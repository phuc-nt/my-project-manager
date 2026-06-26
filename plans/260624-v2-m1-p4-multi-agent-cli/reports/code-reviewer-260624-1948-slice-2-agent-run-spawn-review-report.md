# Code Review — Slice 2: `mpm agent run` (spawn the worker subprocess)

Plan: `plans/260624-v2-m1-p4-multi-agent-cli/phase-02-agent-run.md`
Date: 2026-06-24
Verdict: **APPROVE** — ship. No blocking issues. One brief-vs-reality discrepancy (test count) + two low-priority notes.

## Scope
- Modified: `src/entrypoints/mpm.py` (+4 lines: one `run` branch + lazy import)
- New: `src/entrypoints/mpm_run_cmd.py` (68 LOC), `tests/test_mpm_run_cmd.py` (8 tests)
- LOC: mpm_run_cmd 68, mpm 63, service 162 — all <200
- Focus: full acceptance verification + circular-import / side-effect scrutiny
- Scout: flag-position edge cases (`--dry-run` as a flag value), import-graph cyclicity, test-seam fidelity

## Overall Assessment
Clean, minimal, additive. The load-bearing contract (exact worker argv) is correctly reused from
`service._worker_argv` and asserted exactly in the test. Lazy import keeps `list`/`register` free of
the spawn/subprocess cost. Exit-code mapping is correct. Tests are real behavior assertions, not
phantom coverage. Every acceptance item verified empirically below.

## Acceptance — Verified

1. **Exact worker argv (DRY lock-step)** — PASS.
   `run_agent` builds argv via `service._worker_argv` (mpm_run_cmd.py:54), appends `--dry-run` when
   present (`:55-56`). Test asserts the FULL list, not a fuzzy match (test:55-58):
   `[sys.executable, "-m", "src.runtime.worker", "--agent-id", "acme", "--report", "daily", "--audience", "internal"]`.
   `--audience external` lands correctly (test:69, exact tail slice). `--dry-run` passthrough asserted
   (test:77). Reusing `_worker_argv`/`_supervise`/`_real_spawn` is the correct DRY call — the coupling
   is the point (the CLI run and the P3 scheduler MUST spawn the identical contract). User pre-approved.

2. **No real subprocess in tests** — PASS.
   Every test injects a fake (`_FakeProc` / `_fake_spawn`); default `_real_spawn` is never reached.
   Grepped: no test launches `python -m`. Timeout test (test:88-100) uses `hang=True`, `timeout=1`,
   asserts `record_procs[0].killed is True` and `"TIMEOUT"` in output, rc==1.

3. **Exit-code mapping** — PASS.
   exit 0 ⇒ 0 (test:54); worker non-zero ⇒ 1 (test:85); timeout ⇒ 1 + timeout line + killed
   (test:97-100); unknown agent ⇒ 1, `record == []` i.e. fake NEVER called (test:107-108); bad kind ⇒
   2, no spawn (test:116); missing id ⇒ 2, no spawn (test:123). Mapping `return 0 if exit_code==0 else 1`
   (mpm_run_cmd.py:68) is correct — timeout returns early at `:61` so the `exit_code is None` case never
   reaches the comparison.

4. **Existence pre-check** — PASS.
   `load_registry()` membership checked BEFORE building argv / spawning (mpm_run_cmd.py:45-52). A
   `load_registry` failure (`FileNotFoundError`/`RuntimeError`) is caught and mapped to exit 1 with a
   clean message, no crash (`:47-49`). Both exception types match what `registry.load_registry` actually
   raises (verified registry.py:33-44). Typo'd id ⇒ clean "unknown agent" exit 1, not a deep worker exit 2.

5. **Additive + minimal** — PASS.
   `git status`/`git diff` confirm: ONLY `mpm.py` modified (+4 lines, exactly one `run` branch + import),
   plus the two new files. cli.py / cron.py / src/runtime / Slice-1 registry cmds untouched.

6. **Suite + ruff + LOC** — PASS.
   `uv run pytest -q` ⇒ **405 passed**. `uv run ruff check` (all 3 files) ⇒ clean. All files <200 LOC.

## Special Scrutiny — Verified

- **Entrypoint→runtime private-helper import is ACYCLIC** — confirmed empirically.
  `import src.entrypoints.mpm` does NOT load `mpm_run_cmd` or `service` (both `sys.modules`-absent after
  import). mpm_run_cmd imports `mpm._flag_value` + `service.*`; mpm imports mpm_run_cmd only lazily inside
  the `run` branch (mpm.py:54). No import cycle at module load.

- **No import-time side effect in service.py chain** — confirmed.
  Importing `service` produces 0 bytes stdout, no module-level file IO; `agent_data_dir` is a pure path
  join (no `mkdir` at import). So even though `service` pulls in `subprocess`, the lazy import in mpm.py
  means `mpm agent list`/`register` pay nothing for it. (Verified `list`/`register` branches each do their
  own lazy import of `mpm_registry_cmds` — they never touch mpm_run_cmd or service.)

- **`_last_run_event` test seam is sound** — confirmed empirically.
  `_supervise` calls `_last_run_event` via module-global lookup (service.py:69), so
  `monkeypatch.setattr("src.runtime.service._last_run_event", ...)` IS seen by `_supervise`. Proved by
  patching the module global and observing the sentinel flow through `_supervise`. The REAL path (actual
  `runs.jsonl` read) is exercised only by the user's manual smoke (`mpm agent run default --dry-run` ⇒
  `exit=0 delivered=True cost=0.00134`) — no automated test covers the real file read for `run_agent`.
  Acceptable: `_last_run_event` itself is unit-tested in `test_service.py`, and the seam here only verifies
  the print plumbing. See Low-priority note 2.

- **Timeout default 600s as module constant** — fine. `_DEFAULT_TIMEOUT = 600` (mpm_run_cmd.py:19);
  every test overrides via `timeout=1` or relies on the non-hang fake, so no test waits.

## Edge Cases Found by Scout (all benign)

- `--report --dry-run` ⇒ `_flag_value` returns `"--dry-run"` as the kind ⇒ fails `_VALID_KINDS` ⇒ clean
  exit 2. Correct, no spawn. The user can't accidentally smuggle `--dry-run` past kind validation.
- `--audience --dry-run` ⇒ audience value is `"--dry-run"`, which `!= "external"` ⇒ falls back to
  `"internal"`, and `"--dry-run" in args` is still True ⇒ argv gets `--dry-run`. Acceptable behavior
  (no audience named `--dry-run` exists; worst case is a dry-run with default internal audience).
- `--dry-run` detection is membership-in-`args` (`:55`), independent of position — robust to ordering.
- `_FakeProc.wait(timeout)` correctly raises `subprocess.TimeoutExpired` matching the real `proc.wait`
  contract `_supervise` catches (service.py:65) — the fake is faithful to the real API.

## Discrepancy (brief vs reality)

- **Test count: brief says "9 tests", file has 8.** `tests/test_mpm_run_cmd.py` defines exactly 8 test
  functions (happy/audience/dry-run/nonzero/timeout/unknown/bad-kind/missing-id) and pytest collects 8.
  Coverage is complete per the plan's enumerated cases (the plan lists 8 bullet scenarios, not 9) — this
  is a miscount in the task brief, not a missing test. No action needed.

## Low Priority (non-blocking, optional)

1. **`detail.get('cost_usd')` may print `None`** when the run-event lacks the key (e.g. an error run).
   The print line (`:63-67`) shows `cost=None` rather than a placeholder. Cosmetic; the manual smoke
   shows the populated happy path is fine. No fix required.
2. **No automated coverage of the real `_last_run_event` file read via `run_agent`.** Every test stubs
   the detail. The real read is proven only by manual smoke. If you want regression protection for the
   real-file path, one test seeding a tmp `runs.jsonl` (the plan's original "happy" bullet suggested
   `agent_paths.DATA_DIR` → tmp + seed) would close it — but `_last_run_event` is already unit-tested in
   `test_service.py`, so this is optional belt-and-suspenders, not a gap.

## Positive Observations (risk-calibration)
- The `exit_code is None` (timeout) value can never hit the `== 0` comparison because the timeout branch
  returns early — a subtle correctness point the author handled cleanly rather than relying on
  `None == 0` being falsy.
- Error messages route to `stderr` (not stdout), and tests assert on `.err` vs `.out` correctly —
  proper stream discipline for a CLI.

## Metrics
- Type coverage: full (annotated signatures; `spawn` is duck-typed by design, consistent with `Spawn` alias)
- Test coverage: 8/8 plan scenarios; full suite 405 passed
- Linting: 0 issues (ruff clean, line-length 100)

## Unresolved Questions
None.
