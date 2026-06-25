"""M2-P7 Slice 1: read-only dashboard pages (offline TestClient).

Monkeypatches agent_views.list_agents / agent_status (the views are independently
tested in test_server_agents.py) so the HTML routes are exercised without real
registry/profile files. Asserts the rendered HTML + that the 4 P6 JSON routes stay
byte-stable (the dashboard is purely additive).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.server import agent_views
from src.server.app import create_app


def _client() -> TestClient:
    return TestClient(create_app())


def test_index_renders_agent_list(monkeypatch):
    monkeypatch.setattr(
        agent_views, "list_agents",
        lambda: [
            {"id": "acme", "name": "Acme", "enabled": True,
             "last_run": {"kind": "daily", "audience": "internal", "status": "delivered",
                          "ts": "2026-06-25T12:00:00+00:00"}},
            {"id": "beta", "name": "Beta", "enabled": False, "last_run": None},
        ],
    )
    r = _client().get("/")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    body = r.text
    assert "Acme" in body and "Beta" in body
    assert "/dashboard/agents/acme" in body  # row links to detail
    assert "/static/htmx.min.js" in body  # htmx referenced
    assert "never run" in body  # beta has no last_run


def test_agent_detail_renders_status(monkeypatch):
    monkeypatch.setattr(
        agent_views, "agent_status",
        lambda i: {
            "id": "acme", "name": "Acme", "enabled": True,
            "last_run": {"kind": "daily", "audience": "internal", "status": "delivered",
                         "cost_usd": 0.0012, "ts": "2026-06-25T12:00:00+00:00"},
            "budget": {"spent": 12.5, "cap": 50.0, "ratio": 0.25},
            "pending_approvals": 3,
        },
    )
    r = _client().get("/dashboard/agents/acme")
    assert r.status_code == 200
    body = r.text
    assert "12.5" in body and "50" in body  # budget numbers
    assert ">3<" in body or "3" in body  # pending count
    assert "Acme" in body


def test_agent_detail_unknown_404(monkeypatch):
    def _raise(i):
        raise agent_views.UnknownAgentError(i)

    monkeypatch.setattr(agent_views, "agent_status", _raise)
    assert _client().get("/dashboard/agents/ghost").status_code == 404


def test_agent_detail_broken_profile_degrades_not_500(monkeypatch):
    # A registered-but-broken profile renders a degraded page (not a 500), matching
    # how the index degrades a bad profile rather than failing.
    def _raise(i):
        raise RuntimeError("bad profile.yaml: SLACK_STAKEHOLDER_CHANNEL not in external set")

    monkeypatch.setattr(agent_views, "agent_status", _raise)
    r = _client().get("/dashboard/agents/acme")
    assert r.status_code == 200
    assert "broken profile" in r.text
    assert "bad profile.yaml" in r.text


def test_static_htmx_served():
    r = _client().get("/static/htmx.min.js")
    assert r.status_code == 200  # mount works, file exists


def test_p6_json_routes_unchanged(monkeypatch):
    # The dashboard is additive — /api/agents still returns the same JSON shape.
    from src.runtime.registry import RegistryEntry

    monkeypatch.setattr(agent_views, "load_registry", lambda: (RegistryEntry("acme", True),))
    monkeypatch.setattr(
        agent_views, "load_profile",
        lambda i, **k: type("LP", (), {"name": "Acme", "enabled": True})(),
    )
    monkeypatch.setattr(agent_views, "read_last_run_event", lambda i: None)
    r = _client().get("/api/agents")
    assert r.status_code == 200
    body = r.json()
    assert body[0]["id"] == "acme" and "name" in body[0] and "enabled" in body[0]
    assert r.headers["content-type"].startswith("application/json")
