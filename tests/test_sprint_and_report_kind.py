"""Slice 3: sprint parsing + daily/weekly prompt + cli/cron kind dispatch."""

from __future__ import annotations

from datetime import date

from src.entrypoints.cli import _parse_report_kind
from src.llm.report_prompt import REPORT_TITLES, build_detail_messages
from src.tools.jira_read import parse_sprint
from src.tools.models import Risk

RISKS = [Risk(kind="blocker", severity="high", subject="AB-1", detail="d", suggested_action="a")]


def test_parse_sprint_real_shape():
    raw = {
        "id": 2,
        "name": "SCRUM Sprint 0",
        "state": "active",
        "startDate": "2026-06-21T15:51:18.494Z",
        "endDate": "2026-07-05T15:51:18.494Z",
    }
    s = parse_sprint(raw)
    assert s.id == "2"
    assert s.name == "SCRUM Sprint 0"
    assert s.state == "active"
    assert s.start_date == date(2026, 6, 21)
    assert s.end_date == date(2026, 7, 5)


def test_parse_sprint_missing_id_raises():
    import pytest

    with pytest.raises(ValueError, match="missing 'id'"):
        parse_sprint({"name": "x"})


def test_daily_prompt_is_short_no_sprint():
    msg = build_detail_messages(RISKS, report_date="2026-06-22", kind="daily")[1]["content"]
    assert "DAILY STANDUP" in msg
    assert "Sprint:" not in msg


def test_weekly_prompt_has_sprint_review_and_context():
    ctx = "Sprint: S0 (active), 2026-06-21 → 2026-07-05."
    msg = build_detail_messages(
        RISKS, report_date="2026-06-22", kind="weekly", sprint_context=ctx
    )[1]["content"]
    assert "SPRINT REVIEW" in msg
    assert "Sprint: S0" in msg


def test_report_titles():
    assert REPORT_TITLES["daily"] == "Daily Standup"
    assert REPORT_TITLES["weekly"] == "Sprint Review"


def test_cli_parse_report_kind():
    assert _parse_report_kind([]) == "daily"
    assert _parse_report_kind(["--daily"]) == "daily"
    assert _parse_report_kind(["--weekly"]) == "weekly"


def test_cron_no_key_returns_one(monkeypatch, tmp_path):
    # cron reaches the kind dispatch then exits 1 cleanly with no key (no network).
    import src.config.settings as settings_mod
    from src.entrypoints.cron import main as cron_main

    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setattr(settings_mod, "REPO_ROOT", tmp_path)  # empty dir -> no .env
    settings_mod.get_settings.cache_clear()
    try:
        assert cron_main(["--weekly"]) == 1
        assert cron_main(["--daily"]) == 1
    finally:
        settings_mod.get_settings.cache_clear()
