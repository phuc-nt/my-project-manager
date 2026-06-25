"""Recent per-agent audit rows for the dashboard (v2 M2-P7 Slice 3).

Reuses `AuditLog.query` (newest-first, already-redacted dicts) over the agent's own
audit JSONL. HTML-partial: returns the rows fragment that swaps into the detail page.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from src.server import agent_views
from src.server.routes_dashboard import templates

router = APIRouter(tags=["audit"])


@router.get("/dashboard/agents/{agent_id}/audit")
def audit_rows(agent_id: str, request: Request, tool: str | None = None,
               verdict: str | None = None, limit: int = 20):
    """Recent audit entries (newest first), optionally filtered by tool/verdict."""
    if agent_id not in {e.id for e in agent_views.load_registry()}:
        raise HTTPException(status_code=404, detail=f"unknown agent {agent_id!r}")
    from src.audit.audit_log import AuditLog
    from src.runtime.agent_paths import agent_data_dir

    path = agent_data_dir(agent_id) / "audit" / "audit.jsonl"
    limit = max(1, min(limit, 200))  # clamp: no unbounded table / no limit=0 = all rows
    entries = AuditLog(path).query(tool=tool, verdict=verdict, limit=limit)
    return templates.TemplateResponse(
        request, "audit/rows.html", {"agent_id": agent_id, "entries": entries}
    )
