"""Team-task decomposition: schema + deterministic validation (v12 M28b).

One bounded, synchronous LLM call turns a CEO brief into a `DecomposedTask` (a DAG of
at most 7 steps). The LLM only proposes; every hard constraint (step count, DAG
acyclicity, `assigned_to` role authorization) is re-checked here in CODE, not trusted
from the model's output — the same "LLM fills, code validates" split the ops chat-ops
catalog and slot-filling engine already use.

Role authz: `assigned_to` must be a company staff id (an ENABLED registry agent id,
excluding the coordinator itself and the admin agent — see
`team_task_roster.assignable_staff`, the single source of truth both gates below call).
This gate runs twice by design: once here at decompose-validation time (before the CEO
ever sees a preview, via `ops_assign_team_task._staff_roster`), and again at dispatch
time in the coordinator ticker (`coordinator_nodes.tick_actions.reserve_and_spawn`, via
`CoordinatorDeps.roster_ok`, in case the registry/roles changed between confirm and
dispatch) — a step whose assignee is no longer valid must never silently run; the
dispatch-time re-check marks the step `failed` + escalates instead of spawning it.
"""

from __future__ import annotations

import json
from collections.abc import Iterable

from pydantic import BaseModel, Field, field_validator, model_validator

#: Hard ceiling on a single team task's DAG — keeps a decomposition reviewable in one
#: CEO preview and bounds worst-case fan-out cost.
MAX_STEPS = 7


class TeamStepPlan(BaseModel):
    """One proposed DAG step (pre-persistence — the store's own `TeamStep` is the
    persisted shape; this is the LLM-facing/validation-facing shape)."""

    step_id: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=300)
    assigned_to: str = Field(min_length=1, max_length=40)
    deps: tuple[str, ...] = Field(default_factory=tuple)

    @field_validator("step_id", "assigned_to")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title must not be blank")
        return v


class DecomposedTask(BaseModel):
    """The LLM's proposed decomposition of a CEO brief into a step DAG.

    `requires_approval=True` is fixed (v1 decision): a team task's own external writes
    still go through the normal per-agent Lớp B gate — this flag is documentary/forward
    -compatible, not a bypass switch.
    """

    steps: tuple[TeamStepPlan, ...] = Field(min_length=1, max_length=MAX_STEPS)
    requires_approval: bool = True

    @field_validator("steps")
    @classmethod
    def _unique_step_ids(cls, steps: tuple[TeamStepPlan, ...]) -> tuple[TeamStepPlan, ...]:
        seen: set[str] = set()
        for s in steps:
            if s.step_id in seen:
                raise ValueError(f"duplicate step_id {s.step_id!r}")
            seen.add(s.step_id)
        return steps

    @model_validator(mode="after")
    def _deps_reference_known_steps(self) -> DecomposedTask:
        ids = {s.step_id for s in self.steps}
        for s in self.steps:
            unknown = [d for d in s.deps if d not in ids]
            if unknown:
                raise ValueError(f"step {s.step_id!r} depends on unknown step(s) {unknown}")
            if s.step_id in s.deps:
                raise ValueError(f"step {s.step_id!r} cannot depend on itself")
        return self


class DecompositionError(ValueError):
    """Raised by `validate_decomposition` — always carries a CEO/operator-facing
    message (no internals leaked), matching `ops_catalog`'s ValueError convention."""


def parse_decomposed_task(raw_json: str) -> DecomposedTask:
    """Parse the LLM's raw JSON completion into a `DecomposedTask`.

    Raises `DecompositionError` on anything that is not valid JSON or does not match
    the schema — the caller (ops_catalog.assign_team_task) retries on this (bounded,
    before the CEO ever sees a preview)."""
    try:
        doc = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise DecompositionError(f"phân rã không phải JSON hợp lệ: {exc}") from None
    if not isinstance(doc, dict):
        raise DecompositionError("phân rã phải là một object JSON")
    try:
        return DecomposedTask.model_validate(doc)
    except Exception as exc:  # noqa: BLE001 — pydantic ValidationError, wrapped uniformly
        raise DecompositionError(f"phân rã không hợp lệ: {exc}") from None


def _acyclic(steps: tuple[TeamStepPlan, ...]) -> bool:
    """Kahn's algorithm: True iff the deps graph has no cycle."""
    indeg = {s.step_id: 0 for s in steps}
    adj: dict[str, list[str]] = {s.step_id: [] for s in steps}
    for s in steps:
        for d in s.deps:
            adj[d].append(s.step_id)
            indeg[s.step_id] += 1
    queue = [sid for sid, deg in indeg.items() if deg == 0]
    visited = 0
    while queue:
        node = queue.pop()
        visited += 1
        for nxt in adj[node]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    return visited == len(steps)


def validate_decomposition(
    task: DecomposedTask, *, staff_ids: Iterable[str],
) -> DecomposedTask:
    """Deterministic, code-side gate — bounds + acyclic DAG + role authz.

    `staff_ids`: the set of valid `assigned_to` targets. The codebase has no separate
    "company staff roster" beyond the fleet registry (`company.yaml` carries identity +
    coordinator id + cost cap only, no staff list) — the caller passes
    `{e.id for e in load_registry()}` (optionally filtered to `enabled` entries) as the
    staff set. Documented interpretation, not silently assumed.

    Raises `DecompositionError` (never lets a bad step through) so the caller can turn
    it into a clean CEO-facing message.
    """
    if not (1 <= len(task.steps) <= MAX_STEPS):
        raise DecompositionError(
            f"số bước phải từ 1 đến {MAX_STEPS} (nhận được {len(task.steps)})"
        )
    if not _acyclic(task.steps):
        raise DecompositionError("kế hoạch có vòng lặp phụ thuộc (dependency cycle)")

    staff = set(staff_ids)
    unauthorized = sorted({s.assigned_to for s in task.steps if s.assigned_to not in staff})
    if unauthorized:
        raise DecompositionError(
            f"các bước được giao cho agent không tồn tại/không hợp lệ: {', '.join(unauthorized)}"
        )
    return task


def decomposition_content_hash(task: DecomposedTask) -> str:
    """Deterministic content hash of the confirmed DAG (TOCTOU-proof binding, req 4).

    Canonical JSON (sorted keys, stable step order) so the SAME decomposition always
    hashes the same, and any mutation (added/removed/reassigned step) changes the hash
    — confirm re-verifies this hash before dispatch is ever allowed."""
    import hashlib

    canonical = json.dumps(
        {
            "steps": [
                {"step_id": s.step_id, "title": s.title, "assigned_to": s.assigned_to,
                 "deps": list(s.deps)}
                for s in task.steps
            ],
        },
        sort_keys=True, ensure_ascii=True, separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
