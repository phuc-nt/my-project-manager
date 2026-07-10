"""Task execution graph: `perceive → work → deliver`.

Runs ONE step of a team task, on ONE agent, as the `team-step` generic run kind (see
`worker.py`). Per-agent isolation is unchanged — this graph runs inside the SAME
per-agent subprocess/data-dir/gateway every other report graph runs in; the only new
thing is where its input/output come from: not Jira/GitHub, but the team-task handoff
artifact (`team_task_artifact`) written by the PREVIOUS step.

  - `perceive`: reads the step brief (title + task context) + the handoff artifact
    from the previous step (if any). No handoff yet (first step) ⇒ empty context.
  - `work`: one LLM call with the agent's persona/skills/company docs injected (same
    seam every report graph uses), producing the step's result text. `search_hook`
    is an injectable, OPTIONAL web-search callable — None (no-op, the default) when
    the caller has no real search wired in.
  - `deliver`: writes the result to `step-<n>.json` (internal artifact — THE
    INVARIANT: no external write happens here) and returns a room-message payload
    (a short human-readable line the coordinator can post to the group chat). A step
    that itself needs an EXTERNAL write (e.g. "post this to Slack") does so through
    the normal per-agent `ActionGateway` via the optional `deps.external_write` hook,
    called from `deliver` BEFORE the internal artifact is written. If the gateway
    answers `pending_approval` (trust ladder / Lớp B queue — same contract as every
    other write path, see `action_gateway.GatewayResult`), `deliver` does NOT write
    the internal artifact yet and the graph reports `status: "awaiting_approval"` in
    its result instead of completing; the CALLER (`team_step_runner.run_team_step`)
    maps this to the worker's exit-3 / `awaiting_approval` step status. There is no
    LangGraph checkpointer on this graph (each step is a one-shot per-process
    invoke — see `build_team_task_graph`), so there is no resumable in-flight state
    to restore: the coordinator ticker POLLS the step's stored `approval_id` against
    `ApprovalStore` every tick (`coordinator_nodes.tick_actions
    .poll_awaiting_approval_step`) — once the CEO resolves it out-of-band (`mpm
    approve`/`mpm reject`), the very next tick re-reserves the SAME step and it
    re-runs `perceive → work → deliver` from scratch (approve) or marks it `failed` +
    escalates (reject). `deliver`'s external write MUST therefore be idempotent/
    safe-to-retry from the gateway's own dedup, exactly like every other scheduled
    report's external delivery.

State holds only primitives (checkpoint-safe), matching every other report graph.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from typing_extensions import TypedDict

from src.company_docs.inject import company_docs_text
from src.profile.context import EMPTY, ProfileContext
from src.skills.skill_selector import select_skill_text

if TYPE_CHECKING:
    from src.config.settings import Settings

logger = logging.getLogger(__name__)

#: Optional web-search hook: query -> result text. None (default) ⇒ `work` skips
#: search entirely.
SearchHook = Callable[[str], str]


class TeamStepState(TypedDict, total=False):
    """State for one team-task step run. `total=False`: each node fills its slice."""

    step_title: str  # the step's brief (what this agent must do)
    handoff_context: str  # prior step's result text, "" if this is the first step
    result_text: str  # this step's produced output (written to the artifact)
    cost_usd: float | None
    room_message: str  # short line for the group-chat room (deliver's output)
    delivered: bool  # True once the artifact write succeeds
    status: str  # "done" (default) | "awaiting_approval" — set by deliver


@dataclass
class TeamTaskDeps:
    """Injectable collaborators for the team-task step flow (real or fake in tests)."""

    # perceive: reads the handoff artifact left by the previous step (or "" if none).
    read_handoff: Callable[[], str]
    # work: runs the LLM call (persona/skills/company docs already folded in by the
    # caller) and returns (result_text, cost_usd). Receives the resolved search hook.
    run_work: Callable[[str, str, SearchHook | None], tuple[str, float | None]]
    # deliver: writes the internal artifact + builds the room message; returns
    # (delivered, room_message).
    deliver_step: Callable[[str], tuple[bool, str]]
    search_hook: SearchHook | None = None
    # Optional external write (e.g. post to Slack) attempted BEFORE the internal
    # artifact write. Returns True (proceed to internal artifact write) or False
    # (gateway answered pending_approval — deliver stops short, graph reports
    # status="awaiting_approval"). None (default): no external write, always proceeds.
    external_write: Callable[[str], bool] | None = None


def default_team_task_deps(
    *,
    settings: Settings,
    context: ProfileContext = EMPTY,
    step_title: str,
    data_dir: Any,
    task_id: str,
    step_seq: int,
    search_hook: SearchHook | None = None,
) -> TeamTaskDeps:
    """Wire the real collaborators. Lazy imports keep graph-build network-free.

    `data_dir`/`task_id`/`step_seq` locate the handoff artifact this step reads
    (its OWN previous-step artifact — the caller passes the correct `step_seq - 1`
    convention via `read_handoff`'s closure, see `build_team_task_graph`).
    """
    from src.llm.client import LlmClient
    from src.llm.team_task_prompt import build_team_step_messages

    llm_box: dict[str, LlmClient] = {}

    def _read_handoff() -> str:
        from src.agent.team_task_artifact import read_step_artifact

        if step_seq <= 1:
            return ""  # first step: no prior handoff
        prior = read_step_artifact(data_dir, task_id, step_seq - 1)
        if prior is None:
            return ""
        return str(prior.get("result_text", ""))

    def _run_work(
        title: str, handoff: str, hook: SearchHook | None
    ) -> tuple[str, float | None]:
        search_text = ""
        if hook is not None:
            try:
                search_text = hook(title)
            except Exception as exc:  # noqa: BLE001 — search is best-effort, never fatal
                logger.warning("team-step search hook failed, continuing without it: %s", exc)
                search_text = ""
        try:
            llm = llm_box.get("llm")
            if llm is None:
                llm = LlmClient(settings)
                llm_box["llm"] = llm
            result = llm.complete(
                build_team_step_messages(
                    step_title=title,
                    handoff_context=handoff,
                    search_context=search_text,
                    persona=context.persona,
                    project=context.project,
                    memory=context.memory,
                    skills=select_skill_text(context, "internal", kind="team-step"),
                    company_docs=company_docs_text(context, "internal"),
                )
            )
            return result.content, result.cost_usd
        except Exception as exc:  # noqa: BLE001 — surfaced to the caller as a failed step
            logger.warning("team-step work failed: %s", exc)
            raise

    def _deliver(result_text: str) -> tuple[bool, str]:
        from src.agent.team_task_artifact import write_step_artifact

        write_step_artifact(
            data_dir, task_id, step_seq,
            {"status": "done", "result_text": result_text, "step_title": step_title},
        )
        room_message = _room_message(step_title, result_text)
        return True, room_message

    return TeamTaskDeps(
        read_handoff=_read_handoff, run_work=_run_work, deliver_step=_deliver,
        search_hook=search_hook,
    )


def _room_message(step_title: str, result_text: str) -> str:
    """A short human-readable line for the group-chat room — the first ~200 chars of
    the result, not the full text (the room is a summary feed, not a report viewer)."""
    snippet = result_text.strip().replace("\n", " ")
    if len(snippet) > 200:
        snippet = snippet[:197] + "..."
    return f"[{step_title}] {snippet}" if snippet else f"[{step_title}] (không có nội dung)"


def _make_team_task_nodes(deps: TeamTaskDeps):
    def perceive(state: TeamStepState) -> dict:
        handoff = deps.read_handoff()
        return {"handoff_context": handoff}

    def work(state: TeamStepState) -> dict:
        title = state.get("step_title", "")
        handoff = state.get("handoff_context", "")
        result_text, cost = deps.run_work(title, handoff, deps.search_hook)
        return {"result_text": result_text, "cost_usd": cost}

    def deliver(state: TeamStepState) -> dict:
        result_text = state.get("result_text", "")
        if deps.external_write is not None:
            proceed = deps.external_write(result_text)
            if not proceed:
                return {"status": "awaiting_approval", "delivered": False, "room_message": ""}
        delivered, room_message = deps.deliver_step(result_text)
        return {"status": "done", "delivered": delivered, "room_message": room_message}

    return perceive, work, deliver


def build_team_task_graph(
    checkpointer: BaseCheckpointSaver | None = None,
    *,
    settings: Settings | None = None,
    context: ProfileContext = EMPTY,
    deps: TeamTaskDeps | None = None,
    step_title: str = "",
    data_dir: Any = None,
    task_id: str = "",
    step_seq: int = 1,
    search_hook: SearchHook | None = None,
) -> CompiledStateGraph:
    """Build + compile the team-task step graph. `deps` defaults to real wiring.

    When `deps` is None, `settings`/`data_dir`/`task_id`/`step_seq` are required (they
    wire the real handoff-artifact read/write + LLM call); a caller that injects
    `deps` directly (tests) need not pass them.
    """
    if deps is None:
        if settings is None or data_dir is None or not task_id:
            raise ValueError(
                "build_team_task_graph needs settings + data_dir + task_id when "
                "deps is not provided."
            )
        deps = default_team_task_deps(
            settings=settings, context=context, step_title=step_title, data_dir=data_dir,
            task_id=task_id, step_seq=step_seq, search_hook=search_hook,
        )
    perceive, work, deliver = _make_team_task_nodes(deps)

    builder = StateGraph(TeamStepState)
    builder.add_node("perceive", perceive)
    builder.add_node("work", work)
    builder.add_node("deliver", deliver)
    builder.add_edge(START, "perceive")
    builder.add_edge("perceive", "work")
    builder.add_edge("work", "deliver")
    builder.add_edge("deliver", END)
    return builder.compile(checkpointer=checkpointer)
