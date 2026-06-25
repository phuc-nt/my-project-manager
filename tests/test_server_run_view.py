"""M2-P7 Slice 3: the trigger + live-stream view (offline — form rendering only).

The actual trigger/stream behavior is covered by the P6 run tests; here we only verify
the run view renders a form that targets the EXISTING /api/agents/{id}/trigger +
/api/runs/ stream routes (string checks; no run started).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.server import agent_views
from src.server.app import create_app


def _patch(monkeypatch, ids=("acme",)):
    from src.runtime.registry import RegistryEntry

    monkeypatch.setattr(
        agent_views, "load_registry", lambda: tuple(RegistryEntry(i, True) for i in ids)
    )


def _client():
    return TestClient(create_app())


def test_run_view_renders_form(monkeypatch):
    _patch(monkeypatch)
    r = _client().get("/dashboard/agents/acme/run")
    assert r.status_code == 200
    body = r.text
    assert "/api/agents/acme/trigger" in body  # form posts the EXISTING trigger route
    assert "/api/runs/" in body  # opens the EXISTING SSE stream
    assert "kind" in body and "audience" in body and "dry" in body  # the form fields


def test_run_view_unknown_agent_404(monkeypatch):
    _patch(monkeypatch, ids=("acme",))
    assert _client().get("/dashboard/agents/ghost/run").status_code == 404
