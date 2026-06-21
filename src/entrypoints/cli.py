"""CLI entrypoint.

    uv run python -m src.entrypoints.cli "your message"   # hello-agent (Phase 0)
    uv run python -m src.entrypoints.cli report           # progress report (Phase 1)

`report` reads Jira + GitHub, detects risks, composes a report, and posts it to
Slack through the Action Gateway. Both paths need OPENROUTER_API_KEY; `report`
additionally needs the MCP server builds + tokens (see deployment-guide.md).
"""

from __future__ import annotations

import logging
import sys

from src.agent.checkpoint import get_checkpointer
from src.agent.graph import build_graph
from src.config.settings import get_settings


def _require_key() -> bool:
    if not get_settings().openrouter_api_key:
        print(
            "OPENROUTER_API_KEY is not set. Copy config.example.env to .env and fill it in.",
            file=sys.stderr,
        )
        return False
    return True


def _run_hello(message: str) -> int:
    graph = build_graph(get_checkpointer())
    result = graph.invoke(
        {"user_input": message, "llm_response": "", "cost_usd": None},
        config={"configurable": {"thread_id": "cli"}},
    )
    print(result["llm_response"])
    cost = result.get("cost_usd")
    print(f"\n[cost: {f'${cost:.6f}' if cost is not None else 'unknown'}]", file=sys.stderr)
    return 0


def _run_report(report_kind: str) -> int:
    # Imported here so the hello path (and tests) don't pull in MCP/report deps.
    from src.agent.report_graph import build_report_graph

    graph = build_report_graph(get_checkpointer(), report_kind=report_kind)
    result = graph.invoke({}, config={"configurable": {"thread_id": f"report-{report_kind}"}})

    print(result.get("report_text", "(no report)"))
    cost = result.get("cost_usd")
    delivered = result.get("delivered")
    print(
        f"\n[{report_kind} · delivered: {delivered} · {result.get('delivery_summary', '')} · "
        f"cost: {f'${cost:.6f}' if cost is not None else 'unknown'}]",
        file=sys.stderr,
    )
    return 0


def _parse_report_kind(args: list[str]) -> str:
    """`report [--daily|--weekly]` → kind; default daily."""
    if "--weekly" in args:
        return "weekly"
    return "daily"


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print(
            'usage: python -m src.entrypoints.cli "your message" | report [--daily|--weekly]',
            file=sys.stderr,
        )
        return 2

    if not _require_key():
        return 1

    if args[0] == "report":
        return _run_report(_parse_report_kind(args[1:]))
    return _run_hello(" ".join(args))


if __name__ == "__main__":
    raise SystemExit(main())
