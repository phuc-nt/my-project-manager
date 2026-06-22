# Phase 01 — Slice A: OKR read (models + Confluence table parser + epic-progress fetch)

> **Status: ✅ DONE (2026-06-22).** Shipped `confluence_read.py`, `okr_read.py`, 4 model dataclasses,
> 2 config fields. Epic progress computed in Python (no server tool). 15 UT.

> Goal: pure, network-free building blocks. Parse the OKR Confluence table into typed models, and
> compute per-epic progress from Jira child issues. No analysis, no graph, no delivery yet.

## ⚠️ Integration reality (VERIFIED by spike 2026-06-22 against the running servers)

The planner scout read MCP server *source repos* that differ from the *built/running* servers. The
spike pinned the real contracts — these OVERRIDE the scout assumptions:

- **Confluence fetch tool is `getPageContent`** (arg `pageId`), NOT `getPage`. It returns a Python
  `list` of human-readable text-block strings (after `_coerce_result`). The page body is the **last
  block**, after a `"📝 Content:"` marker block. Verified: the body is **raw XHTML storage** —
  `<table><tbody><tr><th>…</th></tr><tr><td>…</td></tr></tbody></table>` survives the round-trip intact
  (empty cells stay as `<td></td>`). **Table parsing IS viable** — Open Q1 RESOLVED.
- **The running Jira MCP (v3.0.0) has NO `epicSearchAgile`, NO `enhancedGetIssue`, NO epic-progress /
  story-points tool.** Tools present: `enhancedSearchIssues`, `getIssue`, `listIssues`,
  `getSprintIssues`, `getBoardIssues`, `createIssue`, `updateIssue`, plus mutators. So **there is no
  server-side epic progress %**. We compute it in Python from child issues (same as Phase 1 computes
  everything in Python).
- `enhancedSearchIssues` accepts a raw `jql` string. Verified accepted (no error) forms for epic→child
  linkage on this server: `parent = <EPIC>`, `"Epic Link" = <EPIC>`. It returns a **flat** issue shape
  (`key`, `summary`, `status`, `assignee`, `issueType`, `labels`, …) — the SAME shape `parse_issue`
  already handles. No story points in the payload, so progress = **done-children / total-children**.
- Test Jira project key is **SCRUM** (from `JIRA_PROJECT_KEY`); it currently has no epics (only
  Task/Story/Bug/Subtask), so epic-progress E2E will exercise the "epic not found / no children →
  problem row" path until a real epic exists. Unit tests use fixtures regardless.

## Context links

- Plan index: [plan.md](plan.md)
- Pattern to match — pure parse + `call_tool`: `src/tools/jira_read.py:36` (`parse_issue`), `:88`
  (`get_open_issues`), `:83` (`is_done` — reuse for done-counting)
- MCP result shape (`_coerce_result`, text-block unwrap): `src/adapters/mcp_adapter.py:73-98`, `:101`
- Confluence MCP text-block flatten precedent: `src/actions/confluence_write.py:36-46` (`_blocks_text`)
- Models to extend: `src/tools/models.py:14` (frozen dataclass style)
- Config to extend: `src/config/reporting_config.py:59` (`ReportingConfig`), `:88` (`get_reporting_config`)

## Requirements

1. New frozen dataclasses in `src/tools/models.py`:
   - `KeyResult(description: str, epic_keys: tuple[str, ...], weight: float | None, progress_pct: float | None = None)`
   - `Objective(name: str, key_results: tuple[KeyResult, ...], progress_pct: float | None = None)`
   - `OkrProblem(row: str, reason: str)` — `row` = a short human label of the offending row, `reason` =
     why it was skipped.
   - `EpicProgress(epic_key: str, progress_pct: float | None, done_count: int | None, total_count: int | None, found: bool)`
     — progress computed from child issues (done/total). `found=False` ⇒ no children resolved in Jira
     (drives a problem row in Slice B). `total_count==0` ⇒ epic exists but has no children ⇒
     `progress_pct=None` (cannot divide), `found=True`.
2. New `src/tools/confluence_read.py`:
   - `get_page_content(page_id: str, *, server=None) -> str` — call the Confluence MCP `getPageContent`
     tool (arg `{"pageId": page_id}`) via `call_tool`, default `server` to `cfg.confluence_server`.
     Flatten the text-block list (reuse the `_blocks_text` flatten idea) and **return the body** — the
     content after the `"📝 Content:"` marker (in practice the last block). Keep this the ONLY
     shape-handling spot so a server change is a 1-function fix.
   - `parse_okr_table(content: str) -> tuple[list[tuple[str, str, str, str]], list[OkrProblem]]` —
     PURE. Extract raw cell quads `(objective, key_result, epic_keys_cell, weight_cell)` from the XHTML
     `<table>`. Use a tolerant parser: prefer stdlib `html.parser.HTMLParser` (no new dependency) to
     walk `<tr>`/`<th>`/`<td>`; strip inner tags to cell text. The header row (cells matching the known
     column titles case-insensitively) is dropped. Rows without all 4 columns ⇒ an `OkrProblem`, not a
     raise. An **empty Objective cell means "continuation of the Objective above"** (multi-KR objective)
     — carry the last non-empty objective forward; only flag a problem if the FIRST data row has no
     objective. Does NOT resolve epics or compute weights (semantic validation is Slice B).
   - `parse_epic_keys(cell: str) -> tuple[str, ...]` — PURE. Split a cell on comma/whitespace, uppercase,
     drop empties, keep order, dedupe. `""` → `()`.
   - `parse_weight(cell: str) -> float | None` — PURE. Empty ⇒ `None` (equal weighting downstream).
     A trailing `%` is accepted (`"40%"` → `0.4`); plain numeric `"0.4"` → `0.4`. Non-numeric ⇒ raise
     `ValueError` the caller turns into an `OkrProblem` (do NOT silently 0).
3. New epic-progress fetch in `src/tools/okr_read.py` (Python-computed, since no server-side tool):
   - `compute_epic_progress(children: list[Issue], *, epic_key: str) -> EpicProgress` — PURE. Given an
     epic's child issues (already-normalized `Issue` objects), `done_count = sum(is_done(i))`,
     `total_count = len(children)`, `progress_pct = done/total` (0..1) or `None` if `total==0`.
     `found = total>0` is decided by the caller (a key with zero children may be a real empty epic or a
     bad key — caller sets `found`; see below).
   - `get_epic_progress(epic_key: str, *, server=None) -> EpicProgress` — call `enhancedSearchIssues`
     with `{"jql": f'parent = {epic_key}', "maxResults": 100}`; map each raw issue via
     `jira_read.parse_issue`; `compute_epic_progress(...)`. If the JQL errors or returns the
     server's failure shape, **fall back** to `{"jql": f'"Epic Link" = {epic_key}'}` once. If both yield
     zero children, return `EpicProgress(epic_key, None, 0, 0, found=False)` (treated as a problem in
     Slice B — "epic không có child / không tồn tại"). Never raise on "no children"; re-raise only
     adapter/transport errors from `call_tool`.
   - `get_epic_progress_map(epic_keys: Iterable[str], *, server=None) -> dict[str, EpicProgress]` —
     fetch each DISTINCT key once (memoize within the call so two KRs sharing an epic don't double-fetch),
     return key→EpicProgress. This is the single Jira-touching entry the analyzer (Slice B) consumes.
4. Config (in `src/config/reporting_config.py` `ReportingConfig` + `get_reporting_config`):
   - `okr_confluence_page_id: str | None` ← `os.getenv("OKR_CONFLUENCE_PAGE_ID") or None`
   - `okr_behind_threshold: float` ← `float(os.getenv("OKR_BEHIND_THRESHOLD", "0.5"))` — an Objective
     below this fraction (0..1) is flagged "at risk" by Slice B. Default 0.5 (50%).
5. `config.example.env`: add an `# --- Phase 3: OKR ---` block with `OKR_CONFLUENCE_PAGE_ID=` and
   `OKR_BEHIND_THRESHOLD=0.5` (+ one-line comments mirroring existing style).

## Rollup decision (documented here, implemented in Slice B)

**Multi-epic KR aggregation = child-count weighted.** When a KR maps to several epics, sum each epic's
`done_count` (numerator) and `total_count` (denominator) across all FOUND epics and recompute the
percentage — rather than averaging per-epic percentages. Rationale: child-count weighting reflects real
volume (a 1-issue epic and a 50-issue epic should not count equally). An epic with `found=False` (no
children / bad key) is excluded from the KR's denominator and recorded as a problem (Slice B). If ALL
epics for a KR are `found=False`, the KR has `progress_pct=None` and is reported as a problem, excluded
from its Objective's rollup. This is the **decision of record** for acceptance criterion #3.

## Files

- Create: `src/tools/confluence_read.py` (target < 150 LOC; if parser + fetch grows past 200, split the
  pure parsers into `src/tools/okr_table_parser.py`).
- Create: `src/tools/okr_read.py` (epic-progress fetch + pure compute).
- Create: `tests/test_okr_read.py`.
- Modify: `src/tools/models.py` (add 4 dataclasses, keep `frozen=True`).
- Modify: `src/config/reporting_config.py` (2 new fields + env reads).
- Modify: `config.example.env` (OKR block).

## Implementation steps

1. Add the 4 dataclasses to `models.py` next to `Issue`/`Sprint`, mirroring the frozen style.
2. Add the 2 config fields + env reads; update `config.example.env`.
3. Write `confluence_read.get_page_content` (call `getPageContent`, flatten, return body) + the pure
   parsers (`parse_okr_table` via `html.parser`, `parse_epic_keys`, `parse_weight`).
4. Write `okr_read.compute_epic_progress` (pure) + `get_epic_progress` (JQL child query + parse_issue +
   compute, with `"Epic Link"` fallback) + `get_epic_progress_map` (memoized).
5. Write unit tests (below). Run `uv run pytest tests/test_okr_read.py` then `uv run ruff check src tests`.

## Tests / validation (`tests/test_okr_read.py`, fixtures only — no MCP server)

- `parse_okr_table`: the verified round-trip XHTML fixture (header + 2 data rows, second row with empty
  Objective cell) → 2 quads, Objective carried forward to the continuation row, header dropped; a row
  with only 2 `<td>` → one `OkrProblem`, the rest still parsed (resilience).
- `parse_epic_keys`: `"ABC-1, ABC-2  ABC-1"` → `("ABC-1","ABC-2")` (split, upper, dedupe, order);
  `""` → `()`.
- `parse_weight`: `""` → `None`; `"0.4"` → `0.4`; `"40%"` → `0.4`; `"abc"` → `ValueError`.
- `compute_epic_progress`: 4 children, 1 done → `progress_pct=0.25, done=1, total=4`; 0 children →
  `progress_pct=None, total=0`.
- `get_epic_progress`: monkeypatch `call_tool` to return a fake `{"issues": [...]}` (flat shape) →
  populated `EpicProgress(found=True)`; fake empty `{"issues": []}` on both JQL forms →
  `found=False`. Assert the `"Epic Link"` fallback is attempted only when the first form yields zero.
- `get_epic_progress_map`: monkeypatch `okr_read.get_epic_progress` to a counter; assert duplicate keys
  fetched once (memoization) and the map shape.

## Risks / rollback

| Risk | L×I | Mitigation |
|------|-----|-----------|
| `getPageContent` body block position changes (not always last) | L×M | Locate the body by the `"📝 Content:"` marker, fall back to "the block containing `<` and `>`"; isolate in `get_page_content` (1-function fix). |
| `enhancedSearchIssues` flat shape drifts | L×M | Reuse `jira_read.parse_issue` (already tolerant of flat-vs-`fields.*`); a missing field → `Unknown`, not a crash. |
| Weight cell formats vary (locale comma) | L×M | `parse_weight` centralizes format rules; non-numeric → `OkrProblem` (resilient), surfaced in report. |

Rollback: delete the 3 created files; revert the `models.py` / `reporting_config.py` / `config.example.env`
additions. Nothing downstream depends on Slice A until Slice B.

## Open questions

- None blocking. The two former blockers (Confluence shape, epic-progress mechanism) are RESOLVED by the
  spike. Remaining minor: when a real epic exists in the project, confirm `parent = <EPIC>` returns its
  children on THIS server (vs `"Epic Link"`); the code tries both, so either works — verify in Slice C E2E.
