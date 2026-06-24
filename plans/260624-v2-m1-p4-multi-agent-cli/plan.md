---
title: "v2 M1-P4 — Multi-agent CLI (mpm agent ...)"
description: "A thin multi-agent CLI surface over the P3 primitives — closing Milestone 1. Slice 1: `mpm.py` skeleton + dispatch + `agent list` (read registry + last run-event) + `agent register` (scaffold profiles/<id>/ from the default template + text-append registry block, idempotent). Slice 2: `agent run` (spawn the P3 worker subprocess via an injectable spawn fn, collect exit code + last runs.jsonl line). Slice 3: per-agent Lớp B management `agent approvals/approve/reject/audit` built at the agent's OWN .data/agents/<id>/ — the gap-closer cli.py left open — plus a one-line legacy pointer in cli.py. Almost no new business logic: argument parsing + dispatch + per-agent store access. Additive (cli.py/cron.py kept). Mode = auto, commit per slice."
status: completed
priority: P4
effort: 8h
branch: main
tags: [v2, m1, p4, cli, multi-agent, mpm, registry, worker, subprocess, per-agent-isolation, lop-b, approvals, audit, register, scaffold, gap-closer, additive]
created: 2026-06-24
completed: 2026-06-24
---

# v2 M1-P4 — Multi-agent CLI (`mpm agent ...`)

P1–P3 built the multi-agent machinery: per-agent isolation (`data_dir`), the
`registry.yaml`, the per-agent **worker** subprocess, the **coordinating service**, and
per-agent stores. What's missing is the **human-facing surface**: a single CLI to list,
register, run, and manage N agents. P4 is that surface — and it CLOSES Milestone 1.

P4 is **mostly plumbing**: argument parsing + dispatch + per-agent store access. It adds
**no new business logic** — it reuses the P3 worker (spawn), the P3 registry/agent-paths
(`load_registry` / `agent_data_dir`), the P2 loader (`load_profile(..., data_dir=…)`), and
the v1 gateway/audit primitives (`ActionGateway` / `AuditLog` / `make_slack_post_handler`).
The single architectural value it adds is **closing the P3 "cli stale after migration" gap**:
`cli.py` reads the GLOBAL `.data/`; `mpm agent approvals/approve/reject/audit` read the
**per-agent** `.data/agents/<id>/`, so Lớp B management finally points at the migrated store.

This is a **new entrypoint** (`src/entrypoints/mpm.py`). `cli.py` + `cron.py` are KEPT as
legacy single-agent entrypoints — P4 is **additive, not breaking**.

## The command surface (load-bearing contract)

All under `python -m src.entrypoints.mpm agent ...`:

| Command | Reads / writes | Reuses (verified) |
|---------|----------------|-------------------|
| `agent list` | reads `registry.yaml` (id+enabled) + each profile's `name` + last line of `.data/agents/<id>/runs.jsonl` | `load_registry` (`registry.py:30`), `load_profile` (`loader.py:60`), `agent_data_dir` (`agent_paths.py:35`) |
| `agent register <id>` | creates `profiles/<id>/` (profile.yaml from default + 3 md), text-appends `{id, enabled: true}` to `registry.yaml` | `_validate_agent_id` (`agent_paths.py:25`), `load_registry` (collision check) |
| `agent run <id> --report <kind> [--audience …]` | spawns `python -m src.runtime.worker --agent-id <id> --report <kind> [--audience …]`, waits, reads last `runs.jsonl` line | worker (`worker.py:81`), the service spawn shape (`service.py:49,56`) |
| `agent approvals <id>` | reads `.data/agents/<id>/approvals.db` (pending Lớp B) | `ActionGateway.pending_approvals` (`action_gateway.py:253`) at the per-agent dir |
| `agent approve <id> <approval-id>` | approves + dispatches one Lớp B action from the agent's store | `ActionGateway.approve` (`:257`), `make_slack_post_handler` (`slack_write.py:25`) |
| `agent reject <id> <approval-id>` | rejects one Lớp B action in the agent's store | `ActionGateway.reject` (`:284`) |
| `agent audit <id> [filters]` | reads `.data/agents/<id>/audit/audit.jsonl` | `AuditLog(...).query` (`audit_log.py:70`) |

Exit codes: `0` ok · `1` runtime error (load failure, bad approval id, worker not delivered)
· `2` bad invocation (unknown subcommand, missing required arg, id-validation failure).

## Confirmed decisions (do NOT re-litigate — baked in)

1. **New file `src/entrypoints/mpm.py`.** `cli.py` + `cron.py` stay as **legacy single-agent**
   entrypoints (NOT deleted, NOT broken). `cli.py` keeps its P3 "stores migrated" warning;
   Slice 3 adds a one-line note in `cli.py`'s usage pointing operators to `mpm agent` for the
   per-agent view. `cron.py` is untouched.
2. **`agent run` SPAWNS the worker subprocess** (`python -m src.runtime.worker --agent-id …`),
   the SAME argv shape the P3 service uses (`service._worker_argv` `service.py:49`) — NOT
   in-process. The spawn fn is **injectable** so tests assert the exact argv with no real
   process (mirrors `test_service.py`'s `_fake_spawn`). Collect the exit code + the last
   `runs.jsonl` line for the printed result.
3. **Per-agent management** (`approvals`/`approve`/`reject`/`audit`) builds the gateway/audit-log
   at `agent_data_dir(<id>)`. The agent's settings/config come from
   `load_profile(id, data_dir=agent_data_dir(id))` (P3's `data_dir` kwarg). The gateway is
   `ActionGateway(loaded.settings, external_channels=loaded.config.slack_external_channels)`
   (verified `cli._gateway` shape, `cli.py:170`). The approve handler reuses
   `make_slack_post_handler(config.slack_server)` (the same dispatch `cli._dispatch_approved_action`
   uses, `cli.py:211`). **This is the gap-closer:** `cli.py` reads the GLOBAL `DATA_DIR`; `mpm`
   reads the per-agent dir.
4. **`agent register`**: copy `profiles/default/profile.yaml` as the template (it holds only
   `token_env` NAMES, no secrets — verified), write 3 placeholder md files (SOUL/PROJECT/MEMORY
   with a one-line comment, like `profiles/default/`), then **text-append** a `{id: <id>,
   enabled: true}` block to `registry.yaml` (preserve existing entries + comments — append, do
   NOT yaml-round-trip-rewrite). Validate the id via `_validate_agent_id` (`agent_paths.py:25`)
   BEFORE creating anything (a bad id must not create a dir). Error if `profiles/<id>/` exists
   OR the id is already in the registry. The new profile dir is gitignored (`profiles/*` except
   `default` — verified `git check-ignore profiles/acme` returns the path) — that's fine.
5. **`agent list`**: `load_registry()` for id+enabled; `load_profile(id)` for `name` (it also
   validates, so a broken profile surfaces as an error row, not a crash); last-run = parse the
   last line of `.data/agents/<id>/runs.jsonl` (`ts`/`kind`/`status`/`delivered`) — absent file
   ⇒ "never run". A registry id with no profile dir ⇒ an **error row**, never a crash.
6. **Mode = auto, commit per slice. NOT breaking** (mpm is additive).
7. **No new dep.** Reuse P3's worker/registry/agent_paths/run_event + P1/P2 config/profile.

## The `mpm.py` size / split decision (planned, not discovered late)

The full surface — dispatch + arg helpers (~50) + `list` (~30) + `register` (~45) + `run`
(~35) + per-agent `approvals`/`approve`/`reject`/`audit` (~70) — is **~230 LOC**, OVER the
200 gate. So P4 **splits the command groups into helper modules from the start** (the
codebase's <200-LOC modularization rule):

- `src/entrypoints/mpm.py` — the **dispatch shell** only: `main(argv)`, the `agent` subcommand
  router, shared arg-parse helpers (`_flag_value`), usage text. Thin (~60 LOC). It imports the
  group handlers and routes to them.
- `src/entrypoints/mpm_registry_cmds.py` — `agent list` + `agent register` (read registry /
  scaffold / append). Slice 1. (~80 LOC.)
- `src/entrypoints/mpm_run_cmd.py` — `agent run` (build worker argv + injectable spawn +
  supervise + print outcome). Slice 2. (~45 LOC.)
- `src/entrypoints/mpm_manage_cmds.py` — per-agent `approvals`/`approve`/`reject`/`audit`
  (build the gateway/audit-log at the per-agent dir). Slice 3. (~75 LOC.)

Each helper module owns ONE command group, stays under the gate, and is owned by exactly ONE
slice (no two slices edit the same file). `mpm.py` is **created in Slice 1** and **extended in
2 & 3** (each slice adds one router branch + one import) — that's the only shared file across
slices; it is called out in [File ownership](#file-ownership). The router branch additions are
distinct, non-overlapping lines (one `elif sub == "run"` / `elif sub in {...}`), so the
sequential commits don't conflict.

## Slices (ordered, each independently testable + committable)

| # | Slice | Phase file | Status | Commit | Depends on |
|---|-------|-----------|--------|--------|-----------|
| 1 | **Skeleton + `agent list` + `agent register`.** `src/entrypoints/mpm.py` (dispatch shell) + `src/entrypoints/mpm_registry_cmds.py` (`list` reads registry + last run-event; `register` scaffolds `profiles/<id>/` from the default template + text-appends a registry block, idempotent + id-validated). Read-only + scaffold — **provable fully offline, no worker spawn**. | [phase-01-skeleton-list-register.md](phase-01-skeleton-list-register.md) | DONE | `94604b7` | P1–P3 (done) |
| 2 | **`agent run` (spawn the worker subprocess).** `src/entrypoints/mpm_run_cmd.py` — build the worker argv (the P3 service's shape), spawn via an **injectable** spawn fn, wait, collect exit code + last `runs.jsonl` line, print the outcome. Test asserts the exact argv + a fake exit/run-event — NO real process. Adds one router branch in `mpm.py`. | [phase-02-agent-run.md](phase-02-agent-run.md) | DONE | `ed2ed02` | 1 |
| 3 | **Per-agent Lớp B management (the gap-closer) + cli.py legacy note.** `src/entrypoints/mpm_manage_cmds.py` — `approvals`/`approve`/`reject`/`audit` built at `agent_data_dir(<id>)` so they read the agent's OWN `approvals.db` / `audit.jsonl` (NOT the global one). Reuses `make_slack_post_handler` for approve dispatch. Adds the router branch in `mpm.py` + a one-line `mpm agent` pointer in `cli.py`'s usage. | [phase-03-per-agent-management.md](phase-03-per-agent-management.md) | DONE | `8be3e71` | 1 |

**Dependency graph: 1 → 2, 1 → 3** (2 and 3 both depend only on 1; they can land in either
order — they touch disjoint files except the `mpm.py` router, which gets one distinct branch
each, applied sequentially). Each slice is green + valuable at commit: after 1, an operator can
`list` and `register` agents; after 2, run a report for one agent through the CLI; after 3, the
per-agent Lớp B/audit surface closes the migration gap.

## File ownership (no two slices touch the same source file)

| Slice | Creates | Modifies |
|-------|---------|----------|
| 1 | `src/entrypoints/mpm.py`, `src/entrypoints/mpm_registry_cmds.py`, `tests/test_mpm_dispatch.py`, `tests/test_mpm_registry_cmds.py` | — |
| 2 | `src/entrypoints/mpm_run_cmd.py`, `tests/test_mpm_run_cmd.py` | `src/entrypoints/mpm.py` (one router branch: `run`) |
| 3 | `src/entrypoints/mpm_manage_cmds.py`, `tests/test_mpm_manage_cmds.py` | `src/entrypoints/mpm.py` (one router branch: `approvals/approve/reject/audit`), `src/entrypoints/cli.py` (one-line usage note) |

`mpm.py` is **created in Slice 1** and gets ONE new router branch each in Slices 2 & 3 — the
ONLY file shared across slices. It is called out here per the orchestration rule; because the
slices commit **sequentially** (1 → then 2 → then 3) and each adds a distinct, non-overlapping
`elif` branch (not parallel edits), this is safe. `cli.py` is touched ONLY in Slice 3 (the
legacy note). The P3 files (`worker.py`, `registry.py`, `agent_paths.py`, `run_event.py`,
`service.py`), the gateway, the loader, and the audit log are **NOT modified** — P4 consumes
them unchanged.

## Acceptance criteria (whole phase — the roadmap end-to-end)

Run against TWO test agents `A` + `B` (a tmp profiles dir + a tmp registry + tmp per-agent
data dirs), fully offline (injected spawn, monkeypatched paths):

1. **Register 2 agents.** `mpm agent register A` then `register B` each create
   `profiles/<id>/{profile.yaml,SOUL.md,PROJECT.md,MEMORY.md}` (profile.yaml copied from the
   default template) AND append a `{id, enabled: true}` block to the (tmp) registry, preserving
   the existing `default` entry + comments. (Slice 1.)
2. **Idempotent register.** A second `register A` errors clearly (exit non-zero, "already
   exists") and creates/changes nothing. A bad id (`register ../x`) errors via
   `_validate_agent_id` and creates NO dir, NO registry line. (Slice 1.)
3. **List shows both with last-run.** `mpm agent list` reads the registry → both A + B rows
   with id / name / enabled / last-run. Before any run, last-run = "never run"; after a
   recorded run, last-run = the run's kind/status/ts from the agent's `runs.jsonl`. A registry
   id whose profile dir is missing shows an **error row**, not a crash. (Slice 1.)
4. **Run a report for each (spawn asserted).** `mpm agent run A --report daily` and
   `run B --report weekly` each call the injected spawn fn with the EXACT argv
   `[python, "-m", "src.runtime.worker", "--agent-id", <id>, "--report", <kind>, "--audience",
   "internal"]`; the printed result includes the worker's exit code + the last `runs.jsonl`
   line. No real subprocess. (Slice 2.)
5. **Per-agent Lớp B isolation (the gap-closer headline).** Seed a pending Lớp B action in
   **A's** `approvals.db` only. `mpm agent approvals A` lists it; `mpm agent approvals B` shows
   **none**. `mpm agent approve A <id>` consumes A's approval and dispatches it (via a fake
   `make_slack_post_handler`); **B's `approvals.db` is untouched**. `mpm agent reject A <id>`
   rejects in A only. (Slice 3.)
6. **Per-agent audit isolation.** With a seeded `.data/agents/A/audit/audit.jsonl`,
   `mpm agent audit A` prints A's entries; `mpm agent audit B` (empty/absent) prints "(no audit
   entries match)". Confirms `audit` reads the **per-agent** log, not the global one. (Slice 3.)
7. **cli.py still works + points to mpm.** `cli.py`'s legacy single-agent paths are unchanged;
   its usage string now contains a one-line `mpm agent` pointer. (Slice 3.)
8. **Full suite green + ruff clean + LOC gate.** `uv run pytest` passes (P3 suite + the new mpm
   tests); `uv run ruff check src tests` clean (line-length 100); every NEW `src/entrypoints/*`
   file ≤ 200 LOC.

## Risks (phase-level; per-slice detail in phase files)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| `register` clobbers `registry.yaml` comments / existing entries (yaml round-trip drops comments) | M×M | **Text-append** one `{id, enabled: true}` block to the file (open `"a"`), NOT yaml-load-then-dump. Re-read via `load_registry()` afterward to validate the result parses. Test against a TMP registry (never the committed one) seeded with comments + the `default` entry; assert comments + `default` survive and the new block is present. |
| `register` partial state (dir created, registry append fails — or vice versa) leaves an orphan | M×M | Validate the id + check BOTH collisions (profile dir AND registry id) BEFORE any write. Order: (a) validate id, (b) collision-check, (c) create profile dir, (d) append registry. If (d) fails after (c), the error message tells the operator the dir exists but the registry line is missing (a `register` re-run then reports "profile dir exists"). KISS: no transaction; the collision pre-check makes a clean re-run the recovery. Documented in phase-01 rollback. |
| `agent run` spawns a real subprocess in tests (slow/flaky/env-bound) | L×H | The spawn fn is **injectable** (default = a real-Popen helper; tests pass a fake returning a stubbed exit code, mirroring `test_service.py:_fake_spawn`). The test asserts the constructed argv + reads a SEEDED `runs.jsonl`; no real `python -m` runs. |
| Per-agent management reads the WRONG store (global instead of per-agent) — silently re-opens the gap | L×H | The gateway/audit-log are built EXPLICITLY at `agent_data_dir(<id>)` via `load_profile(id, data_dir=agent_data_dir(id))`. The isolation test (acceptance 5/6) seeds A's store ONLY and asserts B sees nothing — structurally proves the per-agent dir is used. A's approve does not touch B's `approvals.db`. |
| `mpm.py` exceeds 200 LOC as commands accrete | M×L (resolved) | Split planned UP FRONT (see [the split decision](#the-mpmpy-size--split-decision-planned-not-discovered-late)): dispatch shell + 3 group helper modules, each owned by one slice, each under the gate. |
| Shared `mpm.py` edited by 2 slices ⇒ merge churn | L×L | Slices commit sequentially; each adds ONE distinct `elif` router branch + one import — non-overlapping lines. Not parallel edits. |

## Rollback

Each slice reverts by reverting its diffs + deleting its created files. **Slice 1** creates
`mpm.py` + `mpm_registry_cmds.py` (+ tests) — purely additive; reverting removes the whole `mpm`
entrypoint with zero impact on `cli.py`/`cron.py`. A `register` that already wrote a tmp/local
profile dir + a registry line is reverted by deleting `profiles/<id>/` + removing the appended
block (the append is one contiguous block, easy to identify). **Slice 2** adds
`mpm_run_cmd.py` + one router branch — reverting removes `agent run`; `list`/`register` still
work. **Slice 3** adds `mpm_manage_cmds.py` + one router branch + the cli.py note — reverting
removes the per-agent management surface and the note; `cli.py`'s own approval/audit paths
(global) are untouched throughout. No slice changes existing runtime behavior; the only edit to
an existing file is Slice 3's one-line cli.py usage note.

## Out of scope (P4)

- **Any change to the worker / service / registry / agent-paths / gateway / loader** — P4 is a
  CLI surface that CONSUMES them unchanged.
- **A `--dry-run` passthrough or `--enabled false` flag** on `run`/`register` — see open
  questions; default behavior only unless a question is answered yes (none block a slice).
- **Deleting `cli.py` / `cron.py`** — kept as legacy single-agent entrypoints (decision #1).
- **Editing the committed `registry.yaml`** in tests — tests use a TMP registry path; the
  committed file is never mutated by the suite.
- **Postgres / web dashboard / agent-written memory** — M2.
- **Scheduling** — that's the P3 service; `mpm` is the manual/interactive surface.

## Open questions

None block a slice. Recommended defaults are baked in; flip only on user request:

1. **Does `register` need an `--enabled false` flag?** Recommend **no** for M1 — `register`
   always writes `enabled: true`; an operator flips it by editing `registry.yaml` (one line) or
   `profile.yaml`. (YAGNI.) Non-blocking.
2. **Should `agent run` support a `--dry-run` passthrough to the worker?** The worker already
   accepts `--dry-run` (`worker.py:94`). Recommend **yes, pass it through** (cheap: append
   `--dry-run` to the argv when present) — useful for a safe smoke. Decided in phase-02 as a
   one-line passthrough; if the user prefers to omit it, drop that line. Non-blocking.
3. **Does `list` gate on registry-enabled, profile-enabled, or both?** The service runs an
   agent only when BOTH are true (P3 decision #6). Recommend `list` show the **registry**
   `enabled` column (the master switch the operator flips) and surface a broken/disabled profile
   via the error/name path — it's a LISTING, not a run gate. Non-blocking.
4. **How does `register` append to `registry.yaml` without clobbering comments?** Recommend
   **text-append** of one `  - id: <id>\n    enabled: true\n` block (open `"a"`), then re-read
   via `load_registry()` to confirm it parses. Preserves the committed comments + `default`
   entry. (A yaml round-trip would drop the comments.) Baked into Slice 1; non-blocking.
