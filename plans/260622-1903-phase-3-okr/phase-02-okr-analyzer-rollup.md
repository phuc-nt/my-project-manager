# Phase 02 — Slice B: OKR analyzer (weighted rollup + equal-weight fallback + problems + at-risk)

> **Status: ✅ DONE (2026-06-22).** Shipped pure `okr_analyzer.py` (`build_objectives`, `OkrRollup`).
> Child-count multi-epic weighting, any-blank⇒equal rule, problems, at-risk. 11 UT.

> Goal: one pure module that turns raw parsed rows + an epic-progress map into computed `Objective`s
> (with rolled-up %), a list of `OkrProblem`s, and an at-risk flag set. No I/O. Fully fixture-testable.

## Context links

- Plan index: [plan.md](plan.md)
- Pattern to match — pure analyzer, thresholds passed in, deterministic: `src/agent/risk_analyzer.py:91` (`analyze`), `:17` (`_overdue_risks`)
- Inputs produced by Slice A: `parse_okr_table` raw quads, `parse_epic_keys`, `parse_weight`,
  `EpicProgress`, and `get_epic_progress_map` — see [phase-01-okr-read-models-and-fetch.md](phase-01-okr-read-models-and-fetch.md)
- Models: `KeyResult`, `Objective`, `OkrProblem`, `EpicProgress` (added in Slice A) in `src/tools/models.py`
- Rollup decision of record: phase-01 §"Rollup decision".

## Why a separate analyzer (not a new Risk kind)

OKR data shape is `Objective`/`KeyResult`, not `Issue`/`PullRequest`/`CiRun`. Overloading
`risk_analyzer.analyze` (`risk_analyzer.py:91`) would force OKR types into a function whose contract is
issues/prs/ci. A separate pure `okr_analyzer.py` keeps each analyzer single-responsibility and mirrors
the existing "pure, thresholds-injected, deterministic" pattern. **Decision: separate analyzer.** (The
at-risk objectives are surfaced inside the OKR report directly, not folded into the daily/weekly Risk
pipeline — they are a distinct report section.)

## Requirements

`src/agent/okr_analyzer.py` — pure, no network, no `datetime.now`:

1. `build_objectives(raw_rows, epic_progress, *, behind_threshold) -> OkrRollup` where:
   - `raw_rows`: the `list[tuple[str,str,str,str]]` from `parse_okr_table`.
   - `epic_progress`: `dict[str, EpicProgress]` from `get_epic_progress_map`.
   - `behind_threshold`: float 0..1 (from `cfg.okr_behind_threshold`).
   - Returns `OkrRollup(objectives: tuple[Objective,...], problems: tuple[OkrProblem,...], at_risk: tuple[str,...])`
     — a small frozen result dataclass (define it in `models.py` or locally in the analyzer module; prefer
     `models.py` for reuse by the prompt layer). `at_risk` = names of objectives whose `progress_pct`
     (as a fraction) `< behind_threshold`.
2. Row → KR resolution (per raw row):
   - Parse epic keys (`parse_epic_keys`) and weight (`parse_weight`). A `parse_weight` `ValueError`
     ⇒ append an `OkrProblem(row, "weight không hợp lệ: ...")` and SKIP the row.
   - A row with no epic keys ⇒ `OkrProblem(row, "thiếu Epic Key")`, skip.
   - For each epic key, look up `epic_progress`. Keys with `found=False` (or missing from the map) ⇒
     `OkrProblem(row, "epic <KEY> không tồn tại trong Jira")` and exclude that epic from the KR.
     If ALL epics of a KR are missing ⇒ the KR has no progress; record a problem and skip the KR from
     its Objective's rollup (Objective still rolls up over its remaining KRs).
3. KR progress (multi-epic aggregation) — implement the phase-01 decision (child-count based; the
   running Jira MCP exposes no story points, so progress = done-children / total-children):
   - If every contributing epic has `total_count` not None and `> 0`: KR% = 100 ×
     Σ`done_count` / Σ`total_count` over the contributing epics.
   - Else fall back to the mean of available `progress_pct` values; if none available, KR% = None
     (KR excluded from Objective rollup, recorded as a problem).
4. Objective progress (weighted average across its KRs):
   - Only KRs with a non-None progress contribute.
   - Effective weight: a KR's `weight` if set, else equal weighting among the Objective's KRs that have
     a weight of `None` — i.e. **blank ⇒ equal share**. Concretely: if all weights blank ⇒ simple mean;
     if some set and some blank ⇒ document and pick ONE rule (recommend: blanks each get the average of
     the explicit weights, OR treat the whole Objective as equal-weight if any blank — choose the
     simpler "if any weight blank in an Objective, treat that Objective as all-equal" unless the user
     specifies mixed weighting). **Decision: if any KR weight in an Objective is blank, the whole
     Objective uses equal weighting** (KISS; avoids ambiguous mixed math). Document in the docstring.
   - Objective% = Σ(KR% × w) / Σw over contributing KRs. None if no KR contributes.
5. At-risk: an Objective with a non-None `progress_pct` and `progress_pct/100 < behind_threshold` ⇒ its
   name in `at_risk`. Objectives with `None` progress are NOT at-risk (they are a problem, listed
   separately).
6. All percentages stored on the returned `Objective`/`KeyResult` as a 0..100 float (matches Jira
   `progressPercentage`). Round for display in the prompt layer (Slice C), not here.

## Files

- Create: `src/agent/okr_analyzer.py` (target < 180 LOC; if it crosses 200, split the KR-aggregation
  math into `src/agent/okr_rollup_math.py`).
- Create: `tests/test_okr_analyzer.py`.
- Possibly modify: `src/tools/models.py` — add `OkrRollup` frozen dataclass (coordinate: this is a
  Slice A file; if Slice B runs after A's merge, append cleanly; otherwise define `OkrRollup` locally in
  the analyzer to avoid a second edit to `models.py`). **To keep file ownership clean, define `OkrRollup`
  in `okr_analyzer.py` (Slice-B-owned), not in `models.py`.**

## Implementation steps

1. Define `OkrRollup` in `okr_analyzer.py`.
2. Implement row→KR resolution with problem collection.
3. Implement KR multi-epic aggregation (story-count weighted + mean fallback).
4. Implement Objective weighted average + equal-weight fallback rule.
5. Implement at-risk detection from `behind_threshold`.
6. Tests + `ruff`.

## Tests / validation (`tests/test_okr_analyzer.py`, fixtures only)

- Equal weighting: 2 KRs, blank weights, 80% + 40% → Objective 60%.
- Explicit weights: KR1 80% w=0.75, KR2 40% w=0.25 → 70%.
- Mixed (some blank) → exercises the documented "all-equal if any blank" rule; assert the chosen result.
- Multi-epic KR child-count weighting: epicA 1/1 done (100%), epicB 0/49 (0%) → KR ≈ 2% (1/50), NOT 50%
  — proves child-count weighting, not percentage-average.
- Multi-epic fallback: epics with only `progress_pct` (no counts) → mean.
- Problem rows: malformed weight, missing epic key, unknown epic key → each yields one `OkrProblem`,
  rollup still produced over valid rows (resilience — acceptance criterion #2).
- Unknown-epic exclusion: KR with one good + one `found=False` epic rolls up over the good one and emits
  a problem for the bad one.
- At-risk: Objective at 30% with `behind_threshold=0.5` → in `at_risk`; at 60% → not.
- None-progress Objective (all KRs problem) → not at-risk, appears only as problems.

## Risks / rollback

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Ambiguous mixed-weight semantics produce surprising numbers | M×M | Lock the "any blank ⇒ Objective all-equal" rule in code + docstring + a dedicated test; surfaced in report so a human can correct the source table. |
| Division by zero (Σtotal=0 or Σw=0) | M×M | Guard every denominator; zero-denominator KR/Objective ⇒ None progress + a problem, never a crash. |
| Float rounding drift in assertions | L×L | Tests assert with `pytest.approx`. |

Rollback: delete the 2 created files. No other module imports the analyzer until Slice C.

## Open questions

1. Mixed explicit+blank weights within one Objective: the plan picks "all-equal if any blank". Confirm
   with the user if they intend true mixed weighting (some KRs heavier, blanks sharing the remainder).
   Low risk — the source table author can just fill all weights to be explicit.
