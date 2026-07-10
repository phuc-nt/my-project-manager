"""Shared "who can be assigned a team-task step" computation (v12 M28b).

One function, used at BOTH gates `task_decomposition.py`'s module docstring documents:
decompose-validation time (`ops_assign_team_task.preview_assign_team_task`, before the
CEO ever sees a preview) and dispatch time (the coordinator ticker, in case the
registry/roles changed between confirm and dispatch — see `coordinator_graph.py`).
Both call sites MUST agree on the same exclusion rules, or a step could pass one gate
and silently fail (or worse, silently pass) the other.

Excluded from the assignable roster, even though they are enabled registry agents:
  - the coordinator itself (`company.yaml::coordinator_id`) — it dispatches team-task
    steps, it does not execute them.
  - the admin agent (`domain == "admin"`) — the CEO's fleet-overseer/ops-chat agent,
    not a line worker; giving it a team-task step would let a CEO brief accidentally
    grant a team-task step the admin agent's config-write ops-chat privileges.
"""

from __future__ import annotations


def assignable_staff() -> list[tuple[str, str]]:
    """`[(agent_id, domain), ...]` for every ENABLED registry agent that is neither the
    coordinator nor the admin agent — the valid `assigned_to` targets for a team-task
    step. A registry entry with no loadable profile is skipped (can't authorize a role
    we can't even read)."""
    from src.profile.loader import load_profile
    from src.runtime.agent_paths import agent_data_dir
    from src.runtime.company import load_company
    from src.runtime.registry import load_registry

    coordinator_id = load_company().coordinator_id
    roster: list[tuple[str, str]] = []
    for entry in load_registry():
        if not entry.enabled or entry.id == coordinator_id:
            continue
        try:
            loaded = load_profile(entry.id, data_dir=agent_data_dir(entry.id))
        except (FileNotFoundError, RuntimeError):
            continue
        if loaded.domain == "admin":
            continue
        roster.append((entry.id, loaded.domain))
    return roster


def is_assignable(agent_id: str) -> bool:
    """True iff `agent_id` is currently a valid team-task step assignee — same rules
    as `assignable_staff`, as a single-id check for the dispatch-time re-verify."""
    return any(a == agent_id for a, _ in assignable_staff())
