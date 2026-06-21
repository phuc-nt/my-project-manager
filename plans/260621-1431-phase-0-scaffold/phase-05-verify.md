# Phase 05 — Tests + Lint + Smoke

## Goal
Prove guardrails work without network; prove graph lifecycle with network (if key present).

## Files created (tests/)
- `tests/test_hard_block.py` — table-driven over **MCP-tool + `gh`-command payloads**: each Lớp A category → DENY (e.g. Confluence `deletePage`, `gh ... --force`, Jira delete-issue, secret-in-args, visibility→public); benign action (Slack post to allowed channel, Confluence `updatePage` with version) → ALLOW. (PDR §7.9 coverage.)
- `tests/test_action_gateway.py` — dry-run skips handler + audits; kill-switch refuses; idempotent re-run skipped; hard-blocked action raises before handler.
- `tests/test_budget_tracker.py` — accumulation, 80% warn, 100% raises `BudgetExceededError`, month rollover resets.
- `tests/test_audit_log.py` — append-only (N calls → N lines), valid JSON, no secret in output, redaction helper works.
- `tests/test_cost.py` — parse response with + without `cost` field.
- `tests/test_graph_build.py` — `build_graph` compiles without network/key.

## Steps
1. `uv run pytest -q` → all green (no network needed for these).
2. `uv run ruff check .` → clean (fix issues, don't suppress).
3. `uv run python -c "import src..."` compile/import check across modules.
4. **Smoke (network):** if `OPENROUTER_API_KEY` set → `uv run python -m src.entrypoints.cli "hello"`; confirm reply + cost line + audit entry + budget file updated. If no key → print SKIP with reason (do not fail the gate; note in report).

## Acceptance (maps to plan.md)
- Tests green; ruff clean; imports compile.
- Gateway denies Lớp A; dry-run default; kill-switch works; budget hard-stops.
- Smoke either passes (key present) or is explicitly skipped (recorded).

## Deliverable
- Report at `plans/260621-1431-phase-0-scaffold/reports/` summarizing: what built, test results, locked dep versions, smoke outcome, open questions.
- Update `docs/codebase-summary.md` (fill "tìm gì ở đâu" map) + check Phase 0 boxes in `docs/project-roadmap.md`.

## Risks
- Smoke needs real key + spends a few cents → acceptable per user (real-call decision). Budget tracker caps it.
- `cost` field absent for the model → smoke still passes (cost shows "unknown"); note in report as unresolved Q1.
