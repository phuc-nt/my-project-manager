"""Slack write — post a report message via the Action Gateway.

The only mutation in Slice 1. It must go through `ActionGateway.execute`, never
call the Slack MCP tool directly outside the handler. The gateway applies the
allowlist (`slack:post_message`), Lớp A hard-deny, kill-switch, dry-run,
rate-limit, idempotency, and audit — this module just supplies the handler and a
convenience wrapper.
"""

from __future__ import annotations

import logging
from typing import Any

from src.actions.action_gateway import ActionGateway, GatewayResult
from src.adapters.mcp_adapter import call_tool
from src.config.reporting_config import McpServerSpec, get_reporting_config

logger = logging.getLogger(__name__)


def _slack_post_handler(action: dict[str, Any]) -> str:
    """Gateway Handler: actually post to Slack via the MCP server.

    Invoked by the gateway ONLY after all guards pass (and never under dry-run).
    Returns a short summary for the audit result.
    """
    args = action.get("args", {})
    spec: McpServerSpec = get_reporting_config().slack_server
    result = call_tool(spec, "post_message", args)
    if isinstance(result, dict):
        ts = result.get("ts") or (result.get("message") or {}).get("ts")
        channel = result.get("channel") or args.get("channel")
        return f"posted to {channel} ts={ts}"
    return "posted"


def _dedup_key(channel: str, report_date: str) -> str:
    """Stable idempotency hint: one report per (channel, date), not per text.

    Report text varies each LLM run, so deduping on text would never catch a
    re-run. Keying on channel+date prevents double-posting the same day's report.
    """
    return f"slack-report:{channel}:{report_date}"


def deliver_report(
    text: str,
    *,
    gateway: ActionGateway,
    channel: str | None = None,
    report_date: str,
    rationale: str = "",
) -> GatewayResult:
    """Post a report to Slack through the gateway. Returns the gateway result.

    `report_date` (YYYY-MM-DD) makes the action idempotent per day+channel.
    """
    target = channel or get_reporting_config().slack_report_channel
    if not target:
        raise RuntimeError("SLACK_REPORT_CHANNEL is not set (in .env or passed explicitly).")
    if not text.strip():
        raise ValueError("Refusing to post an empty report.")

    action = {
        "type": "mcp_tool",
        "server": "slack",
        "tool": "post_message",
        "args": {"channel": target, "text": text},
        # Idempotency marker consumed by the gateway's dedup (stable per day).
        "dedup_hint": _dedup_key(target, report_date),
    }
    return gateway.execute(action, handler=_slack_post_handler, rationale=rationale)
