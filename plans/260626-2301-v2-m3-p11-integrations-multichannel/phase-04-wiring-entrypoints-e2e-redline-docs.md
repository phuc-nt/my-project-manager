# Phase S4 — Wiring through 3 entry points + offline e2e + red-line tests + docs

**Goal:** thread the new profile-driven config (extra MCP servers from S1, SMTP/channel from S3)
through all 3 graph-build entry points + the report graphs' `_deliver` node; add offline end-to-end
+ red-line regression tests; update docs. This is the integration phase — nothing new is invented,
everything is connected + proven.

**Depends:** S1, S2, S3.

## RESOLVED (locked decisions)

- **All 3 report graphs uniform:** `report_graph.py` + `okr_report_graph.py` +
  `resource_report_graph.py` each `_deliver` selects channels from the registry (default
  `[slack, confluence]`, +email when `smtp` declared); every channel send goes through the gateway.
  No narrower-scope carve-out.
- **All email = Lớp B:** the email delivery in `_deliver` returns `pending_approval` (not auto-sent);
  the real send happens on human approval via `dispatch_approved_action`.
- **Backward-compat:** no `smtp:` + no email in the channel list ⇒ default `[slack, confluence]` ⇒
  byte-identical pre-P11. No `extra_servers`/no `linear` ⇒ byte-identical. Baseline-equality test kept.

## Context links (verified file:line)

- `src/runtime/worker.py:54` `build_graph_for(loaded, settings, kind, audience)` — builds
  `ProfileContext` (`:73`) from `loaded.config`/`settings`; the M2-P6 server (`src/server/graph_runner.py`)
  inherits via worker.
- `src/entrypoints/cron.py:95` `main()` — builds `settings, config = loaded.settings, loaded.config`
  (`:107`), `ProfileContext` (`:116`), then `_build_graph(...)` (`:54`).
- `src/entrypoints/cli.py:272` `main()` — `settings, config = loaded.settings, loaded.config` (`:294`);
  `_context_of` (`:71`); approve path `_run_approve` (`:221`) → `dispatch_approved_action(action, config)`
  (`:230`).
- `src/agent/report_graph.py:157-204` `_deliver` node — Slack (`deliver_report`) + Confluence
  (`create_report_page`). `default_report_deps` at `:67`. Parallel `_deliver` in
  `src/agent/okr_report_graph.py` + `src/agent/resource_report_graph.py`.
- `src/agent/audience_delivery.py:30` `resolve_audience_delivery` — extend channel selection.
- `src/agent/channel_registry.py` (created in S3) — `resolve_channels(audience, config)`.

## The 3-entry-point invariant (memory: "report graphs built at worker+cron+cli")

The config flows automatically: all 3 entry points already read `loaded.config` (which now carries
`extra_servers` from S1 + `smtp` from S3) and pass it into the graph builders. So the NEW config
needs NO new threading at the entry points themselves IF S1/S3 added the fields to `ReportingConfig`
(they did) — the entry points pass the whole `config`. **Verify this**: grep each entry point passes
`config=loaded.config` unchanged (it does). The real S4 work is the `_deliver` node consuming the
channel registry + the cli approve path dispatching the new writes.

## Requirements

1. `report_graph._deliver` (+ okr + resource) consume `resolve_channels(audience, config)` instead
   of hardcoded Slack+Confluence — ALL 3 graphs, uniformly. Default (no email) ⇒ identical list ⇒
   identical behavior. When `smtp` configured ⇒ ALSO deliver via `deliver_email_report` (gateway-routed,
   returns `pending_approval` since all email is Lớp B).
2. `delivery_summary` (`audience_delivery.py:54`) extended to surface email status alongside
   slack/confluence (e.g. `email=pending_approval approval_id=...`).
3. cli approve path already calls `dispatch_approved_action(action, config)` — S2/S3 added the
   linear + (if email is Lớp B) email branches there, so approving a queued Linear comment / email
   works end-to-end. Verify `_run_approve` (`cli.py:221`) needs no change.
4. Confirm M2-P6 server inherits via worker — no separate wiring (it calls `build_graph_for`).
5. Offline end-to-end: a fake profile declaring `integrations.linear` + `smtp`, run a report graph
   with monkeypatched `call_tool`/`smtplib`, assert: Linear read works, Confluence + Slack deliver,
   email queued/sent per recipient, all writes audited, no live keys.

## Files to create / modify / delete

**Modify:**
- `src/agent/report_graph.py` — `_deliver` uses the channel registry; add email branch.
- `src/agent/okr_report_graph.py` + `src/agent/resource_report_graph.py` — same `_deliver` change
  (DRY: factor the shared deliver-loop into `audience_delivery.py` or a small helper if it reduces
  duplication; the 3 currently duplicate the deliver shape).
- `src/agent/audience_delivery.py` — channel-selection + `delivery_summary` extension.
- `docs/v2/architecture.md` — document the generic MCP registry + multi-channel delivery + the
  email_send gateway action + the unchanged INVARIANT.
- `config.example.env` — final `LINEAR_*` + `SMTP_*` keys (consolidated).
- `profiles/default/profile.yaml` — final `integrations:` + `delivery:`/`smtp:` documented blocks.
- `docs/v2/roadmap-m2.md` — append P11 exit to the M3 section (`:98`, P10 exit at `:115`).

**Create:**
- `tests/test_p11_integration_e2e.py` — the offline end-to-end.
- `tests/test_p11_redline.py` — consolidated red-line suite (or extend `test_hard_block.py`).

**Delete:** none.

## Implementation steps

1. Factor the deliver-channel loop. Read all 3 `_deliver` nodes; if they share structure, extract
   a `deliver_to_channels(channels, ...)` helper (DRY). Keep each graph file < 200 LOC.
2. Wire `resolve_channels` into the helper; add the email branch (gateway-routed).
3. Extend `delivery_summary`.
4. Verify the 3 entry points pass `config` unchanged (grep `config=` in each `_build_graph` call).
   Add NOTHING unless a gap is found.
5. Write the e2e + red-line tests.
6. Full suite + ruff. Update docs LAST (after behavior verified).

## Tests / validation

`tests/test_p11_integration_e2e.py`:
- Fake profile (`integrations.linear` + `smtp` block) → `load_profile` → `config.extra_servers["linear"]`
  present + `config.smtp` present.
- Run all 3 report graphs with monkeypatched `call_tool` (Linear/Slack/Confluence) + `smtplib` ⇒
  Slack+Confluence deliver; email ⇒ `pending_approval` (Lớp B); audit log records each; no live key.
- Backward-compat e2e: the `default` profile (no integrations/smtp) ⇒ delivers EXACTLY Slack+Confluence
  (assert email NOT attempted, byte-identical summary vs a captured pre-P11 baseline) — for all 3 graphs.
- Approve flow: queue a Linear `linear_createComment` (Lớp B) → `dispatch_approved_action`
  (fake `call_tool`) ⇒ comment "posted". Queue an email (Lớp B) → approve → `dispatch_approved_action`
  (fake `smtplib`) ⇒ "sent".

`tests/test_p11_redline.py` (consolidated):
- `linear:deleteIssue` AND `linear:archiveProject` ⇒ Lớp A DATA_LOSS deny (even with linear allowlisted).
- `email_send` with a secret in body ⇒ CREDENTIAL deny.
- `email_send` no recipient / empty body ⇒ refuse.
- a NEW (unlisted) linear write tool (e.g. `linear_updateIssue`) ⇒ NOT_ALLOWLISTED deny by default.
- every `email_send` ⇒ Lớp B (pending_approval), never auto-sent.
- kill-switch on ⇒ both linear write + email refused.

Commands:
```
uv run pytest -q tests/test_p11_integration_e2e.py tests/test_p11_redline.py
uv run pytest -q tests/test_profile_entrypoints.py tests/test_graph_and_cli.py tests/test_resume_rebuild_deliver.py
uv run pytest -q            # FULL suite: 628 + all new, GREEN
uv run ruff check src tests
```

## Risks + rollback

| Risk | L×I | Mitigation |
|------|-----|-----------|
| `_deliver` change breaks resume/approval rebuild (M2-P5 interrupt) | M×H | Run `test_resume_rebuild_deliver.py` + `test_approval_gate_*`; keep the `approved=` path threaded into email/linear delivery exactly as slack/confluence. |
| One of the 3 graphs diverges (okr/resource `_deliver` not updated) | M×M | Factor the shared loop OR explicitly update all 3; test each graph delivers via the registry. |
| Entry-point config NOT threaded (server doesn't get extra_servers) | L×H | Verified: all 3 pass whole `config`; M2-P6 server inherits via worker. Add a test asserting the server-built graph sees `config.extra_servers`. |
| Backward-compat drift (email attempted when none configured) | L×H | `resolve_channels` returns slack+confluence when `smtp is None`; explicit baseline-equality test. |
| Docs claim diverges from code | L×L | Update docs AFTER tests green; re-grep cited symbols before writing doc claims. |

**Rollback:** revert `_deliver` changes (graphs fall back to direct slack+confluence calls) + the
audience_delivery extension. S1/S2/S3 modules remain but unused by the graph ⇒ no delivery-path
behavior change. Docs revert independently.

## INVARIANT (restated)

Integration must not open any write path that bypasses the gateway. The `_deliver` node calls
`deliver_report` / `create_report_page` / `deliver_email_report` / `post_comment` — ALL of which
build an action and call `gateway.execute()` / `execute_approved()`. The channel registry only
SELECTS channels; it never sends. Every new write (Linear comment, email) stays behind the
default-DENY allowlist + Lớp A red line + Lớp B approval, end to end, through all 3 entry points and
the M2-P6 server. Backward-compat: no extra server + no smtp ⇒ byte-identical pre-P11 delivery.

## Unresolved questions

1. ~~Which roadmap doc tracks M3?~~ RESOLVED: `docs/v2/roadmap-m2.md:98` holds the "M3 — Skill
   system + advanced agent orchestration" section (P10 exit recorded at `:115`). Append the P11
   exit there; no new roadmap file.
2. RESOLVED: all 3 report graphs apply the channel registry uniformly (no okr/resource carve-out).
3. DEFERRED: whether the offline e2e exercises the M2-P6 server path (`graph_runner.py`) directly vs
   a worker-level assertion. Plan = worker-level + one server smoke assertion (sufficient; server
   inherits via worker). Revisit only if a server-specific delivery bug surfaces.
