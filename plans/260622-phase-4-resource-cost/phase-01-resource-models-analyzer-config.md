# Phase 4 · Slice A — Models + config + pure resource analyzer

> **Status: ✅ DONE (2026-06-22).** 3 dataclasses + 2 config fields + pure `resource_analyzer.py`
> (`build_resource_report` relative-to-mean overload, `build_cost_summary`). 12 UT.

**Depends on:** none. **Pure** (no network); the cost path reads a `BudgetTracker`
injected by the caller (a temp-dir-backed real tracker in tests — no fake needed).

## Context (verified file:line)

- Models, frozen dataclasses: `src/tools/models.py:14-126`. `Issue` has
  `assignee: str | None`, `due_date: date | None`, `labels: tuple[str,...]`,
  `status: str` (`src/tools/models.py:15-24`). OKR dataclasses (the analog to mirror)
  at `src/tools/models.py:81-126`.
- Overdue logic: `risk_analyzer._overdue_risks` `src/agent/risk_analyzer.py:17-33`
  → `issue.due_date and issue.due_date < today and not is_done(issue)`.
- Blocker logic: `risk_analyzer._blocker_risks` `src/agent/risk_analyzer.py:36-53`
  → `issue.flagged or any(needle in label.lower() for label in issue.labels)`, `needle =
  blocker_label_substring.lower()`.
- Done check: `jira_read.is_done` `src/tools/jira_read.py:83-85` (status in done set).
- Analog analyzer to mirror: `okr_analyzer.build_objectives` (pure, thresholds injected,
  typed result dataclass) `src/agent/okr_analyzer.py:95-154`; result dataclass
  `OkrRollup` `src/agent/okr_analyzer.py:35-42`.
- Budget tracker (READ only): `BudgetTracker.spent_this_month()`
  `src/llm/budget_tracker.py:62-63`; cap = `settings.monthly_budget_usd`
  `src/config/settings.py:59,91`; warn ratio = `settings.budget_warn_ratio`
  `src/config/settings.py:60,92`. Construct with `BudgetTracker(settings)`
  `src/llm/budget_tracker.py:37`. The tracker exposes `self._settings` privately —
  do NOT reach into it; pass cap+warn explicitly OR read them off the same settings the
  caller already has. Decision: `build_cost_summary` takes `budget_tracker` AND derives
  cap/warn from `budget_tracker._settings`? NO — keep it clean: pass the two scalars in.
  See Implementation step 3.
- Config dataclass + loader: `ReportingConfig` `src/config/reporting_config.py:59-87`;
  `get_reporting_config` builder `src/config/reporting_config.py:94-148`; OKR fields added
  at lines `81-83` (decl) + `143-144` (load) — mirror that pattern.
- Config example env OKR block: `config.example.env:57-63` (privacy-blocked for Read; the
  implementer appends via shell `cat >>`, mirroring the OKR block).
- Test fixture `settings_factory(tmp_path)` builds a `Settings` with `data_dir=tmp_path`,
  `monthly_budget_usd`, `budget_warn_ratio` overridable: `tests/conftest.py:13-33`. Budget
  test pattern: `BudgetTracker(settings_factory(monthly_budget_usd=50.0))` then write a
  budget file under `data_dir/budget/` — `tests/test_budget_tracker.py:13-71`.

## Requirements

1. Add three frozen dataclasses to `src/tools/models.py` (a new "Phase 4" section,
   mirroring the "Phase 3: OKR" comment block at `models.py:73-79`):
   - `AssigneeLoad(assignee: str, open_count: int, overdue_count: int, blocker_count: int,
     overloaded: bool)`
   - `ResourceReport(loads: tuple[AssigneeLoad, ...], team_mean: float,
     overloaded: tuple[str, ...], unassigned_count: int)`
   - `CostSummary(llm_spent: float, llm_cap: float, llm_ratio: float, llm_status: str,
     labor_estimate: float, open_issue_count: int, cost_per_issue: float)`
2. Add two config fields to `ReportingConfig` + loader:
   - `resource_overload_ratio: float` ← `float(os.getenv("RESOURCE_OVERLOAD_RATIO", "1.5"))`
   - `labor_cost_per_issue: float` ← `float(os.getenv("LABOR_COST_PER_ISSUE", "0"))`
3. New module `src/agent/resource_analyzer.py` — PURE except the cost summary reads a
   passed-in tracker. Two functions:
   - `build_resource_report(issues, *, today, overload_ratio, blocker_label_substring)
     -> ResourceReport`
   - `build_cost_summary(open_issue_count, *, llm_spent, llm_cap, warn_ratio, cost_per_issue)
     -> CostSummary`
   (See step 3 below for why cost takes scalars, not the tracker object directly.)
4. Unit tests in `tests/test_resource_analyzer.py`.

## Files to create / modify

- **modify** `src/tools/models.py` — append the 3 dataclasses (Phase 4 section).
- **modify** `src/config/reporting_config.py` — 2 field decls + 2 loader lines.
- **modify** `config.example.env` — append a Phase 4 block (via shell `cat >>`).
- **create** `src/agent/resource_analyzer.py` (pure; <120 LOC expected).
- **create** `tests/test_resource_analyzer.py`.

## Implementation steps

1. **Models** — add to `src/tools/models.py` after the OKR block:
   ```python
   # --- Phase 4: Resource (capacity) + Cost reporting ---
   # Capacity is computed from Jira issues grouped by assignee (no story points
   # available). "overloaded" is relative to the team mean of open counts.

   @dataclass(frozen=True)
   class AssigneeLoad:
       assignee: str
       open_count: int
       overdue_count: int
       blocker_count: int
       overloaded: bool

   @dataclass(frozen=True)
   class ResourceReport:
       loads: tuple[AssigneeLoad, ...]
       team_mean: float
       overloaded: tuple[str, ...]
       unassigned_count: int

   @dataclass(frozen=True)
   class CostSummary:
       llm_spent: float
       llm_cap: float
       llm_ratio: float
       llm_status: str  # "ok" | "warn" | "over"
       labor_estimate: float
       open_issue_count: int
       cost_per_issue: float
   ```

2. **`build_resource_report`** — pure. Steps:
   - Filter to NON-done, OPEN issues (an assignee's "load" is undone work). Reuse
     `is_done` (`from src.tools.jira_read import is_done` — same import path
     `risk_analyzer.py:13` uses).
   - Partition: issues with `assignee is None` (or empty) → `unassigned_count`; the rest
     grouped by `assignee` in first-seen order (mirror the order-preserving grouping in
     `okr_analyzer.build_objectives` `okr_analyzer.py:109-137`).
   - Per assignee compute: `open_count = len(group)`;
     `overdue_count` = those with `due_date and due_date < today` (do NOT re-check
     `is_done` — already filtered);
     `blocker_count` = those with `flagged or any(needle in label.lower() ...)`,
     `needle = blocker_label_substring.lower()` (replicate the tiny check from
     `risk_analyzer.py:40`; replicating 1 line is cleaner than importing a private helper —
     DRY does not force importing a `_`-prefixed function).
   - `team_mean = sum(open_count) / len(loads)` over assignees with load, else `0.0`.
   - `overloaded` flag per assignee: `team_mean > 0 and open_count > team_mean *
     overload_ratio`. Collect overloaded names into the report's `overloaded` tuple.
   - Sort `loads` by `open_count` desc (most-loaded first — lead with the signal, matching
     `risk_analyzer.analyze` severity sort `risk_analyzer.py:110-111`); break ties by name.
   - Return `ResourceReport(loads=..., team_mean=..., overloaded=..., unassigned_count=...)`.

3. **`build_cost_summary`** — takes scalars, NOT the tracker object, so it stays pure and
   trivially unit-testable, and the budget read happens at the call site (the graph deps):
   ```python
   def build_cost_summary(open_issue_count, *, llm_spent, llm_cap, warn_ratio,
                          cost_per_issue) -> CostSummary:
       ratio = llm_spent / llm_cap if llm_cap > 0 else 0.0
       status = "over" if ratio >= 1.0 else "warn" if ratio >= warn_ratio else "ok"
       labor = open_issue_count * cost_per_issue  # cost_per_issue == 0 ⇒ 0.0 (omit in render)
       return CostSummary(llm_spent=llm_spent, llm_cap=llm_cap, llm_ratio=ratio,
                          llm_status=status, labor_estimate=labor,
                          open_issue_count=open_issue_count, cost_per_issue=cost_per_issue)
   ```
   The graph (Slice B) supplies the scalars by reading the real tracker:
   `bt = BudgetTracker(); spent = bt.spent_this_month(); s = get_settings()` →
   `llm_spent=spent, llm_cap=s.monthly_budget_usd, warn_ratio=s.budget_warn_ratio`.
   This matches the rule "READ the existing tracker, do NOT reimplement it" — the status
   classification mirrors `BudgetTracker.check_allowed` `budget_tracker.py:65-87` (warn at
   `budget_warn_ratio`, over at `1.0`) without calling it (we must not raise here).

   NOTE: `cost_per_issue == 0` ⇒ `labor_estimate == 0.0`; the render layer (Slice B) treats
   `cost_per_issue == 0` as "labor estimate not configured" and omits / shows n/a. The
   analyzer just computes; the omit decision lives in the prompt layer.

4. **Config** — in `src/config/reporting_config.py`:
   - decl (after the OKR fields at `reporting_config.py:81-83`):
     ```python
     # Phase 4: resource + cost. Overload = open-count above team_mean × ratio.
     # labor_cost_per_issue == 0 ⇒ labor estimate omitted from the report.
     resource_overload_ratio: float
     labor_cost_per_issue: float
     ```
   - loader (in the `return ReportingConfig(...)` near `reporting_config.py:143-144`):
     ```python
     resource_overload_ratio=float(os.getenv("RESOURCE_OVERLOAD_RATIO", "1.5")),
     labor_cost_per_issue=float(os.getenv("LABOR_COST_PER_ISSUE", "0")),
     ```

5. **config.example.env** — append (shell, since the file is privacy-blocked for Read):
   ```bash
   cat >> config.example.env <<'EOF'

   # --- Phase 4: Resource (capacity) + Cost reporting ---
   # Overload threshold: an assignee is "overloaded" if their open-issue count
   # exceeds team_mean × this ratio (1.5 ⇒ >150% of the team average).
   RESOURCE_OVERLOAD_RATIO=1.5
   # Average labor cost per open issue, USD, for a rough labor estimate.
   # 0 ⇒ labor estimate omitted from the report (only the real LLM budget shows).
   LABOR_COST_PER_ISSUE=0
   EOF
   ```
   After appending, `grep -n "RESOURCE_OVERLOAD_RATIO\|LABOR_COST_PER_ISSUE" config.example.env`
   to confirm both keys landed.

## Tests / validation (`tests/test_resource_analyzer.py`)

Build `Issue` fixtures inline (frozen dataclass — same as `risk_analyzer` tests). Use a
fixed `today = date(2026, 6, 22)`.

- **team-mean + overload**: 3 assignees with open counts e.g. 1, 2, 6 (mean 3.0). With
  `overload_ratio=1.5` (threshold 4.5), only the 6-count assignee is overloaded; assert
  `team_mean == 3.0`, `overloaded == ("<that name>",)`, and that assignee's
  `AssigneeLoad.overloaded is True`, others `False`.
- **overdue + blocker counts**: an assignee with 1 overdue (due < today) and 1
  blocker-labelled issue → `overdue_count == 1`, `blocker_count == 1`. Include a `flagged`
  issue to confirm `flagged` counts as a blocker. Include a label matching the substring
  case-insensitively (e.g. `"Blocked"`).
- **done issues excluded**: a done issue (status in done set) for an assignee does NOT count
  toward `open_count`.
- **unassigned handling**: issues with `assignee=None` → `unassigned_count` increments, no
  `AssigneeLoad` created for them, they don't affect `team_mean`.
- **degenerate cases**: (a) empty issues ⇒ `loads == ()`, `team_mean == 0.0`,
  `overloaded == ()`, `unassigned_count == 0`; (b) single assignee ⇒ `team_mean == own
  count`, threshold = count × 1.5, so NOT self-flagged overloaded; (c) all-unassigned ⇒
  `loads == ()`, `team_mean == 0.0`.
- **load sort order**: assert `loads` is sorted by `open_count` desc (most-loaded first).
- **cost summary, status bands**: with `llm_cap=50, warn_ratio=0.8`:
  spent 10 ⇒ `ratio==0.2`, `status=="ok"`; spent 45 ⇒ `status=="warn"` (0.9 ≥ 0.8);
  spent 50 ⇒ `status=="over"` (1.0 ≥ 1.0). `llm_cap==0` ⇒ `ratio==0.0`, `status=="ok"`.
- **labor estimate incl. zero case**: `open_issue_count=8, cost_per_issue=25` ⇒
  `labor_estimate==200.0`; `cost_per_issue=0` ⇒ `labor_estimate==0.0` (render-omit decision
  is tested in Slice B, flagged here).
- **integration with real tracker (optional, 1 test)**: build
  `bt = BudgetTracker(settings_factory(monthly_budget_usd=50.0, budget_warn_ratio=0.8))`,
  write a budget file under `data_dir/budget/budget-<month>.json` with `total_usd` (copy the
  setup from `tests/test_budget_tracker.py:13-16,55-57`), then feed
  `llm_spent=bt.spent_this_month()` into `build_cost_summary` and assert the status. Confirms
  the real read path lines up with the pure function.

Run: `uv run pytest tests/test_resource_analyzer.py -q` then
`uv run ruff check src/agent/resource_analyzer.py src/tools/models.py
src/config/reporting_config.py tests/test_resource_analyzer.py`.

## Acceptance criteria (Slice A)

- [ ] 3 dataclasses exist, frozen, exact field names/types as specified.
- [ ] 2 config fields load from env with the right defaults (1.5 / 0).
- [ ] `build_resource_report` computes per-assignee open/overdue/blocker counts, team mean,
      relative-overload flagging, unassigned separation, and most-loaded-first ordering —
      all degenerate cases handled (empty, single, all-unassigned, mean 0).
- [ ] `build_cost_summary` derives `ratio`/`status`/`labor_estimate` correctly incl. cap 0
      and cost-per-issue 0.
- [ ] `config.example.env` has the Phase 4 block (verified via grep).
- [ ] `resource_analyzer.py` is pure (no network, no `datetime.now`, no gateway import).
- [ ] New tests pass; ruff clean; module < 200 LOC.

## Risks / rollback

- **Risk**: relative overload mislabels in tiny teams. Mitigated — single-assignee case
  unit-tested to never self-flag; threshold scales with `team_mean`.
- **Risk**: pulling budget logic into the analyzer (drift). Mitigated — analyzer takes
  scalars; the tracker is read only at the graph call site (Slice B).
- **Rollback**: revert the `models.py`/`reporting_config.py`/`config.example.env` diffs +
  delete the two new files. No downstream consumer yet (B/C land after), so Slice A is
  fully isolated.
