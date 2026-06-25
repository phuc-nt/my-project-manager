"""M2-P7 Slice 3: config view/edit (offline TestClient).

The save path is the critical safety surface: validate-in-memory → atomic replace, so a
broken edit is rejected with the exact error and the original file stays byte-unchanged.
Uses a real tmp profiles/<id>/ dir (profile_editor reads/writes it).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.server import agent_views, profile_editor
from src.server.app import create_app

# A minimal valid profile.yaml (stakeholder channel IS in the external set).
_VALID = (
    "name: Acme\n"
    "bindings:\n"
    "  slack:\n"
    "    stakeholder_channel: C_EXT\n"
    "    external_channels: C_EXT\n"
)
# Broken: stakeholder channel NOT in the external set → the Phase-5 guardrail raises.
_BROKEN = (
    "name: Acme\n"
    "bindings:\n"
    "  slack:\n"
    "    stakeholder_channel: C_EXT\n"
    "    external_channels: C_OTHER\n"
)


def _patch(monkeypatch, tmp_path, ids=("acme",)):
    from src.runtime.registry import RegistryEntry

    monkeypatch.setattr(
        agent_views, "load_registry", lambda: tuple(RegistryEntry(i, True) for i in ids)
    )
    # point both the editor's profiles dir AND the data dir at tmp
    profiles = tmp_path / "profiles"
    monkeypatch.setattr(profile_editor, "_PROFILES_DIR", profiles)
    monkeypatch.setattr("src.runtime.agent_paths.DATA_DIR", tmp_path / ".data")
    d = profiles / "acme"
    d.mkdir(parents=True)
    (d / "profile.yaml").write_text(_VALID, encoding="utf-8")
    (d / "SOUL.md").write_text("persona", encoding="utf-8")
    (d / "MEMORY.md").write_text("agent memory line", encoding="utf-8")
    return d


def _client():
    return TestClient(create_app())


def test_config_view_shows_four_files(monkeypatch, tmp_path):
    _patch(monkeypatch, tmp_path)
    r = _client().get("/dashboard/agents/acme/config")
    assert r.status_code == 200
    body = r.text
    assert "profile.yaml" in body and "SOUL.md" in body and "MEMORY.md" in body
    assert "persona" in body  # SOUL content
    assert "agent memory line" in body  # MEMORY content shown
    assert "read-only" in body  # the memory note
    assert "readonly" in body  # the memory textarea is readonly


def test_save_valid_yaml_commits(monkeypatch, tmp_path):
    d = _patch(monkeypatch, tmp_path)
    new = _VALID + "model: x/y\n"
    r = _client().post("/dashboard/agents/acme/config/profile", data={"text": new})
    assert r.status_code == 200
    assert "Saved" in r.text
    assert "model: x/y" in (d / "profile.yaml").read_text(encoding="utf-8")  # committed


def test_save_broken_yaml_rejects_and_keeps_original(monkeypatch, tmp_path):
    d = _patch(monkeypatch, tmp_path)
    original = (d / "profile.yaml").read_bytes()
    r = _client().post("/dashboard/agents/acme/config/profile", data={"text": _BROKEN})
    assert r.status_code == 400
    assert "SLACK_STAKEHOLDER_CHANNEL" in r.text  # the exact guardrail message
    assert (d / "profile.yaml").read_bytes() == original  # original byte-unchanged


def test_save_non_mapping_yaml_400(monkeypatch, tmp_path):
    d = _patch(monkeypatch, tmp_path)
    original = (d / "profile.yaml").read_bytes()
    r = _client().post("/dashboard/agents/acme/config/profile", data={"text": "- a\n- b\n"})
    assert r.status_code == 400
    assert (d / "profile.yaml").read_bytes() == original


def test_save_markdown_soul(monkeypatch, tmp_path):
    d = _patch(monkeypatch, tmp_path)
    r = _client().post("/dashboard/agents/acme/config/soul", data={"text": "new persona"})
    assert r.status_code == 200 and "Saved" in r.text
    assert (d / "SOUL.md").read_text(encoding="utf-8") == "new persona"


def test_memory_save_rejected(monkeypatch, tmp_path):
    d = _patch(monkeypatch, tmp_path)
    before = (d / "MEMORY.md").read_text(encoding="utf-8")
    # the markdown route only accepts soul/project; memory → 400, file untouched
    r = _client().post("/dashboard/agents/acme/config/memory", data={"text": "hacked"})
    assert r.status_code == 400
    assert (d / "MEMORY.md").read_text(encoding="utf-8") == before


def test_config_unknown_agent_404(monkeypatch, tmp_path):
    _patch(monkeypatch, tmp_path, ids=("acme",))
    assert _client().get("/dashboard/agents/ghost/config").status_code == 404
