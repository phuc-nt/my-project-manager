"""Per-agent worker entrypoint (v2 M1-P3).

    python -m src.runtime.worker --agent-id <id> --report <daily|weekly|okr|resource>
                                 [--audience internal|external] [--dry-run]

One worker = one OS process running ONE report for ONE agent, fully isolated: it loads
`profiles/<id>/` at the per-agent data dir `.data/agents/<id>/`, so its gateway/audit/
budget/dedup/approvals/checkpoint all live under that dir (Slice 1). It mirrors the
cron report path but per-agent (data dir + agent-prefixed thread_id), appends a B1
run-event to `runs.jsonl`, and exits 0 (delivered) / 1 (ran, not delivered / error) /
2 (bad invocation or profile load failure). The coordinating service (Slice 3) spawns
this and collects the exit code + the last run-event line.
"""

from __future__ import annotations

import logging
import sys
from collections.abc import Callable
from dataclasses import replace
from typing import Any

from src.profile.context import ProfileContext
from src.profile.loader import LoadedProfile, load_profile
from src.runtime.agent_paths import agent_data_dir, agent_thread_id
from src.runtime.legacy_migration import migrate_legacy_data_dir
from src.runtime.run_event import append_run_event

logger = logging.getLogger(__name__)

# A run_report runs the real graph; injectable so tests stay fully offline (no MCP).
RunReport = Callable[[LoadedProfile, Any, str, str, str], dict]


def _flag_value(args: list[str], flag: str) -> str | None:
    if flag in args:
        i = args.index(flag)
        if i + 1 < len(args):
            return args[i + 1]
    return None


def _report_kind(args: list[str]) -> str:
    return _flag_value(args, "--report") or "daily"


def _audience(args: list[str]) -> str:
    return "external" if _flag_value(args, "--audience") == "external" else "internal"


def _default_run_report(
    loaded: LoadedProfile, settings: Any, kind: str, audience: str, thread_id: str
) -> dict:
    """Real dispatch: build the per-agent graph and run one report (mirrors cron)."""
    from src.agent.checkpoint import get_checkpointer

    context = ProfileContext(persona=loaded.soul, project=loaded.project, memory=loaded.memory)
    cp = get_checkpointer(settings.data_dir / "checkpoints.db")
    if kind == "resource":
        from src.agent.resource_report_graph import build_resource_graph

        graph = build_resource_graph(
            cp, config=loaded.config, settings=settings, context=context, audience=audience
        )
    elif kind == "okr":
        from src.agent.okr_report_graph import build_okr_graph

        graph = build_okr_graph(
            cp, config=loaded.config, settings=settings, context=context, audience=audience
        )
    else:
        from src.agent.report_graph import build_report_graph

        graph = build_report_graph(
            cp, config=loaded.config, settings=settings, context=context,
            report_kind=kind, audience=audience,
        )
    return graph.invoke({}, config={"configurable": {"thread_id": thread_id}})


def main(argv: list[str] | None = None, *, run_report: RunReport = _default_run_report) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = argv if argv is not None else sys.argv[1:]

    agent_id = _flag_value(args, "--agent-id")
    if not agent_id:
        print(
            "usage: python -m src.runtime.worker --agent-id <id> --report <kind>",
            file=sys.stderr,
        )
        return 2
    kind = _report_kind(args)
    audience = _audience(args)
    dry_run = "--dry-run" in args

    # A malformed agent id (path-escape, bad chars) is rejected before any data dir is
    # built — clean exit, no run-event (the data dir is unknown / unsafe).
    try:
        data_dir = agent_data_dir(agent_id)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    # Migrate the v1 .data/ into .data/agents/default/ once, on the first multi-agent run.
    migrate_legacy_data_dir()

    try:
        loaded = load_profile(agent_id, data_dir=data_dir)
    except (FileNotFoundError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        append_run_event(data_dir, _event(agent_id, kind, audience, "load_error", None, False))
        return 2

    settings = loaded.settings
    if dry_run:
        settings = replace(settings, dry_run=True)

    # Preflight the key (mirrors cron) so a misconfigured agent is a clean exit-2
    # `load_error`, not a noisy `status=error` the service would read as a crash.
    if not settings.openrouter_api_key:
        print(f"error: OPENROUTER_API_KEY not set for agent {agent_id!r}.", file=sys.stderr)
        append_run_event(data_dir, _event(agent_id, kind, audience, "load_error", None, False))
        return 2

    thread_id = agent_thread_id(agent_id, kind, audience)
    try:
        result = run_report(loaded, settings, kind, audience, thread_id)
    except Exception as exc:  # noqa: BLE001 — record the failure, never crash the worker
        logger.exception("worker %s/%s failed", agent_id, kind)
        append_run_event(data_dir, _event(agent_id, kind, audience, "error", None, False))
        print(f"error: {exc}", file=sys.stderr)
        return 1

    delivered = bool(result.get("delivered", False))
    cost = result.get("cost_usd")
    status = "delivered" if delivered else "not_delivered"
    append_run_event(data_dir, _event(agent_id, kind, audience, status, cost, delivered))
    logger.info(
        "worker %s %s/%s: delivered=%s %s",
        agent_id, kind, audience, delivered, result.get("delivery_summary", ""),
    )
    return 0 if delivered else 1


def _event(agent_id, kind, audience, status, cost, delivered) -> dict:
    return {
        "agent_id": agent_id, "kind": kind, "audience": audience,
        "status": status, "cost_usd": cost, "delivered": delivered,
    }


if __name__ == "__main__":
    raise SystemExit(main())
