"""Delivery channel registry (M3-P11 D2) — additive multi-channel report delivery.

Today reports always go to Slack + Confluence (in each graph's `_deliver`). This registry
adds OPTIONAL extra channels (currently Email) without changing that core path: when an
`smtp` config is present, the report is ALSO emailed. Every extra-channel send is a
mutation routed through the Action Gateway (Email = `email_send`, all Lớp B), so dry-run /
kill-switch / approval / audit apply automatically.

Backward-compat: no `smtp` config ⇒ `resolve_channels` returns () ⇒ delivery is byte-identical
to pre-P11 (Slack + Confluence only).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.actions.action_gateway import ActionGateway, GatewayResult
    from src.config.reporting_config import ReportingConfig

logger = logging.getLogger(__name__)

# Statuses that count as a successful (or accepted) extra-channel delivery. `pending_approval`
# is success for email: the send is correctly queued for human approval, not failed.
EXTRA_CHANNEL_OK_STATUSES = frozenset({"executed", "dry_run", "deduplicated", "pending_approval"})


def resolve_channels(config: ReportingConfig) -> tuple[str, ...]:
    """Return the OPTIONAL extra channels to deliver to, beyond Slack + Confluence.

    Email is included only when an `smtp` config is present. No smtp ⇒ () ⇒ no extra
    delivery (backward-compat). Slack + Confluence are NOT listed here — they are the
    always-on core path owned by each graph's `_deliver`.
    """
    channels: list[str] = []
    if getattr(config, "smtp", None) is not None:
        channels.append("email")
    return tuple(channels)


def deliver_extra_channels(
    body: str,
    subject: str,
    *,
    gateway: ActionGateway,
    config: ReportingConfig,
    report_date: str,
    audience: str,
    rationale: str = "",
    approved: bool = False,
) -> list[GatewayResult]:
    """Deliver the report to each resolved extra channel through the gateway.

    Each send funnels through the Action Gateway (so all guards apply). A channel failure
    is logged and skipped — an extra channel must never break the core Slack+Confluence
    delivery. Returns the per-channel gateway results (empty when no extra channel).
    """
    results: list[GatewayResult] = []
    for channel in resolve_channels(config):
        try:
            if channel == "email":
                results.append(
                    _deliver_email(
                        body, subject, gateway=gateway, config=config,
                        report_date=report_date, rationale=rationale, approved=approved,
                    )
                )
        except Exception as exc:  # noqa: BLE001 — an extra channel must never break core delivery
            logger.warning("extra channel %r failed, skipping: %s", channel, exc)
    return results


def _deliver_email(
    body: str,
    subject: str,
    *,
    gateway: ActionGateway,
    config: ReportingConfig,
    report_date: str,
    rationale: str,
    approved: bool,
) -> GatewayResult:
    from src.actions.email_write import deliver_email_report

    return deliver_email_report(
        body,
        subject,
        gateway=gateway,
        smtp=config.smtp,
        report_date=report_date,
        rationale=f"{rationale} (email)",
        approved=approved,
    )
