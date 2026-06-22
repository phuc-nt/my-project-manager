---
title: "Phase 5 — Audience-split reporting (internal vs external)"
description: "Add --audience internal|external to all 4 report kinds (daily/weekly/okr/resource). External = business-tone prose + posts to a stakeholder channel that routes through the EXISTING Lớp B approval. Internal stays byte-identical (backward-compat). NO new write authority, NO new approval path."
status: done
priority: P2
effort: 9h
branch: main
tags: [phase-5, audience, stakeholder, external, reporting, lop-b, langgraph]
created: 2026-06-22
---

# Phase 5 — Audience-split reporting

Add an `--audience internal|external` option to ALL 4 report kinds (daily, weekly,
okr, resource). `internal` (default) = current behavior, byte-identical. `external`
= a business-tone, stakeholder-facing version that posts to a configured stakeholder
Slack channel which `hard_block.needs_interrupt` already classifies as **Lớp B** →
queued for human approval, NOT auto-posted.

The difference between audiences lives in the **LLM-composed prose tone + detail
level** and in **which Slack channel the short posts to**. The deterministic data
tables stay factual; external simply omits internal noise (raw issue keys, PR
numbers, per-person workload, assignee names, labor cost) and reads as a stakeholder
update.

**REUSES** the Phase 2 Lớp B path entirely. NO new MCP write tool, NO allowlist
entry, NO Lớp A/B logic change. The single new guardrail concern is a config
foot-gun (a stakeholder channel NOT in the external set would auto-post without
approval) — closed by validation in Slice A.

## Scope boundary (user-confirmed 2026-06-22)

Phase 5 here is **ONLY audience-split**. The roadmap's Phase 5 also lists "service
backend + Slack bot UI + multi-user" — those are **explicitly deferred** to a future
effort (the Slack browser-token MCP server is SEND-ONLY; a real Slack bot / multi-user
needs major new infra). Do NOT plan them here.

## Confirmed decisions (do NOT re-litigate)

- **Audience = 2 levels.** `internal` (default): full technical detail — issue keys,
  PR numbers, blockers, the current report content. `external`: business summary for
  stakeholders/customers — progress/status/milestones, NO raw keys / PR numbers /
  internal blocker chatter. Difference = TONE + DETAIL of the LLM prose, not the
  factual numbers.
- **External delivery = the existing Lớp B path.** When `audience=external`, the Slack
  short posts to `SLACK_STAKEHOLDER_CHANNEL` (a new explicit config). That channel
  MUST be in `slack_external_channels`, so `needs_interrupt` (hard_block.py:79-111,
  unchanged) returns Lớp B and the gateway queues it (`pending_approval`) instead of
  auto-posting. Internal stays auto. NO new approval mechanism.
- **Coverage = ALL 4 kinds.** daily/weekly/okr/resource each gain
  `--audience internal|external`; default `internal` reproduces current behavior.
- **External resource report drops per-person detail** (privacy): no assignee names,
  no per-assignee table, no labor cost — only a high-level "team capacity ok/strained"
  line + LLM-budget status band. See phase-01 + Open Questions.
- **Confluence detail page is created for BOTH audiences** (KISS — same page/space).
  Only the Slack short + channel + prose tone differ by audience. The external
  Confluence page is internal-visibility (the stakeholder gets the Slack summary, not
  the Confluence link by default) — see Open Questions.
- **`pending_approval` is a SUCCESS for external delivery**, not a failure. The
  `_deliver` ok-check in all 3 graphs must accept `slack=pending_approval` when
  `audience=external` (action_gateway.py:202-206 returns that status).

## Slices (ordered, each independently testable)

| # | Slice | File | Status | Depends on |
|---|-------|------|--------|-----------|
| A | Audience-aware prompt builders for all 4 report families (external system prompts + audience Slack shorts, external resource drops names/labor) + config `slack_stakeholder_channel` with validation it's in the external set. Pure, unit-tested. | [phase-01-audience-prompts-config.md](phase-01-audience-prompts-config.md) | ✅ done |
| B | Thread `audience` through the 3 graph builders + deps (compose picks audience prompt, deliver picks channel = stakeholder for external) + handle `pending_approval` + CLI/cron `--audience` flag + E2E. | [phase-02-graph-cli-delivery-wiring.md](phase-02-graph-cli-delivery-wiring.md) | ✅ done |

**Done 2026-06-22** — 2 slices, 269 UT, ruff clean, code-reviewed. Backward-compat verified (internal
byte-identical, all prior tests pass unchanged). Code review found C1 (external resource Slack short
linked the internal per-assignee Confluence page → privacy leak) → fixed (external resource short omits
the link). E2E: external report → business tone → Lớp B queue → **approve → real Slack post**. The E2E
exposed + fixed a Phase-2 gap: `approve <id>` was a stub that authorized but didn't dispatch — now
`_dispatch_approved_action` routes the approved Slack post to its live handler (the first Lớp B action
to actually execute on approval). Deployment note: internal + stakeholder channels should be DISTINCT
(a shared channel routes internal posts to Lớp B too — correct but not the intent).

Dependency graph: **A → B**. A is pure (prompt builders + a config field + a
validation helper, all unit-testable with no network). B wires the audience through
the graphs, delivery channel selection, the `pending_approval` handling, and the
CLI/cron flag, then E2E-verifies internal-unchanged + external→queued-for-approval.

## File ownership (no two slices touch the same file)

| Slice | Creates | Modifies |
|-------|---------|----------|
| A | `tests/test_audience_prompts.py` | `src/llm/report_prompt.py`, `src/llm/okr_report_prompt.py`, `src/llm/resource_report_prompt.py`, `src/config/reporting_config.py`, `config.example.env` |
| B | `tests/test_audience_delivery.py` | `src/agent/report_graph.py`, `src/agent/okr_report_graph.py`, `src/agent/resource_report_graph.py`, `src/entrypoints/cli.py`, `src/entrypoints/cron.py` |

No file is touched by both slices. A owns prompt + config layers; B owns graph +
entrypoint layers. The `tests/test_audience_*.py` split keeps each slice's tests in
its own new file (existing test files are untouched — they assert the unchanged
internal behavior and MUST still pass).

## Acceptance criteria (whole phase)

1. **Backward compat (TOP).** With no `--audience` flag (or `--audience internal`),
   every report kind produces output byte-identical to current behavior. `uv run
   pytest` passes with ALL existing test files UNCHANGED. `uv run ruff check src
   tests` clean. No file exceeds 200 LOC (split if it would).
2. `uv run python -m src.entrypoints.cli report --daily --audience external` (and
   `--weekly`, `--okr`, `--resource`) composes a business-tone report and attempts to
   post the Slack short to `SLACK_STAKEHOLDER_CHANNEL`; because that channel is in
   `slack_external_channels`, the gateway returns `pending_approval` and the action
   appears in `cli approvals`. The run reports `delivered=True` (queued is success),
   summary shows `slack=pending_approval`. The Confluence detail page is still created.
3. External prose/short omit internal detail: no raw issue keys, no PR numbers, no
   internal blocker chatter; external resource short/prose carry NO assignee names, NO
   per-assignee numbers, NO labor cost — only a high-level capacity word + LLM-budget
   band. Verified by unit tests asserting an injected key/name does NOT appear in
   external output.
4. **Config guardrail.** If `SLACK_STAKEHOLDER_CHANNEL` is set but NOT in
   `slack_external_channels`, config raises a clear error at load (the would-be
   foot-gun where an external report auto-posts to stakeholders without approval is
   prevented). If `SLACK_STAKEHOLDER_CHANNEL` is unset, requesting `--audience
   external` fails fast with a clear message (no silent fallback to the internal
   channel). Verified by unit tests.
5. NO new MCP write tool, NO allowlist entry, NO change to `hard_block.classify` /
   `needs_interrupt` / `action_gateway` logic. The external route reaches Lớp B purely
   through channel selection. Verified by grep/diff: `hard_block.py` and
   `action_gateway.py` are NOT in the file-ownership table.

## Risks (phase-level; per-slice detail in phase files)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Config foot-gun: stakeholder channel NOT in `slack_external_channels` → external report auto-posts to stakeholders with NO approval (a guardrail hole) | M×H | `get_reporting_config()` validates `slack_stakeholder_channel ∈ slack_external_channels` (when set) and raises at load. Unit test asserts the raise. This is the single most important guardrail in the phase. |
| `pending_approval` treated as a delivery failure → external runs report `delivered=False`, cron exits non-zero, looks broken | M×M | The `_deliver` ok-check accepts `slack=pending_approval` as success when `audience=external`. Unit test asserts external `_deliver` returns `ok=True` with a fake gateway returning `pending_approval`. |
| Backward-compat regression: an `audience` default other than `internal`, or a prose/format drift in the internal path | L×H | `audience: str = "internal"` defaulted everywhere; internal branch byte-identical (same system prompts, same Slack-short text). ALL existing test files run UNCHANGED as the regression gate. New tests live in new files only. |
| Internal detail leaks into external prose (LLM ignores the "no keys/PR numbers" instruction) | M×M | (a) The deterministic numbers the LLM sees are already qualitative for okr/resource narratives (no keys passed); for daily/weekly the external user message passes a SUMMARIZED risk view (counts + severities, NOT raw `subject`/`detail` with keys). (b) Unit test asserts an injected key like `SCRUM-15` in a risk subject does NOT reach the external user-message payload. Residual LLM-output risk accepted (prose is human-reviewed via Lớp B before reaching stakeholders). |
| External resource report exposes assignee names / labor cost (privacy) | M×H | External resource path uses a names-free, table-free short + prose: only `len(loads)` people + a capacity word + LLM-budget band. Unit test asserts no assignee name and no labor figure appear in external resource output. |
| External cron silently queues forever (no human watching approvals) | L×M | Documented behavior, not a bug: an external cron → Lớp B → `pending_approval` is the CORRECT guardrail (a stakeholder update should never auto-fire unattended). Surfaced in cron log (`delivered=True pending_approval`). Noted in deployment docs + Open Questions. |

## Rollback

Each slice reverts by deleting its created test file + reverting its diffs (see
ownership table). Reverting B removes the `--audience` flag and the channel/prose
selection, restoring `report`/`cron` to the current 4-kind, internal-only behavior.
Reverting A removes the external system prompts + the `slack_stakeholder_channel`
config field + its validation. No migrations, no schema, no gateway/allowlist changes
to undo. Because `audience` defaults to `internal` everywhere, a partial revert (B
only) leaves A's prompt builders dormant but harmless (internal path unaffected).

## Out of scope (Phase 5 — audience-split)

- Service backend / Slack bot UI / multi-user / multi-project (deferred — the Slack
  MCP server is send-only; needs major new infra).
- A third audience level (e.g. "exec one-liner") — only internal/external this phase.
- Per-stakeholder / per-customer channel routing (single `SLACK_STAKEHOLDER_CHANNEL`).
- Auto-approving external reports (every external post stays Lớp B by design).
- A separate Confluence space/parent for external pages (same space; the difference is
  the Slack short + channel — see Open Questions if a split is later wanted).
- Audience for the weekly-EMBEDDED okr/resource sub-sections (the weekly report itself
  gets `--audience`; the embedded sub-sections stay internal-detail — see Open Qs).

## Resolved (user-confirmed 2026-06-22)

1. **Audience model = 2 levels** (internal default / external). Tone+detail differ, not
   the factual numbers.
2. **External delivery reuses Lớp B** via channel selection; the channel must be in
   `slack_external_channels`. No new approval path.
3. **Coverage = all 4 report kinds.**
4. **Explicit `SLACK_STAKEHOLDER_CHANNEL`** config (not "first of the external set") +
   validation it's in `slack_external_channels`.
5. **External resource report is high-level** (no assignee names, no labor cost).

## Resolved open questions (user-confirmed 2026-06-22)

1. **External resource report EXISTS, high-level** — no assignee names, no per-person
   table, no labor cost; only a capacity word + people count + LLM-budget band.
2. **External DOES create a Confluence page, same space (MPM)** — only the Slack short +
   channel + prose tone differ by audience. Page is internal-visibility; the stakeholder
   gets the Slack summary.
3. **External weekly DROPS the embedded OKR + resource sub-sections** — an external weekly
   is the sprint business summary only (the embedded sub-sections are internal detail).
