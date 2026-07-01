"""hr-pack write surface (v3 M6 S4): allowlist contribution.

HR writes a Confluence detail page + a Slack short, reusing the shared `confluence_write`
/ `slack_write` primitives through the Action Gateway — the SAME red line + Lớp A/B
applies, no HR exception. This pack contributes only the allowlist entries; the dispatch
handlers stay in core (`approved_dispatch.py`), exactly as PM does.

Only safe, reversible writes are listed (create/update page, post message). NO
destructive tool is here — HR cannot delete pages or staff records via the gateway; a
destructive marker still hits the Lớp A red line regardless (proven in the red-line test).
"""

from __future__ import annotations

# Permitted MCP writes for HR — Confluence page + Slack post (server → tool names,
# case-insensitive). HR posts a headcount detail page + a Slack short; nothing else is
# writable. The gateway enforces this as the default-DENY allowlist; a destructive marker
# still hits Lớp A.
ALLOWLIST: dict[str, tuple[str, ...]] = {
    "slack": ("post_message", "post_message_blocks", "update_message"),
    "confluence": ("createpage", "updatepage"),
}
