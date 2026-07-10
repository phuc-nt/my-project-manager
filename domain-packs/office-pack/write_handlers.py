"""office-pack write surface (v12 M28b): EMPTY allowlist = default-deny.

The coordinator performs no external write of its own — the two things it does
(update team_task_store rows, spawn a `team-step` worker subprocess) never touch the
Action Gateway. A step's own external write (if any) runs inside that step's assigned
agent's OWN per-agent gateway/allowlist, entirely separate from this pack.

RED LINE (M8-class regression the phase red-line test proves): `{} or None` evaluates
to `None` in Python, so an office-pack `ActionGateway` built with
`mcp_allowlist=pack.allowlist or None` would silently fall back to the core's wider
default allowlist — an empty dict here does NOT by itself guarantee default-deny.
`graphs.py` therefore never constructs a real write-capable gateway from this allowlist
at all: its only gateway use is the Telegram escalation, which is delegated to an
EXISTING agent's own gateway/allowlist (`ops_alert_runner`-style — "route qua agent có
sẵn operator trong chat_ids" per the phase spec), never a gateway built from this pack.
"""

from __future__ import annotations

#: Deliberately empty: the coordinator has no MCP write target of its own.
ALLOWLIST: dict[str, tuple[str, ...]] = {}
