"""Email WRITE — send a report email via the Action Gateway (M3-P11 D2).

Outbound email is a MUTATION, so it MUST go through `ActionGateway.execute`, never call
`smtplib` directly outside the handler. The gateway applies the `email_send` Lớp A scan,
the Lớp B human-approval queue (ALL email is Lớp B — locked policy), kill-switch, dry-run,
rate-limit, idempotency, and audit. This module supplies the handler + a wrapper.

stdlib only (`smtplib` + `email.message.EmailMessage`, STARTTLS) — no new dependency. The
SMTP password is read from `os.environ["SMTP_PASSWORD"]` inside the handler at send time, so
it never lives on the action dict (it would otherwise enter the audit log / approval store).
"""

from __future__ import annotations

import logging
import os
import smtplib
from collections.abc import Callable
from email.message import EmailMessage
from typing import Any

from src.actions.action_gateway import ActionGateway, GatewayResult
from src.config.smtp_config import SmtpConfig

logger = logging.getLogger(__name__)

Handler = Callable[[dict[str, Any]], str]

_SMTP_PASSWORD_ENV = "SMTP_PASSWORD"


def _recipients(to: Any) -> list[str]:
    """Normalize the action `to` field to a non-empty recipient list."""
    if isinstance(to, str):
        return [to] if to.strip() else []
    if isinstance(to, (list, tuple)):
        return [str(r) for r in to if str(r).strip()]
    return []


def make_email_handler(smtp: SmtpConfig) -> Handler:
    """Build a gateway handler bound to an SMTP config.

    The config (host/user/from) is captured in the closure; the password is read from
    env at send time — neither enters the action dict, the audit log, or the approval
    store. Invoked by the gateway ONLY after all guards pass (never under dry-run).
    """

    def _handler(action: dict[str, Any]) -> str:
        to = _recipients(action.get("to"))
        if not to:
            raise ValueError("email_send has no recipient at send time.")
        password = os.environ.get(_SMTP_PASSWORD_ENV, "")

        msg = EmailMessage()
        msg["From"] = smtp.from_addr
        msg["To"] = ", ".join(to)
        msg["Subject"] = str(action.get("subject", ""))
        msg.set_content(str(action.get("body", "")))

        with smtplib.SMTP(smtp.smtp_host, smtp.smtp_port, timeout=30) as server:
            if smtp.use_tls:
                server.starttls()
            if smtp.smtp_user and password:
                server.login(smtp.smtp_user, password)
            server.send_message(msg)
        return f"emailed {len(to)} recipient(s)"

    return _handler


def _dedup_key(to: str, report_date: str) -> str:
    """Stable idempotency hint: one report email per (recipient-set, date)."""
    return f"email-report:{to}:{report_date}"


def deliver_email_report(
    body: str,
    subject: str,
    *,
    gateway: ActionGateway,
    smtp: SmtpConfig,
    to: list[str] | tuple[str, ...] | str | None = None,
    report_date: str,
    rationale: str = "",
    approved: bool = False,
) -> GatewayResult:
    """Send a report email through the gateway. Returns the gateway result.

    ALL email is Lớp B, so `gateway.execute()` returns `pending_approval`; the real send
    happens only via the approve path. Recipients default to `smtp.recipients`. Refuses an
    empty body / no recipient BEFORE the gateway (mirrors `slack_write.deliver_report`).
    `approved=True` runs the already-human-approved path (Lớp A + audit + dedup still apply).
    """
    recipients = _recipients(to) or list(smtp.recipients)
    if not recipients:
        raise RuntimeError("No email recipient (set smtp.recipients or pass `to`).")
    if not body.strip():
        raise ValueError("Refusing to send an empty report email.")

    joined = ",".join(recipients)
    action = {
        "type": "email_send",
        "to": recipients,
        "subject": subject,
        "body": body,
        "dedup_hint": _dedup_key(joined, report_date),
    }
    handler = make_email_handler(smtp)
    if approved:
        return gateway.execute_approved(action, handler=handler, rationale=rationale)
    return gateway.execute(action, handler=handler, rationale=rationale)
