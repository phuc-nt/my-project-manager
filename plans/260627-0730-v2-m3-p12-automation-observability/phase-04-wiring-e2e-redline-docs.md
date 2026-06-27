# Phase 04 — Wiring + offline e2e + red-line + docs

**Status**: pending · **Effort**: 2h · **Blocks**: none · **Blocked by**: S1, S2, S3

Integration slice. Merge the two `mpm.py` one-line additions (S2 replay + S3 automate),
run a consolidated offline e2e + the cross-cutting red-line suite, and update docs +
journal. May be folded into S3 if the surface stayed small.

## Context (verified 2026-06-27)

- `src/entrypoints/mpm.py` — S2 and S3 each add ONE dispatch branch (`replay`,
  `automate`) + a `_USAGE` token. This phase owns the FINAL merge so the two parallel
  edits don't collide (alternatively: do S2→S3 serially and skip this merge concern).
- Docs to update (LOCKED): `docs/v2/architecture.md` (the "preserved invariant" section the
  M3 rule points at — `feature-proposals.md:93`) + `docs/v2/roadmap-m2.md` — append a
  `### P12 — Automation + observability ✅ COMPLETE` entry AFTER the P11 entry
  (`roadmap-m2.md:133-149`), matching the P11/P10 format (Status line + commit-hash
  placeholders + What shipped + Files + Acceptance + Exit line). NO new `roadmap-m3.md`
  (M3 P10/P9/P11 all live in roadmap-m2.md — verified `docs/v2/` has only roadmap-m1.md +
  roadmap-m2.md).
- Journal (LOCKED, convention verified): NEW `docs/journals/260627-v2-m3-p12-automation-observability.md`
  (the repo's `YYMMDD-<slug>.md` one-file-per-milestone convention) + a timeline ROW in
  `docs/journals/README.md`'s "Dòng thời gian" table, matching the existing terse bilingual
  (VI) format (`Ngày | Mốc | Trạng thái | Tóm tắt`).
- 3 entry points that must agree (B4 tracing threads through all): `worker.py`,
  `cli.py`, `server/run_manager.py`. S1 already wired the helper into each — S4 only
  VERIFIES all three are consistent, no new threading here.

## Requirements

1. `mpm.py` exposes `list | register | run | resume | replay | automate | approvals |
   approve | reject | audit` — all dispatch correctly, `_USAGE` lists them.
2. Consolidated offline e2e proves the three features coexist + backward-compat holds.
3. Cross-cutting red-line test (one suite) asserts the WHOLE P12 surface keeps the
   Action-Gateway invariant.
4. Docs reflect: tracing opt-in (default OFF), replay command, automation READ-ONLY+PROPOSE
   + the invariant. Roadmap P12 marked complete with the red-line note (mirror P11).

## Files

**Modify**
- `src/entrypoints/mpm.py` — final merged dispatch (both `replay` + `automate` branches
  present + both in `_USAGE`).
- `docs/v2/architecture.md` — add a short P12 note under the preserved-invariant section:
  D3 automation proposes through the gateway; B3 replay re-runs gateway-routed graphs; B4
  tracing is observability-only. Keep it tight.
- `docs/v2/roadmap-m2.md` — append the `### P12 — Automation + observability ✅ COMPLETE`
  entry after P11 (deliverables, acceptance, "RED LINE HELD" note) in the P11 style; mark
  M3 complete.
- `docs/journals/README.md` — add the P12 timeline row to the "Dòng thời gian" table.

**Create**
- `tests/test_p12_e2e_offline.py` (NEW, offline) — the consolidated e2e (below).
- `docs/journals/260627-v2-m3-p12-automation-observability.md` (NEW) — the P12 journal
  entry, terse bilingual (VI) per the existing template.

## Implementation steps

1. Merge/confirm the `mpm.py` dispatch (replay + automate). Run `mpm agent` with no args →
   `_USAGE` lists all subcommands.
2. Write the consolidated e2e (backward-compat + coexistence).
3. Write/centralize the cross-cutting red-line assertions (or confirm S3's redline suite
   already covers it + add the B3/B4 no-bypass checks).
4. Update `architecture.md` + append the P12 entry to `roadmap-m2.md` + write
   `docs/journals/260627-v2-m3-p12-automation-observability.md` + add its row to
   `docs/journals/README.md`. Verify dates (2026-06-27), links, and that every claim
   matches the shipped code (re-grep before writing acceptance).

## Tests / validation

`tests/test_p12_e2e_offline.py` (NEW, offline):
- **Backward-compat (the headline)**: with NO tracing flag and NO automation invoked, a
  normal report run's invoke config == the pre-P12 literal (`invoke_config` returns
  `{"configurable":{"thread_id":..}}` with no `callbacks` key) — byte-identical assertion.
- **B4 coexist**: tracing ON via env+flag ⇒ callbacks present, a report still runs offline
  (fake LLM), no network.
- **B3 coexist**: a seeded tmp checkpoint can be listed + replayed (frozen state) without
  re-fetch.
- **D3 coexist**: a workflow propose enqueues Lớp B (`pending_approval`) and the user can
  approve it through the EXISTING `mpm agent approve` path (assert the proposal is in the
  same queue the report path uses).
- **mpm dispatch**: `replay` and `automate` subcommands both resolve (no "unknown
  subcommand").

`tests/test_p12_redline_consolidated.py` (NEW, offline) — or fold into S3's redline suite:
- D3 propose → `pending_approval`, never executed (re-assert).
- D3 destructive propose → Lớp A hard-deny.
- `src/automation/` imports the gateway only (grep-guard, re-assert at the integration
  level).
- B3 replay reaching a write goes through the SAME gateway (no replay-specific bypass).

Commands:
```
uv run pytest -q tests/test_p12_e2e_offline.py tests/test_p12_redline_consolidated.py
uv run pytest -q tests/   # FULL suite green (704 baseline + all new P12 tests)
uv run ruff check src/ tests/
```

## Risks + rollback

| Risk | L×I | Mitigation |
|------|-----|------------|
| Parallel S2+S3 edits to `mpm.py` collide | M×L | S4 owns the final merge (or run S2→S3 serially). Both are append-only one-liners — trivial merge. |
| Docs claim a behavior the code doesn't have | M×M | Re-grep every acceptance claim against shipped code before writing (verification discipline). Cite file:line in the roadmap entry where useful. |
| Full suite regresses from the combined change | L×H | Run the full `uv run pytest -q` last; fix regressions, never weaken a test. The 704 baseline must hold + new tests added. |

**Rollback**: revert the docs + the `mpm.py` merge + delete the consolidated test files.
Each feature (S1/S2/S3) rolls back independently per its own phase (default-OFF / additive
commands) — S4 adds no new runtime behavior, only integration tests + docs + the dispatch
merge.

## INVARIANT (restated)

The consolidated red-line suite is the gate: D3 proposes through the gateway (Lớp B,
never auto-execute), B3 replay re-runs gateway-routed graphs (no replay bypass), B4
tracing is observability-only (no action path). The Action-Gateway red line — Lớp A
hard-deny + allowlist default-DENY + Lớp B approve — is unchanged by all of P12.

## Unresolved questions

1. Should S4 stay separate or fold into S3? Proposed: keep separate only if the e2e +
   red-line + docs total >1h of work; otherwise fold into S3's final steps.

_Resolved by coordinator (2026-06-27): docs home = `docs/v2/roadmap-m2.md` (append P12
after P11; NO roadmap-m3.md). Journal = NEW `docs/journals/260627-v2-m3-p12-automation-observability.md`
+ a row in `docs/journals/README.md` (terse bilingual format — convention verified)._

**Grep-guard ownership**: the `src/automation/` imports-gateway-only grep-guard lives in
S3 (`tests/test_automation_redline.py`) and is RE-ASSERTED at the integration level in S4
(`tests/test_p12_redline_consolidated.py`). Confirmed kept in both.
