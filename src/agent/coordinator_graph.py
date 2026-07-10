"""Coordinator ticker (v12 M28b): one SHORT tick, one action, exit.

Runs on the coordinator agent (`company.yaml::coordinator_id`) as the `team-tick`
generic pseudo-kind (mirrors `tasks`/`ops-alerts`) — NOT a long-running process. Every
tick: pick ONE open team task, take ONE action on it, return. No 600s-worker-kill risk
because a tick never blocks on a spawned worker (it spawns DETACHED and moves on).

Tick actions, in priority order for a given task:
  1. A step is `pending` with all deps `done` -> reserve the lease + spawn a DETACHED
     `team-step` worker (do not wait for it).
  2. A step is `running` -> poll it: dead pid + no outcome artifact -> retry once, then
     `failed`; lease expired -> kill the pid, mark `timeout`, escalate to Telegram.
  3. A step is `awaiting_approval` WITH an `approval_id` (the gateway queued its
     external write in `ApprovalStore`) -> poll that approval: `approved` ->
     re-reserve + re-spawn the SAME step (there is no LangGraph checkpointer on this
     graph — resuming means re-running perceive/work/deliver from scratch, and
     `deliver`'s external write is gateway-dedup-idempotent against the earlier
     attempt, see `team_task_graph.py`'s module docstring); `rejected` -> mark the
     step `failed` + escalate; still `pending` (no decision yet) -> leave it, exactly
     like an `awaiting_approval` step with NO `approval_id` (e.g. a test double, or a
     gate this ticker never learned an id for) — the lease clock is considered PAUSED
     for `awaiting_approval` by construction; only `running` steps are ever polled for
     lease expiry (see `coordinator_nodes.tick_actions.poll_running_step`), never an
     `awaiting_approval` one, approval-decided-or-not.
  4. All steps `done` -> aggregate (one LLM summarize call) -> deliver a room payload,
     mark the task `done`, record the aggregate cost.
  5. Cost cap exceeded (step + decompose + aggregate) -> stop the task, mark `stalled`,
     escalate.
  6. No ready/running/awaiting step AND not all-done, but at least one step is
     terminally `failed`/`timeout` (retries exhausted, approval rejected, lease
     timeout) -> the task can never complete as planned: mark `stalled`, escalate
     exactly once (the status transition itself removes the task from
     `list_dispatchable()`, so no later tick re-enters this branch for it).

Before any of the above: the persisted DAG's content hash is re-verified against the
task's `plan_hash` on every tick (`_verify_plan_hash`) — a mismatch stalls the task +
escalates instead of ever dispatching a step from an unverified plan (this is a fast,
idempotent no-op comparison in the normal case; steps never legitimately change once
`confirm_plan` flips a task out of `planning`).

Reboot recovery is free: there is no separate "resume" trigger — the next tick simply
re-reads `team_task_store` and continues from whatever it sees (a `running` step with a
dead pid is caught by action 2 on the very next tick).

Retry counting has no column in the P2 store schema (only `escalated_at` at the task
level), so `RetryTracker` is an injectable small counter this module owns (the real
one is a JSON sidecar file, see `team_tick_runner.py`).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from src.agent.coordinator_nodes.tick_actions import (
    aggregate_and_deliver,
    poll_awaiting_approval_step,
    poll_running_step,
    reserve_and_spawn,
)
from src.runtime.team_task_cost import check_cost_cap
from src.runtime.team_task_store import TeamStep, TeamTask, TeamTaskStore

logger = logging.getLogger(__name__)

#: A step's lease is considered dead-worth-killing after this long with no heartbeat
#: (phase default: 10 minutes). The store's own `lease_expires_at` already encodes this
#: TTL at `reserve_step` time (see `TeamTaskStore.__init__`'s `lease_ttl_s`); this
#: constant is the ticker's OWN default when constructing that store.
DEFAULT_STEP_TIMEOUT_S = 600


@dataclass
class RetryTracker:
    """Injectable retry-count store, keyed by `(task_id, step_id)`. The real
    implementation (a JSON sidecar `team_tick_runner.py` owns) persists across ticks;
    tests use a plain in-memory dict-backed instance."""

    get: Callable[[str, str], int]
    increment: Callable[[str, str], int]
    clear: Callable[[str, str], None]


def in_memory_retry_tracker() -> RetryTracker:
    """A simple dict-backed tracker for tests / a single-process caller."""
    counts: dict[tuple[str, str], int] = {}

    def _get(task_id: str, step_id: str) -> int:
        return counts.get((task_id, step_id), 0)

    def _increment(task_id: str, step_id: str) -> int:
        key = (task_id, step_id)
        counts[key] = counts.get(key, 0) + 1
        return counts[key]

    def _clear(task_id: str, step_id: str) -> None:
        counts.pop((task_id, step_id), None)

    return RetryTracker(get=_get, increment=_increment, clear=_clear)


@dataclass
class CoordinatorDeps:
    """Every side-effecting collaborator the ticker needs — real callables in
    production (`team_tick_runner.py`), fakes/doubles in tests. Keeping every OS/
    network/LLM touchpoint here is what makes `run_one_tick` deterministic to test."""

    store: TeamTaskStore
    retry_tracker: RetryTracker
    cost_cap_usd: float
    step_timeout_s: int = DEFAULT_STEP_TIMEOUT_S
    # spawn(task_id, step) -> child pid. Spawns a DETACHED `team-step` worker for the
    # given step's `attempt_id` lease (already reserved by the caller) and returns
    # immediately — must NOT block on the child.
    spawn_step: Callable[[TeamTask, TeamStep, str], int] = lambda *_: 0
    # pid_alive(pid) -> True if the process is still running.
    pid_alive: Callable[[int], bool] = lambda _pid: False
    # kill_pid(pid, attempt_id) -> None. Best-effort; swallow "already dead" internally.
    # `attempt_id` lets the real implementation guard against PID reuse (verify the
    # live process is actually THIS step's worker before sending SIGKILL — see
    # `team_tick_runner._kill_pid`'s docstring) — a test double may ignore it.
    kill_pid: Callable[[int, str], None] = lambda _pid, _attempt_id: None
    # approval_status(approval_id) -> "pending" | "approved" | "rejected" | None. Reads
    # the SAME `ApprovalStore` `mpm approve`/`mpm reject` write to (None ⇒ the id no
    # longer resolves, e.g. a corrupted/foreign id — treated as still-pending, never
    # as an implicit approve). Default: always "pending" (never auto-resumes) so a
    # caller that does not wire this collaborator leaves an awaiting_approval step
    # alone forever (never auto-resumed), matching every
    # existing test that never sets `approval_id` on a step at all).
    approval_status: Callable[[int], str | None] = lambda _approval_id: "pending"
    # roster_ok(agent_id) -> True iff agent_id is CURRENTLY a valid team-task step
    # assignee (enabled registry agent, excluding the coordinator + admin agent — see
    # `team_task_roster.is_assignable`). Re-checked at DISPATCH time (not just at
    # decompose-validation time) so a step whose assignee was demoted/disabled/removed
    # between confirm and dispatch never silently spawns. Default: always True, so a
    # caller that does not wire this collaborator leaves every agent id dispatchable
    # (matching every existing test's fake "agent-a"/"agent-b" ids).
    roster_ok: Callable[[str], bool] = lambda _agent_id: True
    # aggregate(task) -> (summary_text, cost_usd). One LLM call over all step results.
    aggregate: Callable[[TeamTask], tuple[str, float | None]] = lambda _t: ("", None)
    # deliver_room(task, message) -> None. Posts the final summary to the group room
    # (P4's room store — until that lands this may be a no-op/log-only double).
    deliver_room: Callable[[TeamTask, str], None] = lambda *_: None
    # escalate(task, step, event_kind, message) -> None. Telegram best-effort —
    # MUST NOT raise (try/degrade is the caller's job per the phase spec); this
    # callable's own contract is "never raises", enforced by team_tick_runner's real
    # implementation, not by this graph.
    escalate: Callable[[TeamTask, TeamStep | None, str, str], None] = lambda *_: None
    now: Callable[[], datetime] = lambda: datetime.now(UTC)


@dataclass(frozen=True)
class TickResult:
    """What one tick did, for logging/tests — never raises, always returns this."""

    task_id: str | None
    action: str  # "none" | "spawned" | "failed" | "timeout_escalated" | "aggregated" |
    #               "cap_exceeded" | "stalled" — plan_hash mismatch at dispatch-read,
    #               OR a dead-end step (failed/timeout, no retry left) with no other
    #               actionable step this tick (see `_dead_end_result`); both share the
    #               "stalled" action value, `detail` distinguishes the reason.
    #               NOTE: a dead-pid retry re-spawns immediately and surfaces as
    #               "spawned" (not a distinct "retried" value) — the retry count
    #               itself lives in `RetryTracker`, inspectable separately; a step
    #               only reaches a terminal, test-visible "failed" once retries are
    #               exhausted.
    detail: str = ""


def run_one_tick(deps: CoordinatorDeps) -> TickResult:
    """Advance exactly ONE open team task by exactly ONE action, then return.

    Task selection: the first task in `list_dispatchable()` order (oldest first,
    `open`/`running` ONLY — a CEO-previewed but not-yet-`confirm_plan`-confirmed
    `planning` draft is invisible to the ticker by construction, closing the
    confirm-bypass window) that actually has something actionable this tick — a task
    with no ready step and nothing running (e.g. every step already
    `awaiting_approval`) is skipped so the tick still inspects the next task instead
    of doing nothing at all.
    """
    open_tasks = deps.store.list_dispatchable()
    if not open_tasks:
        return TickResult(task_id=None, action="none", detail="no open tasks")

    for task in open_tasks:
        result = _act_on_task(deps, task)
        if result.action != "none":
            return result
    return TickResult(task_id=None, action="none", detail="no actionable step in any open task")


def _act_on_task(deps: CoordinatorDeps, task: TeamTask) -> TickResult:
    hash_result = _verify_plan_hash(deps, task)
    if hash_result is not None:
        return hash_result

    cap = check_cost_cap(deps.store, task.id, cap_usd=deps.cost_cap_usd)
    if not cap.within_cap:
        deps.store.set_task_status(task.id, "stalled")
        deps.escalate(
            task, None, "cost_cap_exceeded",
            f"Việc '{task.title}' vượt trần chi phí (${cap.spent_usd:.4f} > "
            f"${cap.cap_usd:.2f}) — đã dừng, cần CEO xem lại.",
        )
        return TickResult(task_id=task.id, action="cap_exceeded",
                          detail=f"${cap.spent_usd:.4f} > ${cap.cap_usd:.2f}")

    running = [s for s in task.steps if s.status == "running"]
    for step in running:
        result = poll_running_step(deps, task, step)
        if result.action != "none":
            return result

    awaiting = [s for s in task.steps if s.status == "awaiting_approval" and s.approval_id]
    for step in awaiting:
        result = poll_awaiting_approval_step(deps, task, step)
        if result.action != "none":
            return result

    ready = deps.store.next_pending_step(task.id)
    if ready is not None:
        return reserve_and_spawn(deps, task, ready)

    if task.steps and all(s.status == "done" for s in task.steps):
        return aggregate_and_deliver(deps, task)

    dead_end = _dead_end_result(deps, task)
    if dead_end is not None:
        return dead_end

    return TickResult(task_id=task.id, action="none", detail="nothing actionable")


def _dead_end_result(deps: CoordinatorDeps, task: TeamTask) -> TickResult | None:
    """Task-lifecycle dead-end: a step that reaches terminal `failed`/`timeout`
    with no retry left only terminalizes ITSELF — `all(s.status == "done" ...)` above
    never becomes true, `next_pending_step` never returns anything either (a step
    depending on the dead one is permanently unready), so the task would otherwise sit
    `open` forever, invisible as broken to the CEO (no aggregate, no escalation, no
    terminal status). Reached only once nothing else this tick claimed the task
    (no ready step, not all-done) — if ANY step is `failed`/`timeout` AND no OTHER step
    is still genuinely in flight (`running` or `awaiting_approval`, which may yet
    complete and let a later tick's `all(done)` succeed independent of the dead one's
    dependents), the task can never complete as planned; stall it + escalate exactly
    once. "Exactly once" is enforced by the status transition itself:
    `set_task_status(..., "stalled")` removes the task from `list_dispatchable()`'s
    `open`/`running` set, so no later tick can ever re-enter this branch for the same
    task.
    """
    dead_steps = [s for s in task.steps if s.status in ("failed", "timeout")]
    if not dead_steps:
        return None
    in_flight = any(s.status in ("running", "awaiting_approval") for s in task.steps)
    if in_flight:
        return None

    deps.store.set_task_status(task.id, "stalled")
    names = ", ".join(f"'{s.title}'" for s in dead_steps)
    deps.escalate(
        task, None, "task_stalled_dead_step",
        f"Việc '{task.title}' bị dừng: (các) bước {names} thất bại/quá hạn và không "
        "còn được thử lại — cần CEO xem lại.",
    )
    return TickResult(task_id=task.id, action="stalled", detail=f"dead step(s): {names}")


def _verify_plan_hash(deps: CoordinatorDeps, task: TeamTask) -> TickResult | None:
    """Dispatch-read hash re-check: `confirm_plan`'s TOCTOU binding only
    proves the CEO approved this exact DAG at CONFIRM time — it does not by itself
    prove the persisted `team_steps` rows are still that same DAG by the time the
    ticker actually reads them (e.g. a bug or an out-of-band DB write between confirm
    and dispatch). Recomputes the SAME content hash `task_decomposition
    .decomposition_content_hash` produces (it only reads `step_id`/`title`/
    `assigned_to`/`deps`, which `TeamStep` also exposes, so it works unmodified against
    the persisted rows) and compares against the stored `plan_hash` on EVERY tick
    (cheap + idempotent — the steps never legitimately change after confirm, so this
    is a no-op comparison in the common case) before any dispatch action is taken this
    tick. A mismatch means the on-disk plan no longer matches what was approved: stall
    the task + escalate rather than ever dispatching a step from an unverified DAG.

    Returns None (proceed normally) when the hash matches or the task has no steps yet
    (nothing to verify); a terminal `TickResult` when it stalls the task.
    """
    if not task.steps:
        return None
    from src.agent.task_decomposition import decomposition_content_hash

    recomputed = decomposition_content_hash(task)  # duck-typed: TeamStep has the same fields
    if task.plan_hash == recomputed:
        return None

    deps.store.set_task_status(task.id, "stalled")
    deps.escalate(
        task, None, "plan_hash_mismatch",
        f"Việc '{task.title}' bị dừng: kế hoạch trên đĩa không khớp kế hoạch đã được "
        "CEO xác nhận — cần CEO xem lại.",
    )
    return TickResult(task_id=task.id, action="stalled", detail="plan_hash mismatch")
