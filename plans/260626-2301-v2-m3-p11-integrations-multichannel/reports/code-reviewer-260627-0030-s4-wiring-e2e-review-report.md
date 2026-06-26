# Code Review — v2 M3-P11 Slice S4 (channel registry wiring + offline e2e + red-line)

Reviewer: code-reviewer | Date: 2026-06-27 00:30
Scope: working-tree diff vs HEAD=3df09d8 (S3 commit). Code-only (docs pending, excluded).

## Scope

Files changed (4 src + 2 new tests; NO entry-point edits — verified by `git diff --name-only 3df09d8`):
- `src/agent/audience_delivery.py` — NEW `deliver_extra_channels_and_summarize` (+44 LOC)
- `src/agent/report_graph.py` `_deliver` — +7 LOC append
- `src/agent/okr_report_graph.py` `_deliver` — +7 LOC append
- `src/agent/resource_report_graph.py` `_deliver` — +7 LOC append
- `tests/test_p11_integration_e2e.py` (NEW), `tests/test_p11_redline.py` (NEW)

Empirical: `uv run pytest -q` → **702 passed**. `uv run ruff check src tests` → **All checks passed**.
Targeted: P11 e2e+redline (25 pass), resume/approval-gate (33 pass: resume_rebuild_deliver, approval_gate_interrupt, approval_gate_okr_resource, worker_resume, server_approvals).

## Overall Assessment

S4 is a clean, minimal integration slice. It SELECTS + summarizes only; the actual mutation
stays on S3's gateway-routed path. The PII red line is correctly enforced fail-closed at the
top of the new helper, before any channel resolution or send. No guardrail regression, no
gateway bypass, no backward-compat break. **No CRITICAL or HIGH findings.**

## RED-LINE VERDICT (explicit, as requested)

- **External reports never email** — CONFIRMED. `deliver_extra_channels_and_summarize`
  returns `""` at `audience_delivery.py:81-82` (`if audience != "internal": return ""`)
  BEFORE `resolve_channels`/`deliver_extra_channels`. The gate is fail-closed: ANY audience
  other than the exact string `"internal"` (external, typo, future value) yields no email.
  e2e `test_external_never_emails` (all 3 graphs, stakeholder channel set so `_deliver`
  doesn't raise early) asserts `"email=" not in summary` AND `not gw.pending_approvals()` —
  meaningful (drives the real external path; Slack/Confluence fakes never queue, so a
  non-empty queue could only be the email). The gate mirrors the resource graph's own
  external link-strip (`resource_report_graph.py:157` `short_url = None if external`).
  No path found where external reaches the email send.
- **Email stays gateway-routed Lớp B** — CONFIRMED. The helper calls registry
  `deliver_extra_channels` → `_deliver_email` → `deliver_email_report` →
  `gateway.execute(...)` (S3). No `smtplib` call anywhere in S4. classify (`hard_block.py:461-468`)
  runs Lớp A `_hard_deny_email` FIRST then `_ALLOW`; `needs_interrupt` (`:99-102`) returns
  True unconditionally for `email_send`. e2e `test_internal_with_smtp_queues_email` asserts
  `email=pending_approval` + non-empty `pending_approvals()` across all 3 graphs.
- **Backward-compat byte-identical** — CONFIRMED. No `smtp` ⇒ `resolve_channels` returns ()
  ⇒ helper returns `""` (truly empty, not `" "`); summary = unchanged `delivery_summary(...)`.
  e2e `test_no_smtp_backward_compat` asserts `"email=" not in summary` and
  `summary.startswith("confluence=")`. The 48 existing graph/delivery/resume tests pass.

## Critical Issues

None.

## High Priority

None.

## Medium Priority

**M1 — `gateway` and `config` params untyped in the new public helper** (`audience_delivery.py:60-61`).
The registry's `deliver_extra_channels` annotates `gateway: ActionGateway, config: ReportingConfig`
(under `TYPE_CHECKING`), but the S4 helper leaves them bare. ruff passes (no annotation rule
enforced), and the module already has the `TYPE_CHECKING` import for `ReportingConfig`, so the
fix is free and matches the sibling function. Low risk, but it's a public function on a
trust-boundary path — typed params document the contract and catch a wrong-shape caller.
Fix: add `from src.actions.action_gateway import ActionGateway` under the existing
`TYPE_CHECKING` block and annotate `gateway: ActionGateway, config: ReportingConfig`.

## Low Priority

**L1 — DRY: the 3 per-graph call sites are near-identical 4-line blocks**
(`report_graph.py:204-209`, `okr_report_graph.py:154-158`, `resource_report_graph.py:168-172`).
The plan suggested factoring the whole deliver-loop; the author instead factored a shared
*summarize* helper and kept a thin per-graph call. **This is the right DRY balance** — judged
acceptable, do not change. Each call passes a graph-specific body var (`detail_body` vs `body`)
and rationale string; a full loop-factor would need to hoist the entire Confluence+Slack+extra
sequence (which legitimately differs per graph: resource strips the link for external, report
appends weekly lines). Forcing one super-helper would couple three graphs that intentionally
diverge. The ~3 lines of repetition is cheaper than that coupling (KISS > DRY here).

**L2 — LOC gate**: report_graph 328, okr 252, resource ~250 (all >200). report_graph was
already >200 pre-P11; S4 added ~7 lines each. Not meaningfully worsened. No action — splitting
a graph's `_deliver` further would hurt readability more than the gate helps. Flagged per
checklist only.

**L3 — lazy `from src.agent.audience_delivery import deliver_extra_channels_and_summarize`
inside each `_deliver`** (e.g. `report_graph.py:204`). report_graph already imports
`delivery_summary`/`resolve_audience_delivery` lazily at the top of `_deliver` (`:158-162`),
so this is consistent with local style (avoids import cycle: audience_delivery →
channel_registry is itself lazy at `:79`). No action.

## Edge Cases Scouted

- **audience domain**: `audience: str = "internal"` default across all factories; only
  `"internal"`/`"external"` are produced by entry points. The `!= "internal"` gate is
  fail-closed for any unexpected value. SAFE.
- **`zip(channels, results, strict=False)`** (`:91`): if a channel raises inside the registry
  it's logged+skipped, so `results` may be shorter than `channels`. `strict=False` is correct
  here (don't raise on length mismatch) — a skipped channel simply gets no suffix, summary
  stays well-formed. Intentional and correct.
- **Resume/approved path**: `approved` threads through to the email step exactly like
  Slack/Confluence (`approved=approved` passed in all 3). On an *external* resume the helper
  returns `""` anyway (red line holds on resume too). On an *internal* approved resume the
  email runs `gateway.execute` (still Lớp B → re-queues pending_approval, not auto-sent) —
  consistent with how Slack/Confluence behave on resume. 33 resume/approval tests pass.
- **e2e fixture monkeypatch soundness**: report_graph binds `deliver_report` at MODULE level
  (`:22`) → patched via `src.agent.report_graph.deliver_report`; okr/resource lazy-import it
  *inside the deps factory* → resolved at factory-call time (after fixture applies) → patched
  at source `src.actions.slack_write.deliver_report`. `create_report_page` lazy in all 3 →
  source patch. Fixture is NOT testing nothing: `pending_approvals()` non-empty can only come
  from the email (Confluence/Slack fakes return `dry_run`, never queue). SOUND.
- **Config flow to server**: worker `build_graph_for` passes `loaded.config` whole to all 3
  builders (`worker.py:83/90/96`); builders pass `config` to `default_*_deps`; server inherits
  via worker. `config.smtp` reaches the graph unchanged. NO entry-point edit needed — verified.
- **Secret leakage**: SMTP password read from `os.environ["SMTP_PASSWORD"]` inside
  `make_email_handler` at send time; never on the action dict, audit log, or approval store
  (`email_write.py:53`). `from_addr` defaults to `user` in `build_smtp`. No PII/secret in
  the summary suffix (only `channel=status` + `approval_id`).

## Positive Observations (risk-calibration)

- The red-line gate placement (top of helper, before resolve/send) is the single most
  important S4 decision and it's correct + documented + tested per-graph. This is the right
  defense-in-depth: even though the *content* would be the internal-detail body, the gate
  refuses by audience, not by inspecting the body.
- Red-line suite (`test_p11_redline.py`) is genuine, not phantom: it asserts DATA_LOSS for
  destructive Linear, NOT_ALLOWLISTED for unlisted writes, CREDENTIAL for secret-in-email,
  Lớp B for every well-formed email, and that `execute_approved` cannot override Lớp A or the
  kill-switch. These drive `classify`/`needs_interrupt`/gateway with real assertions on
  category + interrupt, not just "ran without error".

## Recommended Actions

1. (M1) Add type annotations to `gateway`/`config` on `deliver_extra_channels_and_summarize`
   — free, matches the sibling registry function, documents the trust-boundary contract.
2. No other code change required. L1/L2/L3 are accept-as-is judgments.

## Metrics

- Tests: 702 passed (P11 e2e+redline 25; resume/approval-gate 33). 0 failures.
- Lint: 0 issues (ruff src+tests). Type: no new annotations missing except M1.
- New LOC: ~44 (helper) + ~21 (3 call sites) + 2 test files. Net small, scoped.

## Unresolved Questions

1. **Email idempotency on resume**: `_dedup_key` is `email-report:{recipients}:{report_date}`
   (`email_write.py:72`). On an internal resume that re-runs `_deliver`, does the gateway's
   dedup correctly return `deduplicated` (in `EXTRA_CHANNEL_OK_STATUSES`) for the same
   (recipients, date) rather than queuing a second approval? The e2e drives a single
   `deliver()` call, so the resume-re-deliver dedup path for email isn't directly asserted.
   Likely fine (same dedup machinery as Confluence/Slack), but an explicit "resume does not
   double-queue the email" assertion would close it. Non-blocking.
2. **Docs pending** (architecture.md, config.example.env, profile.yaml) — out of scope for
   this code review, but acceptance criteria #10 requires them before the phase closes.

---

Status: DONE_WITH_CONCERNS
Summary: S4 wiring is correct and guardrail-safe — external never emails (fail-closed gate at
helper top, tested per-graph), email stays gateway-routed Lớp B, backward-compat byte-identical;
702 pass / lint clean. One MEDIUM (untyped public params) + one unresolved Q (resume email-dedup
not directly asserted).
Concerns: M1 typed-params (trivial fix); resume email double-queue dedup unasserted (Q1);
docs still pending (acceptance #10).
