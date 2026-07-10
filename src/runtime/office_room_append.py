"""try/degrade wrapper for `office_room_store.append` calls made from the team-task
pipeline (v12 M29): coordinator ticker, `ops_assign_team_task`, `team_step_runner`.

A room-store append is a NICE-TO-HAVE observability write, never a step in the pipeline
itself — the coordinator/step/CEO-command flow must complete identically whether or not
the append lands (a locked file, a disk-full data dir, or a bad `kind` must never block
dispatch/step-completion/task-confirm). Every call here therefore swallows its own
exception and logs, matching `team_tick_collaborators.make_escalate`'s "never raises"
contract for the exact same reason.
"""

from __future__ import annotations

import logging

from src.runtime.office_room_store import OfficeRoomStore, office_room_db_path
from src.runtime.team_task_paths import team_tasks_root

logger = logging.getLogger(__name__)


def append_office_event(
    room_id: str, *, author: str, kind: str, body: dict, also_office: bool = False,
) -> None:
    """Open the store, append one event, close — best-effort, never raises.

    Opens a fresh connection per call rather than holding one open across the caller's
    lifetime: callers here are short-lived (one tick / one CEO command / one step), so
    the connection-open cost is negligible next to the LLM/subprocess work around it,
    and a fresh connection sidesteps any lifetime-management question entirely.
    """
    try:
        store = OfficeRoomStore(office_room_db_path(team_tasks_root()))
        try:
            store.append(room_id, author=author, kind=kind, body=body, also_office=also_office)
        finally:
            store.close()
    except Exception:  # noqa: BLE001 — an office-room append must never block the pipeline
        logger.warning(
            "office-room append failed (room=%s kind=%s) — continuing without it",
            room_id, kind, exc_info=True,
        )
