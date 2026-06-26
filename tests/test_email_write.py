"""M3-P11 S3: Email (SMTP) delivery as a gateway-routed mutation.

ALL email is Lớp B (queues for approval). Fake SMTP via monkeypatched `smtplib.SMTP`
(stdlib only — no real send, no external lib). Verifies the gateway funnel: dry-run ⇒ no
connection; kill-switch ⇒ refused; secret/empty ⇒ denied; password never on the action.
"""

from __future__ import annotations

import pytest

from src.actions import approved_dispatch, email_write
from src.actions.action_gateway import ActionGateway, WriteDisabledError
from src.audit.audit_log import AuditLog
from src.config.config_builders import build_reporting_config_from_dict
from src.config.smtp_config import SmtpConfig


def _smtp() -> SmtpConfig:
    return SmtpConfig(
        smtp_host="smtp.test", smtp_user="bot@test", from_addr="bot@test",
        recipients=("lead@team.com",),
    )


def _gateway(settings_factory, tmp_path, **kw):
    settings = settings_factory(**kw)
    return ActionGateway(settings=settings, audit_log=AuditLog(tmp_path / "audit.jsonl"))


class _FakeSMTP:
    """Records calls instead of connecting. Context-manager like smtplib.SMTP."""

    instances: list = []

    def __init__(self, host, port, timeout=None):
        self.host, self.port = host, port
        self.started_tls = False
        self.logged_in = None
        self.sent = None
        _FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self):
        self.started_tls = True

    def login(self, user, password):
        self.logged_in = (user, password)

    def send_message(self, msg):
        self.sent = msg


@pytest.fixture(autouse=True)
def _reset_fake():
    _FakeSMTP.instances = []


# --- Lớp B: every email queues for approval, never auto-sent ---


def test_email_queues_for_approval(settings_factory, tmp_path, monkeypatch):
    monkeypatch.setattr("src.actions.email_write.smtplib.SMTP", _FakeSMTP)
    gw = _gateway(settings_factory, tmp_path, dry_run=False)
    result = email_write.deliver_email_report(
        "report body", "Daily", gateway=gw, smtp=_smtp(), report_date="2026-06-26"
    )
    assert result.status == "pending_approval"
    assert not _FakeSMTP.instances  # nothing sent — only queued


def test_dry_run_opens_no_connection(settings_factory, tmp_path, monkeypatch):
    monkeypatch.setattr("src.actions.email_write.smtplib.SMTP", _FakeSMTP)
    # dry_run short-circuits in the gateway BEFORE the handler. Use approved path so the
    # Lớp B queue is skipped and we'd reach the handler if not for dry-run.
    gw = _gateway(settings_factory, tmp_path, dry_run=True)
    result = email_write.deliver_email_report(
        "body", "Daily", gateway=gw, smtp=_smtp(), report_date="2026-06-26", approved=True
    )
    assert result.status == "dry_run"
    assert not _FakeSMTP.instances


def test_kill_switch_refuses(settings_factory, tmp_path, monkeypatch):
    monkeypatch.setattr("src.actions.email_write.smtplib.SMTP", _FakeSMTP)
    gw = _gateway(settings_factory, tmp_path, dry_run=False, write_disabled=True)
    with pytest.raises(WriteDisabledError):
        email_write.deliver_email_report(
            "body", "Daily", gateway=gw, smtp=_smtp(), report_date="2026-06-26", approved=True
        )
    assert not _FakeSMTP.instances


# --- wrapper refusals before the gateway ---


def test_refuses_empty_body(settings_factory, tmp_path):
    gw = _gateway(settings_factory, tmp_path, dry_run=False)
    with pytest.raises(ValueError, match="empty"):
        email_write.deliver_email_report(
            "  ", "Daily", gateway=gw, smtp=_smtp(), report_date="2026-06-26"
        )


def test_refuses_no_recipient(settings_factory, tmp_path):
    gw = _gateway(settings_factory, tmp_path, dry_run=False)
    smtp = SmtpConfig(smtp_host="smtp.test", smtp_user="b@test", from_addr="b@test")
    with pytest.raises(RuntimeError, match="recipient"):
        email_write.deliver_email_report(
            "body", "Daily", gateway=gw, smtp=smtp, report_date="2026-06-26"
        )


# --- approved dispatch performs the real (faked) send ---


def test_dispatch_approved_email_sends(monkeypatch):
    monkeypatch.setattr("src.actions.email_write.smtplib.SMTP", _FakeSMTP)
    monkeypatch.setenv("SMTP_PASSWORD", "app-pw")
    config = build_reporting_config_from_dict(
        {"smtp": {"host": "smtp.test", "user": "bot@test", "recipients": "lead@team.com"}}
    )
    action = {
        "type": "email_send", "to": ["lead@team.com"], "subject": "Daily", "body": "3 done"
    }
    summary = approved_dispatch.dispatch_approved_action(action, config)
    assert "1 recipient" in summary
    sent = _FakeSMTP.instances[0]
    assert sent.started_tls is True
    assert sent.logged_in == ("bot@test", "app-pw")
    assert sent.sent["To"] == "lead@team.com"


def test_dispatch_email_without_smtp_raises():
    config = build_reporting_config_from_dict({})  # no smtp
    action = {"type": "email_send", "to": "x@y.com", "subject": "s", "body": "b"}
    with pytest.raises(RuntimeError, match="smtp not configured"):
        approved_dispatch.dispatch_approved_action(action, config)


# --- credential safety: password never on the persisted action ---


def test_password_never_on_action(settings_factory, tmp_path, monkeypatch):
    monkeypatch.setenv("SMTP_PASSWORD", "super-secret-pw")
    gw = _gateway(settings_factory, tmp_path, dry_run=False)
    email_write.deliver_email_report(
        "body", "Daily", gateway=gw, smtp=_smtp(), report_date="2026-06-26"
    )
    pending = gw.pending_approvals()
    assert pending
    assert "super-secret-pw" not in str(pending[0].action)
    assert "SMTP_PASSWORD" not in str(pending[0].action)
