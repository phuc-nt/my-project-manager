# Code Review — v2 M1-P4 Slice 1: `mpm` dispatch + `agent list` + `agent register`

Date: 2026-06-24
Reviewer: code-reviewer
Scope: uncommitted working-tree (untracked) files only.

## Scope

Files (all NEW, untracked):
- `src/entrypoints/mpm.py` (59 LOC)
- `src/entrypoints/mpm_registry_cmds.py` (105 LOC)
- `tests/test_mpm_dispatch.py` (6 tests)
- `tests/test_mpm_registry_cmds.py` (7 tests)

Focus: pre-landing review against the 6 acceptance items + 3 special-scrutiny points in
`phase-01-skeleton-list-register.md`. No code modified.

## Overall Assessment

Clean, scoped, additive. Every consumed API in the plan was fact-checked against source and
matches. All 6 acceptance items hold. The two flagged design trade-offs (partial-write window,
private-constant import) are both acceptable for M1 as-is — neither blocks. One plan/reality
discrepancy in the stated test count, and two minor observations below. No Critical, no High.

Verdict: ship.

## Acceptance Verification

### 1. register is SAFE (no partial/clobbering writes) — PASS

- **(a) validate-id-first**: `run_register` calls `_validate_agent_id(agent_id)` at
  `mpm_registry_cmds.py:87`, BEFORE resolving paths or any collision/write. Verified
  empirically: `../x`, `a/b`, `/abs`, `Acme`, `x..y`, `''` all raise `ValueError` ⇒ exit 2,
  NO dir, NO append. `test_register_bad_id_no_writes` asserts registry byte-identical +
  `profiles/../x` absent.
- **(b) both collision checks before any write**: `(pdir / agent_id).exists()` (`:95`) AND
  `any(e.id == agent_id for e in load_registry(reg))` (`:98`) both run, return 1, BEFORE the
  `_scaffold_profile_dir` / `_append_registry` calls at `:102-103`. Registry-only collision
  covered by `test_register_collision_in_registry_only`; dir-collision covered implicitly by
  the idempotent test.
- **(c) text-append, not yaml round-trip**: `_append_registry` opens `"a"` and writes one
  two-line block (`:73-74`); no `yaml.dump`. `test_register_scaffolds_and_appends` seeds a
  `# comment line` + `id: default` and asserts both survive in the post-append text AND the
  result re-parses to `["default","acme"]`. Confirmed the real committed `registry.yaml` (a
  4-line comment header + `default`) is structurally identical to what the test seeds, so the
  preserve-comments guarantee transfers to production. Re-validate (`load_registry(reg)` at
  `:75`) runs after append and raises on a corrupted file — verified `load_registry` raises
  `RuntimeError` on malformed input.
- **(d) partial-failure window**: REAL and as-documented. If `_scaffold_profile_dir` succeeds
  but `_append_registry` raises (e.g. disk full mid-append, or the re-validate trips), the
  `profiles/<id>/` dir is left behind with no compensating cleanup. The plan documents this
  (Risks §2) and relies on the dir-collision pre-check as the re-run recovery. **Severity: low**
  — see judgment below.

### 2. tests never mutate the real registry.yaml / profiles/ — PASS (critical)

Grepped every write op in both test files. All write targets (`pdir`, `reg`, `acme_dir`,
`tmp_path/.data/...`) are rooted at pytest `tmp_path`. The only real-path access is
`shutil.copyfile(_REAL_DEFAULT, ...)` where `_REAL_DEFAULT = profiles/default/profile.yaml` is
the **read source**, never a write target. After running the full suite, `git status` shows
`registry.yaml`, `profiles/`, `cli.py`, `cron.py`, `src/runtime/`, `src/profile/` all clean
(untouched). Confirmed the real `registry.yaml` content is intact.

### 3. list is crash-proof — PASS

- Missing/broken profile: `load_profile` raises `FileNotFoundError`/`RuntimeError`, caught at
  `:55` ⇒ `name = "<error: {exc}>"`, row still printed. `test_list_missing_profile_is_error_row_not_crash`
  (registry has `ghost`, no `profiles/ghost/`) ⇒ exit 0, `ghost` row present, no traceback.
- last-run: `_last_run` returns "never run" for absent file (`:32`), empty file (`:34-35`), and
  `JSONDecodeError` (`:39-40`). Happy path formats `"<kind> <status> @<ts[:19]>"`.
  `test_list_shows_rows_with_last_run` asserts an `acme` row with "daily delivered" and a
  `default` row with "never run". Empty registry ⇒ "(no agents registered)" via
  `test_list_empty_registry`.

### 4. dispatch grammar — PASS

- `[]` ⇒ 2 + usage; `["bogus","list"]` ⇒ 2; `["agent"]` ⇒ 2 (len < 2); `["agent","bogus"]`
  ⇒ 2 + "unknown subcommand". All covered by `test_mpm_dispatch.py`.
- Lazy-import routing: `main` does `from src.entrypoints.mpm_registry_cmds import run_list`
  INSIDE the branch (`:46`, `:50`). Verified empirically that monkeypatching
  `cmds.run_list`/`cmds.run_register` IS picked up — the import re-reads the module attribute
  per call, so the spy fires. `test_list_routes_to_run_list` / `test_register_routes_to_run_register`
  assert the spy receives `rest` (`[]` and `["acme"]` respectively).

### 5. additive — nothing else changed — PASS

`git diff --stat` empty (no tracked-file modifications). Only the 4 new untracked files (+ plan
& report dirs). `cli.py`, `cron.py`, `src/runtime/*`, `src/profile/*` all confirmed clean.

### 6. suite green / ruff clean / LOC < 200 — PASS

- Full suite: **396 passed** in 0.77s.
- `ruff check` on all 4 files: **All checks passed!** (the unicode `⇒`/`→` in docstrings &
  placeholder strings are fine under line-length 100.)
- LOC: `mpm.py` 59, `mpm_registry_cmds.py` 105. Both < 200.

## Special-Scrutiny Judgments

### Partial-write window (scaffold ok, append fails) — accept as-is for M1

Documented cleanup-on-failure (try/except → `rmtree` the scaffolded dir) is NOT worth adding
for M1. Reasoning:
- The append is the very next statement after scaffold; the only realistic failure modes are
  disk-full or the re-validate raising on a file an external actor corrupted between checks —
  both rare and operator-visible.
- The recovery path already works: a re-run hits the dir-collision pre-check at `:95` and exits
  1 with "profiles/<id>/ already exists" — a clear, actionable message. The operator then
  `rm -rf`s the orphan (the plan's rollback note already spells this out).
- A naive `rmtree` on failure would itself be a footgun: if the failure is the re-validate
  raising because the registry was *already* malformed before this register (not because of our
  append), an `rmtree` would still leave the half-written registry line while deleting a dir the
  operator might want to inspect. The transactional version that's actually correct (stage →
  append → rmtree-on-append-failure but NOT on revalidate-failure, distinguishing the two) is
  more complexity than M1's single-operator CLI warrants. **YAGNI holds.** Note: there is no
  test exercising this window (confirmed via grep) — acceptable since the plan accepts the
  behavior rather than guaranteeing cleanup; nothing to test.

### Private-constant import (`_REGISTRY_PATH`, `_PROFILES_DIR`) — acceptable, minor

`run_register` imports `_REGISTRY_PATH` (registry.py:19) and `_PROFILES_DIR` (loader.py:31) as
the kwarg defaults (`:92-93`). These are the single canonical path constants and the kwargs make
them fully overridable for tests, so this is the right source of truth — re-deriving
`REPO_ROOT / "registry.yaml"` locally would DUPLICATE the definition and risk drift (worse than
the underscore). It's a same-package sibling import, not a cross-boundary leak. If the team wants
to tidy this, promote both to public (`REGISTRY_PATH` / `PROFILES_DIR`) in a later slice — but
it does not matter for M1. Not a blocker.

### `agent_data_dir(id)` unwrapped in list — invariant holds, unreachable

`run_list` calls `agent_data_dir(e.id)` (`:58`) without a try/except. `agent_data_dir` calls
`_validate_agent_id` which raises `ValueError` on a bad id. But `e` comes from
`load_registry`, which itself validates every id via `_validate_agent_id` at the registry
boundary (registry.py:64-67) and raises `RuntimeError` on a bad one BEFORE returning any entry.
So by the time `run_list` iterates, every `e.id` is already proven valid — the `ValueError`
branch is genuinely unreachable. The registry is the validation boundary (P3 slice 3), and
that invariant is intact. No defensive wrap needed; adding one would be paranoia the rules
discourage.

## Observations (non-blocking)

1. **Plan test-count discrepancy.** Plan states "7 tests" for dispatch and "8 tests" for
   registry cmds (15 total); actual is **6 + 7 = 13**. The suite is green and all acceptance
   behaviors are covered, so this is a doc/reality drift, not a coverage gap — but the plan's
   stated count should be corrected to 13, or the missing 2 cases identified if they were
   intended. Candidate uncovered-but-cheap case: `run_register` with `args == []` ⇒ exit 2 +
   "usage" (the `:82-84` branch) is not directly tested (the dispatcher never passes empty
   `rest` to `register` since `["agent","register"]` has `rest == []` → actually it WOULD; worth
   one test asserting `run_register([])` returns 2). Low value, optional.

2. **Data-dir base is not a kwarg (asymmetric injection).** `run_list` injects `registry_path`
   and `profiles_dir` as kwargs, but the per-agent data-dir base is reached via
   `agent_data_dir` → module-global `DATA_DIR`, overridable only by monkeypatching
   `agent_paths.DATA_DIR`. The plan explicitly chose this (lines 78-79, "reuse `agent_data_dir`
   and monkeypatch `agent_paths.DATA_DIR`"), and I verified the monkeypatch is effective
   (`agent_data_dir` resolves `DATA_DIR` from its own namespace at call time; `mpm_registry_cmds`
   imports the *function*, not the value). So it works and is intentional — but it's a slightly
   leaky test seam vs. the clean kwarg pattern used for the other two paths. Acceptable; note
   for consistency if a future slice threads a `data_dir` kwarg.

3. **Scaffolded placeholders are not byte-identical to `profiles/default/*.md`.** The plan said
   "mirror profiles/default/SOUL.md"; the implementation writes its own shorter one-line HTML
   comments (`_PLACEHOLDER_MD`, `:22-26`). Functionally equivalent (both are
   empty-of-meaning HTML comments that `load_profile` reads verbatim as effectively-empty
   context), so no behavioral difference. Purely cosmetic; not worth changing.

## Metrics

- Tests: 396 passed (full suite); 13 new (6 dispatch + 7 registry-cmds).
- Ruff: 0 issues across the 4 files.
- LOC: mpm.py 59, mpm_registry_cmds.py 105 (both < 200).
- Type coverage: full type hints on all public signatures + helpers (`argv: list[str] | None`,
  `Path | None` kwargs, `-> int`/`-> str`/`-> None`). No `Any`, no lint suppressions.
- Tracked-file changes: 0 (purely additive).

## Unresolved Questions

- Plan claims 15 tests; actual 13. Intended drop, or were 2 cases (e.g. `run_register([])`
  empty-args, dir-only collision distinct from registry-only) meant to ship? Confirm with the
  author whether the count should be reconciled in the plan or the 2 tests added.
