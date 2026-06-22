# Phase 04 — Slice D: embed an OKR summary section into the weekly report

> **Status: ✅ DONE (2026-06-22).** Shipped `okr_weekly_section.py` (fault-isolated
> `weekly_okr_section` + `weekly_okr_slack_line`); weekly compose/deliver append OKR when configured.
> Existing weekly tests stay green; 5 new UT. E2E: weekly report carries the OKR section.

> Goal: when an OKR page is configured, append a compact OKR section to the existing weekly sprint-review
> Confluence detail (and optionally a one-line OKR mention in the weekly Slack short). Additive, guarded,
> and degrades gracefully. Reuses Slice C's deterministic renderers — no new OKR math.

## Context links

- Plan index: [plan.md](plan.md)
- Weekly wiring to extend: `src/agent/report_graph.py:73` (`_fetch_issues` weekly branch), `:82`
  (`_sprint_context`), `:93` (`_compose`), `:106` (`_deliver`) — the weekly path inside
  `default_report_deps`
- Weekly detail prompt: `src/llm/report_prompt.py:71` (`build_detail_messages`, `kind="weekly"`)
- OKR building blocks from Slice A/B/C (REUSE, do not duplicate):
  `confluence_read.get_page` + `parse_okr_table`, `okr_read.get_epic_progress_map`,
  `okr_analyzer.build_objectives`, `render_okr_table_xhtml` (Slice C)
- Existing weekly tests to keep green: `tests/test_sprint_and_report_kind.py`

## Requirements

1. Weekly detail body gains an OKR section ONLY when `cfg.okr_confluence_page_id` is set:
   - In the weekly compose path, after the LLM writes the sprint-review XHTML, append the deterministic
     OKR block produced by `render_okr_table_xhtml(rollup)` (an `<h2>OKR</h2>` section). The sprint
     narrative stays LLM-authored; the OKR block stays deterministic (no hallucinated numbers).
   - If `okr_confluence_page_id` is unset ⇒ omit the section entirely (no error). Optionally render a
     single `<p>OKR chưa được cấu hình.</p>` — decision: OMIT silently to avoid noise (configurable
     later). Document the chosen behavior.
2. Fetching OKR data inside the weekly flow MUST be fault-isolated:
   - Wrap the OKR fetch+analyze (`get_page`→`parse_okr_table`→`get_epic_progress_map`→`build_objectives`)
     in a try/except that, on ANY failure, logs and renders a small `<p>Không lấy được dữ liệu OKR: ...</p>`
     note INSTEAD of aborting the weekly report. Weekly must never fail because OKR failed (plan risk:
     "Weekly report regression"). Acceptance criterion #4.
3. Reuse, do not re-implement: the weekly OKR section calls the SAME `build_objectives` +
   `render_okr_table_xhtml` from Slices B/C. No second copy of rollup math or rendering.
4. Optional weekly Slack short mention: append a single `•` line to the weekly Slack short summarizing
   OKR (e.g. `• OKR: X% trung bình, K objective at-risk`). Keep deterministic; reuse the figures from the
   rollup. Decision: include it (cheap, high signal) but guard on `okr_confluence_page_id` set.

## Files

- Modify: `src/agent/report_graph.py` — weekly branch of `default_report_deps` only (the `_compose` /
  `_deliver` closures). Do NOT touch daily or the OKR graph. If `report_graph.py` is at risk of >200 LOC,
  factor the weekly-OKR helper into `src/agent/okr_report_graph.py` (created in Slice C) and import it —
  preferred, keeps `report_graph.py` lean and the OKR logic in one module.
- Modify: `src/llm/report_prompt.py` — only if a weekly-specific OKR wrapper string is needed; prefer
  reusing `render_okr_table_xhtml` directly (no new prompt). Avoid editing the OKR builders Slice C owns
  beyond reuse.
- Modify: `tests/test_sprint_and_report_kind.py` — add weekly-with-OKR and weekly-without-OKR cases.

> Ordering note (from plan.md): Slice D lands strictly AFTER Slice C. The two share `report_graph.py` /
> `report_prompt.py` but are sequential, never parallel. With the Slice C recommendation to put OKR
> wiring in `okr_report_graph.py`, D's edit to `report_graph.py` is limited to importing + calling the
> weekly-OKR helper — minimal surface.

## Implementation steps

1. Add a `weekly_okr_section(cfg) -> str` helper (in `okr_report_graph.py`) that fetches+analyzes+renders
   the OKR block, fault-isolated, returning `""` when unconfigured.
2. In the weekly `_compose` closure, append `weekly_okr_section(cfg)` to the LLM-composed detail body.
3. In the weekly `_deliver`/Slack-short path, append the optional OKR `•` line when configured.
4. Tests + `ruff`. Run `uv run pytest tests/test_sprint_and_report_kind.py` then full suite.

## Tests / validation (`tests/test_sprint_and_report_kind.py` additions)

- Weekly WITH OKR configured (fake `get_page`/`epic_map`): the weekly detail body contains the OKR
  `<h2>OKR</h2>` section with computed numbers; Slack short has the OKR `•` line.
- Weekly WITHOUT OKR (`okr_confluence_page_id=None`): body has NO OKR section; existing weekly assertions
  unchanged (regression).
- Weekly with OKR fetch RAISING (fake `get_page` throws): weekly still completes; body contains the
  "Không lấy được dữ liệu OKR" note; the run does not raise (fault isolation — acceptance criterion #4).
- Daily unaffected: a daily-kind test confirms no OKR section leaks into daily.

## Risks / rollback

| Risk | L×I | Mitigation |
|------|-----|-----------|
| OKR fetch failure aborts weekly | L×H | Mandatory try/except around OKR fetch in the weekly path; test asserts weekly survives an OKR exception. |
| Double Confluence page (weekly already creates one) | L×M | The OKR section is appended to the SAME weekly page body before `create_report_page`; no second page, no second dedup key. Reuses the existing weekly `report_date="weekly-<date>"` dedup. |
| Editing `report_graph.py` regresses daily/weekly | M×H | Change limited to importing the weekly-OKR helper; all existing `test_sprint_and_report_kind.py` cases must pass unchanged. |
| Weekly body grows large / slow | L×L | OKR section is compact (table + lists); single extra `get_epic_progress_map` call, memoized. |

Rollback: revert the weekly-branch edits in `report_graph.py`, the Slack-short OKR line, and the new
test cases. Weekly returns to its pre-D behavior. Slices A–C remain fully functional independently
(standalone `report --okr` still works).

## Open questions

1. Should the weekly Slack short include the OKR line, or keep OKR detail-only? Plan includes it
   (high signal, low cost); flip to detail-only if the weekly short should stay sprint-focused.
2. Unconfigured-OKR behavior in weekly: OMIT silently (chosen) vs a "OKR chưa cấu hình" note. Confirm
   preference; trivial to switch.
