# Phase S3 — Channel abstraction + Email (SMTP) gateway-routed (D2)

**Goal:** add a delivery-channel abstraction + ONE new channel = **Email (SMTP)**. Email send is
a MUTATION → routes through the Action Gateway as a NEW action `type` `"email_send"` (the only safe
route; the gateway's dry-run/kill-switch/dedup/audit then apply automatically). Independently
shippable (no email channel declared ⇒ default Slack+Confluence only, byte-identical).

**Depends:** none structurally (different files from S1/S2). But shares `hard_block.py` with S2 —
prefer running S2 → S3 sequentially. S4 integrates the channel list into the graphs.

## RESOLVED (research report + locked policy)

- **stdlib ONLY:** `smtplib` + `email.message.EmailMessage`, STARTTLS, `login()`. NO new dependency.
  Sync send (our graph nodes are sync). FORBID `aiosmtplib`/external libs this round.
- **POLICY LOCKED — ALL email = Lớp B.** EVERY outbound email queues for human approval. NO domain
  allowlist, NO internal/external split. This SIMPLIFIES `needs_interrupt`: for `type=="email_send"`
  it returns `interrupt=True` unconditionally (after Lớp A passes). No `email_internal_*` config.
- **Lớp A still applies:** `_hard_deny_email` scans recipient+subject+body for secrets (CREDENTIAL
  deny) and rejects empty recipient / empty body.
- **SMTP config fields** (`smtp:` block → from_dict): `smtp_host`, `smtp_port` (default 587),
  `smtp_user`, `smtp_password` (ENV ONLY — `SMTP_PASSWORD`, never committed), `use_tls`
  (bool, True ⇒ STARTTLS:587), `from_addr`, `recipients` (default list). KISS: STARTTLS path only this
  round; port-465 implicit-SSL is a DEFERRED toggle.

## Context links (verified file:line)

- `src/actions/action_gateway.py:38` — `_MUTATING_TYPES = {"mcp_tool","gh_cli"}` (email send is
  NEITHER ⇒ MUST add `"email_send"` here, else `_execute` raises "ActionGateway only handles
  mutating actions" at `:181`). `:92` `_label` returns `str(atype)` for unknown types ⇒
  `"email_send"` audit label works; `:74` `_action_dedup_key` honors `dedup_hint`.
- `src/actions/hard_block.py:397` `classify()` — the `else` branch (`:413-423`) currently DENIES any
  non-mcp/non-gh type as NOT_ALLOWLISTED after a credential scan. MUST add an `email_send` branch
  (credential scan + a `_hard_deny_email` for destructive/secret content + allow valid sends).
- `src/actions/hard_block.py:79` `needs_interrupt()` — Lớp B. RESOLVED: ALL `email_send` ⇒ Lớp B
  unconditionally (return `interrupt=True` for any `type=="email_send"` past Lớp A). No recipient
  classification — simpler than the slack external-channel split.
- `src/actions/slack_write.py:25,62` — `make_slack_post_handler` + `deliver_report` = the channel
  handler template (closure over spec/credentials; gateway-routed wrapper with `dedup_hint`,
  `approved` path).
- `src/agent/audience_delivery.py:30` `resolve_audience_delivery(audience, kind, today, config)` →
  `(channel, dedup_hint)`; `:54` `delivery_summary`; `SLACK_OK_STATUSES` at `:25`.
- `src/agent/report_graph.py:157-204` `_deliver` node (Slack + Confluence today). S4 plugs the
  channel list here — S3 only builds the abstraction + email channel.

## Architecture decision (verified)

Email = a NEW gateway action `type` `"email_send"`, NOT an `mcp_tool` (no email MCP server) and NOT
`gh_cli`. The action dict:
```python
{"type": "email_send", "to": "...", "subject": "...", "body": "...",
 "dedup_hint": "email-report:{to}:{date}"}
```
`gateway.execute(action, handler=make_email_handler(smtp_config))`. The handler (closure over SMTP
config; password read from `os.environ` at send time) opens an SMTP session and sends. Credentials
NEVER on the action dict (so they don't enter the audit log / approval store) — exactly the
slack_write pattern. EVERY send is Lớp B ⇒ `gateway.execute()` returns `pending_approval`; the real
send happens only when a human approves ⇒ `approved_dispatch.dispatch_approved_action` routes the
approved `email_send` to `make_email_handler` (NEW branch in S3 mirroring the slack/linear branches).

## Requirements

1. `_MUTATING_TYPES` gains `"email_send"` (`action_gateway.py:38`).
2. `classify()` gains an `email_send` branch (`hard_block.py`): credential-scan `subject`+`body`+`to`;
   add `_hard_deny_email(action)` for Lớp A on email (e.g. a secret pattern in body ⇒ CREDENTIAL deny;
   empty/garbage recipient ⇒ deny). A VALID email_send is allowed past Lớp A (no destructive marker
   applies to sending mail) — then the allowlist layer: email_send has no per-server allowlist, so
   ADD an explicit allow for a well-formed `email_send` (do NOT fall through to default-deny). Gate it:
   allow only when `to`/`subject`/`body` present + `to` non-empty.
3. `needs_interrupt()` (`hard_block.py:79`): for `type=="email_send"` return `interrupt=True`
   UNCONDITIONALLY (after Lớp A). No recipient classification, no `email_internal_*` config — ALL
   email is Lớp B (locked policy).
4. `email_write.py`: `make_email_handler(smtp_config)` + `deliver_email_report(text, subject, *,
   gateway, config, to, report_date, rationale, approved=False)`. Refuse empty body / no recipient
   BEFORE the gateway (mirror `slack_write` `:78-80`). stdlib `smtplib` + `email.message.EmailMessage`,
   STARTTLS + `login()` (no new dep). Respect `dry_run` via the gateway (it short-circuits BEFORE the
   handler at `action_gateway.py:233`, so dry-run ⇒ no SMTP connection — automatic).
5. `channel_registry.py`: maps a channel name → a deliver callable. Default registry =
   `{"slack": ..., "confluence": ...}`. Email registered only when an `smtp:` config block is present.
   `resolve_channels(audience, config) -> list[channel]`. Backward-compat: no smtp ⇒ excludes email ⇒
   identical to today.
6. SMTP config: a frozen `SmtpConfig(smtp_host, smtp_port=587, smtp_user, use_tls, from_addr,
   recipients)` — password NOT a field; read from `os.environ["SMTP_PASSWORD"]` inside the handler.
   **decision:** put `smtp: SmtpConfig | None` on `ReportingConfig` (delivery target = reporting
   concern), default `None`. Plumb via `config_builders_reporting` + `loader_mapping` `smtp:` block.

## Files to create / modify / delete

**Modify:**
- `src/actions/action_gateway.py` — add `"email_send"` to `_MUTATING_TYPES`. (1 line; disjoint from
  any S1/S2 edit.)
- `src/actions/hard_block.py` — add `email_send` branch in `classify()` + `_hard_deny_email` +
  email recipient logic in `needs_interrupt`. (Disjoint region from S2's `_MCP_ALLOWLIST`/Lớp B
  marker — but same file; see plan ownership note.)
- `src/config/reporting_config.py` — add `smtp: SmtpConfig | None` field + `SmtpConfig` frozen
  dataclass (or a sibling `smtp_config.py` if `reporting_config.py` nears 200 LOC).
- `src/config/config_builders_reporting.py` — build `SmtpConfig` from dict (None when absent).
- `src/actions/approved_dispatch.py` — add the `type=="email_send"` branch routing an approved send
  to `make_email_handler(config.smtp)` (lazy import for monkeypatch parity, like slack/linear).
- `src/profile/loader_mapping.py` — map a `smtp:` block → from_dict kwargs.
- `profiles/default/profile.yaml` + `config.example.env` — commented `smtp:` example + `SMTP_*` env.

**Create:**
- `src/actions/email_write.py` — handler + gateway-routed `deliver_email_report`.
- `src/agent/channel_registry.py` — channel abstraction + `resolve_channels`.

**Delete:** none.

## Implementation steps

1. Add `email_send` to `_MUTATING_TYPES`.
2. `classify()` email branch + `_hard_deny_email`. **Trace the existing `else` branch first**
   (`hard_block.py:413`) — it credential-scans then NOT_ALLOWLISTED-denies. Insert the `email_send`
   case BEFORE that fallthrough so a valid send is allowed, an invalid/secret one denied.
3. `needs_interrupt` recipient classification (internal vs external email).
4. `SmtpConfig` + builder + loader mapping.
5. `email_write.py` (stdlib smtplib; TLS; closure creds; empty-body refusal).
6. `channel_registry.py` (default = slack+confluence; +email when smtp configured).
7. Tests, then broaden. (S4 wires the registry into `report_graph._deliver`.)

## Tests / validation

New `tests/test_email_write.py`, `tests/test_channel_registry.py`, extend `tests/test_hard_block.py`
+ `tests/test_action_gateway.py`:
- `email_send` action via `gateway.execute()` with a FAKE handler (monkeypatch smtplib) ⇒ executed;
  dry_run settings ⇒ `status=="dry_run"`, NO SMTP connection opened.
- kill-switch (`write_disabled`) ⇒ `WriteDisabledError` (refused), no send.
- empty body / no recipient ⇒ `deliver_email_report` refuses BEFORE gateway.
- secret in body ⇒ `CREDENTIAL` deny via `classify`.
- ANY well-formed `email_send` (any recipient) ⇒ `needs_interrupt` ⇒ `pending_approval` (Lớp B),
  never auto-sent (the all-email-Lớp-B policy — assert it for an internal-looking AND external-looking
  recipient).
- approved path: `dispatch_approved_action({type:email_send,...}, config)` with monkeypatched
  `smtplib.SMTP` ⇒ "sent" (no real send).
- a malformed `email_send` (missing `to` / empty body) ⇒ `classify` deny (`_hard_deny_email`).
- `resolve_channels`: no smtp config ⇒ `["slack","confluence"]` (backward-compat); smtp present ⇒
  email included for the right audience.
- `_MUTATING_TYPES` now includes `email_send` (regression: an `email_send` does NOT raise "only
  handles mutating actions").
- FAKE SMTP via monkeypatched `smtplib.SMTP` (NO `aiosmtpd`/external lib — stdlib-only locked) —
  NO real send.

Commands:
```
uv run pytest -q tests/test_email_write.py tests/test_channel_registry.py tests/test_hard_block.py tests/test_action_gateway.py tests/test_audience_delivery.py
uv run pytest -q
uv run ruff check src tests
```

## Risks + rollback

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Email send BYPASSES the gateway (side path) | L×H | Hard rule: only via `email_send` in `_MUTATING_TYPES` + `gateway.execute`. NO `smtplib.send` anywhere except inside the gateway handler closure. A grep test asserts `smtplib` is imported ONLY in `email_write.py`. |
| `classify` email branch allows a malformed/secret send | M×H | `_hard_deny_email` credential scan + explicit required-field gate; tests for empty/secret/missing-recipient. |
| SMTP password leaks into audit/approval store | L×H | Password in handler closure (from `os.environ`), NEVER on the action dict. Mirror slack_write closure. Test: assert no SMTP password substring in the recorded action. |
| Silent auto-send of any email | L×H | ALL email is Lớp B (locked) — `needs_interrupt` returns True unconditionally for `email_send`. No classification path to get wrong. Real send only via approved dispatch. |
| Adding `email_send` type breaks the gateway's READ-bypass invariant | L×M | READ actions still bypass (only mutating types funnel); email_send is explicitly mutating. Regression test for read bypass. |

**Rollback:** remove `email_send` from `_MUTATING_TYPES` + the classify branch + delete
`email_write.py`/`channel_registry.py` + `smtp` field defaults to None. Registry falls back to
Slack-only; zero residual behavior.

## INVARIANT (restated)

Email send is a MUTATION and MUST route through `ActionGateway.execute()` via the new `email_send`
type — never a side path. It is classified (Lớp A credential/empty-field scan via `_hard_deny_email`;
Lớp B human-approval for EVERY recipient — locked policy) and subject to kill-switch + dry-run + dedup
+ audit automatically because it funnels through the gateway. A well-formed send is allowed past Lớp A
then ALWAYS queued for approval; a malformed/secret one is denied. This phase ADDS a mutating delivery
channel; it must not create any path that sends mail outside the gateway.

## Unresolved questions

1. RESOLVED: ALL email = Lớp B (no domain/internal-external split). Stdlib smtplib + app-password
   STARTTLS. `email_send` is a native gateway action type (no email MCP server). Password via
   `SMTP_PASSWORD` env only.
2. DEFERRED: port-465 implicit-SSL toggle for corporate SMTP (this round = STARTTLS:587 only).
   `use_tls` field reserved for the switch; wire the 465 path when an actual corp endpoint needs it.
3. DEFERRED: live-SMTP E2E (real send to a real inbox). Offline tests monkeypatch `smtplib.SMTP`.
