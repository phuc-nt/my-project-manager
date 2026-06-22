# Phase 4 · Slice C — Weekly-embedded resource+cost section (fault-isolated)

> **Status: ✅ DONE (2026-06-22).** `resource_weekly_section.py` (shared `build_resource_rollup` +
> fault-isolated `weekly_resource_section`/`weekly_resource_slack_line`); weekly compose/deliver append
> resource AFTER the OKR section (both present). Daily unaffected. 8 UT.

**Depends on:** Slice A (analyzer + models + config) and Slice B (renderers in
`resource_report_prompt.py`). Adds a resource+cost section to the existing **weekly**
report, fault-isolated so it never aborts weekly. Mirrors the weekly OKR section.

## Context (verified file:line)

- Analog to mirror exactly: `src/agent/okr_weekly_section.py` —
  `build_okr_rollup()` (fetch+analyze entry, `okr_weekly_section.py:26-51`),
  `weekly_okr_section(report_date)` (returns `""` when unconfigured; on ANY exception logs
  + returns a short note, never raises — `okr_weekly_section.py:54-73`),
  `weekly_okr_slack_line()` (`""` when unconfigured/failed else a one-liner —
  `okr_weekly_section.py:76-91`).
- Weekly wiring points in the report graph:
  - `_compose` appends the OKR section ONLY for weekly:
    `src/agent/report_graph.py:106-112`:
    ```python
    if report_kind == "weekly":
        from src.agent.okr_weekly_section import weekly_okr_section
        body += weekly_okr_section(today)
    ```
  - `_deliver` appends the OKR Slack line ONLY for weekly:
    `src/agent/report_graph.py:128-131`:
    ```python
    if report_kind == "weekly":
        from src.agent.okr_weekly_section import weekly_okr_slack_line
        short += weekly_okr_slack_line()
    ```
  These OKR hooks MUST stay intact — the resource hooks are ADDED alongside them.
- Config guard for "configured": resource needs `JIRA_PROJECT_KEY`
  (`get_reporting_config().jira_project_key` `reporting_config.py:63,132`) — the same key
  `get_open_issues` requires (`jira_read.py:99-102`). Unlike OKR (gated on a Confluence page
  id), resource is gated on the Jira project key.
- Budget/settings reads: `BudgetTracker().spent_this_month()` `budget_tracker.py:62`,
  `get_settings().monthly_budget_usd`/`.budget_warn_ratio` `settings.py:91-92`.
- Renderers from Slice B: `render_resource_xhtml`, `build_resource_slack_short` (or a
  dedicated one-line helper) in `src/llm/resource_report_prompt.py`.
- Existing weekly tests live in `tests/test_sprint_and_report_kind.py` (Phase 3 D added the
  weekly-OKR assertions there). New resource-weekly tests go in a NEW file
  `tests/test_weekly_resource_section.py` to keep ownership clean (Slice C owns it).

## Requirements

1. New module `src/agent/resource_weekly_section.py`:
   - `build_resource_rollup() -> tuple[ResourceReport, CostSummary]` — the single
     fetch+analyze entry (reuses the same logic as `default_resource_deps._fetch` from
     Slice B; factor it so both call ONE function — see DRY note below). Raises if
     `JIRA_PROJECT_KEY` unset or a fetch fails.
   - `weekly_resource_section(report_date) -> str` — `""` when `JIRA_PROJECT_KEY` unset;
     on ANY exception → a short Vietnamese note (NOT the raw exception text), never raises;
     else `render_resource_xhtml(resource, cost, report_date=report_date)`.
   - `weekly_resource_slack_line() -> str` — `""` when unconfigured/failed; else a one-line
     mrkdwn summary (people count, overloaded count, LLM budget %).
2. Wire both into `report_graph.py` weekly `_compose` + `_deliver`, ALONGSIDE the OKR hooks.

## DRY note (avoid duplicating the fetch)

Slice B's `default_resource_deps._fetch` and Slice C's `build_resource_rollup` do the same
fetch+analyze+cost work. **Decision:** put the shared fetch in
`resource_weekly_section.build_resource_rollup()` and have Slice B's `_fetch` call it
(exactly as `okr_report_graph.default_okr_deps` imports `build_okr_rollup` from
`okr_weekly_section` — see `okr_report_graph.py:27,100`). This means:
- Slice B `default_resource_deps._fetch` should be `return build_resource_rollup()`.
- That makes Slice C the home of the fetch. To keep slice ordering safe (B lands before C),
  during Slice B implement `_fetch` inline, then in Slice C extract it into
  `build_resource_rollup` and switch B's `_fetch` to call it. The extraction touches
  `resource_report_graph.py` (a Slice-B-owned file) — that is the ONE cross-slice edit;
  it is sequential (C strictly after B), never parallel, mirroring the Phase 3 C/D note.

  (If the implementer prefers zero back-edit to B, alternatively define
  `build_resource_rollup` in Slice B's graph module and import it in C — but the OKR
  precedent puts the shared fetch in the weekly-section module, so follow that.)

## Files to create / modify

- **create** `src/agent/resource_weekly_section.py` (<110 LOC).
- **create** `tests/test_weekly_resource_section.py`.
- **modify** `src/agent/report_graph.py` — 2 additive blocks in `_compose` + `_deliver`.
- **modify** (cross-slice, sequential) `src/agent/resource_report_graph.py` — point
  `_fetch` at `build_resource_rollup` (see DRY note).

## Implementation steps

1. **`resource_weekly_section.py`** — mirror `okr_weekly_section.py`:
   ```python
   def build_resource_rollup() -> tuple[ResourceReport, CostSummary]:
       from src.config.reporting_config import get_reporting_config
       from src.config.settings import get_settings
       from src.llm.budget_tracker import BudgetTracker
       from src.tools import jira_read
       from src.agent.resource_analyzer import build_cost_summary, build_resource_report
       cfg = get_reporting_config()
       if not cfg.jira_project_key:
           raise RuntimeError("JIRA_PROJECT_KEY is not set.")
       s = get_settings()
       issues = jira_read.get_open_issues()
       resource = build_resource_report(
           issues, today=_today_utc(),
           overload_ratio=cfg.resource_overload_ratio,
           blocker_label_substring=cfg.blocker_label_substring)
       open_count = sum(l.open_count for l in resource.loads)
       cost = build_cost_summary(
           open_count, llm_spent=BudgetTracker().spent_this_month(),
           llm_cap=s.monthly_budget_usd, warn_ratio=s.budget_warn_ratio,
           cost_per_issue=cfg.labor_cost_per_issue)
       return resource, cost
   ```
   (`_today_utc` copied from `okr_report_graph.py:42-43` / `report_graph.py:47-48`.)

   ```python
   def weekly_resource_section(report_date: str) -> str:
       from src.config.reporting_config import get_reporting_config
       from src.llm.resource_report_prompt import render_resource_xhtml
       if not get_reporting_config().jira_project_key:
           return ""
       try:
           resource, cost = build_resource_rollup()
       except Exception as exc:
           logger.warning("Weekly resource section skipped (fetch/analyze failed): %s", exc)
           return "<p>Không lấy được dữ liệu resource/cost (xem log để biết chi tiết).</p>"
       return render_resource_xhtml(resource, cost, report_date=report_date)

   def weekly_resource_slack_line() -> str:
       from src.config.reporting_config import get_reporting_config
       if not get_reporting_config().jira_project_key:
           return ""
       try:
           resource, cost = build_resource_rollup()
       except Exception as exc:
           logger.warning("Weekly resource Slack line skipped: %s", exc)
           return ""
       n = len(resource.loads); over = len(resource.overloaded)
       over_txt = f", {over} quá tải" if over else ""
       return f"\n• Resource: {n} người{over_txt} · LLM {cost.llm_ratio*100:.0f}% ngân sách"
   ```
   The error note must NOT contain the raw exception (mirror the OKR note at
   `okr_weekly_section.py:71-72` — log detail, keep markup/internals out of the page body).

2. **Wire into `report_graph.py`** — additive, immediately AFTER the existing OKR hooks:
   - In `_compose` (after `report_graph.py:111`):
     ```python
     from src.agent.resource_weekly_section import weekly_resource_section
     body += weekly_resource_section(today)
     ```
     (Keep inside the existing `if report_kind == "weekly":` block, after the OKR append.)
   - In `_deliver` (after `report_graph.py:131`):
     ```python
     from src.agent.resource_weekly_section import weekly_resource_slack_line
     short += weekly_resource_slack_line()
     ```
   Do NOT remove or reorder the OKR appends — resource is concatenated AFTER OKR so both
   sections show.

## Tests / validation (`tests/test_weekly_resource_section.py`)

Use `monkeypatch` to control config + the fetch (no network).

- **unconfigured ⇒ empty**: `JIRA_PROJECT_KEY` unset (monkeypatch
  `get_reporting_config` to return a config with `jira_project_key=None`) →
  `weekly_resource_section("2026-06-22") == ""` and `weekly_resource_slack_line() == ""`.
- **configured + happy path**: monkeypatch `build_resource_rollup` to return a known
  `(ResourceReport, CostSummary)` → section contains `<table>` + the assignee + cost block;
  Slack line contains "Resource:" + the LLM % .
- **fault isolation**: monkeypatch `build_resource_rollup` to raise → section returns the
  short Vietnamese note (NOT the exception text), `slack_line` returns `""`; NEITHER raises.
- **weekly report still contains the OKR section** (regression): build the weekly graph with
  fakes (or call `_compose` deps directly as the OKR weekly tests do) and assert BOTH the OKR
  section markers AND the resource section markers are present — proves the resource hook did
  not displace the OKR hook. (Cross-check against existing assertions in
  `tests/test_sprint_and_report_kind.py`; do not modify that file — assert here.)
- **daily unaffected**: a daily compose does NOT include the resource section (the hook is
  inside `if report_kind == "weekly"`). Assert a daily body has no resource markers.

Run: `uv run pytest tests/test_weekly_resource_section.py tests/test_sprint_and_report_kind.py
tests/test_resource_report.py tests/test_resource_analyzer.py -q`, then the FULL suite
`uv run pytest -q` (weekly/OKR/daily regressions must all still pass), then
`uv run ruff check src tests`.

## Acceptance criteria (Slice C)

- [ ] `report --weekly` body includes the resource+cost section when `JIRA_PROJECT_KEY` is
      set; the section is omitted (empty string) when it is unset.
- [ ] Any resource fetch/analyze failure inside weekly yields a short note (not the raw
      exception) and the weekly report still completes — never raises.
- [ ] The existing weekly OKR section + Slack line are still present (regression test green);
      the daily report is unchanged (no resource markers).
- [ ] The shared fetch is defined ONCE (`build_resource_rollup`) and reused by both the
      standalone graph and the weekly section (no duplicated fetch logic).
- [ ] Full `pytest` + `ruff` pass; new module < 200 LOC.

## Risks / rollback

- **Risk**: weekly regression — mitigated: hooks are additive, behind the `JIRA_PROJECT_KEY`
  guard, fault-isolated; full weekly/OKR/daily suite must pass unchanged.
- **Risk**: double fetch cost (weekly calls `build_resource_rollup` from both `_compose` and
  `_deliver`, like the OKR section does twice). Accepted — matches the existing OKR pattern
  (`okr_weekly_section` is called in both `_compose` and `_deliver`); a per-run memo is out of
  scope and would mirror an existing, accepted cost. Flag for the reviewer; do not optimize
  here (YAGNI).
- **Rollback**: delete `resource_weekly_section.py` + its test; revert the 2 additive blocks
  in `report_graph.py`; revert B's `_fetch` back to inline if the extraction was applied.
  Weekly returns to OKR-only embedding.

## Note for the reviewer (carry into code review)

- Assignee display names from Jira flow into Confluence XHTML via this section too — the
  escaping lives in `render_resource_xhtml` (Slice B). Confirm the weekly path uses that same
  renderer (it does) so the escape protection is not bypassed.
- The weekly section is called twice per run (compose + deliver). This is the existing OKR
  pattern, not a new defect — note it, do not "fix" by adding caching this phase.
