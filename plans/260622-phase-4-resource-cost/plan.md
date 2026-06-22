---
title: "Phase 4 — Resource + Cost reporting"
description: "One report covering team workload (capacity from Jira issues/assignee) AND cost (real LLM budget + labor estimate); standalone cli report --resource + a weekly-embedded section. READ-only — no new write authority."
status: done
priority: P2
effort: 12h
branch: main
tags: [phase-4, resource, capacity, cost, budget, reporting, langgraph]
created: 2026-06-22
---

# Phase 4 — Resource + Cost reporting

ONE report covering **both** resource (team workload) and cost. The agent only
**READS** Jira; delivery reuses the EXISTING Action Gateway path (createPage +
Slack post — both already Auto-allowlisted, same as OKR Phase 3). NO new MCP write
tool, NO allowlist entry, NO Lớp A/B change.

Two outputs (mirrors Phase 3 OKR):
- standalone `cli report --resource` → Confluence "Resource & Cost Status <date>"
  page + Slack short+link, through the gateway, dedup key `resource-<date>`;
- a resource+cost summary section embedded into the existing **weekly** report
  (fault-isolated, like the weekly OKR section).

## Confirmed decisions (do NOT re-litigate)

- **Capacity source = Jira issues per assignee** (no story points — running Jira MCP
  exposes none). Per assignee: open-issue count, overdue count, blocker-labelled count.
  Reuse `Issue` (`assignee`, `due_date`, `labels`, `status`) + the overdue/blocker/`is_done`
  LOGIC from `risk_analyzer.py:17-53`.
- **Overload = RELATIVE to team mean**: assignee overloaded if open-count > `team_mean ×
  RESOURCE_OVERLOAD_RATIO` (default 1.5). Self-adjusts to team size. Also surface
  overdue+blocker pressure carriers.
- **Cost = two parts**:
  a. **Real LLM budget** — READ the existing `BudgetTracker` (`spent_this_month()`, cap
     `settings.monthly_budget_usd`, warn `settings.budget_warn_ratio`). Do NOT duplicate
     or move budget logic. Surface spent / cap / % / status (ok|warn|over).
  b. **Labor cost ESTIMATE** (clearly labeled) — `open_issue_count × LABOR_COST_PER_ISSUE`
     (new config, single avg $/issue). `LABOR_COST_PER_ISSUE=0` ⇒ labor line omitted (n/a).
- **Output = both** standalone `--resource` report + weekly-embedded section.
- Delivery reuses gateway create-page + Slack post. Dedup key `resource-<date>`.
- **Security**: assignee names are Jira user-controlled display strings flowing into
  Confluence XHTML + Slack — the render layer MUST `html.escape` them (the OKR phase had
  an XHTML-injection finding; do NOT repeat). See phase-02.

## Slices (ordered, each independently testable)

| # | Slice | File | Status | Depends on |
|---|-------|------|--------|-----------|
| A | Models + config + pure `resource_analyzer` (load report + cost summary) | [phase-01-resource-models-analyzer-config.md](phase-01-resource-models-analyzer-config.md) | ✅ done | — |
| B | Prompts (escaped) + standalone `resource_report_graph` + CLI `--resource` + E2E delivery | [phase-02-resource-prompts-graph-cli.md](phase-02-resource-prompts-graph-cli.md) | ✅ done | A |
| C | Weekly-embedded resource+cost section (fault-isolated) + wire into weekly | [phase-03-weekly-embedded-resource-section.md](phase-03-weekly-embedded-resource-section.md) | ✅ done | A, B |

**Done 2026-06-22** — 3 slices shipped, 236 UT pass, ruff clean, code-reviewed. Cron `--resource`
added (Monday 09:00 plist) per user. Code review found C1 (assignee names reached Slack mrkdwn
unescaped — a trust-boundary defect the XHTML path already guarded) → fixed with a `_slack_safe`
sanitizer + regression test. M1 (weekly fetches resource/OKR twice per run) accepted as matching the
OKR precedent. E2E verified against the seeded dataset (assigned SCRUM-19/20/21 → a real load row),
real write succeeded: Confluence page 589825 + Slack post.

Dependency graph: A → B → C. A is pure (analyzer unit-testable with fixtures + a
temp-dir-backed real `BudgetTracker`, no network). B wires the standalone graph +
delivery + CLI. C reuses B's renderers + fetch inside the existing weekly flow.

## File ownership (no two slices touch the same file)

| Slice | Creates | Modifies |
|-------|---------|----------|
| A | `src/agent/resource_analyzer.py`, `tests/test_resource_analyzer.py` | `src/tools/models.py`, `src/config/reporting_config.py`, `config.example.env` |
| B | `src/llm/resource_report_prompt.py`, `src/agent/resource_report_graph.py`, `tests/test_resource_report.py` | `src/llm/report_prompt.py` (REPORT_TITLES only), `src/entrypoints/cli.py` |
| C | `src/agent/resource_weekly_section.py`, `tests/test_weekly_resource_section.py` | `src/agent/report_graph.py` (weekly `_compose`/`_deliver` only) |

Note on the B/C overlap — there is none. B touches `report_prompt.py` (REPORT_TITLES
dict) + `cli.py`; C touches `report_graph.py`. No shared file between B and C. (Phase 3
needed a C/D split note because both touched `report_graph.py`; here the standalone graph
lives in its OWN file, so weekly wiring in C is the only edit to `report_graph.py`.)

## Acceptance criteria (whole phase)

1. `uv run python -m src.entrypoints.cli report --resource` produces a Confluence
   "Resource & Cost Status <date>" page + a Slack short message linking to it, through
   the Action Gateway (dedup `resource-<date>`); with `DRY_RUN=true` the summary shows
   `confluence=dry_run slack=dry_run` and performs no real writes.
2. Given a set of issues, the analyzer computes per-assignee open/overdue/blocker counts,
   the team mean of open counts, and marks an assignee overloaded iff
   `open_count > team_mean × RESOURCE_OVERLOAD_RATIO`; unassigned issues are counted
   separately (`unassigned_count`), never as an assignee. Verified by unit tests.
3. The cost summary reads the real `BudgetTracker`: `llm_spent`/`llm_cap`/`llm_ratio` come
   from it; `llm_status ∈ {ok, warn, over}` follows `budget_warn_ratio`/cap. Labor estimate
   = `open_issue_count × LABOR_COST_PER_ISSUE`; with `LABOR_COST_PER_ISSUE=0` the labor line
   is omitted/shown n/a. Verified by unit tests with a temp-dir `BudgetTracker`.
4. The weekly report (`report --weekly`) contains a resource+cost section when
   `JIRA_PROJECT_KEY` is configured, and degrades gracefully (short note, weekly never
   aborts) on any resource fetch/analyze failure. The existing weekly OKR section + daily
   report are unchanged.
5. Render layer html-escapes all assignee names (no XHTML/mrkdwn injection). No new MCP
   write tool, no allowlist entry, no Lớp A/B change. `uv run pytest` and
   `uv run ruff check src tests` pass. No file exceeds 200 LOC (split if it would).

## Risks (phase-level; per-slice detail in phase files)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| XHTML/mrkdwn injection via assignee display names | M×H | Render layer `html.escape` on every assignee string before XHTML; Slack short keeps names plain text with no markup interpolation. Unit test asserts an injected `<script>`/`*` name is escaped. Mirrors OKR finding H1/H2. |
| Weekly regression from embedding the resource section | L×H | C is additive + behind the `JIRA_PROJECT_KEY`-configured guard; any fetch/analyze failure inside weekly is caught → short note, never aborts; existing weekly + OKR + daily tests must still pass unchanged. |
| Overload math degenerate cases (team size 1, all-unassigned, mean 0) | M×M | Analyzer handles: empty/all-unassigned ⇒ no loads, `team_mean=0.0`, no overloaded; single assignee ⇒ mean = own count ⇒ ratio-threshold never self-flags (1×1.5). Explicit unit tests for each. |
| Budget logic drift (reimplementing the tracker) | L×M | Cost summary READS `BudgetTracker` only; `build_cost_summary` takes an injected tracker; status derives from cap+warn ratio already on the tracker's settings. No write/record, no file logic duplicated. |
| LLM invents resource/cost numbers | M×M | All numbers (counts, mean, $, %) rendered deterministically in the prompt layer; LLM writes only a short Vietnamese narrative paragraph (no figures), with a no-key fallback. |

## Rollback

Each slice reverts by deleting its created files + reverting its diffs (see ownership
table). B is the only slice changing user-facing CLI behavior; reverting B removes the
`--resource` branch and restores `report` to daily/weekly/okr. C reverts to a weekly
report without the resource section (OKR section intact). No migrations, no schema, no
gateway/allowlist changes to undo.

## Out of scope (Phase 4)

- Story-point / velocity-based capacity (Jira MCP exposes no points this phase).
- Per-person labor roster / real salary data (labor cost is one flat avg estimate).
- Writing/reassigning Jira issues to rebalance load (READ-only this phase).
- Resource/cost history or trend over time (single snapshot per run).
- A `--resource` cron schedule (see Open Questions — left as a follow-up).

## Resolved (user-confirmed 2026-06-22)

1. **CLI flag precedence** = `resource > okr > weekly > daily` (resource most specific; keeps
   OKR's existing relative order). Implemented in Slice B.
2. **Cron `--resource`** = IN SCOPE this phase. Add a `--resource` branch to `cron.py` + a
   launchd plist (weekly cadence, e.g. Monday) mirroring `deploy/launchd/` daily/weekly plists +
   `run-report.sh`. Wired in Slice B (alongside the CLI flag) or a small Slice B addendum.
