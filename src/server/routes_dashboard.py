"""HTML dashboard pages (v2 M2-P7).

Server-rendered ops dashboard (Jinja2 + HTMX) over the existing P6 views. Read-only in
this slice: the index (agent list) + the agent-detail page (status / budget / pending
count). Approvals / audit / config / trigger surfaces are added in later slices.

Templates + static resolve from `Path(__file__).parent` (NOT cwd) so the app works when
run via `python -m src.server.app` from the repo root.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.templating import Jinja2Templates

from src.server import agent_views

TEMPLATES_DIR = Path(__file__).parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

router = APIRouter(tags=["dashboard"])


@router.get("/")
def index(request: Request):
    """Dashboard home: the agent list."""
    return templates.TemplateResponse(
        request, "index.html", {"agents": agent_views.list_agents()}
    )


@router.get("/dashboard/agents/{agent_id}")
def agent_detail(agent_id: str, request: Request):
    """One agent: status + budget + pending-approval count.

    Unknown id → 404. A registered-but-broken profile (load/config error) renders a
    degraded page with the error (matching the index, which degrades rather than
    500ing on one bad profile) instead of a raw 500.
    """
    try:
        status = agent_views.agent_status(agent_id)
    except agent_views.UnknownAgentError:
        raise HTTPException(status_code=404, detail=f"unknown agent {agent_id!r}") from None
    except (FileNotFoundError, RuntimeError) as exc:
        return templates.TemplateResponse(
            request, "agent_detail.html", {"s": None, "agent_id": agent_id, "error": str(exc)}
        )
    return templates.TemplateResponse(request, "agent_detail.html", {"s": status})
