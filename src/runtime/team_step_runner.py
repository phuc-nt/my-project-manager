"""Team-task step runner — the `team-step` generic run kind's body.

Mirrors `task_runner.py`/`ops_alert_runner.py`: worker.py's `team-step` branch calls
straight into `run_team_step`, which does everything for ONE step:

  1. verify the presented `attempt_id` is the CURRENT lease on this step (reject as a
     clean no-op otherwise — see module docstring on `team_task_store.verify_attempt`);
  2. run the `team_task_graph` (perceive reads the prior step's handoff artifact, work
     calls the LLM, deliver writes THIS step's handoff artifact);
  3. record the outcome in the store (`mark_done`/`mark_failed`/`mark_awaiting_approval`)
     and return a dict the worker turns into a run-event + exit code.

The worker branch (not this module) owns writing the run-event and the fallback outcome
artifact on an exception this function itself doesn't catch — this function raises on
setup failures (bad task/step) so the caller's `except Exception` still produces a
'failed' outcome artifact + a non-zero exit, matching the "write outcome on EVERY exit
path" requirement.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

#: Result "status" values `run_team_step` returns — the worker maps these to an exit code.
STATUS_DONE = "done"
STATUS_REJECTED = "rejected"  # bad/absent/mismatched attempt_id — clean no-op
STATUS_PAUSED = "paused"  # a Lớp B interrupt inside the step's graph (exit 3)


def run_team_step(
    loaded: Any, settings: Any, *, task_id: str, step_id: str, attempt_id: str,
) -> dict:
    """Run one team-task step. Returns `{status, cost_usd, delivered, room_message}`.

    `status`:
      - `"rejected"`: the attempt_id lease didn't match (no work done, no artifact
        written) — the worker treats this as a clean no-op error (exit 1).
      - `"done"`: the step ran to completion (delivered artifact written).
      - `"failed"`: the step's graph raised — the CALLER (worker) catches the
        exception this function re-raises and writes the failed outcome artifact.
      - `"paused"`: a Lớp B interrupt inside a step's graph (an external write went to
        `pending_approval`) — the worker maps this to exit 3 / `awaiting_approval`.

    Lease safety: every terminal store write in this function (`mark_done`/
    `mark_failed`) passes `attempt_id`, so if the ticker has since killed this worker
    for a lease timeout and re-reserved the step (new `attempt_id`), the write is a
    no-op against the new attempt's row instead of corrupting it or double-counting
    cost. `store.heartbeat(...)` is called at each graph node boundary (perceive/work/
    deliver, via `_run_graph`'s injected hook) so a step that is genuinely still
    working keeps refreshing its own lease and the ticker's unconditional
    kill-on-expiry never fires against live work.
    """
    from src.runtime.team_task_paths import team_tasks_db_path
    from src.runtime.team_task_store import TeamTaskStore

    store = TeamTaskStore(team_tasks_db_path())
    try:
        if not store.verify_attempt(task_id, step_id, attempt_id):
            logger.warning(
                "team-step %s/%s: attempt_id %r does not match the current lease — "
                "rejecting as a no-op", task_id, step_id, attempt_id,
            )
            return {"status": STATUS_REJECTED, "cost_usd": None, "delivered": False,
                     "room_message": ""}

        step = store.get_step(task_id, step_id)
        task = store.get(task_id)
        if step is None or task is None:
            logger.warning(
                "team-step %s/%s: task/step vanished after lease verify", task_id, step_id
            )
            return {"status": STATUS_REJECTED, "cost_usd": None, "delivered": False,
                     "room_message": ""}

        def _touch() -> None:
            try:
                store.heartbeat(task_id, step_id)
            except Exception:  # noqa: BLE001 — a heartbeat write must never fail the step
                logger.warning("team-step %s/%s: heartbeat write failed", task_id, step_id)

        result = _run_graph(
            loaded, settings, task_id=task_id, step=step, on_node=_touch,
        )
        if result.get("status") == "awaiting_approval":
            store.mark_awaiting_approval(task_id, step_id, attempt_id=attempt_id)
            return {"status": STATUS_PAUSED, "cost_usd": result.get("cost_usd"),
                     "delivered": False, "room_message": ""}
        cost = result.get("cost_usd")
        store.mark_done(
            task_id, step_id,
            outcome_ref=f"team-tasks/{task_id}/step-{step.seq}.json", cost_usd=cost,
            attempt_id=attempt_id,
        )
        room_message = result.get("room_message", "")
        _append_step_event(
            task_id, author=step.assigned_to, task_title=task.title, step_title=step.title,
            kind="handoff", status="done", message=room_message,
        )
        return {
            "status": STATUS_DONE, "cost_usd": cost, "delivered": bool(result.get("delivered")),
            "room_message": room_message,
        }
    except Exception:
        # The graph or store call failed — mark the step failed so a stuck lease
        # doesn't block the DAG forever, then re-raise so the WORKER (caller) writes
        # the failed outcome artifact + failed run-event + exit 1 (single place that
        # does artifact writes on the failure path, matching every other exit).
        try:
            store.mark_failed(task_id, step_id, attempt_id=attempt_id)
        except Exception:  # noqa: BLE001 — never let a store write mask the original error
            logger.exception("team-step %s/%s: failed to record failure status", task_id, step_id)
        _task = locals().get("task")
        _step = locals().get("step")
        _append_step_event(
            task_id, author=_step.assigned_to if _step is not None else "coordinator",
            task_title=_task.title if _task is not None else task_id,
            step_title=_step.title if _step is not None else step_id,
            kind="step_status", status="failed", message="",
        )
        raise
    finally:
        store.close()


def _append_step_event(
    task_id: str, *, author: str, task_title: str, step_title: str, kind: str, status: str,
    message: str,
) -> None:
    """try/degrade room-event append for one step's outcome (done → `handoff` with the
    graph's own `room_message`; failed → `step_status`) — never raises, matching
    `office_room_append.append_office_event`'s own contract.

    `assigned_to` always equals `author` here (the worker posting its OWN outcome), but
    is still carried explicitly in the body — the office-room reducer keys a desk by
    `assigned_to`, never by `author`, so every `step_status`/`handoff` producer (this one
    and the ticker's `started` event) agrees on one field name regardless of who the
    authoring identity is.
    """
    from src.runtime.office_room_append import append_office_event

    body: dict[str, str] = {"task_title": task_title, "step_title": step_title, "status": status,
                            "assigned_to": author}
    if kind == "handoff":
        body["message"] = message
    append_office_event(task_id, author=author, kind=kind, body=body, also_office=True)


def _run_graph(
    loaded: Any, settings: Any, *, task_id: str, step, on_node: Callable[[], None] | None = None,
) -> dict:
    """Build + invoke the team_task_graph for one step (no checkpointer — a single
    step is a one-shot invoke, not a resumable multi-turn conversation like a report
    graph; resumability across steps is the store's job, not the graph's).

    `on_node`, when given, is called after EACH node (perceive/work/deliver) finishes —
    the heartbeat hook that keeps a genuinely-still-working step's lease from expiring
    mid-run. Uses `.stream(stream_mode="updates")` instead of `.invoke()` so we observe
    node completion without changing the graph's own node functions.
    """
    from src.agent.team_task_graph import build_team_task_graph
    from src.company_docs.pool import load_company_docs
    from src.profile.context import EMPTY, ProfileContext
    from src.runtime.team_task_paths import team_tasks_root
    from src.skills.skill_pool import build_skill_context

    if loaded is not None:
        skills, selector = build_skill_context(loaded, settings)
        context = ProfileContext(
            persona=loaded.soul, project=loaded.project, memory=loaded.memory,
            skills=skills, skill_selector=selector,
            company_docs=load_company_docs(getattr(loaded, "company_docs", ())),
        )
    else:
        context = EMPTY

    graph = build_team_task_graph(
        settings=settings, context=context, step_title=step.title,
        data_dir=team_tasks_root(), task_id=task_id, step_seq=step.seq,
        search_hook=_resolve_search_hook(loaded, settings),
    )
    state: dict[str, Any] = {"step_title": step.title}
    for update in graph.stream({"step_title": step.title}, stream_mode="updates"):
        for node_output in update.values():
            if isinstance(node_output, dict):
                state.update(node_output)
        if on_node is not None:
            on_node()
    return state


def _resolve_search_hook(loaded: Any, settings: Any) -> Callable[[str], str] | None:
    """Build the real `search_hook` iff the agent's profile opted in (`web_search:
    true`) AND at least one provider key is configured — either gate absent ⇒ None
    (the graph's `work` node then skips search entirely, a clean no-op degrade).

    Wires `web_search`'s own `audit_log` param to the shared team-tasks audit trail
    (`team_tasks_root()/audit/audit.jsonl` — the same shared-root convention
    `team_task_paths.py` uses for the store DB and handoff artifacts; a team step is
    cross-agent by design, so its egress audit belongs in that shared trail, not a
    per-agent one) so every real search call — not just tests — leaves a redacted-query
    audit row, matching the Action Gateway's "no audit => no write" posture applied to
    this tool's own network egress.
    """
    if loaded is None or not getattr(loaded, "web_search", False):
        return None
    from src.audit.audit_log import AuditLog
    from src.runtime.team_task_paths import team_tasks_root
    from src.tools.search_result_formatter import format_search_results
    from src.tools.web_search_tool import WebSearchConfig, web_search

    config = WebSearchConfig(
        tavily_api_key=getattr(settings, "tavily_api_key", None),
        brave_api_key=getattr(settings, "brave_api_key", None),
    )
    if not config.available():
        return None

    audit_log = AuditLog(team_tasks_root() / "audit" / "audit.jsonl")

    def _hook(query: str) -> str:
        results = web_search(query, config=config, audit_log=audit_log)
        text, _count, _quarantined = format_search_results(results)
        return text

    return _hook
