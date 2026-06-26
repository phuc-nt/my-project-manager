# Phase S2 — Gated Linear write: allowlist + Lớp A/B + dispatch (C3, part 2)

**Goal:** add ONE gated Linear WRITE (`createComment`) as a NEW server's write tool, flowing
through the default-DENY allowlist + Lớp A/B classification + approved-dispatch. Proves the
generic write path: a new server's write tools are DENIED until explicitly allowlisted, then
Lớp B-queued. Independently shippable (write denies-by-default if S2 partial = fail-safe).

**Depends:** S1 (needs `config.extra_servers["linear"]`).

## RESOLVED (research report, verified)

- **Gated write tool (verbatim):** `linear_createComment` → classify **Lớp B**.
- **Exact `_MCP_ALLOWLIST` edit** (names lowercased — `_allowlisted_mcp` matches case-insensitively):
  ```python
  "linear": frozenset({
      "linear_getissues", "linear_searchissues", "linear_getissuebyid",
      "linear_getprojects", "linear_createcomment",
  }),
  ```
  Read tools listed too (harmless belt-and-suspenders; reads bypass the gateway anyway). The ONLY
  write in the set is `linear_createcomment`.
- **Lớp B marker:** `_LOP_B_MCP_TOOL_MARKERS` has no "comment" marker today → add `"createcomment"`
  (substring-matches `linear_createcomment`) so the write queues for approval.
- **Destructive Linear tools** (`linear_deleteissue`, `linear_deletecomment`, `linear_archiveproject`,
  `linear_archiveissue`, ~15 delete/archive/unarchive) → already Lớp A hard-denied by
  `_DATA_LOSS_TOOL_MARKERS` (delete/remove/archive substrings). NO allowlist entry for them. S2 adds
  red-line tests for `linear:deleteissue` AND `linear:archiveproject`.

## Context links (verified file:line)

- `src/actions/hard_block.py:119-125` — `_MCP_ALLOWLIST` (per-server frozenset of allowed tools;
  `_MCP_ALLOWLIST.get(server, frozenset())` at `:390` = empty for unknown server = DENY).
- `src/actions/hard_block.py:54-60` — `_LOP_B_MCP_TOOL_MARKERS` (substring match → human approval).
- `src/actions/hard_block.py:143-160` — `_DATA_LOSS_TOOL_MARKERS` (delete/remove/purge/destroy/
  trash/archive) + `_SECURITY_TOOL_MARKERS` (the Lớp A red line, substring match).
- `src/actions/hard_block.py:239` `_hard_deny_mcp` + `:397` `classify()` (Lớp A first, then
  default-DENY allowlist).
- `src/actions/action_gateway.py:129` `execute()`, `:144` `execute_approved()`, `:286` `approve()`;
  `_MUTATING_TYPES = {"mcp_tool","gh_cli"}` at `:38` (linear write IS an `mcp_tool` ⇒ already routed).
- `src/actions/approved_dispatch.py:22` `dispatch_approved_action(action, config)` — only routes
  `server=="slack"` today; any other ⇒ `RuntimeError("No live handler wired ...")`.
- `src/actions/slack_write.py:25` `make_slack_post_handler` — the EXACT handler template (closure
  captures the spec so token-bearing env never enters audit/approval store).

## Requirements

1. Add the `linear` entry to `_MCP_ALLOWLIST` exactly as in RESOLVED (5 lowercased names; only
   `linear_createcomment` is a write). `_allowlisted_mcp` matches case-insensitively, so the action
   passing `tool:"linear_createComment"` matches the lowercased `linear_createcomment`.
2. Add `"createcomment"` to `_LOP_B_MCP_TOOL_MARKERS` so the Linear comment queues for approval.
   **Caution:** marker is substring-matched across ALL servers — verify it does NOT catch an existing
   allowed tool: `createcomment` ≠ substring of jira `addcomment` or confluence `createpage` (safe).
   Regression test guards this.
3. Lớp A red line: `linear:deleteissue` / `linear:archiveproject` / any destructive name ⇒ hard-deny
   via existing `_DATA_LOSS_TOOL_MARKERS` (substring `delete`/`remove`/`archive`). NO code needed —
   `_hard_deny_mcp` scans the tool name regardless of server. Add TESTS for both names.
4. A `linear_write.py` handler + a `post_comment(...)` wrapper mirroring `slack_write.deliver_report`:
   builds `{"type":"mcp_tool","server":"linear","tool":"linear_createComment","args":{"issueId":...,
   "body":...},"dedup_hint":...}`, calls `gateway.execute()` (Lớp B ⇒ pending_approval) or
   `execute_approved()` (resume path).
5. `dispatch_approved_action` gains a `linear` branch: `server=="linear"` ⇒ build the linear handler
   and run it. Lazy import (mirror the slack lazy import for the monkeypatch target).

## Files to create / modify / delete

**Modify:**
- `src/actions/hard_block.py` — add the 5-name `"linear"` frozenset (per RESOLVED) to `_MCP_ALLOWLIST`;
  add `"createcomment"` to `_LOP_B_MCP_TOOL_MARKERS`. (Disjoint region from S3's `email_send`
  classify branch — but same file: see plan.md ownership note; prefer running S2 before S3.)
- `src/actions/approved_dispatch.py` — add the `server=="linear"` dispatch branch.

**Create:**
- `src/actions/linear_write.py` — `make_linear_comment_handler(spec)` (closure over the spec) +
  `post_comment(text, *, gateway, config, issue_id, report_date, rationale, approved=False)`.
  Refuse empty body / missing issue_id (mirror `slack_write` empty-text refusal at `:79`).

**Delete:** none.

## Implementation steps

1. Add the linear allowlist entry + Lớp B marker. RESOLVED: `_allowlisted_mcp` matches
   case-insensitively, so the lowercased frozenset names match an action `tool:"linear_createComment"`.
   Confirm by re-reading `_allowlisted_mcp` (`hard_block.py:388-391`) once before editing; add a test
   asserting BOTH deny-before (no entry) and allow-after states to guard any casing regression.
2. Write `linear_write.py` mirroring `slack_write.py` (handler closure + gateway-routed wrapper +
   `_dedup_key`).
3. Extend `dispatch_approved_action` with the linear branch (lazy import for monkeypatch parity).
4. Tests, then broaden.

## Tests / validation

Extend `tests/test_hard_block.py` + new `tests/test_linear_write.py`:
- `linear:linear_createComment` BEFORE allowlisting (temporarily) ⇒ NOT_ALLOWLISTED deny. AFTER ⇒
  allowed past Lớp A but `needs_interrupt` ⇒ Lớp B queue (the gated-write proof).
- `linear:linear_createComment` via `gateway.execute()` ⇒ `status=="pending_approval"` + `approval_id`.
- `linear:deleteIssue` AND `linear:archiveProject` ⇒ Lớp A `DATA_LOSS` hard-deny EVEN with allowlist
  (red-line tests — both names).
- secret in `args` (e.g. an API key string) ⇒ `CREDENTIAL` deny (`_credential_verdict`).
- empty body / missing issueId ⇒ `post_comment` refuses before the gateway.
- approved path: `dispatch_approved_action({type:mcp_tool,server:linear,tool:linear_createComment,...},
  config)` with monkeypatched `call_tool` ⇒ returns the handler summary (no live key).
- regression: jira `addcomment` + confluence `createpage` still NOT Lớp B (the new marker didn't
  catch them); slack post still works.

Commands:
```
uv run pytest -q tests/test_hard_block.py tests/test_linear_write.py tests/test_action_gateway.py tests/test_mpm_dispatch.py
uv run pytest -q
uv run ruff check src tests
```

## Risks + rollback

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Tool-name CASING mismatch silently denies/allows the write | M×H | Trace `_allowlisted_mcp` casing before edit; add a test that asserts BOTH the deny-before and allow-after states. |
| `createcomment` Lớp B marker over-catches another server's tool | L×M | Substring-checked: verified it does NOT match `addcomment`/`createpage`; regression test guards. |
| Approved email/linear action deserializes but has no handler ⇒ mis-route | L×H | `dispatch_approved_action` raises explicit `RuntimeError` for unknown server (fail-closed) — never silent no-op. |
| A future destructive Linear tool slips the allowlist | L×H | Default-DENY: only `createcomment` is listed; everything else denied. Lớp A scans names regardless. |

**Rollback:** remove the linear allowlist entry + the `createcomment` Lớp B marker + the dispatch
branch + delete `linear_write.py`. Linear write then DENIES by default (fail-safe) — the read path
(S1) is unaffected.

## INVARIANT (restated)

The new Linear write tool is DENIED by default (`_MCP_ALLOWLIST.get("linear", frozenset())` = empty
until S2 adds exactly `createcomment`). It is classified Lớp B (queued for human approval), and any
destructive Linear tool name hits the Lớp A red line (`_DATA_LOSS_TOOL_MARKERS`) regardless of the
allowlist. The write flows through `ActionGateway.execute()` (it is an `mcp_tool`, already in
`_MUTATING_TYPES`) — never a side path. This phase ADDS write authority; it must not weaken any
existing deny.

## Unresolved questions

1. DEFERRED: live Linear-key E2E for the gated write (real `linear_createComment` after approval).
   Offline tests use a fake `call_tool`. Arg schema assumed `{issueId, body}` (tacticlaunch TOOLS.md);
   confirm exact arg keys against the installed server version before the live run.
2. RESOLVED: Linear comment is always Lớp B (no per-project split) — conservative, matches the
   all-email-Lớp-B stance. Revisit only if approval noise becomes a problem.
3. RESOLVED: ONE write this round (`linear_createComment` only). `createIssue` etc. deferred (YAGNI);
   add later behind the same allowlist + Lớp B pattern.
