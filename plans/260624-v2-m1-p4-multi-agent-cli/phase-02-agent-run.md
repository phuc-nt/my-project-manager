# Phase 2 — `agent run` (spawn the worker subprocess)

> Status: pending. Slice 2 of [plan.md](plan.md). Depends on Slice 1 (`mpm.py` dispatch shell).
> Adds `mpm agent run <id> --report <kind> [--audience …]` — spawns the P3 worker subprocess
> (the SAME argv shape the coordinating service uses), waits, collects the exit code + the last
> `runs.jsonl` line, prints the outcome. The spawn fn is **injectable** so the test asserts the
> exact argv with no real process. Additive: extends `mpm.py` by one router branch + one new
> file.

## Context (verified file:line)

- **The worker = the spawn target.** `python -m src.runtime.worker --agent-id <id> --report
  <kind> [--audience …] [--dry-run]` (`src/runtime/worker.py:3-4`, `main` at `:81`). Exit codes:
  `0` delivered, `1` ran-not-delivered/error, `2` bad invocation / load failure (`worker.py`
  exit table, `:142`/`:102`/`:123`).
- **The service's spawn shape to MIRROR (verified):**
  - `service._worker_argv(agent_id, kind, audience)` (`src/runtime/service.py:49-53`) =
    `[sys.executable, "-m", "src.runtime.worker", "--agent-id", agent_id, "--report", kind,
    "--audience", audience]`.
  - `service._real_spawn(argv)` (`:39-46`) = `subprocess.Popen(argv)` (no shell; id validated at
    the registry boundary).
  - `service._supervise(spawn, argv, *, timeout)` (`:56-69`) spawns, `proc.wait(timeout)`, on
    `TimeoutExpired` kills + `status="timeout"`, else returns
    `{"status":"ran","exit_code":…,"detail": _last_run_event(agent_id)}`.
  - `service._last_run_event(agent_id)` (`:72-83`) reads the last line of
    `agent_data_dir(agent_id)/runs.jsonl`.
  - **DRY-vs-coupling decision:** `mpm agent run` runs ONE agent (not a scheduler loop) and
    wants the SAME argv + the same supervise-collect behavior. **Decision: import
    `_worker_argv`, `_supervise`, and `Spawn`/`_real_spawn` from `src.runtime.service`** — they
    are already module-level, already unit-tested (`test_service.py`), and re-implementing them
    in `mpm_run_cmd.py` would duplicate the argv contract (the exact thing that must stay in
    lock-step with the service). Reusing them keeps ONE argv shape. (If a reviewer prefers no
    entrypoint→service import, the fallback is a 6-line local `_worker_argv` + a thin
    spawn-wait; note it as the alternative. Recommend the import — DRY wins here, the functions
    are stable + tested.)
- **Injectable-spawn test precedent (mirror):** `tests/test_service.py:15-37` — `_FakeProc`
  (configurable `exit_code` / `hang`) + `_fake_spawn(record)` appends the argv and returns a
  `_FakeProc`. The test asserts `record[0]` equals the exact argv (`test_service.py:64-68`).
- **Registry/id (consume):** `load_registry` (`registry.py:30`) to confirm the agent exists +
  is registered before spawning; `_validate_agent_id` already runs inside `agent_data_dir` /
  `_worker_argv`'s id (validated at registry load). For `run`, validate the id (reject a bad id
  with exit 2 before building any argv).
- **Slice 1 dispatch shell (extend):** `mpm.main` routes `agent <sub>` → group helpers; Slice 2
  adds `elif sub == "run": return mpm_run_cmd.run_agent(rest, …)`.

## Requirements

1. **`src/entrypoints/mpm_run_cmd.py`** — `run_agent`:
   - `run_agent(args, *, spawn=None, timeout=_DEFAULT_TIMEOUT) -> int`.
   - Parse: `agent_id = args[0]` (missing ⇒ usage/2). `kind = _flag_value(args, "--report")`
     (default `daily`; validate it's one of `daily|weekly|okr|resource` ⇒ else usage/2).
     `audience = "external" if _flag_value(args,"--audience")=="external" else "internal"`.
     `--dry-run` flag (see open question #2 — recommend passthrough).
   - **Existence check:** confirm the agent is in `load_registry()` (or its profile dir exists)
     so `run <typo>` is a clean "unknown agent" error (exit 1), not a worker that exits 2 with a
     less obvious message. (Cheap pre-check; the worker still re-validates.)
   - Build the argv via `service._worker_argv(agent_id, kind, audience)`; if `--dry-run`, append
     `"--dry-run"`.
   - `spawn = spawn or service._real_spawn`. `outcome = service._supervise(spawn, argv,
     timeout=timeout)`.
   - Print the outcome: the worker's `status` + `exit_code` + the `detail` (the last
     `runs.jsonl` line: kind/status/delivered/cost). On `status=="timeout"` ⇒ print a timeout
     line.
   - Return: map the worker's exit code through — `0` if `outcome["exit_code"]==0`, else `1`
     (a timeout or a non-zero worker ⇒ `1`); a bad invocation (missing/invalid args) ⇒ `2`.
2. **`src/entrypoints/mpm.py`** — add ONE router branch: `elif sub == "run": return
   mpm_run_cmd.run_agent(rest)` + the import. No other change.

## Files to create

- `src/entrypoints/mpm_run_cmd.py` — `run_agent` + arg helpers (~50 LOC). Imports
  `_worker_argv`, `_supervise`, `_real_spawn` from `src.runtime.service`; `load_registry` from
  `src.runtime.registry`; `_flag_value` from `mpm` (or a local copy — keep DRY via import).
- `tests/test_mpm_run_cmd.py` — argv assertion via an injected fake spawn (below).

## Files to modify

- `src/entrypoints/mpm.py` — one `elif sub == "run"` branch + the `mpm_run_cmd` import (Slice 2
  owns this edit; Slice 3 adds its own disjoint branch).

## Implementation steps

1. `mpm_run_cmd.py`:
   - import `from src.runtime.service import _worker_argv, _supervise, _real_spawn`.
   - `_VALID_KINDS = {"daily","weekly","okr","resource"}`.
   - `run_agent(args, *, spawn=None, timeout=600)`: parse + validate; existence pre-check via
     `load_registry()`; build argv; `outcome = _supervise(spawn or _real_spawn, argv,
     timeout=timeout)`; print; return the mapped code.
2. `mpm.py`: add the `run` branch + import.
3. Tests (below). Focused first, then full suite + ruff.

## Tests / validation

`tests/test_mpm_run_cmd.py` (offline — injected fake spawn, NO real subprocess):

- **happy: exact argv asserted.** Reuse the `test_service.py` fake-spawn shape (`_FakeProc`
  exit 0 + a `record` list). Monkeypatch `load_registry` (so the agent exists) and
  `agent_paths.DATA_DIR` → a tmp dir; seed `agent_data_dir("acme")/runs.jsonl` with one line.
  `run_agent(["acme","--report","daily"], spawn=fake)` ⇒ exit 0; assert `record[0] ==
  [sys.executable, "-m", "src.runtime.worker", "--agent-id", "acme", "--report", "daily",
  "--audience", "internal"]`; assert the printed outcome includes the seeded run-event detail.
- **audience external in the argv.** `run_agent(["acme","--report","okr","--audience","external"],
  spawn=fake)` ⇒ argv ends `…"--report","okr","--audience","external"`.
- **dry-run passthrough.** `run_agent(["acme","--dry-run"], spawn=fake)` ⇒ argv contains
  `"--dry-run"` (drop this test if the user declines passthrough — open Q #2).
- **worker non-zero ⇒ exit 1.** fake exits `1` ⇒ `run_agent` returns 1; printed outcome shows
  the exit code.
- **timeout ⇒ exit 1 + killed.** fake `hang=True`, `timeout=1` ⇒ `_supervise` returns
  `status="timeout"`; `run_agent` returns 1 and prints a timeout line.
- **unknown agent ⇒ exit 1, no spawn.** `load_registry` returns no matching id ⇒ `run_agent`
  returns 1 and the fake spawn was NEVER called (assert `record == []`).
- **bad kind / missing id ⇒ exit 2, no spawn.** `run_agent(["acme","--report","bogus"], …)` ⇒ 2;
  `run_agent([], …)` ⇒ 2; spawn not called.

Shell validation:
```
uv run pytest tests/test_mpm_run_cmd.py -q
uv run ruff check src/entrypoints/mpm_run_cmd.py src/entrypoints/mpm.py tests/test_mpm_run_cmd.py
uv run pytest -q   # full suite green
# Optional real smoke (needs key + a registered agent): a true dry-run report via the CLI:
#   uv run python -m src.entrypoints.mpm agent run default --report daily --dry-run
```

## Acceptance (slice)

- `mpm agent run <id> --report <kind> [--audience …]` (injected fake spawn) constructs the EXACT
  worker argv `[python, "-m", "src.runtime.worker", "--agent-id", <id>, "--report", <kind>,
  "--audience", <aud>]` and prints the exit code + the last `runs.jsonl` line. NO real process
  in the test.
- A worker non-zero exit ⇒ `run` returns 1; a timeout ⇒ returns 1 + a timeout line + the proc
  killed; an unknown agent or bad args ⇒ no spawn + exit 1/2.
- `mpm.py` gains exactly one `run` router branch. New file ≤ 200 LOC; ruff clean; full suite
  green.

## Risks / rollback

- **Risk: a real `python -m src.runtime.worker` subprocess in tests is slow/flaky/env-bound.** →
  the spawn fn is injectable (default `_real_spawn`; tests pass a `_FakeProc`-returning fake,
  the proven `test_service.py` pattern). No real process runs in the suite.
- **Risk: the entrypoint→service import (`_worker_argv`/`_supervise`) couples mpm to a private
  helper.** → these are module-level, already unit-tested, and the COUPLING IS THE POINT — `run`
  must spawn the exact same argv as the scheduler. Reuse keeps one argv contract. (Fallback: a
  6-line local copy if a reviewer rejects the import; noted in Context.)
- **Risk: `run` reports a confusing error for a typo'd agent (worker exits 2 deep inside).** →
  the existence pre-check via `load_registry` turns `run <typo>` into a clean "unknown agent"
  exit 1 before any spawn.
- **Rollback:** delete `src/entrypoints/mpm_run_cmd.py` + `tests/test_mpm_run_cmd.py`; revert
  the one `run` branch + import in `mpm.py`. `list`/`register` (Slice 1) keep working; the P3
  worker/service are untouched.
