"""Cross-agent team-task store — SQLite at `data_dir` ROOT, not per-agent.

A team task spans MULTIPLE agents (e.g. "chuẩn bị demo cho khách" fans out into steps
each run by a different agent), so unlike `TaskStore` (one file per agent) this store
lives at one shared path: `<data_dir>/team_tasks.sqlite3`. Real cross-process writers
(the coordinator ticker + each spawned worker writing its own step's cost/status) can
hit this concurrently, so it opens **WAL + busy_timeout** — without WAL, two writers in
the same instant would trip `sqlite3.OperationalError: database is locked`.

Two tables:
  - `team_tasks`: the task header (title, status, plan_hash, cost roll-up columns).
  - `team_steps`: one row per DAG step, including the **lease** columns
    (`attempt_id`/`child_pid`/`spawned_at`/`last_seen`/`lease_expires_at`) a worker
    spawn claims via `reserve_step`. Step-row SQL lives in `team_task_steps` (module
    split — this file stays under the repo's LOC guideline).

Reserve-before-spawn / lease semantics: `reserve_step` issues a fresh `attempt_id` UUID
and marks the step `running`. A caller may re-reserve an ALREADY-`running` step ONLY when
its lease has expired (`lease_expired`) AND no outcome artifact exists yet for that
attempt — "the row says running" is an idempotent DB write, not proof a process is
alive, so the artifact-absence check (owned by the coordinator, which knows the
artifact-path convention) is the actual double-spawn guard. `mark_done`/`mark_failed`
additionally accept an `attempt_id` so a stale worker's terminal write, should it ever
race a legitimate re-reserve, is a harmless no-op rather than clobbering the new
attempt's row (see `team_task_steps.set_step_status`'s docstring for the full guard).

Rows here are internal-audience-only (THE INVARIANT): nothing in this store is ever
handed to an external delivery path.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from src.runtime import team_task_steps as _steps
from src.runtime.team_task_paths import team_tasks_db_path, team_tasks_root
from src.runtime.team_task_steps import TeamStep  # re-exported for callers

__all__ = [
    "TeamStep", "TeamTask", "TeamTaskStore", "DEFAULT_LEASE_TTL_S",
    "team_tasks_root", "team_tasks_db_path",
]

#: A reserved-but-not-yet-heartbeating step is considered dead (re-reservable) once
#: this many seconds pass with no heartbeat/spawn record update.
DEFAULT_LEASE_TTL_S = 600

_TASK_STATUSES = ("planning", "open", "running", "done", "cancelled", "stalled")
#: Statuses the coordinator ticker may ACT on — deliberately excludes `planning`
#: (a draft the CEO has previewed but not yet confirmed via `confirm_plan`). The
#: confirm-binds-hash / TOCTOU design (see `confirm_plan`'s docstring) is only real
#: if the ticker never dispatches a step for a task the CEO has not confirmed —
#: `list_open` (visibility: what a status view may show) and `list_dispatchable`
#: (what the ticker may act on) are DELIBERATELY separate lists so a future
#: visibility need for `planning` tasks can never silently reopen the dispatch gate.
_DISPATCHABLE_TASK_STATUSES = ("open", "running")
_OPEN_TASK_STATUSES = ("planning", "open", "running")


@dataclass(frozen=True)
class TeamTask:
    id: str
    title: str
    original_request: str
    status: str
    created_at: str
    assigned_by: str
    cost_usd_total: float
    plan_hash: str | None
    decompose_cost_usd: float
    aggregate_cost_usd: float
    escalated_at: str | None
    steps: tuple[TeamStep, ...] = field(default_factory=tuple)


class TeamTaskStore:
    """SQLite-backed cross-agent store for team tasks + their DAG steps.

    `check_same_thread=False` + WAL + a `busy_timeout` PRAGMA: several OS processes
    (the ticker plus each spawned per-agent worker) open a connection to the SAME
    file concurrently, so both the driver-level thread check and SQLite's default
    rollback-journal locking must be relaxed/widened for a real multi-writer file.
    """

    def __init__(self, db_path: Path, *, lease_ttl_s: int = DEFAULT_LEASE_TTL_S) -> None:
        self._path = db_path
        self._lease_ttl_s = lease_ttl_s
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self._path), check_same_thread=False, timeout=30.0)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=30000")
        self._create_schema()

    def _create_schema(self) -> None:
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS team_tasks ("
            "  id TEXT PRIMARY KEY,"
            "  title TEXT NOT NULL,"
            "  original_request TEXT NOT NULL DEFAULT '',"
            "  status TEXT NOT NULL DEFAULT 'planning',"
            "  created_at TEXT NOT NULL,"
            "  assigned_by TEXT NOT NULL DEFAULT '',"
            "  cost_usd_total REAL NOT NULL DEFAULT 0.0,"
            "  plan_hash TEXT,"
            "  decompose_cost_usd REAL NOT NULL DEFAULT 0.0,"
            "  aggregate_cost_usd REAL NOT NULL DEFAULT 0.0,"
            "  escalated_at TEXT"
            ")"
        )
        _steps.create_schema(self._conn)
        self._conn.commit()

    def _now(self) -> str:
        return datetime.now(UTC).isoformat()

    # ---- task lifecycle -----------------------------------------------------

    def create_task(
        self, *, task_id: str, title: str, original_request: str = "", assigned_by: str = "",
    ) -> str:
        """Create a task row in `planning` status. `task_id` is caller-supplied
        (the coordinator mints it) so it can be referenced before `set_plan`."""
        self._conn.execute(
            "INSERT INTO team_tasks "
            "(id, title, original_request, status, created_at, assigned_by) "
            "VALUES (?, ?, ?, 'planning', ?, ?)",
            (task_id, title, original_request, self._now(), assigned_by),
        )
        self._conn.commit()
        return task_id

    def set_plan(self, task_id: str, steps: list[dict[str, Any]], plan_hash: str) -> None:
        """Attach the confirmed DAG to a task: replaces any existing steps, records
        `plan_hash` (a content hash of the confirmed DAG), and moves the task to
        `open`. Each step dict: `{step_id, title, assigned_to, deps}`.

        Test/fixture convenience (writes + confirms in one call). The REAL CEO-facing
        assign_team_task flow does NOT use this — it uses `set_draft_plan` (preview
        time) then `confirm_plan` (confirm time) so the confirm step can verify the
        CEO is approving the EXACT DAG they were shown, never re-materializing it (see
        `confirm_plan`'s docstring).
        """
        _steps.replace_steps(self._conn, task_id, steps)
        self._conn.execute(
            "UPDATE team_tasks SET plan_hash = ?, status = 'open' WHERE id = ?",
            (plan_hash, task_id),
        )
        self._conn.commit()

    def set_draft_plan(self, task_id: str, steps: list[dict[str, Any]], plan_hash: str) -> None:
        """Persist a PROPOSED (not yet confirmed) DAG: writes the steps + `plan_hash`
        but leaves `status` at `planning` — the task is not dispatchable yet.

        Called once, at `assign_team_task`'s preview step, right after decomposition +
        validation succeed. `plan_hash` is `task_decomposition.decomposition_content_hash`
        of the SAME steps — the CEO's later "xác nhận" must present this exact hash back
        (via `confirm_plan`) or the confirm is rejected as stale/tampered.
        """
        _steps.replace_steps(self._conn, task_id, steps)
        self._conn.execute(
            "UPDATE team_tasks SET plan_hash = ? WHERE id = ?", (plan_hash, task_id),
        )
        self._conn.commit()

    def confirm_plan(self, task_id: str, expected_hash: str) -> bool:
        """TOCTOU-proof confirm: flips a `planning` task to `open` IFF `expected_hash`
        matches the `plan_hash` persisted by `set_draft_plan` — and does NOTHING else.

        Deliberately does NOT re-run decomposition or re-write steps ("re-materialization
        forbidden" — the plan the CEO approves is byte-for-byte the plan that was
        previewed, never a freshly recomputed one that merely claims the same hash).
        Returns False (no-op, task left untouched) when the task is missing, has no
        draft plan, or the hash no longer matches (e.g. a second preview overwrote the
        draft between preview and confirm) — the caller reports this as "kế hoạch đã
        thay đổi, xác nhận lại" rather than silently dispatching a different plan.
        """
        row = self._conn.execute(
            "SELECT plan_hash, status FROM team_tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if row is None:
            return False
        plan_hash, status = row
        if status != "planning" or plan_hash != expected_hash:
            return False
        self._conn.execute("UPDATE team_tasks SET status = 'open' WHERE id = ?", (task_id,))
        self._conn.commit()
        return True

    def get(self, task_id: str) -> TeamTask | None:
        row = self._conn.execute(
            "SELECT * FROM team_tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if row is None:
            return None
        cols = [d[0] for d in self._conn.execute("SELECT * FROM team_tasks LIMIT 0").description]
        data = dict(zip(cols, row, strict=True))
        steps = _steps.steps_for_task(self._conn, task_id)
        return TeamTask(
            id=data["id"], title=data["title"], original_request=data["original_request"],
            status=data["status"], created_at=data["created_at"], assigned_by=data["assigned_by"],
            cost_usd_total=float(data["cost_usd_total"]), plan_hash=data["plan_hash"],
            decompose_cost_usd=float(data["decompose_cost_usd"]),
            aggregate_cost_usd=float(data["aggregate_cost_usd"]),
            escalated_at=data["escalated_at"], steps=steps,
        )

    def list_open(self) -> list[TeamTask]:
        """VISIBILITY list (status views/room feeds) — includes `planning` drafts.
        NEVER use this to decide what the ticker may dispatch; see `list_dispatchable`.
        """
        rows = self._conn.execute(
            f"SELECT id FROM team_tasks WHERE status IN "
            f"({','.join('?' * len(_OPEN_TASK_STATUSES))}) ORDER BY created_at",
            _OPEN_TASK_STATUSES,
        ).fetchall()
        tasks = [self.get(r[0]) for r in rows]
        return [t for t in tasks if t is not None]

    def list_dispatchable(self) -> list[TeamTask]:
        """DISPATCH list — the ONLY task set the coordinator ticker may act on.

        `open`/`running` only: a `planning` task is a CEO-previewed but NOT YET
        `confirm_plan`-confirmed draft. Confirm is the one gate that flips a task out
        of `planning` (see `confirm_plan`'s docstring); the ticker must never
        second-guess that gate by acting on a task still sitting in it.
        """
        rows = self._conn.execute(
            f"SELECT id FROM team_tasks WHERE status IN "
            f"({','.join('?' * len(_DISPATCHABLE_TASK_STATUSES))}) ORDER BY created_at",
            _DISPATCHABLE_TASK_STATUSES,
        ).fetchall()
        tasks = [self.get(r[0]) for r in rows]
        return [t for t in tasks if t is not None]

    def set_task_status(self, task_id: str, status: str) -> None:
        if status not in _TASK_STATUSES:
            raise ValueError(
                f"invalid team task status {status!r}; expected one of {_TASK_STATUSES}"
            )
        self._conn.execute("UPDATE team_tasks SET status = ? WHERE id = ?", (status, task_id))
        self._conn.commit()

    def cancel_draft(self, task_id: str) -> bool:
        """CEO "huỷ" at preview time: terminalize an unconfirmed `planning` draft so it
        can never be picked up by the ticker later. Returns False (no-op) when the task
        is missing or already past `planning` (e.g. confirmed/dispatched in the race
        between preview and this call) — cancelling a live task is `cancel_task`'s job,
        not this one's; a draft is only cancellable while still a draft."""
        cur = self._conn.execute(
            "UPDATE team_tasks SET status = 'cancelled' WHERE id = ? AND status = 'planning'",
            (task_id,),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def record_task_cost(self, task_id: str, *, decompose: float | None = None,
                          aggregate: float | None = None) -> None:
        """Add to `decompose_cost_usd` / `aggregate_cost_usd` (coordinator-level LLM
        spend, distinct from per-step cost). Either kwarg may be omitted."""
        if decompose is not None:
            self._conn.execute(
                "UPDATE team_tasks SET decompose_cost_usd = decompose_cost_usd + ? WHERE id = ?",
                (decompose, task_id),
            )
        if aggregate is not None:
            self._conn.execute(
                "UPDATE team_tasks SET aggregate_cost_usd = aggregate_cost_usd + ? WHERE id = ?",
                (aggregate, task_id),
            )
        self._conn.commit()

    def sum_cost(self, task_id: str) -> float:
        """Total cost for a task = sum of step costs + decompose + aggregate cost."""
        task = self.get(task_id)
        if task is None:
            return 0.0
        step_total = sum(s.cost_usd or 0.0 for s in task.steps)
        return step_total + task.decompose_cost_usd + task.aggregate_cost_usd

    # ---- step lifecycle (delegates to team_task_steps) -----------------------

    def get_step(self, task_id: str, step_id: str) -> TeamStep | None:
        return _steps.get_step(self._conn, task_id, step_id)

    def next_pending_step(self, task_id: str) -> TeamStep | None:
        """The lowest-`seq` `pending` step whose deps are ALL `done` — or None if no
        step is ready yet (either everything is done, or the ready step is blocked on
        a still-running/failed dependency)."""
        return _steps.next_pending_step(self._conn, task_id)

    def reserve_step(self, task_id: str, step_id: str) -> str:
        """Claim a step for a fresh spawn attempt: issues a new `attempt_id`, marks the
        step `running`, sets `spawned_at`/`last_seen`/`lease_expires_at`. Returns the
        `attempt_id` (the lease token the worker must present back on `--attempt-id`).

        Always claims — the caller (the ticker) owns the re-reserve decision (lease
        expired AND outcome artifact absent) BEFORE calling this.
        """
        attempt_id = _steps.reserve_step(
            self._conn, task_id, step_id, lease_ttl_s=self._lease_ttl_s
        )
        self._conn.commit()
        return attempt_id

    def lease_expired(self, task_id: str, step_id: str, *, now: datetime | None = None) -> bool:
        """True when the step's `lease_expires_at` is set and in the past (or the step
        has no lease at all, e.g. still `pending`)."""
        return _steps.lease_expired(self._conn, task_id, step_id, now=now)

    def verify_attempt(self, task_id: str, step_id: str, attempt_id: str) -> bool:
        """True iff the step is `running` with EXACTLY this `attempt_id` — the check a
        worker makes before doing any work, so a stale/forged/absent attempt-id is a
        clean no-op rather than a duplicate spawn racing the legitimate one."""
        return _steps.verify_attempt(self._conn, task_id, step_id, attempt_id)

    def record_spawn(self, task_id: str, step_id: str, pid: int) -> None:
        _steps.record_spawn(self._conn, task_id, step_id, pid)
        self._conn.commit()

    def heartbeat(self, task_id: str, step_id: str) -> None:
        """Refresh `last_seen` + push `lease_expires_at` out another TTL window — the
        long-running-but-alive path (distinct from a dead lease)."""
        _steps.heartbeat(self._conn, task_id, step_id, lease_ttl_s=self._lease_ttl_s)
        self._conn.commit()

    def mark_running(self, task_id: str, step_id: str) -> None:
        _steps.set_step_status(self._conn, task_id, step_id, "running")
        self._conn.commit()

    def mark_awaiting_approval(self, task_id: str, step_id: str, *,
                                attempt_id: str | None = None,
                                approval_id: int | None = None) -> bool:
        """Mark a step paused on an approval gate. Same `attempt_id` no-op guard as
        `mark_done` — the worker that hit the gate passes its own attempt_id; the
        ticker's later resume-path call (re-spawn) passes none (it holds no lease).

        `approval_id` (the `ApprovalStore` row id the gateway queued this write under,
        `GatewayResult.approval_id`) is persisted on the step so the ticker can later
        poll that SAME approval and resume the step once a human decides — a step
        marked `awaiting_approval` with no `approval_id` (e.g. every test double that
        gates on a plain bool, or any future gate not backed by `ApprovalStore`) is
        simply never auto-resumed by the ticker; it stays exactly as un-pollable as
        before this field existed.
        """
        updated = _steps.set_step_status(
            self._conn, task_id, step_id, "awaiting_approval", attempt_id=attempt_id,
            approval_id=approval_id,
        )
        self._conn.commit()
        return updated

    def mark_done(self, task_id: str, step_id: str, *, outcome_ref: str | None = None,
                  cost_usd: float | None = None, attempt_id: str | None = None) -> bool:
        """Mark a step done. When `attempt_id` is given, the write only applies if that
        is still the step's CURRENT lease (see `team_task_steps.set_step_status`) —
        returns False (no-op) if a newer attempt has since reserved the step."""
        updated = _steps.set_step_status(
            self._conn, task_id, step_id, "done", outcome_ref=outcome_ref, cost_usd=cost_usd,
            attempt_id=attempt_id,
        )
        self._conn.commit()
        return updated

    def mark_failed(self, task_id: str, step_id: str, *, outcome_ref: str | None = None,
                     cost_usd: float | None = None, attempt_id: str | None = None) -> bool:
        """Mark a step failed. Same `attempt_id` no-op guard as `mark_done`."""
        updated = _steps.set_step_status(
            self._conn, task_id, step_id, "failed", outcome_ref=outcome_ref, cost_usd=cost_usd,
            attempt_id=attempt_id,
        )
        self._conn.commit()
        return updated

    def mark_timeout(self, task_id: str, step_id: str, *, attempt_id: str | None = None) -> bool:
        """Mark a step timed out. Same `attempt_id` no-op guard as `mark_done`/
        `mark_failed`: the ticker passes the lease it read the step under, so a
        concurrent re-reservation (a second ticker instance, or the worker's own
        terminal write racing this one) makes this a clean no-op instead of clobbering
        a newer attempt's row. Returns True iff a row was actually updated."""
        updated = _steps.set_step_status(
            self._conn, task_id, step_id, "timeout", attempt_id=attempt_id
        )
        self._conn.commit()
        return updated

    def append_outcome(self, task_id: str, step_id: str, outcome_ref: str) -> None:
        """Record the handoff-artifact path a step produced (does not change status)."""
        _steps.append_outcome(self._conn, task_id, step_id, outcome_ref)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()
