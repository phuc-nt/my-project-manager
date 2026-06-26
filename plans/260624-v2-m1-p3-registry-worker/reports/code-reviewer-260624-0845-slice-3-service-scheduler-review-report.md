# Slice 3 Review — Coordinating Service Daemon + croniter Scheduler (v2 M1-P3 D1)

Date: 2026-06-24
Reviewer: code-reviewer
Scope: working-tree changes only (no commit). Code NOT modified.

## Scope

Files in this slice:
- NEW `src/runtime/scheduler.py` (47 LOC)
- NEW `src/runtime/service.py` (152 LOC)
- NEW `deploy/launchd/com.mpm.service.plist`
- MODIFIED `deploy/launchd/run-report.sh` (legacy disposition comment only, +8 lines)
- MODIFIED `pyproject.toml` (+`croniter>=6.2.2`), `uv.lock` (croniter 6.2.2 resolved)
- NEW `tests/test_scheduler.py` (9 tests), `tests/test_service.py` (7 tests)

Gates (all green, verified):
- `uv run pytest -q` → **378 passed in 0.56s**
- `uv run ruff check src/runtime tests/test_scheduler.py tests/test_service.py` → All checks passed
- LOC: service 152, scheduler 47 (both <200)
- `plutil -lint com.mpm.service.plist` → OK
- `git status` confirms NO file outside `src/runtime/`, `deploy/launchd/`, `pyproject.toml`, `uv.lock`, tests, plans/ was touched. cli/cron/loader/worker UNCHANGED.

## Overall Assessment

Clean, well-scoped, additive slice. The scheduling core (`due_reports`) is genuinely pure and the tests have real discriminating power. The concurrency-cap-defers-no-drop and starvation-avoidance properties hold under empirical trace. All 6 acceptance items and the 3 special-scrutiny judgments verified. One **stale comment** is the only concrete defect; the unvalidated-id-into-Popen item is a real-but-low-severity hardening gap given list-form argv. No blockers.

## Acceptance Verification

### 1. due_reports is PURE + correct — PASS
- No I/O, no `datetime.now`, no sleep. `now` and `last_fire` fully injected (scheduler.py:21-26). croniter base is `last_fire.get(kind)` (`:39`), so a kind that fired this period has its next `get_next` in the future ⇒ `[]` (no re-fire). Verified empirically: base=08:00 ⇒ next fire 2026-06-25 08:00 > now ⇒ not due.
- Reports gate: `if reports and kind not in reports` (`:37`) — empty `reports` = no gate (test_empty_reports_gate_allows_all_scheduled confirms). Non-empty gate excludes unlisted kinds (test_reports_gate).
- Weekday cron correct: `0 17 * * 5` on a Wednesday ⇒ next fire future Friday ⇒ `[]` (test_weekday_cron_not_due_on_wrong_day).
- Malformed cron: `croniter.is_valid(cron)` guard (`:42`) → skip not crash. Verified `is_valid("not a cron")` returns False.
- Unseeded kind: `base is None` ⇒ skip (`:40-41`, test_unseeded_kind_is_skipped).
- **Discriminating power CONFIRMED**: with base=yesterday, next fire = today 08:00. `<= now(08:00)` is True (DUE) but `<= now(07:59)` is False (not due). If the `next_fire <= now` comparison at `:45` were inverted, test_due_when_cron_fired_since_last and test_not_due_just_before_cron_time would both flip and fail. These are not phantom tests.

### 2. run_tick isolation + exact argv — PASS
- Fully offline: `_patch` monkeypatches `service.load_registry` and `service.load_profile`; spawn is faked (`_FakeProc`, no real subprocess, no real loop). No MCP, no network.
- EXACT argv asserted (test_two_enabled_agents_both_spawn_exact_argv:65-68): `[sys.executable, "-m", "src.runtime.worker", "--agent-id", id, "--report", kind, "--audience", "internal"]`. Matches `_worker_argv` (service.py:44-48). Note it asserts `service.sys.executable` not literal `"python"` — correct, the plan text said "python" loosely but the implementation uses `sys.executable`, which is the right choice for venv correctness.
- BOTH-gates skip tested separately: registry.enabled=false (test_registry_disabled_agent_skipped) and profile.enabled=false (test_profile_disabled_agent_skipped). Both gates short-circuit before spawn (service.py:110-114).

### 3. Concurrency cap = 4 defers, does NOT drop — PASS
- Cap logic (service.py:117-128): inner `for` breaks when `spawned >= cap` WITHOUT advancing `last_fire` for the deferred kind (the `self._last_fire[...] = now` at `:125` is only reached for actually-spawned items). Outer `for` then breaks too (`:127-128`). The deferred item's last_fire stays at its OLD value, so its next croniter fire is still `<= now` next tick ⇒ still due.
- test_concurrency_cap_defers_overflow genuinely proves no-drop: 5 due agents → exactly 4 spawn tick1 (`len(record)==4 and len(out)==4`); tick2 (same `now`) → ag4 spawns (last_fire never advanced). This is a real no-drop proof, not a happy-path assertion.

### 4. Timeout + crash handling — PASS
- Timeout: `_supervise` (service.py:58-62) — `proc.wait(timeout)` raises `TimeoutExpired` ⇒ `proc.kill()` + return `{"status":"timeout","exit_code":None}`. Returns (no hang). test_timeout_kills_and_records_status asserts status=timeout, exit_code=None with timeout=1.
- Crash: exit 1 ⇒ outcome carries `exit_code=1` (`:64`), spawn called exactly once (test_worker_crash_no_same_tick_respawn asserts `len(record)==1`). No same-tick respawn — correct, the for-loop visits each due (kind) once.

### 5. last_fire seed prevents back-fire — PASS
- `_seed` (service.py:90-101) sets `last_fire.setdefault((agent,kind), now)` for every scheduled pair of a both-gates-enabled agent, then `self._seeded = True`. Guarded: `run_tick` calls `_seed` only `if not self._seeded` (`:105-106`). Auto-seeds on first tick.
- **Starvation-avoidance CONFIRMED empirically** (5 agents all on `* * * * *`, cap=4):
  - tick1 @08:00 = seed-tick → all 5 seeded to 08:00 → NOTHING due (`[]`).
  - tick2 @08:01 → all 5 due, cap picks ag0-3, advances their last_fire to 08:01. ag4 deferred (last_fire stays 08:00).
  - tick3 @08:01 (same minute) → ag0-3 next fire is 08:02 (not due); ag4 last_fire=08:00 still due ⇒ **ag4 spawns**.
  - Conclusion: the last_fire-advance on the first-4 makes them ineligible next tick, so the deferred tail gets serviced. **No permanent starvation** of the first-4-favoring iteration order. The cap is a per-tick throttle, not a drop.
- Minor note: in the always-due steady state, throughput is cap-bound (4 workers/tick). With >4 always-due agents and a 60s interval this is intended back-pressure, not a bug. The first tick after daemon start is a no-op fire (seed=now), which is the desired no-back-fire behavior.

### 6. Suite / lint / LOC / plist / dep / blast-radius — PASS
All verified above. croniter 6.2.2 added to pyproject + locked. plist runs `python -m src.runtime.service`, KeepAlive+RunAtLoad, logs to `.data/service.{log,err.log}`. run-report.sh legacy comment is disposition-only (no `launchctl` call in code).

## Special Scrutiny Judgments

### A. subprocess security — unvalidated registry id into Popen argv — LOW/MEDIUM (hardening)
The service builds argv with `entry.id` straight from `registry.yaml` and never calls `_validate_agent_id` before spawn. The only validation on the spawn path is inside `_last_run_event → agent_data_dir` (service.py:69), which runs AFTER the process is already launched.

- **No shell injection**: `_real_spawn` uses `subprocess.Popen(argv)` list-form, no `shell=True`. A malicious id like `"; rm -rf /"` becomes a single inert argv element. The worker re-validates via `agent_data_dir` (worker.py:99-102) and exits 2 on a bad id. So the worst realistic outcome is a wasted process spawn + a clean exit-2, not RCE or path escape.
- **Trust boundary**: `registry.yaml` is a committed, repo-root, operator-controlled file (no secrets, per registry.py header). It is not an untrusted external input in the current threat model. But `load_registry` deliberately does NOT enforce `_AGENT_ID_RE` (it only rejects empty/non-string ids), so the id reaching argv is weakly typed.
- **STALE COMMENT (concrete defect)**: service.py:41 `# noqa: S603 — argv is built from validated ids, not a shell`. The "built from validated ids" half is **false** — the service performs no id validation. The noqa suppression is still correct (list-form, no shell), but the justification misrepresents the code. A future reader will believe ids are validated when they are not.
- **Recommendation**: (a) fix the comment to state the real reason ("list-form argv, no shell; the worker re-validates the id"); and/or (b) cheaply harden by validating `entry.id` once before the spawn loop (or fold `_validate_agent_id` into `load_registry` so every consumer gets a safe id). Option (b) is the more robust fix — it closes the gap that the comment already (incorrectly) claims is closed, and centralizes the invariant. Severity LOW today (operator-controlled file, list argv, worker re-validates); raise to MEDIUM if registry.yaml ever becomes writable by a less-trusted path.

### B. real-spawn path untested (only the fake is) — ACCEPTABLE
`_real_spawn` and `run_forever` are `# pragma: no cover`. This is the correct unit/integration boundary: a real subprocess + a real daemon loop are timing- and environment-dependent and would make the fast suite flaky. The reviewer's separate manual end-to-end smoke (service → real worker → real dry-run report → delivered run-event, exit 0) is the right place to prove the real path. No guarded integration test is warranted in the fast suite. If desired later, a single opt-in (env-gated) integration test that spawns one real no-op worker would add value, but it is not a gap for this slice.

### C. run_forever no graceful shutdown / signal handling — LOW (acceptable)
`run_forever` is `while True: run_tick(now); sleep(interval)` with no signal handler. For a KeepAlive launchd daemon this is acceptable — launchd sends SIGTERM and the process dies between ticks (sleep is interruptible). Risk surface:
- A worker spawned mid-tick when the service is SIGTERM'd: the service dies but the child worker is NOT killed (no process-group teardown), so the in-flight worker keeps running to completion and writes its run-event — which is actually the desired outcome (no half-written report; the worker is idempotent via dedup). On restart, the seed-tick prevents back-fire.
- The in-memory `last_fire` map is lost on restart and re-seeded to "now". Consequence: a report that was due-but-deferred-by-cap right before a restart is forgotten until its next cron occurrence. This is a minor, acceptable liveness gap for a best-effort scheduler (the worker's dedup store and the next cron tick are the safety nets). Not worth persisting last_fire for M1.

No action required for C.

## Critical Issues
None.

## High Priority
None.

## Medium Priority
1. **Stale/misleading noqa justification** — `src/runtime/service.py:41`. The comment claims "argv is built from validated ids" but the service never validates ids. Fix the comment, and preferably add a one-line id validation before spawn (or centralize in `load_registry`). See Special Scrutiny A.

## Low Priority
1. **Defense-in-depth**: consider folding `_validate_agent_id` into `load_registry` so all consumers (service spawn, future callers) get a guaranteed-safe id, making the `agent_data_dir` re-validation a true second line of defense rather than the first. (registry.py:59-63)
2. **`run_forever` uses `datetime.now(UTC)`** while cron strings are documented as "local time" (plist comment + phase doc say "every day at 08:00 local"). croniter on a UTC `now` + a local-intended cron will fire at 08:00 UTC, not 08:00 local. Verify the intended timezone: if profiles mean local wall-clock, `run_forever` should use `datetime.now()` (naive local) to match the test fixtures (which are naive local) and the documented intent. The unit tests pass naive local datetimes, so the tested path is local; only the untested `run_forever` injects UTC — a latent prod/test divergence. **Flag for confirmation.**

## Edge Cases Checked
- Empty `reports` tuple → no gate (intended, tested).
- Empty `schedule` → `due_reports` returns `[]`, `_seed` adds nothing, no spawn (test_once uses this for a safe no-op).
- Unseeded kind mid-run (kind added to schedule after seed) → `per_kind` dict omits it (service.py:115-116), `due_reports` skips (base None). It gets seeded on the NEXT `_seed`… but `_seed` only runs once (`_seeded` guard). So a kind added to a profile while the daemon is running is never seeded ⇒ never fires until restart. **Latent, low severity** — schedule changes require a daemon restart (KeepAlive makes this a `launchctl kickstart`). Acceptable for M1; worth a doc note.
- Duplicate ids: blocked at `load_registry` (registry.py:60-61). Good.

## Positive Observations (risk-calibration)
- The cap break is correctly two-level (inner + outer), and the last_fire advance is correctly gated to spawned items only — the single most error-prone line in the slice is right.
- Tests assert exact argv and exact deferral identity (ag4), not just counts — real behavioral proof.
- `_last_run_event` defensively handles missing file / empty / malformed JSON (service.py:67-78) without throwing into the tick loop.

## Metrics
- Type coverage: full annotations on public fns; `dict` return on `_supervise`/`_last_run_event` is loosely typed (acceptable for internal outcome bags).
- Test coverage: scheduler core + run_tick branches covered; real-spawn/loop intentionally `no cover`.
- Linting: 0 issues.
- Suite: 378 passed.

## Unresolved Questions
1. **Timezone intent** (Low #2): do profile cron strings mean local wall-clock or UTC? `run_forever` injects `datetime.now(UTC)`; tests + docs imply local. Confirm and align `run_forever` to avoid an 8-hour fire offset in prod (latent, untested path).
2. **Should `load_registry` enforce `_AGENT_ID_RE`?** (Special Scrutiny A / Low #1). Product decision: keep validation only at `agent_data_dir` (current, comment is wrong), or centralize at load (closes the spawn-argv gap and makes the comment true).
