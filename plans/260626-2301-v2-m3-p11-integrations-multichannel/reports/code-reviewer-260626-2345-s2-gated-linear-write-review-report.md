# Code Review — v2 M3-P11 S2: Gated Linear WRITE (linear_createComment)

Date: 2026-06-26
Reviewer: code-reviewer
Scope: GUARDRAIL-CRITICAL slice — first new write authority of P11.
Base: working tree vs S1 commit `76ad0c5`.

## Verdict

**CONFIRMED: the new write is gated Lớp B, and no existing deny was weakened.**

`linear:linear_createComment` is allowlisted, classified Lớp B (queued, never auto-run),
the destructive-Linear red line still hard-denies regardless of the allowlist, the
token-bearing spec stays in the handler closure (never on the persisted/audited action),
the approved dispatch fails closed, and the real `call_tool` is reachable only through
the gateway handler after all guards. All 659 tests pass; ruff clean. Changes are
strictly additive — no existing marker, allowlist entry, or check logic was modified.

## Files reviewed
- `src/actions/hard_block.py` (454 LOC; +18 additive) — allowlist + Lớp B marker
- `src/actions/linear_write.py` (NEW, 95 LOC) — handler + `post_comment` wrapper
- `src/actions/approved_dispatch.py` (+10 additive) — approved `linear` branch
- `src/actions/action_gateway.py` (unchanged; verified guard order)
- `tests/test_linear_write.py` (NEW), `tests/test_hard_block.py` (DENY/ALLOW cases)

## CRITICAL checks — all PASS (evidence)

**1. Lớp B marker does NOT catch existing allowed tools.** Marker is `"createcomment"`.
Verified by execution (`needs_interrupt`):
- jira `addComment` → `interrupt=False` (token `addcomment` has no `createcomment` substring) ✓
- confluence `createPage` → `interrupt=False` ✓
- confluence `updatePage`, jira `createIssue`, slack `post_message` → all `interrupt=False` ✓
- linear `linear_createComment` → `interrupt=True` ✓
The `test_jira_addcomment_still_auto_not_lop_b` / `test_confluence_createpage_still_auto_not_lop_b`
assertions are correct AND meaningful (they pin the exact non-collision this slice risks).

**2. Destructive Linear tools STILL hard-denied (Lớp A first, allowlist unreachable).**
`classify()` runs `_hard_deny_mcp` before the allowlist (`action_gateway.py:189`→`hard_block.py:415-443`).
Verified: `linear_deleteIssue`, `linear_deleteComment`, `linear_archiveProject`,
`linear_removeLabel`, `linear_purgeTeam` → all `DATA_LOSS` despite `linear` now being a known
server. A mutating Linear tool NOT named delete/archive AND not allowlisted
(`linear_createIssue`, `linear_updateIssue`, `linear_createProject`, `linear_addLabel`,
`linear_makeAdmin`) → `NOT_ALLOWLISTED` deny, as designed. No destructive tool slips both
the markers and the allowlist.

**3. createComment is the ONLY write in the allowlist entry.** The 4 read names
(`linear_getissues`, `linear_searchissues`, `linear_getissuebyid`, `linear_getprojects`)
contain no write-ish substring (create/update/delete/set/add/remove/archive/assign). No
other Linear write (createIssue/updateIssue/...) is allowlisted — verified each denies.

**4. Credentials never persisted.** `make_linear_comment_handler(spec)` captures the spec
in the closure (`linear_write.py:32-49`); the action dict built by `post_comment` carries
only `type/server/tool/args/dedup_hint`, and `args` only `issueId/body`. Empirical: with
`LINEAR_API_TOKEN=secret-tok-VALUE-123` set, the audit JSONL contains neither the token
value nor the env-key name; the persisted approval action keys are
`['args','dedup_hint','server','tool','type']`, args keys `['body','issueId']`. The
sibling `dedup_hint` is also credential-scanned (`_hard_deny_mcp` line 267-270) — a secret
hidden there → `CREDENTIAL`. Matches the established `slack_write` pattern exactly.

**5. Approved dispatch fails closed.** `approved_dispatch.py` adds the `linear` branch
before the existing fallthrough `RuntimeError("No live handler...")`. Unknown server
(`monday`) raises. `(config.extra_servers or {}).get("linear")` handles `extra_servers`
being None OR empty — both raise `RuntimeError("linear MCP server not declared...")`,
never a silent no-op. Verified by execution.

**6. No bypass of the gateway.** `call_tool` is invoked only inside the `_handler` closure
(`linear_write.py:43`). No module imports `post_comment`/`make_linear_comment_handler`
except `approved_dispatch` (post-human-approval path). The real Linear call cannot fire
under dry-run even on the approved path: `execute_approved` with `dry_run=True` returns
`status="dry_run"` with **0 handler calls** (verified live — the dry-run guard at
`action_gateway.py:233` is NOT gated on `approved`). `post_comment` refuses empty
body / missing issue_id before reaching the gateway.

## Acceptance — all PASS
- `gateway.execute(linear_createComment)` ⇒ `status=="pending_approval"`, `approval_id` set, handler NOT run ✓
- Approve/dispatch path ⇒ real (faked) `call_tool`, summary contains comment id ✓
- `linear_deleteIssue` / `linear_archiveProject` ⇒ `DATA_LOSS` ✓
- secret in `body` ⇒ `CREDENTIAL` ✓
- `uv run pytest -q` ⇒ 659 passed ✓
- `uv run ruff check src tests` ⇒ All checks passed ✓
- Backward-compat: slack post + jira addComment + confluence createPage + gateway/Lớp B/audit tests all green; additive allowlist entry + marker only ✓
- LOC: `linear_write.py` 95 (<200) ✓; `hard_block.py` 454 (was >200 pre-P11; S2 added 18 well-grouped lines, structure not worsened) ✓

## Findings by severity

### CRITICAL — none
### HIGH — none
### MEDIUM — none

### LOW (informational, non-blocking)

**L1 — Plan/phase labels in code comments** (`hard_block.py:60,128`, `approved_dispatch.py:25`):
comments carry `M3-P11 (C3)`, which `.claude/rules/review-audit-self-decision.md`
("Stable Code Artifacts") asks to avoid. However this is a **verified-pervasive existing
convention** — `action_gateway.py`, `slack_write.py`, `confluence_write.py`,
`approved_dispatch.py` all already use `M2-P5`/`M2-P7`/`§7.9` labels. Per the review rule
("do not reverse a verified decision over an abstract concern"), I do NOT block on this;
flagging only for consistency if the team later sweeps the convention. The comments DO
also explain the invariant (not just the label), so they are not pure noise.

**L2 — `post_comment` uses `config.extra_servers.get(...)` directly** (`linear_write.py:75`)
while `approved_dispatch` uses the defensive `(config.extra_servers or {}).get(...)`. This
is a non-issue: `ReportingConfig.extra_servers` is typed `dict[str, McpServerSpec]` (not
Optional) and the builder `_build_extra_servers` always returns a dict (`{}` when none
declared), so `post_comment` cannot hit `None.get`. Noting only the minor asymmetry; no
change required.

## Positive observations (risk-relevant)
- Defense-in-depth ordering is correct and unchanged: Lớp A → Lớp B → allowlist deny.
  An approved action can pass only a `NOT_ALLOWLISTED` block, never a real Lớp A deny
  (`action_gateway.py:216-223`), so the createComment Lớp B approval can never be abused
  to push a destructive Linear tool through.
- The closure-not-action credential pattern is consistent with `slack_write`/`confluence_write`,
  reducing the chance of a future copy-paste leaking a token onto the audited action.
- DENY_CASES adds the exact adversarial Linear set (deleteIssue/archiveProject/secret-body/
  makeAdmin) that proves the red line holds for the new known server.

## Status
Status: DONE
Summary: S2 correctly gates the new Linear write as Lớp B and weakens no existing deny;
all 6 critical checks pass with empirical evidence, 659 tests green, ruff clean. Only two
LOW informational notes, neither blocking.
Concerns: none blocking.

## Unresolved questions
1. The 4 read tool names (`linear_getIssues` etc.) are listed "for clarity" but reads
   bypass the gateway, so they are inert in the allowlist. Confirm the team wants them
   retained as documentation vs. removed to keep the allowlist strictly the enforced
   write surface (either is safe; listing them is harmless, removing them changes nothing
   functionally). Non-blocking.
