"""Shared ops helpers for the dashboard write surfaces (v2 M4-S4).

`_require_agent` + `_gateway` were defined inline in `routes_approvals.py` (htmx). M4 adds
JSON sibling routes that need the IDENTICAL per-request agent-load + gateway-build (so the
React approve path is the same real path as the htmx one). Extracted here so both UIs share
one definition; the htmx routes are deleted in S5 but this helper survives.
"""

from __future__ import annotations

from fastapi import HTTPException

from src.server import agent_views


def require_agent(agent_id: str):
    """Load a REGISTERED agent's profile at its own data dir, or raise 404.

    The registry-membership check also covers path-escape: a malformed id is never
    registered, so it never reaches a data-dir build.
    """
    from src.profile.loader import load_profile
    from src.runtime.agent_paths import agent_data_dir

    if agent_id not in {e.id for e in agent_views.load_registry()}:
        raise HTTPException(status_code=404, detail=f"unknown agent {agent_id!r}")
    return load_profile(agent_id, data_dir=agent_data_dir(agent_id))


def build_gateway(loaded):
    """Build the per-request per-agent ActionGateway (caller MUST close it in a finally).

    Same construction the CLI/worker use — external channels injected so a stakeholder post
    routes through Lớp B. The gateway is the ONLY write path; this just builds it.
    """
    from src.actions.action_gateway import ActionGateway

    return ActionGateway(
        loaded.settings, external_channels=loaded.config.slack_external_channels
    )
