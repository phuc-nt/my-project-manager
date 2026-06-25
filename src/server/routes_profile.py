"""Config view/edit + the trigger-run view for the dashboard (v2 M2-P7 Slice 3).

Config: profile.yaml editable (validate-then-atomic-replace via profile_editor), SOUL.md
/ PROJECT.md editable (free text), MEMORY.md read-only (agent self-writes it). Save
errors return a 400 error partial with the EXACT validation message. Run view: a form
that hx-posts the EXISTING /api/agents/{id}/trigger then opens the EXISTING SSE stream.
HTML-partial / htmx-native throughout. Every route validates the agent id first (404).
"""

from __future__ import annotations

from fastapi import APIRouter, Form, HTTPException, Request

from src.server import agent_views, profile_editor
from src.server.routes_dashboard import templates

router = APIRouter(tags=["config"])


def _require_registered(agent_id: str) -> None:
    if agent_id not in {e.id for e in agent_views.load_registry()}:
        raise HTTPException(status_code=404, detail=f"unknown agent {agent_id!r}")


@router.get("/dashboard/agents/{agent_id}/config")
def config_view(agent_id: str, request: Request):
    """The 4-file config view: yaml/soul/project editable, memory read-only."""
    _require_registered(agent_id)
    files = profile_editor.read_profile_files(agent_id)
    return templates.TemplateResponse(
        request, "config/view.html", {"agent_id": agent_id, "f": files}
    )


@router.post("/dashboard/agents/{agent_id}/config/profile")
def save_profile(agent_id: str, request: Request, text: str = Form(...)):
    """Save profile.yaml: validate in memory → atomic replace; a bad edit → 400, original kept."""
    _require_registered(agent_id)
    try:
        profile_editor.save_profile_yaml(agent_id, text)
    except (ValueError, RuntimeError) as exc:
        return templates.TemplateResponse(
            request, "config/error.html", {"error": str(exc)}, status_code=400
        )
    return templates.TemplateResponse(request, "config/saved.html", {"what": "profile.yaml"})


@router.post("/dashboard/agents/{agent_id}/config/{md}")
def save_md(agent_id: str, md: str, request: Request, text: str = Form(...)):
    """Save SOUL.md / PROJECT.md (free text). Any other name (incl. memory) → 400."""
    _require_registered(agent_id)
    filename = {"soul": "SOUL.md", "project": "PROJECT.md"}.get(md)
    if filename is None:
        return templates.TemplateResponse(
            request, "config/error.html",
            {"error": f"{md!r} is not editable (only soul / project)."}, status_code=400,
        )
    profile_editor.save_markdown(agent_id, filename, text)
    return templates.TemplateResponse(request, "config/saved.html", {"what": filename})


@router.get("/dashboard/agents/{agent_id}/run")
def run_view(agent_id: str, request: Request):
    """The trigger form + live SSE viewer (calls the existing trigger/stream routes)."""
    _require_registered(agent_id)
    return templates.TemplateResponse(request, "run/view.html", {"agent_id": agent_id})
