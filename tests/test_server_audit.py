"""M2-P7 Slice 3: audit rows view (offline TestClient)."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from src.server import agent_views
from src.server.app import create_app


def _patch(monkeypatch, tmp_path, ids=("acme",)):
    from src.runtime.registry import RegistryEntry

    monkeypatch.setattr(
        agent_views, "load_registry", lambda: tuple(RegistryEntry(i, True) for i in ids)
    )
    monkeypatch.setattr("src.runtime.agent_paths.DATA_DIR", tmp_path / ".data")


def _seed_audit(tmp_path, agent_id, lines):
    d = tmp_path / ".data" / "agents" / agent_id / "audit"
    d.mkdir(parents=True, exist_ok=True)
    (d / "audit.jsonl").write_text(
        "\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8"
    )


def _client():
    return TestClient(create_app())


def test_audit_rows_render(monkeypatch, tmp_path):
    _patch(monkeypatch, tmp_path)
    _seed_audit(tmp_path, "acme", [
        {"timestamp": "2026-06-25T12:00:00+00:00", "verdict": "allow",
         "tool": "slack:post_message", "reason": "executed"},
        {"timestamp": "2026-06-25T12:01:00+00:00", "verdict": "deny",
         "tool": "gh_cli:push", "reason": "Lớp A: force-push"},
    ])
    r = _client().get("/dashboard/agents/acme/audit")
    assert r.status_code == 200
    body = r.text
    assert "slack:post_message" in body and "allow" in body
    assert "gh_cli:push" in body and "deny" in body


def test_audit_empty_shows_placeholder(monkeypatch, tmp_path):
    _patch(monkeypatch, tmp_path)  # no audit file seeded
    r = _client().get("/dashboard/agents/acme/audit")
    assert r.status_code == 200
    assert "no audit entries" in r.text


def test_audit_unknown_agent_404(monkeypatch, tmp_path):
    _patch(monkeypatch, tmp_path, ids=("acme",))
    assert _client().get("/dashboard/agents/ghost/audit").status_code == 404


def test_audit_limit_zero_clamped_not_all(monkeypatch, tmp_path):
    # limit is clamped to >=1: limit=0 must NOT return the whole log unbounded.
    _patch(monkeypatch, tmp_path)
    _seed_audit(tmp_path, "acme", [
        {"timestamp": f"2026-06-25T12:0{i}:00+00:00", "verdict": "allow",
         "tool": f"t{i}", "reason": "x"} for i in range(5)
    ])
    r = _client().get("/dashboard/agents/acme/audit?limit=0")
    assert r.status_code == 200
    assert r.text.count("<code>allow</code>") == 1  # clamped to 1, not all 5
