"""`team_tick_collaborators.make_escalate` (v12 final-review escalation-reachability
redesign): the office-room `milestone` append must happen FIRST and UNCONDITIONALLY,
before any attempt at a direct coordinator Telegram send — the admin agent's
milestone-mirror ops-tick (`milestone_mirror_runner`) polls the room and DMs the CEO
regardless of whether the coordinator has its own Telegram binding, so a coordinator
with no bot of its own (the 1-click bootstrap default) still has a working escalation
path via the mirror.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.runtime.office_room_store import OFFICE_ROOM_ID, OfficeRoomStore
from src.runtime.team_task_steps import TeamStep
from src.runtime.team_task_store import TeamTask
from src.runtime.team_tick_collaborators import make_escalate


@pytest.fixture(autouse=True)
def _isolated_team_tasks_root(monkeypatch, tmp_path):
    """Every test in this module writes through the shared cross-agent root (store,
    artifacts, office-room appends) — pin it to tmp_path so no test can touch the
    real install's .data (the office room is a real user-visible surface)."""
    monkeypatch.setattr("src.runtime.team_task_paths.DATA_DIR", tmp_path)

def _task(task_id="t1"):
    return TeamTask(
        id=task_id, title="Demo task", original_request="lam demo", status="running",
        created_at="2026-07-10T00:00:00", assigned_by="ceo", cost_usd_total=0.0,
        plan_hash="h", decompose_cost_usd=0.0, aggregate_cost_usd=0.0, escalated_at=None,
    )


def _step():
    return TeamStep(
        task_id="t1", step_id="s1", seq=1, title="draft", assigned_to="agent-a", deps=(),
        status="running", outcome_ref=None, cost_usd=None, attempt_id="attempt-1",
        child_pid=None, spawned_at=None, last_seen=None, lease_expires_at=None,
        escalated_at=None, approval_id=None,
    )


def _loaded_no_telegram():
    return SimpleNamespace(config=SimpleNamespace(telegram=None, slack_external_channels=()))


def test_escalate_appends_the_room_milestone_even_with_no_coordinator_telegram_binding(
    tmp_path, monkeypatch,
):
    """The headline regression this test pins: a coordinator with NO Telegram binding
    of its own must still leave a trace in the office room — the mirror path is the
    ONLY way the CEO ever hears about this escalation, so a silent early-return here
    would make the escalation vanish entirely."""
    from src.runtime import team_task_paths

    monkeypatch.setattr(team_task_paths, "DATA_DIR", tmp_path)

    escalate = make_escalate(_loaded_no_telegram(), settings=SimpleNamespace())
    escalate(_task(), _step(), "step_failed", "bước draft thất bại 3 lần")

    store = OfficeRoomStore(team_task_paths.team_tasks_root() / "office_room.sqlite3")
    try:
        office_rows = store.list(OFFICE_ROOM_ID)
        task_rows = store.list("t1")
    finally:
        store.close()

    assert len(office_rows) == 1
    assert office_rows[0].kind == "milestone"
    assert office_rows[0].body["task_title"] == "Demo task"
    assert office_rows[0].body["milestone"] == "step_failed"
    # also_office=True mirrors the SAME event into both the task room and "office".
    assert len(task_rows) == 1
    assert task_rows[0].kind == "milestone"


def test_escalate_room_append_survives_even_if_the_gateway_import_itself_would_fail(
    tmp_path, monkeypatch,
):
    """The room append is wrapped in its OWN try/except, independent of the Telegram
    send block below it — an exception constructing the gateway (bad settings, missing
    env) must not retroactively un-append the room event that already succeeded."""
    from src.runtime import team_task_paths

    monkeypatch.setattr(team_task_paths, "DATA_DIR", tmp_path)

    telegram = SimpleNamespace(bot_token_env="X", chat_ids=("op-1",), poll_minutes=5,
                               ops_operator_id="op-1")
    loaded = SimpleNamespace(config=SimpleNamespace(telegram=telegram, slack_external_channels=()))

    class _ExplodingGateway:
        def __init__(self, *a, **kw):
            raise RuntimeError("gateway boom")

    monkeypatch.setattr("src.actions.action_gateway.ActionGateway", _ExplodingGateway)

    escalate = make_escalate(loaded, settings=SimpleNamespace())
    escalate(_task(), _step(), "step_failed", "bước draft thất bại")  # must not raise

    store = OfficeRoomStore(team_task_paths.team_tasks_root() / "office_room.sqlite3")
    try:
        office_rows = store.list(OFFICE_ROOM_ID)
    finally:
        store.close()
    assert len(office_rows) == 1


def test_escalate_step_none_omits_step_id_from_dedup_hint_without_crashing(tmp_path, monkeypatch):
    """A task-level escalation (no single step responsible, e.g. `task_stuck`) passes
    `step=None` — must not crash on `step.step_id`."""
    from src.runtime import team_task_paths

    monkeypatch.setattr(team_task_paths, "DATA_DIR", tmp_path)

    escalate = make_escalate(_loaded_no_telegram(), settings=SimpleNamespace())
    escalate(_task(), None, "task_stuck", "việc bị kẹt")  # must not raise

    store = OfficeRoomStore(team_task_paths.team_tasks_root() / "office_room.sqlite3")
    try:
        office_rows = store.list(OFFICE_ROOM_ID)
    finally:
        store.close()
    assert len(office_rows) == 1
    assert office_rows[0].body["milestone"] == "task_stuck"
