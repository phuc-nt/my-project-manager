---
title: "v2 M1-P3 — Registry + worker + per-agent isolation + coordinating service"
description: "Run N agents / N projects fully isolated. Slice 1 lands the isolation core: per-agent data dir .data/agents/<id>/ + once-only v1 auto-migrate + agent-prefixed thread_id (provable with 2 agents, no service). Slice 2 adds registry.yaml + a real-subprocess worker (python -m src.runtime.worker) that loads one profile, sets the per-agent data dir, runs one report, writes a runs.jsonl event, exits with a status code. Slice 3 adds the coordinating daemon: reads the registry + each profile's schedule, spawns/supervises worker subprocesses, collects exit codes + run-events. Guardrail chain PRESERVED, only per-agent-ized. BREAKING (thread_id + data-dir move) accepted; default + auto-migrate = safe v1 path."
status: pending
priority: P1
effort: 13h
branch: main
tags: [v2, m1, p3, registry, worker, coordinating-service, per-agent-isolation, scheduler, run-event-log, subprocess, daemon, breaking]
created: 2026-06-24
---

# v2 M1-P3 — Registry + worker + per-agent isolation + coordinating service

v1/v2-through-P2 run ONE agent against ONE global `.data/`. P3 runs **N agents / N
projects, fully isolated**, via three new pieces: a `registry.yaml` listing agents, a
**per-agent worker** (`python -m src.runtime.worker --agent-id <id>`, one OS process per
agent), and a **coordinating service daemon** (`src/runtime/service.py`) with an internal
scheduler that reads each profile's `schedule:` and spawns workers. Isolation is the
headline: agent A's budget/audit/dedup/approvals/checkpoints never touch agent B's.

This builds directly on P1 (config-injection: `data_dir` is an injectable `Settings`
field) and P2 (the profile loader: `load_profile` builds `Settings`/`ReportingConfig` from
`profiles/<id>/`). The guardrail chain (Lớp A/B + audit + budget + dedup) is **preserved**,
only per-agent-ized via `data_dir`; `classify()` / `needs_interrupt()` are unchanged.

## The crux — per-agent `data_dir` override (load-bearing)

**Per-agent isolation FALLS OUT of one value: `settings.data_dir`.** Every store already
keys off it (verified):

- `ActionGateway.__init__` (`src/actions/action_gateway.py:124-127`) builds `audit/audit.jsonl`,
  `dedup.db`, `approvals.db` from `self._settings.data_dir` — the inline comment at
  `:122` already says "per-agent in v2".
- `BudgetTracker` (`src/llm/budget_tracker.py:39`) → `self._settings.data_dir / "budget"`.
- Checkpointer path is `settings.data_dir / "checkpoints.db"` (`cli.py:26`, `cron.py:54`,
  passed to `get_checkpointer(db_path)` at `src/agent/checkpoint.py:24`).

So P3's whole job for isolation is: **set `settings.data_dir = .data/agents/<id>/`** before
building the graph + gateway. Today `load_profile` hard-codes the global `DATA_DIR`:

```
# src/profile/loader.py:88
settings = build_settings_from_dict(build_settings_dict(yaml_doc, DATA_DIR))
```

**Decision (KISS, minimal blast radius): add a keyword param `data_dir: Path | None = None`
to `load_profile`.** When `None` (every P2 caller, every existing test) it keeps `DATA_DIR`
— byte-identical to P2. When set, it threads through to `build_settings_dict(yaml_doc,
data_dir)` (`loader_mapping.py:69` already takes the param). The worker computes
`.data/agents/<id>/` and passes it. No post-load mutation (Settings is `@dataclass(frozen=True)`),
no second naming scheme, no new env var. This is the ONE change that makes isolation real;
Slice 1 owns it and proves it with two agents writing to two dirs.

## Confirmed decisions (do NOT re-litigate — baked into this plan)

1. **Coordinating service = persistent daemon + internal scheduler.** `src/runtime/service.py`
   is long-running: reads `registry.yaml`, and on a schedule read from each profile's
   `schedule:` field, spawns workers. (User explicitly chose the full-architecture daemon
   over an on-demand runner.) Slice 3.
2. **Worker = real subprocess, 1 OS process per agent.** The service spawns
   `python -m src.runtime.worker --agent-id <id> --report <kind> [--audience ...]` as a
   child. Strong isolation (one agent's crash can't take down others). The worker loads ONE
   profile, sets the per-agent `data_dir`, builds the graph + per-agent `ActionGateway` +
   per-agent stores, runs one report, writes a `runs.jsonl` event, exits with a status code.
   Slice 2.
3. **Per-agent data dir = `.data/agents/<id>/` for ALL agents incl. `default`.** Every store
   (checkpoints.db, audit/, budget/, dedup.db, approvals.db) lives under the agent's dir.
   The injectable `data_dir` (P1) is set to `.data/agents/<id>/` by the worker. See
   [the data-dir contract](#contract-1--per-agent-data-dir).
4. **Auto-migrate v1 `.data/` ONCE, idempotently.** When `.data/agents/default/` does NOT
   exist AND a legacy top-level store exists, MOVE the known v1 stores into
   `.data/agents/default/`. Preserves real v1 dedup/budget/audit history (there IS live data
   from P1/P2 E2E). Slice 1. See [the migration contract](#contract-3--once-only-v1-auto-migration).
5. **thread_id = `<agent_id>:<kind>:<audience>`** (NO date). Replaces v1 flat ids
   (`cli.py:69`="cli", `cli.py:103`="report-{kind}-{audience}", `cron.py:104`="cron-{kind}-{audience}").
   One stable thread per (agent,kind,audience) so checkpoint resume works; date omitted to
   avoid unbounded thread growth. See [the thread_id contract](#contract-2--thread_id).
6. **`registry.yaml` at repo root, committed.** `agents: [{id, enabled}]`; path = `profiles/<id>/`.
   Modeled on OpenClaw `openclaw.json` agents.list[]. It holds agent IDs + `enabled` bools only
   (no secrets), so it is **safe to commit**; it ships ONE entry `{id: default, enabled: true}`.
   Verified NOT gitignored: it is a root file and the only `profiles`-related rule
   (`.gitignore:21` `profiles/*`) does not match a repo-root path (`git check-ignore
   registry.yaml` prints nothing). **`enabled` precedence (the master switch):** an agent runs
   only when BOTH `registry.enabled: true` AND its `profile.yaml enabled: true`. Registry is the
   master gate (cheap to flip without touching the profile); `profile.enabled` is the secondary
   gate (`LoadedProfile.enabled`, parsed at `loader.py:90`). `enabled: false` in EITHER ⇒ the
   service skips. Slice 2 ships the file + loader; Slice 3 consumes both gates.
7. **B1 Run-event log + D1 per-agent scheduler land here.** B1: each worker appends a
   `runs.jsonl` line (`{ts, agent_id, kind, audience, status, cost_usd, delivered}`) at
   `.data/agents/<id>/runs.jsonl`, next to that agent's audit. D1: the service reads
   `schedule:` from each `profile.yaml` (P2 parsed-but-unused on `LoadedProfile.schedule`)
   and triggers workers — replacing v1's global launchd plists (`deploy/launchd/*.plist`).
   **Schedule format = real 5-field cron** (`croniter` dep — see
   [the schedule contract](#contract-4--schedule-format--croniter)). **The scheduler fires
   `--audience internal` only**; external (always Lớp B ⇒ pending approval, never auto-posted)
   is left to manual invocation / P4.
8. **Per-agent isolation acceptance (the headline matrix).** Two agents run; write to two
   separate data dirs; audit/budget/dedup/approvals do NOT mix; budget of A at 100% does NOT
   block B; Lớp B approval of A is NOT in B's queue; thread_id of A and B don't collide. See
   [Acceptance](#acceptance-criteria-whole-phase).
9. **BREAKING allowed** (thread_id changes, data dir moves). `default` profile + auto-migrate
   = the safe v1 migration path. **Mode = auto, commit per slice.**

## Load-bearing contracts

### Contract 1 — per-agent data dir

```
.data/agents/<agent_id>/
  checkpoints.db        # SqliteSaver, one file / agent (M1; Postgres = M2-P8)
  dedup.db              # idempotency reserve-before-execute
  approvals.db          # Lớp B queue (per-agent ⇒ A's approval not in B's queue)
  budget/budget-<YYYY-MM>.json   # per-agent monthly cap
  audit/audit.jsonl     # immutable audit, secret-redacted
  runs.jsonl            # B1 run-event log (NEW in P3)
```

- Computed by ONE helper `agent_data_dir(agent_id) -> Path` = `DATA_DIR / "agents" / agent_id`
  (Slice 1, in `src/runtime/agent_paths.py`). The worker passes it to `load_profile(..., data_dir=…)`.
- Applies to `default` too: `default` runs out of `.data/agents/default/` after migration.
- `.data/agents/` itself is gitignored (already covered by the existing `.data/` rule — verify).

### Contract 2 — thread_id

`thread_id = f"{agent_id}:{kind}:{audience}"` — e.g. `"acme-web:daily:internal"`,
`"beta-app:okr:external"`. Stable per (agent,kind,audience); checkpoint resume keys on it.
Built by ONE helper `agent_thread_id(agent_id, kind, audience) -> str` (Slice 1, in
`src/runtime/agent_paths.py`) so the worker and any future caller share one format. NO date
component (avoids unbounded checkpoint thread growth). The hello path keeps `"cli"` (not an
agent flow).

### Contract 3 — once-only v1 auto-migration

`migrate_legacy_data_dir()` (Slice 1, `src/runtime/legacy_migration.py`):

- **Guard (idempotent):** run ONLY when `.data/agents/default/` does NOT yet exist.
- **Trigger:** at least one legacy top-level store exists in `.data/`.
- **Action:** for each known store name present at `.data/<name>`, MOVE it to
  `.data/agents/default/<name>`. Exact set (verified to exist today): `audit/` (dir),
  `budget/` (dir), `checkpoints.db`, `dedup.db`, `approvals.db`. Move dirs whole.
- **Never touch** `.data/agents/` (the new tree) and never any name outside that known set
  (so an unrelated file at `.data/` is left alone).
- **Per-target safety:** move a given store only if the target `.data/agents/default/<name>`
  is ABSENT (so a half-run never clobbers). Log each move at INFO.
- **WHERE it runs:** called by `agent_data_dir("default")`'s first use AND at worker startup
  via a shared one-shot guard — concretely, the worker calls `migrate_legacy_data_dir()` once
  at startup BEFORE computing its data dir; it is a no-op for non-default agents and after the
  first migration. Slice 1 wires it into the worker-less helper path + a unit test; Slice 2's
  worker calls it at startup. (Keeping it in one function called from one place avoids two
  migration code paths.)

### Contract 4 — schedule format + croniter

`profile.yaml schedule:` is a map of **report kind → standard 5-field cron string**:

```yaml
schedule:
  daily: "0 8 * * *"      # every day at 08:00 local
  weekly: "0 17 * * 5"    # Fridays at 17:00
  okr: "0 9 * * 1"        # Mondays at 09:00
```

- **Parser = `croniter`** (added via `uv add croniter` in Slice 3 — it is NOT a dep today;
  `pyproject.toml` currently has no cron lib). `croniter` computes the next-fire datetime for
  each `(agent, kind)` cron expr.
- **The service ticks on wall clock** (default every 60s) and fires any `(agent, kind)` whose
  croniter next-fire has passed since the last tick for that pair. See
  [the tick algorithm](#the-tick--next-fire-algorithm).
- `loader.py:93-95` already coerces every schedule value to `str`, so a cron string flows
  through `LoadedProfile.schedule: dict[str, str]` unchanged — NO loader change for P3.
- **`profiles/default/profile.yaml:52` ships `schedule: {}` (empty) — KEEP it empty.** The
  default agent is therefore NOT auto-scheduled until the user fills it; the service simply
  skips any agent whose `schedule` is empty. (Also keeps `--once` a safe no-op smoke.)
- **Audience: internal only.** The scheduler fires `--audience internal` reports; external is
  manual / P4 (decision #7).

### The tick → next-fire algorithm

The service holds an in-memory `last_fire: dict[(agent_id, kind), datetime]` (seeded at
startup to "now" so a freshly-started daemon does not back-fire every past occurrence). On each
tick with wall-clock `now`: for each `enabled` agent (both gates), for each `(kind, cron)` in
its `schedule` where `kind` is also in the agent's `reports` gate, compute
`croniter(cron, base=last_fire[(agent,kind)]).get_next(datetime)`; if that next-fire `<= now`,
the pair is DUE — spawn `worker --agent-id <id> --report <kind> --audience internal`, then set
`last_fire[(agent,kind)] = now`. The due-check is factored into a **pure** function that takes
an injected `now` (and the `last_fire` map) so a test passes a fixed `now` and asserts exactly
which `(agent, kind)` fire — no dependence on real wall-clock time (see phase-03 tests).

## Slices (ordered, each independently testable + committable)

| # | Slice | Phase file | Status | Commit | Depends on |
|---|-------|-----------|--------|--------|-----------|
| 1 | **Isolation core (no service).** `src/runtime/agent_paths.py` (`agent_data_dir`, `agent_thread_id`) + `src/runtime/legacy_migration.py` (once-only v1 migrate). Add `data_dir: Path \| None = None` kwarg to `load_profile` (None ⇒ `DATA_DIR`, P2-identical). Re-point `cli.py`/`cron.py` thread_ids to `agent_thread_id(profile_id, kind, audience)`. **Provable NOW with 2 agents → 2 data dirs, no audit/budget/dedup/approval cross-contamination, no service.** | [phase-01-isolation-core.md](phase-01-isolation-core.md) | pending | — | P1, P2 (done) |
| 2 | **Registry + worker subprocess + B1 run-event log.** `registry.yaml` (root, committed) + `src/runtime/registry.py` (load + validate `agents:[{id,enabled}]`). `src/runtime/worker.py`: `python -m src.runtime.worker --agent-id <id> --report <kind> [--audience ...] [--dry-run]` — migrate-once, `load_profile(id, data_dir=agent_data_dir(id))`, build graph + per-agent gateway, run ONE report, append a `runs.jsonl` event, exit 0/1/2. `src/runtime/run_event.py` (B1 append). | [phase-02-registry-worker-runlog.md](phase-02-registry-worker-runlog.md) | pending | — | 1 |
| 3 | **Coordinating service daemon + scheduler (D1).** `src/runtime/service.py`: read registry, for each `enabled` agent read `profile.schedule`, on each due tick spawn a worker subprocess (injectable spawn fn), supervise (timeout + concurrency cap), collect exit code + last `runs.jsonl` line. `--once` mode runs exactly one scheduler tick (deterministic test). `src/runtime/scheduler.py` (due-check). `deploy/launchd/com.mpm.service.plist` launches the SERVICE (replaces the 3 per-report plists). | [phase-03-service-scheduler.md](phase-03-service-scheduler.md) | pending | — | 1, 2 |

**Dependency graph: 1 → 2 → 3.** Slice 1 is self-contained (paths + migration + the
`load_profile` kwarg + thread_id re-point) and proves isolation with two `load_profile`
calls at two tmp dirs — no subprocess, no daemon, fully unit-testable. Slice 2 adds the
registry + the worker entrypoint that USES Slice 1's helpers (a real subprocess, testable
in `--dry-run` against a tmp profile). Slice 3 adds the daemon that SPAWNS Slice 2's worker
(testable via an injected fake-spawn + `--once`). Each slice is green + valuable at commit:
after 1, isolation is real for anyone calling `load_profile(data_dir=…)`; after 2, a single
agent runs end-to-end via the worker CLI; after 3, the scheduler runs N agents.

## File ownership (no two slices touch the same source file)

| Slice | Creates | Modifies |
|-------|---------|----------|
| 1 | `src/runtime/__init__.py`, `src/runtime/agent_paths.py`, `src/runtime/legacy_migration.py`, `tests/test_agent_isolation.py`, `tests/test_legacy_migration.py` | `src/profile/loader.py` (add `data_dir` kwarg), `src/entrypoints/cli.py` (thread_id → `agent_thread_id`), `src/entrypoints/cron.py` (thread_id → `agent_thread_id`) |
| 2 | `registry.yaml`, `src/runtime/registry.py`, `src/runtime/worker.py`, `src/runtime/run_event.py`, `tests/test_registry.py`, `tests/test_worker.py`, `tests/test_run_event.py` | `.gitignore` (verify `.data/agents/` covered + add `runs.jsonl` note only if needed) |
| 3 | `src/runtime/service.py`, `src/runtime/scheduler.py`, `deploy/launchd/com.mpm.service.plist`, `tests/test_service.py`, `tests/test_scheduler.py` | `deploy/launchd/` (mark the 3 per-report plists legacy — see phase-03 disposition; do NOT delete in P3) |

No source file appears in two "Modifies" rows. `src/runtime/` is created across all three
slices but each owns distinct files. `cli.py`/`cron.py` are touched ONLY in Slice 1
(thread_id). `action_gateway.py`, `budget_tracker.py`, `checkpoint.py`, `loader_mapping.py`,
and `config_builders*.py` are **NOT modified** — P3 consumes them unchanged (isolation falls
out of `data_dir`).

## Entrypoint disposition (cron.py / cli.py vs the worker)

- **`cli.py`** stays the single-agent human CLI (hello + `report --profile`); P3 only swaps
  its thread_id to the agent-prefixed form (Slice 1). The multi-agent `mpm agent run` CLI is
  P4 — out of scope.
- **`cron.py`** becomes **legacy**: D1's service+scheduler replaces the global launchd target.
  P3 does NOT delete `cron.py` (it still works as a manual per-report runner and its thread_id
  is fixed in Slice 1) but the new scheduled path is the worker. The worker is essentially
  `cron.py`'s report path, per-agent (data dir + thread_id + run-event). Stated, not deleted —
  deletion/replacement of `cron.py` is a P4 cleanup once `mpm agent run` exists.

## Acceptance criteria (whole phase)

**The per-agent isolation matrix (#8 — the headline). Two agents A=`acme-web`, B=`beta-app`
(or `default` + one tmp test agent), each loaded with `data_dir=agent_data_dir(id)`:**

1. **Separate data dirs.** A's stores live under `.data/agents/acme-web/`, B's under
   `.data/agents/beta-app/`; the two dirs share no files. (Unit: two `load_profile(data_dir=…)`
   at two tmp dirs; assert each store path is under its own dir.)
2. **Audit does NOT mix.** A write executed via A's gateway writes ONLY A's `audit/audit.jsonl`;
   B's audit file is unchanged. (Unit: run one audited action through each gateway; assert
   line counts + content per file.)
3. **Dedup does NOT mix.** The same `dedup_hint` reserved by A does NOT dedup B (different
   `dedup.db`). (Unit: reserve in A, assert B's gateway still executes the same action.)
4. **Budget A at 100% does NOT block B.** Set A's `monthly_budget_usd` tiny and exhaust it so
   A's tracker raises `BudgetExceededError`; B's tracker (own `budget/`) still admits a call.
   (Unit: two `BudgetTracker`s at two data dirs; A raises, B does not.)
5. **Lớp B approval of A is NOT in B's queue.** Queue a Lớp B action in A; assert B's
   `ApprovalStore` (own `approvals.db`) has zero pending. (Unit.)
6. **thread_id of A and B don't collide.** `agent_thread_id("acme-web","daily","internal")`
   != `agent_thread_id("beta-app","daily","internal")`; both contain their agent_id. (Unit.)
7. **Once-only migration preserves v1 history.** Given a fake legacy `.data/` with the 5
   stores and no `.data/agents/default/`, `migrate_legacy_data_dir()` MOVES all 5 into
   `.data/agents/default/`; a second call is a no-op; an unrelated `.data/foo` is untouched.
   (Unit, Slice 1.)
8. **Worker runs one report + writes a run-event + exits with a status code.** `python -m
   src.runtime.worker --agent-id default --report daily --dry-run` (against a tmp profile, no
   network) exits 0, and `.data/agents/default/runs.jsonl` gains one JSON line with
   `{agent_id, kind, audience, status, cost_usd, delivered}`. A bad `--agent-id` exits non-zero
   (clean error, no traceback). (Slice 2.)
9. **Service spawns workers deterministically.** With an injected fake-spawn fn + `--once`,
   the service reads the registry, computes which `enabled` agents are due per their
   `schedule`, and calls the spawn fn with the EXACT argv
   `["python","-m","src.runtime.worker","--agent-id",id,"--report",kind,...]` for each due
   agent; `enabled:false` agents are skipped. (Slice 3 — no real subprocess in the test.)
10. **Full suite green + ruff clean + LOC gate.** `uv run pytest` passes (P2's ~317 + the new
    runtime tests); `uv run ruff check src tests` clean (line-length 100); every NEW `src/`
    file ≤ 200 LOC (split if a file would exceed). Pre-existing over-gate files are NOT
    introduced by P3 (P1/P2 precedent).

## Risks (phase-level; per-slice detail in phase files)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| `load_profile` `data_dir` override leaks across agents (shared/cached state) | L×H | `Settings` is `@dataclass(frozen=True)`; `load_profile` builds a FRESH `Settings` per call (no module cache after P1 killed the singletons). Worker = one OS process per agent ⇒ no in-process sharing at all. Unit test (acceptance 1) asserts two calls → two distinct data dirs; the two-process worker spawn makes leakage structurally impossible. |
| Migration data loss / double-run corrupts v1 history | L×H | Idempotent guard: run only when `.data/agents/default/` is absent; per-store target-absent check before each move; known-name allowlist (never `.data/agents`, never unknown files); MOVE (atomic rename on same filesystem) not copy-delete. Unit test covers: full move, second-call no-op, unrelated-file-untouched (acceptance 7). The real `.data/` is backed up by git-ignored history; a dry preview is logged. |
| thread_id change orphans v1 checkpoints (resume breaks) | M×L | BREAKING accepted (#9). v1 `report-daily-internal` thread becomes `default:daily:internal` after migration; the OLD checkpoint rows stay in the (migrated) `checkpoints.db` but under the old key — they are simply not resumed (a fresh run starts a new thread). No data loss, only a one-time non-resume. Stated in rollback; acceptance does not require resuming a v1 thread. |
| Subprocess test flakiness (real `python -m` spawn is slow/env-dependent) | M×M | The worker is testable WITHOUT network via `--dry-run` (DRY_RUN-equivalent: builds the graph against a tmp profile, gateway in dry-run, no MCP spawn) — assert exit code + the runs.jsonl line. The SERVICE never spawns a real subprocess in tests: inject a fake-spawn fn and assert the constructed argv (acceptance 9). A `--once` mode runs exactly one scheduler tick. No test waits on a real daemon loop. |
| Hung worker blocks the service forever | M×M | The service supervises each spawn with a **600s** per-worker timeout (kill + record `status=timeout` run-event). Tested via the fake-spawn returning a long-running stub + asserting the timeout path. |
| Scheduler triggers wrong / over-engineered | L×M | RESOLVED: standard 5-field cron via `croniter` (Contract 4); the due-check is a pure function over an injected `now` + `last_fire`, so `--once` + a fixed `now` make it deterministic. `croniter` is a small, well-tested dep added in Slice 3. |
| Concurrency: N agents = N processes (5 OK, 50 needs a pool) | L×M (M1) | M1 ships a fixed concurrency **cap = 4** simultaneous workers; over the cap, the service queues the spawn for the next tick. A real pool/queue is M2. |
| New `src/runtime/*` file exceeds 200 LOC | M×L | Split per the file-ownership table (paths / migration / registry / worker / run_event / service / scheduler are already separate files). The worker is the fattest — if it nears 200 LOC, extract the report-dispatch (mirrors `cron._build_graph`) into a helper. Checked per slice. |

## Rollback

Each slice reverts by reverting its diffs + deleting its created files. **Slice 1** is the
only one that changes existing behavior (thread_id + the `load_profile` kwarg); reverting it
restores v1 thread_ids and the global `DATA_DIR` (the kwarg defaults to `None` ⇒ `DATA_DIR`,
so even partial adoption is safe). The auto-migration is one-way data movement: a rollback of
the CODE does not un-move the data — but the migrated `.data/agents/default/` is exactly the
v1 stores, so reverting the code and pointing `DATA_DIR` back is a manual move-back if ever
needed (documented; not expected). **Slices 2 and 3** are purely additive (new `src/runtime/`
files + `registry.yaml` + a new plist) — reverting them removes the worker/service with zero
impact on `cli.py`/`cron.py` (which still run single-agent). A partial state (1 without 2/3)
is fully functional: `cli`/`cron` run with agent-prefixed thread_ids and isolation is
available to any caller that passes `data_dir`.

## Out of scope (P3)

- **Multi-agent CLI surface** (`mpm agent list / register / run`) — that is **P4**. P3 ships
  the worker + service; the human-facing multi-agent command wrapper is P4.
- **Postgres** checkpointer/Store — **M2-P8**. P3 keeps `SqliteSaver` per-agent (one db file
  per agent; no contention since one worker = one process).
- **Web dashboard** — **M2**.
- **Agent-WRITTEN memory** (MEMORY.md append via Store) — **M2-P8**. P3 does not touch memory.
- **A real worker pool / job queue** — M1 ships a simple concurrency cap + per-tick queue; a
  pool is M2.
- **Any change to the guardrail chain** (`classify()` / `needs_interrupt()` / Lớp A/B logic),
  risk/okr/resource analyzers, prompts, or `config_builders*.py` — all consumed unchanged.
- **Deleting `cron.py`** — kept as a legacy manual runner; its replacement is a P4 cleanup.

## Open questions

**None blocking.** The 5 prior questions are RESOLVED and baked into this plan:

1. **`schedule:` format** → standard 5-field cron via `croniter` (added in Slice 3). See
   [Contract 4](#contract-4--schedule-format--croniter) + [the tick algorithm](#the-tick--next-fire-algorithm).
2. **Worker hang timeout** → **600s** (kill + `status=timeout` run-event). Constant, tunable.
3. **Concurrency cap** → **4** simultaneous workers; excess queues to the next tick.
4. **Scheduler audience** → **internal only**; external (always Lớp B ⇒ pending) is manual / P4.
   `cron.py` is KEPT as a legacy manual per-agent runner (deletion is a P4 cleanup, not P3).
5. **Service daemon** → one `deploy/launchd/com.mpm.service.plist` with `KeepAlive=true`
   (restart on crash). The deploy notes instruct the operator to **manually unload the 3 legacy
   per-report plists** to avoid double-scheduling — the code MARKS them legacy but does NOT call
   `launchctl` (no code touches launchd state).

Non-blocking note (carried, decide at impl): on a worker crash the service records the failed
run-event and waits for the NEXT tick (no same-tick retry) — simplest, avoids tight-loop retries;
revisit if a transient-failure retry proves needed.

## Enabled precedence

An agent runs (scheduled OR worker-invoked) only when BOTH gates are true: `registry.yaml`
`enabled: true` (the master switch the service reads) AND `profile.yaml enabled: true` (the
secondary per-profile gate, already on `LoadedProfile.enabled`). Either false ⇒ skipped. The
committed `registry.yaml` ships one entry `{id: default, enabled: true}`; it holds only ids +
bools (no secrets) and is NOT matched by the `profiles/*` gitignore rule (it lives at repo root),
so it is committed.
