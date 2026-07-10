"""Office room event projection — the PII firewall for `office_room_store` (v12 M29).

Same philosophy as `sse_events.summarize_node` (`src/server/sse_events.py:17`): project
a raw event body down to an ALLOWLIST of non-PII fields per `kind`. Anything not on the
allowlist is DROPPED. Unknown kind -> {} (drop all — a safe default if the room grows a
new kind before this module is updated).

Applied AT WRITE TIME by `office_room_store.append` (workers are the writers), NOT at
SSE emit time — so the store itself never holds an unprojected field, and replay (a late
subscriber reading old rows back out of the store) is automatically as safe as the live
stream. Free-form `body_json` passthrough is forbidden by construction: every kind here
lists its own short, explicit set of string/number fields.
"""

from __future__ import annotations

#: Max length for any free-text field this module keeps — a room message is a short
#: timeline line, not a report viewer; long text is truncated with an explicit marker
#: instead of silently keeping (and thus risking widening) a large payload.
_MAX_TEXT_CHARS = 500


def _short(value: object) -> str:
    text = str(value or "")
    if len(text) > _MAX_TEXT_CHARS:
        return text[:_MAX_TEXT_CHARS] + "…"
    return text


def summarize_office_event(kind: str, body: dict) -> dict:
    """Project a raw office-event body to its non-PII allowlist (drop everything else).

    `kind` one of ceo | assignment | step_status | handoff | milestone. Unknown kind ->
    {} (drop all).
    """
    if kind == "ceo":
        return {"text": _short(body.get("text"))}
    if kind == "assignment":
        return {
            "task_title": _short(body.get("task_title")),
            "step_count": int(body.get("step_count") or 0),
            "summary": _short(body.get("summary")),
        }
    if kind == "step_status":
        return {
            "task_title": _short(body.get("task_title")),
            "step_title": _short(body.get("step_title")),
            "status": _short(body.get("status")),
            "assigned_to": _short(body.get("assigned_to")),
        }
    if kind == "handoff":
        return {
            "task_title": _short(body.get("task_title")),
            "step_title": _short(body.get("step_title")),
            "message": _short(body.get("message")),
            "assigned_to": _short(body.get("assigned_to")),
        }
    if kind == "milestone":
        return {
            # `task_id` (not PII — an internal opaque id, same shape as the room_id
            # itself) rides alongside `task_title` so a dedup/identity key built from
            # this projected body never depends on a human-editable title: two tasks
            # given the same brief text would otherwise collide in `milestone_mirror_runner`'s
            # per-(task, milestone, day) dedup claim.
            "task_id": _short(body.get("task_id")),
            "task_title": _short(body.get("task_title")),
            "milestone": _short(body.get("milestone")),
            "message": _short(body.get("message")),
        }
    return {}


#: The only valid `kind` values a caller may append — `office_room_store.append` uses
#: this to fail loud on a typo'd kind instead of silently persisting an ungoverned event.
VALID_KINDS = frozenset({"ceo", "assignment", "step_status", "handoff", "milestone"})
