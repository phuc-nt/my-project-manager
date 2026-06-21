# Phase 03 — Guardrails (Audit + Budget + Action Gateway)

## Goal
Every guardrail from PDR §7 + §7.9 present BEFORE any real write handler exists. This is the heart of "full autonomous write" safety.

## Files created
- `src/audit/audit_log.py` — append-only JSONL writer. `record(entry: AuditEntry)` appends one JSON line to `.data/audit/audit.jsonl` (configurable). Entry schema: `{timestamp, action_type, tool, params, verdict, reason, result_summary, dry_run, rationale}`. Never overwrites; opens in append mode. No secret values may be logged (caller responsibility + a redaction helper for known key-ish fields).
- `src/llm/budget_tracker.py` — accumulate monthly cost. Storage: JSON file `.data/budget/budget-YYYY-MM.json` (`{month, total_usd}`). `record_cost(usd)`, `check_allowed() -> (allowed, ratio)`. Warn log at ≥80%, raise `BudgetExceededError` at ≥100%. Auto-resets when month rolls over (new file). Wire `check_allowed()` into `llm/client.complete()` BEFORE the call; `record_cost()` AFTER.
- `src/actions/hard_block.py` — **Lớp A list** (PDR §7.9). Pure functions: `classify(action) -> BlockVerdict`. **Action shape = MCP tool call `{server, tool, args}` OR `gh` command `{argv}`** (the real Phase-1 integration shapes), not Python SDK calls. Hard-block categories: (1) permanent data loss (`gh` force-push / delete repo/branch/tag, Confluence `deletePage` / overwrite w/o version, Jira delete-issue, delete backup/file, `rm` data); (2) credential exfil (sending/echoing secret to any sink — esp. broad Slack browser-token); (3) security incident (grant perms, change visibility public, invite outsiders, disable security). Structured match first (server+tool name, gh subcommand+flags like `--force`), keyword secondary. Returns DENY with category + reason. **This is code, not LLM-decided.** Phase 0 has no live actions → tests use representative MCP-tool/`gh` payloads (deny + allow cases).
- `src/actions/action_gateway.py` — single entry `execute(action, *, handler=None)`:
  1. `hard_block.classify` → if DENY: audit + raise `HardBlockedError` (never reaches handler/LLM).
  2. kill-switch (`write_disabled`) → refuse all mutations, audit.
  3. dry-run (`dry_run`) → audit intended action, return DryRunResult, do NOT call handler.
  4. rate-limit (cap writes/min, in-memory token bucket per process).
  5. idempotency (dedup key from action; in-memory + optional marker; skip duplicate, audit).
  6. execute handler (Phase 0: handler is None/no-op → returns "no handler, skipped"; real handlers Phase 1).
  7. audit result, return.

## Constraints
- hard_block + gateway = the ONLY place mutations are authorized. Document this invariant in module docstrings.
- Lớp B (interrupt/ask-human) NOT implemented this round (no real write actions yet) — leave a clear TODO hook + note it's Phase 1/2 per PDR §7.9. Do NOT fake it.
- Reversibility: gateway prefers dry-run by default.

## Validation (tests in phase 5, but design for testability)
- hard_block denies each Lớp A category (table-driven).
- gateway: dry-run logs + skips handler; kill-switch refuses; budget hard-stop raises; idempotent re-run skips.
- audit: entries are valid JSON lines, append-only (2 calls → 2 lines), no secret leaked.

## Risks
- Over-broad hard-block keyword match could false-positive benign actions → keep matchers structured (action.type/target) first, keyword as secondary; document each rule. Phase 0 has no real actions so low blast radius; tests assert both deny + allow cases.
