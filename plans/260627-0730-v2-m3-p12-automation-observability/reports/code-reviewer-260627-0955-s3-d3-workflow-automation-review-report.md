# Code Review — v2 M3-P12 Slice S3 (D3 workflow automation: READ-ONLY + PROPOSE)

Date: 2026-06-27
Reviewer: code-reviewer (adversarial / guardrail-critical pass)
Base: HEAD=6cda62d (S2). Branch: main.

## Scope
- Files: `src/automation/{__init__,prompts,schema,propose,engine}.py`, `src/entrypoints/mpm_automate_cmd.py`, `src/entrypoints/mpm.py` (dispatch), `docs/v2/examples/automation-blocker-stakeholder-note.yaml`, 4 new test files.
- LOC (all automation files <200): engine 109, prompts 40, propose 63, schema 129, cmd 132. PASS.
- Focus: prove the red line — a workflow can NEVER auto-execute a write; it can only enqueue a Lớp B proposal through the Action Gateway.

## VERDICT ON THE INVARIANT

**CONFIRMED: a workflow can only PROPOSE (enqueue a Lớp B approval), never auto-execute a write, and never bypasses the Action Gateway.**

Proven structurally AND empirically:

1. **No handler is ever passed.** `engine.py:97` calls `gateway.execute(action, rationale=...)` with NO `handler=`. The gateway's execute chain (`action_gateway.py:257-262`) returns `status="skipped"` (no-op) when `handler is None` — a write physically cannot run from this path. Verified by `test_engine_never_executes_a_write` (spy asserts `handler is None`).
2. **No approve path is ever called.** Engine never references `execute_approved`/`approve` (grep-guarded in code by `test_automation_engine_never_calls_approve_paths_in_code`, and behaviorally by `test_engine_never_calls_approve_paths`).
3. **`build_propose_action` constructs plain dicts only** (`propose.py:45-62`) — no callable, no handler key. The two targets (`slack.post`→`mcp_tool/post_message`, `linear.comment`→`mcp_tool/linear_createComment`) are both `mcp_tool` ⇒ in `_MUTATING_TYPES` ⇒ fully gateway-governed.
4. **No action shape a propose can build auto-executes.** I traced every gateway branch for a handler-less `mcp_tool`:
   - `linear.comment` → `linear_createComment` matches the `createcomment` Lớp B marker (`hard_block.py:63`) ⇒ `pending_approval`. Verified empirically (`test_linear_comment_propose_enqueues`).
   - `slack.post` to an **external** channel ⇒ Lớp B ⇒ `pending_approval` (verified).
   - `slack.post` to an **internal** channel ⇒ NOT Lớp B, IS allowlisted ⇒ reaches the execute stage with no handler ⇒ returns `status="skipped"` (no-op). I ran this directly: `INTERNAL slack propose status: skipped | pending: 0`. No write, no enqueue. Safe.
   There is no propose-buildable shape that is (a) a mutating type, (b) allowlisted, (c) non-Lớp-B, AND (d) carries a handler — (d) is impossible because the engine never supplies one.

## CRITICAL CHECKS (all PASS)

1. **No bypass / no auto-execute** — PASS (see verdict).
2. **Grep-guard correctness** — PASS. `test_automation_redline.py:94-100` extracts only lines starting with `import `/`from ` before substring-matching the forbidden module set (`slack_write`, `linear_write`, `email_write`, `confluence_write`, `approved_dispatch`, `mcp_adapter`), so a docstring mention won't false-positive. I confirmed the guard WOULD catch a real import: adding `from src.actions.slack_write import x` produces an import line containing `slack_write` → assert fails. The `call_tool(` check scans full source (correct: a call, not just an import, is the danger). Sound.
3. **Schema fail-closed** — PASS on every probe:
   - (a) arbitrary read tool → `READ_TOOLS` frozenset whitelist, no dynamic import from the yaml value (`schema.py:91`). Rejected (`test_unknown_read_tool_rejected`).
   - (b) free-text LLM prompt → `analyze:` value is the prompt NAME, registry-validated via `is_known_prompt` (`schema.py:101`); there is NO yaml path that supplies prompt text. Confirmed by reading `prompts.py` (text lives only in `_NAMED_PROMPTS`).
   - (c) compound/eval `when` → single `==` only. I probed beyond the test set: `a in b` REJECT (no `==`), `x == y == z` REJECT (multi-`==`), `1 == 1 and 2==2` REJECT, `field == value or x` REJECT. The dunder case `__import__ == os` "parses" but is INERT — `when` evaluation is `str(context.get(field)) == value` (`engine.py:48`), a literal string compare, never `eval`. A dunder field is just a missing context key. Confirmed: `_condition_met` on empty ctx → False. No code execution possible.
   - (d) propose target outside whitelist → `PROPOSE_TARGETS` frozenset (`schema.py:110`). Rejected (`test_unknown_propose_target_rejected`).
4. **Secret/destructive propose hits Lớp A** — PASS. The propose whitelist has only `slack.post`+`linear.comment`; a destructive op (delete/gh) CANNOT even be expressed (parse-time deny). A secret templated from a read result into a proposal is CREDENTIAL-denied at the gateway — I ran the end-to-end case (read returns `ghp_...`, templated into the slack body): `CREDENTIAL deny on templated secret`, `pending after deny: 0`. The `test_secret_in_proposal_credential_denied` test is meaningful (token-shaped body → `HardBlockedError`, empty queue).
5. **`{{var}}` templating** — PASS. Regex `\{\{\s*(\w+)\s*\}\}` is `\w`-only, linear (no nested quantifier, no ReDoS — a 200k-whitespace probe resolved in 0.0002s). Templating substitutes VALUES only; it cannot inject a new args key (keys come from the parsed dict, `propose.py:29` preserves them) and cannot escape the args dict (a value like `x", "admin": true` stays an inert string — confirmed `args keys: ['channel','text']`, value unchanged). A dict/list context value coerces to its `str()` repr (inert).
6. **dry-run inert** — PASS for the gateway: dry-run builds the action dict and never calls `gateway.execute` (`engine.py:88-91`); `test_dry_run_never_enqueues` + `test_automate_dry_run_no_enqueue` confirm an empty ApprovalStore. See LOW-1 for the (intended, documented) note that dry-run still runs real reads + the real LLM.

## ALSO VERIFIED
- Acceptance: valid yaml → `pending_approval` (real) / prints plan, empty store (dry-run); unknown agent/tool/target/prompt → clean rc=1 error; cmd never prints "executed" (`test_automate_propose_enqueues` asserts `"executed" not in out`). PASS.
- Real read-tools map: `jira_read.get_open_issues`, `github_read.get_open_prs`, `linear_read.get_issues`, `confluence_read.get_page_content` ALL exist with signatures matching the call sites (`mpm_automate_cmd.py:30-35`). The earlier `get_page`/`get_okr_table` problem is fixed — the final map is all-real. PASS.
- `analyze_fn` builds messages as `{"role","content"}` dicts; `Message = dict[str, str]` (`src/llm/client.py:32`) and `LlmClient.complete(messages)` exists. PASS.
- `LoadedProfile.settings`/`.config` exist (`profile/loader.py:51-52`); the cmd's `loaded.settings, loaded.config` is correct. PASS.
- `mpm.py` dispatch routes `agent automate` → `run_automate(rest)` (`mpm.py:68-71`) and lists usage. PASS.
- `RegistryEntry(id, enabled)` matches the test's positional `RegistryEntry("acme", True)`. PASS.
- Tests: 38/38 new pass. Full suite: **767 passed, 1 warning** (pre-existing Starlette/httpx deprecation, unrelated). Lint: `ruff check` clean on all touched files. PASS.
- `when` semantics: `str(actual) == value`; absent field → `str(None) == value` (won't match unless value is literally `"None"`). Acceptable for a fail-safe gate (a missing field skips the workflow rather than running it). PASS.

## Findings

### Critical
None.

### High
None.

### Medium
None.

### Low
- **LOW-1 (dry-run runs real reads + real LLM).** `--dry-run` skips only the gateway; it still executes whitelisted reads (network/MCP) and the LLM analyze (token cost). This is documented (`mpm_automate_cmd.py:9-11`, engine docstring) and defensible: reads are non-mutating and "plan the proposals" requires real read/analysis output to template the real action dict. Acceptable as-designed; flag only so the operator expectation is explicit (dry-run is not zero-cost / fully offline). No change required. If a future fully-inert "lint" mode is wanted, that is a separate slice, not a defect here.
- **LOW-2 (no per-workflow read-result cap).** A `read` step binds the entire tool result into context unbounded; a very large read templated into a proposal yields a large action dict. The gateway audits/queues it regardless (no execution), so blast radius is bounded by the approval step. Not a red-line issue; note for future ergonomics only.

### Positive (risk-relevant)
- The "no handler" design is the right structural lever: the engine cannot execute a write because it never holds the capability to, rather than relying on a runtime check it could forget. This makes the invariant a property of the type-flow, not of a conditional.
- Defense-in-depth holds even if the propose whitelist were widened by mistake: any destructive/secret shape still hits Lớp A independently (verified for the secret case end-to-end).
- The grep-guard + behavioral red-line tests together cover both "did someone import a write path" and "did the engine call one at runtime" — the two ways the invariant could regress.

## Metrics
- New tests: 38 pass (schema 12, engine 7, redline 6+param, cmd 8 — exact split per file). Full suite 767 pass.
- Lint: 0 issues. Type: no new errors (frozen dataclasses, TYPE_CHECKING-only gateway import).
- LOC: all automation files <200.

## Unresolved Questions
None blocking. One product question for the lead (non-blocking): should a future `--lint`/`--check` mode stub reads + analyze so a workflow file can be validated with zero network/LLM cost? Out of scope for S3 (LOW-1).

---
Status: DONE
Summary: S3 D3 workflow automation is correct and guardrail-safe — a workflow can only PROPOSE (enqueue Lớp B) or no-op, never auto-execute a write, and never bypasses the Action Gateway; verified structurally and via end-to-end adversarial probes (internal-channel no-op, templated-secret CREDENTIAL deny, fail-closed parser). 767 tests pass, lint clean.
Concerns: none blocking; two LOW notes (dry-run runs real reads/LLM by design; unbounded read-result size) — informational only.
