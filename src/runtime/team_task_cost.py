"""Per-team-task cost cap enforcement (v12 M28b).

`TeamTaskStore.sum_cost` already adds step + decompose + aggregate cost (see its
docstring); this module is the one-line cap comparison the coordinator ticker calls
every tick before acting, so the cap check lives in ONE place rather than being
inlined at each of the ticker's several call sites.

Accepted v1 limitation — cap is checked BETWEEN ticks, not enforced WITHIN a
still-running step: `check_cost_cap` only sums cost already RECORDED in the store
(`mark_done`'s `cost_usd`), so a step's own in-flight LLM call cannot be killed
mid-call once dispatched, even if that single call's eventual cost would push the
task over `cap_usd`. The cap only stops the task from spawning its NEXT step (or
the next tick's aggregate) once the overage is visible in the recorded total. This is
a deliberate v1 trade-off, not an oversight: a step is one bounded LLM call (no loop,
no agentic tool-calling inside a step), so worst-case overshoot is bounded by one
step's cost, not unbounded; building a kill-on-cap mid-call mechanism would require
either a token-budget-aware LLM client abort path or a wall-clock heuristic kill,
both of which risk truncating a legitimate in-flight response for a marginal, bounded
overspend protection. Revisit only if steps grow loops/multi-call tool use, at which
point the overshoot bound above no longer holds.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.runtime.team_task_store import TeamTaskStore


@dataclass(frozen=True)
class CostCapResult:
    """Whether a team task is still under its cost cap, and the numbers behind it."""

    within_cap: bool
    spent_usd: float
    cap_usd: float


def check_cost_cap(store: TeamTaskStore, task_id: str, *, cap_usd: float) -> CostCapResult:
    """Sum step + decompose + aggregate cost for `task_id` and compare to `cap_usd`.

    `cap_usd` is the caller's resolved `company.yaml::team_task_cap_usd` (default
    $2, v1 has no per-task override) — this function does not read company config
    itself so it stays a pure, easily-tested comparison.
    """
    spent = store.sum_cost(task_id)
    return CostCapResult(within_cap=spent <= cap_usd, spent_usd=spent, cap_usd=cap_usd)
