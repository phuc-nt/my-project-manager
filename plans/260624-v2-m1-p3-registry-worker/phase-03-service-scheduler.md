# Phase 3 — Coordinating service daemon + scheduler (D1)

> Status: DONE (05b5ef1). Slice 3 of [plan.md](plan.md). Depends on Slices 1 + 2. Delivers the long-running
> coordinating service that reads `registry.yaml`, reads each profile's `schedule:`, and on a
> schedule spawns + supervises per-agent worker subprocesses — replacing v1's global launchd
> plists. Additive: no existing source file changes (only `deploy/launchd/`). After this slice
> N agents run on a schedule, isolated, supervised.

## Context (verified file:line)

- **Slice 2 worker (spawn target):** `python -m src.runtime.worker --agent-id <id> --report
  <kind> [--audience ...] [--dry-run]`; exit codes 0/1/2; writes `runs.jsonl`
  (`src/runtime/worker.py`, `run_event.py`).
- **Slice 2 registry:** `load_registry(path)` → `tuple[RegistryEntry(id, enabled)]`
  (`src/runtime/registry.py`).
- **Schedule source (P2 parsed-but-unused):** `LoadedProfile.schedule: dict[str, str]`
  (`src/profile/loader.py:50`, coerced to `str` at `:93-94` from `yaml_doc["schedule"]`). P2
  parsed it, M1 entrypoints ignored it — **P3 consumes it** (decision #7, D1). The string
  FORMAT is RESOLVED: a standard 5-field **cron** expression per kind (e.g. `daily: "0 8 * *
  *"`), parsed by `croniter` (Contract 4 in plan.md). Cron strings flow through
  `LoadedProfile.schedule: dict[str, str]` unchanged — **NO loader change** for P3.
- **`load_profile(id)` per agent** gives the service each agent's `schedule` +
  (decision) which report kinds to run. Reports to run per agent: `LoadedProfile.reports`
  (`loader.py:51`) — the kind gate, also P2 parsed-but-unused.
- **v1 launchd (D1 replaces):** `deploy/launchd/{com.mpm.report.daily.plist,
  com.mpm.report.weekly.plist, com.mpm.report.resource.plist, run-report.sh}` — three
  per-report jobs. D1 ships ONE service plist; the three legacy per-report plists are marked
  legacy (not deleted in P3).
- **No `src/runtime/service.py` / `scheduler.py` today** (verified).

## Requirements

1. `src/runtime/scheduler.py` — pure due-check: given a `schedule` (kind → 5-field cron str)
   + the `reports` gate + an injected `now: datetime` + a `last_fire` map (per `(agent,kind)`,
   seeded to "now" at startup), return the list of `(kind, audience)` DUE this tick. For each
   `(kind, cron)` where `kind` is also in `reports`, compute
   `croniter(cron, base=last_fire[(agent,kind)]).get_next(datetime)`; if `<= now` it is due.
   Audience is always `internal`. NO I/O, NO sleep, NO real wall-clock — fully deterministic
   under a fixed injected `now`. Uses `croniter` (added via `uv add croniter` in this slice).
2. `src/runtime/service.py` — the daemon:
   - In-memory `last_fire: dict[(agent_id, kind), datetime]`, **seeded to "now" at startup**
     so a freshly-started daemon does NOT back-fire every past cron occurrence.
   - `run_forever(interval=60)` — loop: each tick, `run_tick(now())`; sleep `interval`. (The
     loop is thin; all logic is in `run_tick`.)
   - `run_tick(now, *, spawn=<real subprocess spawn>)` — read registry; for each agent that
     passes **BOTH enabled gates** (`registry.enabled` AND `profile.enabled`), `load_profile(id)`,
     compute due `(kind, "internal")` via `scheduler.due_reports(schedule, reports, now,
     last_fire)`, and for each due item call `spawn(argv)` where `argv =
     ["python","-m","src.runtime.worker","--agent-id",id,"--report",kind,"--audience","internal"]`,
     then set `last_fire[(id,kind)] = now`. Respect the concurrency **CAP = 4** simultaneous
     workers (excess queues to the next tick). Supervise each spawn with a **600s TIMEOUT**
     (kill + record `status=timeout` run-event). On a worker CRASH (non-zero exit), record the
     failed run-event and wait for the NEXT tick (no same-tick retry). Collect each worker's
     exit code + its last `runs.jsonl` line.
   - `--once` mode: run exactly ONE `run_tick` and exit (deterministic test + manual trigger).
   - `spawn` is an INJECTABLE param (default = `subprocess.Popen`-based) so tests pass a fake
     and assert the EXACT argv WITHOUT launching a process.
3. `deploy/launchd/com.mpm.service.plist` — launches `python -m src.runtime.service`
   (`KeepAlive=true` + `RunAtLoad=true` so macOS starts it at load and restarts it on crash),
   replacing the 3 per-report plists. The deploy note instructs the operator to **manually
   unload** the 3 legacy `com.mpm.report.*.plist` jobs to avoid double-scheduling — the code
   only MARKS them legacy; it does NOT call `launchctl`.

## Files to create

- `src/runtime/scheduler.py` — `due_reports(schedule, reports, now, last_fire) ->
  list[tuple[str, str]]`. Pure cron due-check (croniter). ~60 LOC. (Audience: **internal only
  (resolved)** — the scheduler fires `--audience internal`; external is manual / P4, decision #7.)
- `src/runtime/service.py` — the daemon. Keep ≤ 200 LOC; if it nears the gate, the timeout +
  exit-code collection can move to a `_supervise(spawn, argv, timeout)` helper. `main(argv)`
  handles `--once` / `--interval`. `if __name__ == "__main__": raise SystemExit(main())`.
- `deploy/launchd/com.mpm.service.plist` — one job, `ProgramArguments` =
  `[".../python","-m","src.runtime.service"]`, `KeepAlive=true`, `RunAtLoad=true`,
  `StandardOut/ErrorPath` to a log. Model on the existing `com.mpm.report.daily.plist`.
- `tests/test_scheduler.py` — pure due-check tests (fixed clock).
- `tests/test_service.py` — `run_tick` with a FAKE spawn (asserts argv, no real process).

## Files to modify

- `deploy/launchd/` — add a one-line note (a `LEGACY.md` or a comment in `run-report.sh`)
  stating the 3 per-report plists are superseded by `com.mpm.service.plist`. **Do NOT delete**
  them in P3 (a user may still have them loaded; unloading is a deploy step, not a code
  change). Disposition only.

## Scheduler format + the tick → next-fire algorithm (RESOLVED)

**Format = standard 5-field cron per report kind** (decision baked in plan.md Contract 4).
`profile.yaml schedule:` is a map of report kind → cron string:

```yaml
schedule:
  daily: "0 8 * * *"      # every day at 08:00 local
  weekly: "0 17 * * 5"    # Fridays at 17:00
  okr: "0 9 * * 1"        # Mondays at 09:00
```

**Parser = `croniter`**, added via `uv add croniter` in THIS slice (it is NOT a dep today;
verified `pyproject.toml` has no cron lib). The cron strings flow through
`LoadedProfile.schedule: dict[str, str]` unchanged (`loader.py:93-94` already coerces values
to `str`) — **NO loader change** for P3.

**The tick → next-fire algorithm** (mirrors plan.md "The tick → next-fire algorithm"):

- The service holds an in-memory `last_fire: dict[(agent_id, kind), datetime]`, **seeded to
  "now" at startup** so a freshly-started daemon does NOT back-fire every past occurrence.
- On each tick with wall-clock `now`: for each agent passing **BOTH enabled gates**
  (`registry.enabled` AND `profile.enabled`), for each `(kind, cron)` in its `schedule` where
  `kind` is also in the agent's `reports` gate, compute
  `croniter(cron, base=last_fire[(agent,kind)]).get_next(datetime)`.
- If that next-fire `<= now`, the pair is **DUE** → spawn
  `worker --agent-id <id> --report <kind> --audience internal`, then set
  `last_fire[(agent,kind)] = now`.
- The due-check is a **PURE** function taking an injected `now` + the `last_fire` map →
  returns the list of `(agent_id, kind)` (or `(kind, "internal")` per agent) to fire. A test
  passes a fixed `now` + a seeded `last_fire` and asserts EXACTLY which fire — no dependence
  on real wall-clock time.

**Audience = internal only** (resolved). The scheduler fires `--audience internal`; external
(always Lớp B ⇒ pending approval) is manual / P4.

**`reports` gate:** a `schedule` entry for a kind NOT in the agent's `reports` list is ignored
— the fired set is `schedule.keys()` ∩ `reports`. An agent runs only kinds it both schedules
AND is allowed to run.

## Implementation steps

0. `uv add croniter` — adds the cron parser to `pyproject.toml` (NEW dep in this slice; the
   only new dependency P3 introduces).
1. `scheduler.py`: `due_reports(schedule, reports, now, last_fire)` — for each `(kind, cron)`
   in `schedule` where `kind in reports`, compute
   `croniter(cron, base=last_fire[(agent,kind)]).get_next(datetime)`; if `<= now`, include
   `(kind, "internal")`. Return the due list. PURE; `now` (datetime) + `last_fire` injected.
2. `service.py`:
   - At startup: seed `last_fire[(agent,kind)] = now()` for every scheduled pair (no back-fire).
   - `run_tick(now, spawn, *, timeout=600, cap=4)`: `entries = load_registry()`; for each
     entry passing BOTH gates (`entry.enabled` AND `load_profile(entry.id).enabled`): `loaded =
     load_profile(e.id)`; `due = due_reports(loaded.schedule, loaded.reports, now, last_fire)`;
     for each `(kind, "internal")` in `due` (respecting `cap=4`): `argv = [...,"--audience",
     "internal"]`; `outcome = _supervise(spawn, argv, timeout=600)`; record outcome + set
     `last_fire[(e.id,kind)] = now`. Overflow beyond `cap` ⇒ defer to the next tick (a simple
     queue). On worker crash (non-zero exit) ⇒ record the failed run-event, wait for next tick.
   - `_supervise(spawn, argv, timeout=600)`: call `spawn(argv)`; wait up to `timeout`; on
     timeout kill + `status="timeout"`; else read exit code + the agent's last `runs.jsonl` line.
   - `run_forever(interval=60)`: loop `run_tick(now())` then sleep `interval`. (Untested as a
     loop — only `run_tick` is unit-tested; the loop is a thin wrapper.)
   - `main(argv)`: `--once` ⇒ one `run_tick(now())`; else `run_forever`.
3. `com.mpm.service.plist`: model on `com.mpm.report.daily.plist`; `KeepAlive`; one job.
4. `deploy/launchd/` disposition note.
5. Tests (below). Focused, then full suite + ruff.

## Tests / validation

`tests/test_scheduler.py` (pure, INJECTED `now: datetime` + seeded `last_fire` — acceptance 9 core):

- `schedule: {daily: "0 8 * * *"}`, `reports: ("daily",)`, `last_fire[(a,"daily")]` = a base
  before 08:00, `now` = 08:00:00 ⇒ next-fire `<= now` ⇒ `[("daily","internal")]`.
- same with `now` = 07:59 (just before the cron fire) ⇒ `[]` (not yet due).
- `last_fire` set so the next croniter fire is in the future relative to `now` (already fired
  this period) ⇒ `[]` (no double-fire within a period).
- a kind in `schedule` but NOT in a non-empty `reports` (e.g. `weekly` in schedule, `reports:
  ("daily",)`) ⇒ excluded (the `reports` gate).
- weekday cron: `weekly: "0 17 * * 5"` (Friday) with a `now` on a Tuesday and a `last_fire`
  after last Friday ⇒ `[]` (next fire is a future Friday).
- audience is ALWAYS `internal` in every emitted tuple.

`tests/test_service.py` (FAKE spawn + injected `now` — acceptance 9, NO real subprocess, NO real loop):

- two registry entries (`acme-web` enabled, `beta-app` enabled), both `profile.enabled: true`,
  both `schedule: {daily: "0 8 * * *"}`, `reports: ("daily",)`; `run_tick(now=<08:00 datetime>,
  spawn=fake)` with `last_fire` seeded before 08:00 ⇒ the fake was called TWICE with argv
  `["python","-m","src.runtime.worker","--agent-id","acme-web","--report","daily",
  "--audience","internal"]` and the `beta-app` equivalent. Assert EXACT argv per call.
- BOTH-gates skip: `registry.enabled: false` OR `profile.enabled: false` ⇒ that agent is NOT
  spawned (assert the fake never got that id) — one test per gate.
- concurrency cap = 4: with 5 due agents, only 4 spawn this tick; the 5th is deferred to the
  next `run_tick`.
- timeout path: fake spawn returns a stub that "never finishes" ⇒ `_supervise` records
  `status="timeout"` (600s constant, monkeypatched small in the test) and does not hang
  (assert it returns within the test timeout).
- worker crash: fake spawn returns exit 1 ⇒ the failed run-event is recorded and NO same-tick
  re-spawn (assert the fake was called once for that pair).
- exit-code + run-event collection: fake spawn writes a `runs.jsonl` line + returns exit 0 ⇒
  the tick's collected outcome carries `delivered`/`cost_usd` from that line.
- `--once` runs EXACTLY one `run_tick` and exits (assert one tick, no loop).

Shell validation:
```
uv run pytest tests/test_scheduler.py tests/test_service.py -q
uv run python -m src.runtime.service --once   # one tick against the real registry (default
                                              # agent); spawns a real worker only if `default`
                                              # has a due schedule entry — keep `default`'s
                                              # schedule empty in registry/profile to make this
                                              # a safe no-op smoke.
uv run ruff check src/runtime tests/test_scheduler.py tests/test_service.py
uv run pytest -q   # full suite green
plutil -lint deploy/launchd/com.mpm.service.plist   # plist is well-formed
```

## Acceptance (slice)

- `run_tick(now, spawn=fake)` reads the registry, computes due `(kind, audience)` per each
  `enabled` agent's `schedule`, and calls `spawn` with the EXACT worker argv per due item;
  `enabled:false` agents are skipped. (acceptance 9 — no real subprocess.)
- `due_reports` is pure + deterministic under a fixed clock; no double-fire within a period;
  weekday + reports gates honored.
- Concurrency cap defers overflow to the next tick; a hung worker hits the timeout (no hang).
- `--once` runs exactly one tick and exits; `com.mpm.service.plist` lints; the 3 per-report
  plists are marked legacy (not deleted).
- All new `src/runtime/*` ≤ 200 LOC; ruff clean; full suite green.

## Risks / rollback

- **Risk: the daemon loop makes tests flaky / hang.** → Only `run_tick` is unit-tested, with
  an injected fake spawn + a fixed clock; `run_forever` is a thin untested wrapper. `--once`
  gives a deterministic single tick for the smoke. No test sleeps or waits on a real loop.
- **Risk: a real worker subprocess is spawned in a test.** → `spawn` is injectable; tests pass
  a fake that records argv and returns a stub. A real process is launched only by the manual
  `--once` smoke, kept a no-op by leaving `default`'s schedule empty.
- **Risk: schedule format churn / over-engineering.** → RESOLVED: standard 5-field cron via
  `croniter` (added `uv add croniter` in this slice; a small, well-tested dep). The due-check
  is a PURE function over an injected `now` + `last_fire`, fully unit-tested with a fixed
  `now` — no real wall-clock, no flaky timing.
- **Risk: a hung worker blocks the tick forever.** → `_supervise` enforces a per-worker
  timeout (kill + `status=timeout`). Tested.
- **Risk: two ticks double-fire the same report.** → `last_fire[(agent,kind)]` is advanced to
  `now` on each fire and used as croniter's `base`, so the next-fire moves into the future ⇒ no
  re-fire within a period; tested (already-fired-this-period ⇒ `[]`). The worker's dedup store
  is the second line of defense (same `dedup_hint` won't write twice).
- **Risk: macOS user still has the 3 per-report plists loaded ⇒ double scheduling.** → P3
  ships the service plist + a disposition note; UNLOADING the old plists is a deploy step
  (documented), not auto-done by code. Flagged in open questions / deployment.
- **Rollback:** delete `src/runtime/{service,scheduler}.py`, the new plist, the 2 test files;
  revert the `deploy/launchd/` note. Zero impact on Slices 1-2 or the entrypoints. The service
  is purely additive — without it, the worker still runs on-demand (Slice 2) and `cli`/`cron`
  still run single-agent.

## Open questions

**None blocking — resolved in plan.md.** The 5 prior questions are decided and baked into the
plan (schedule format = cron via `croniter`; timeout = 600s; cap = 4; audience = internal only;
daemon = one `com.mpm.service.plist`, `KeepAlive`+`RunAtLoad`, operator manually unloads the 3
legacy per-report plists). The `reports` ∩ `schedule` gate and the BOTH-enabled precedence are
likewise fixed. See plan.md "Open questions", "Contract 4", "The tick → next-fire algorithm",
and "Enabled precedence".

Non-blocking note (carried, decide at impl): on a worker CRASH the service records the failed
run-event and waits for the NEXT tick (no same-tick retry) — simplest, avoids tight-loop
retries; revisit only if a transient-failure retry proves needed.
