"""Assigned-task runner (v6 M15) — one tick over an agent's open tasks. Generic.

The coordinating service fires the pseudo-kind `tasks` on a cadence (like the M11 inbox
poll). One run: for each OPEN task whose reminder cadence is due, run its check; post a
reminder or a done/stalled notice through the Action Gateway; update the task's status,
fail-streak, and history.

Watermark discipline mirrors the inbox:
- A per-check INFRA failure (provider/budget/network) does NOT count toward the stall
  streak and does NOT advance status — the task is retried next tick (a flaky network
  must never mark a healthy watch `stalled`).
- A content/read error (bad PR number, gh non-zero) increments the fail-streak; STALL_AFTER
  consecutive ones ⇒ `stalled` + a notice (surfaced, not silently looped).
- A watch whose stop condition fires ⇒ `done` + a final notice.

Only `watch` tasks exist in M15a; report/qa dispatch is added in M15b via the same loop.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from src.llm.fallback_policy import INFRA_ERRORS
from src.profile.loader import LoadedProfile
from src.runtime.task_store import STALL_AFTER, HistoryEntry, Task, TaskStore

logger = logging.getLogger(__name__)


def _store_path(data_dir: Path) -> Path:
    return Path(data_dir) / "tasks.sqlite3"


def run_tasks(loaded: LoadedProfile, settings: Any, *, now: datetime | None = None) -> dict:
    """One tick over `loaded`'s open tasks. Returns a run-event dict for the worker.

    Cadence gating is intentionally simple in M15a: every open task is checked each tick
    the service fires `tasks` (hourly), and the watch reminder is deduped per-day at the
    gateway — so a reminder fires at most ONCE per calendar day, not at a specific hour.
    Honoring each task's own cron (a true "8am" reminder) lands in M15b with report/qa."""
    from src.actions.action_gateway import ActionGateway
    from src.packs.registry import PackRegistry

    data_dir = Path(settings.data_dir)
    store = TaskStore(_store_path(data_dir))
    open_tasks = store.list_open()
    if not open_tasks:
        store.close()
        return {"status": "no_tasks", "checked": 0, "cost_usd": None, "delivered": False}

    if settings.write_disabled:
        store.close()
        logger.warning("tasks %s: AGENT_WRITE_DISABLED — skipped", loaded.profile_id)
        return {"status": "writes_disabled", "checked": 0, "cost_usd": None, "delivered": False}

    pack = PackRegistry().load(loaded.domain)
    gateway = ActionGateway(
        settings,
        external_channels=loaded.config.slack_external_channels,
        mcp_allowlist=pack.allowlist or None,
    )
    checked, delivered = 0, False
    try:
        for task in open_tasks:
            try:
                did_post = _run_one(task, loaded, gateway, store, now=now)
            except INFRA_ERRORS:
                # Infra down — not the task's fault. Leave status/streak untouched; retry.
                logger.exception("tasks %s: infra failure on task %d — held for retry",
                                 loaded.profile_id, task.id)
                break
            except Exception:  # noqa: BLE001 — a task-specific error must not stop the others
                logger.exception("tasks %s: task %d check failed", loaded.profile_id, task.id)
                _record_failure(task, store, loaded, gateway)
                continue
            checked += 1
            delivered = delivered or did_post
    finally:
        gateway.close()
        store.close()
    return {"status": f"checked_{checked}", "checked": checked, "cost_usd": None,
            "delivered": delivered}


def _run_one(task: Task, loaded, gateway, store: TaskStore, *, now: datetime | None) -> bool:
    """Check one task; post reminder/done via the gateway. Returns True if it posted."""
    if task.kind != "watch":
        logger.warning("tasks %s: unknown task kind %r (skipped)", loaded.profile_id, task.kind)
        return False
    from src.adapters.cli_adapter import run_gh
    from src.runtime.watch_task import check_pr_watch, watch_reminder_dedup

    target = str(task.params.get("target") or "pr")
    if target != "pr":
        raise ValueError(f"watch-task target {target!r} chưa hỗ trợ (M15a: chỉ 'pr')")
    repo = loaded.config.github_repo
    if not repo:
        raise ValueError("agent chưa cấu hình github_repo — không theo dõi PR được")

    result = check_pr_watch(task.params, repo=repo, created_at=task.created_at, run_gh=run_gh,
                            now=now)
    store.set_fail_streak(task.id, 0)  # a successful read clears any prior streak

    if result.done:
        store.set_status(task.id, "done")
        store.append_history(task.id, HistoryEntry(_now_iso(now), result.reason))
        _post(gateway, loaded, f"✅ {result.reason}", dedup=f"watch-task-done:{task.id}")
        return True
    if result.remind:
        store.append_history(task.id, HistoryEntry(_now_iso(now), result.reason))
        posted = _post(gateway, loaded, result.reason,
                       dedup=watch_reminder_dedup(task.id))
        return posted
    return False


def _record_failure(task: Task, store: TaskStore, loaded, gateway) -> None:
    """A content error (bad PR, gh non-zero): bump the streak; stall past the threshold."""
    streak = task.fail_streak + 1
    store.set_fail_streak(task.id, streak)
    store.append_history(task.id, HistoryEntry(_now_iso(None), f"kiểm tra lỗi (lần {streak})"))
    if streak >= STALL_AFTER:
        store.set_status(task.id, "stalled")
        _post(gateway, loaded,
              f"⚠️ Việc #{task.id} bị treo sau {streak} lần kiểm tra lỗi — cần xem lại.",
              dedup=f"watch-task-stalled:{task.id}")


def _post(gateway, loaded, text: str, *, dedup: str) -> bool:
    """Post a task notice to the agent's report channel through the gateway."""
    from src.actions.slack_write import make_slack_post_handler

    channel = loaded.config.slack_report_channel
    if not channel:
        logger.warning("tasks %s: no slack_report_channel — notice dropped", loaded.profile_id)
        return False
    action = {
        "type": "mcp_tool", "server": "slack", "tool": "post_message",
        "args": {"channel": channel, "text": text}, "dedup_hint": dedup,
    }
    result = gateway.execute(
        action, handler=make_slack_post_handler(loaded.config.slack_server),
        rationale="assigned-task notice",
    )
    return result.status in ("executed", "pending_approval")


def _now_iso(now: datetime | None) -> str:
    from datetime import UTC

    return (now or datetime.now(UTC)).isoformat()
