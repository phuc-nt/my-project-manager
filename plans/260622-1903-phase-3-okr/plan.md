---
title: "Phase 3 — OKR / Objective Tracking"
description: "Read OKR from a Confluence table, roll up weighted progress from Jira epics, deliver an OKR report (Confluence page + Slack) and embed an OKR section in the weekly report."
status: done
priority: P2
effort: 14h
branch: main
tags: [phase-3, okr, reporting, jira-epic, confluence, langgraph]
created: 2026-06-22
---

# Phase 3 — OKR / Objective Tracking

Define OKR **outside Jira** (2-tier: Objective → Key Result) on a Confluence page, map each KR to one
or more Jira **epics**, roll up a weighted progress %, and deliver it two ways:
a standalone `cli report --okr` (Confluence detail page + Slack short+link) and an OKR section
embedded in the existing **weekly** sprint-review report. The agent only READS Jira (epic progress);
it creates no epics and gains no new write authority.

## Confirmed decisions (do NOT re-litigate)

- OKR source = one Confluence page (page id in config), a table with fixed columns
  `Objective | Key Result | Epic Key(s) | Weight`. Multiple epic keys per cell; blank Weight ⇒ equal.
- Resilient parse: valid rows roll up; malformed rows or unknown epic keys are SKIPPED but LISTED as
  "OKR có vấn đề". A bad page never aborts the report.
- Rollup = weighted. KR progress = epic progress computed in Python (done-children / total-children via
  `enhancedSearchIssues` JQL `parent = <EPIC>`; the running Jira MCP has no epic-progress tool — verified
  2026-06-22). Multi-epic KR = child-count weighted (see phase-01 §rollup). Objective progress = weighted
  average of its KRs using Weight (equal if blank).
- Output = BOTH a standalone OKR report (new `report_kind="okr"`) AND a weekly-embedded OKR section.
- Delivery reuses the existing Action Gateway path (create Confluence page + post Slack). NO gateway,
  allowlist, or Lớp A/B changes — both are already-allowlisted Auto actions. Dedup key `okr-<date>`.

## Slices (ordered, each independently testable)

| # | Slice | File | Status | Depends on |
|---|-------|------|--------|-----------|
| A | OKR read: models + Confluence table parser + epic-progress fetch | [phase-01-okr-read-models-and-fetch.md](phase-01-okr-read-models-and-fetch.md) | ✅ done | — |
| B | OKR analyzer: weighted rollup + equal-weight fallback + problems + at-risk | [phase-02-okr-analyzer-rollup.md](phase-02-okr-analyzer-rollup.md) | ✅ done | A |
| C | OKR prompts + `report_kind="okr"` graph + CLI `--okr` + E2E delivery | [phase-03-okr-report-graph-prompts-cli.md](phase-03-okr-report-graph-prompts-cli.md) | ✅ done | A, B |
| D | Embed OKR summary section into the weekly report | [phase-04-weekly-embedded-okr-section.md](phase-04-weekly-embedded-okr-section.md) | ✅ done | B, C |

**Done 2026-06-22** — 4 slices shipped, 202 UT pass, ruff clean, code-reviewed (6 findings fixed:
H1 escaped error note, H2 epic-key JQL-injection guard, M1 nested-table parser, M2 page-cap warn,
L1/L2 cleanups). E2E verified against a seeded realistic dataset (3 Jira epics + children, an OKR
Confluence table, 2 GitHub PRs) — DRY_RUN then a real write (Confluence page 557057 + Slack post,
dedup confirmed). A real Phase-1 bug surfaced during E2E and was fixed: the Jira MCP
`enhancedSearchIssues` omitted `duedate`, so overdue detection never fired — patched in the MCP server
repo (`jira-cloud-mcp-server@41a6a30`) and verified (daily report now flags 6 overdue tasks).

Dependency graph: A → B → C → D. A and B are pure (no network); C wires the graph + delivery;
D reuses C's renderers inside the existing weekly flow.

## File ownership (no two slices touch the same file)

| Slice | Creates | Modifies |
|-------|---------|----------|
| A | `src/tools/confluence_read.py`, `src/tools/okr_read.py`, `tests/test_okr_read.py` | `src/tools/models.py`, `src/config/reporting_config.py`, `config.example.env` |
| B | `src/agent/okr_analyzer.py`, `tests/test_okr_analyzer.py` | — |
| C | `tests/test_okr_report.py` | `src/llm/report_prompt.py`, `src/agent/report_graph.py`, `src/agent/state.py`, `src/entrypoints/cli.py` |
| D | — | `src/agent/report_graph.py` (weekly deps only), `src/llm/report_prompt.py` (weekly detail only), `tests/test_sprint_and_report_kind.py` |

Note on the C/D overlap on `report_graph.py` and `report_prompt.py`: D appends to the **weekly** path
only and lands strictly after C. They are sequential, never parallel — no concurrent edits. If
parallelized later, D's weekly hook must be carved into a separate function during C.

## Acceptance criteria (whole phase)

1. `uv run python -m src.entrypoints.cli report --okr` produces a Confluence "OKR Status <date>" page
   plus a Slack short message linking to it, through the Action Gateway (dedup `okr-<date>`), with
   `DRY_RUN=true` showing `confluence=dry_run slack=dry_run` and no real writes.
2. A Confluence OKR table with N valid + M malformed rows yields a report rolling up the N valid rows
   and a "OKR có vấn đề" list of the M problems; the run never raises on the bad rows.
3. Weighted rollup is correct: Objective % = Σ(KR% × weight)/Σweight; blank weights ⇒ equal weighting;
   a KR mapped to multiple epics aggregates by story counts. All verified by unit tests with fixtures.
4. The weekly report (`report --weekly`) contains an OKR summary section when an OKR page is configured,
   and degrades gracefully (section omitted or "OKR chưa cấu hình") when `OKR_CONFLUENCE_PAGE_ID` unset.
5. No new MCP write tool, no allowlist entry, no Lớp A/B change. `uv run pytest` and
   `uv run ruff check src tests` pass. No file exceeds 200 LOC (split if it would).

## Risks (phase-level; per-slice detail in phase files)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Confluence content shape | RESOLVED | Spike 2026-06-22: tool is `getPageContent` (not `getPage`); body is the last text-block as raw XHTML storage; `<table>` round-trips intact. Parser isolates shape handling in `get_page_content`. |
| Jira epic progress | RESOLVED | Spike 2026-06-22: running Jira MCP has NO epic tool. Progress computed in Python from child issues via `enhancedSearchIssues` JQL (`parent = <EPIC>`, `"Epic Link"` fallback), reusing `parse_issue` + `is_done`. |
| Weekly report regression from embedding OKR | L×H | D is additive + behind the OKR-configured guard; existing weekly tests must still pass unchanged; OKR fetch failure inside weekly is caught and rendered as a note, never aborts weekly. |
| LLM invents OKR numbers | M×M | Numbers (progress %, weights, counts) are computed deterministically and rendered without the LLM; the LLM only writes narrative prose around pre-rendered figures (or is skipped entirely for the table — see phase-03). |

## Rollback

Each slice is reversible by reverting its created files + its diffs to modified files (see ownership
table). C is the only slice that changes user-facing CLI behavior; reverting C removes the `--okr`
branch and restores `report` to daily/weekly only. D reverts to a weekly report without the OKR
section. No migrations, no schema, no gateway/allowlist changes to undo.

## Out of scope (Phase 3)

- Writing/creating Jira epics or editing the OKR Confluence table (READ-only this phase).
- OKR history/trend over time (single snapshot per run; trend is a later phase).
- Multi-project / multi-OKR-page (one configured page).
- New Lớp B approvals or any widening of write authority.
