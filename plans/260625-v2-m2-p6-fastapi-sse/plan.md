---
title: "v2 M2-P6: Streaming + FastAPI service"
description: "Localhost FastAPI backend that runs report graphs in-process and streams live node-progress over SSE."
status: pending
priority: P1
effort: 12h
branch: main
tags: [v2, m2, fastapi, sse, streaming]
created: 2026-06-25
---

# v2 M2-P6 — Streaming + FastAPI service

First web surface in the repo (greenfield). A FastAPI backend that runs a report graph
IN-PROCESS for on-demand triggers and streams live per-node progress to the client over
SSE. Scheduled runs still go through the worker subprocess (P3 service) — unchanged.

Baseline: 443 tests pass, clean tree at `92110b1`. M2-P5 (graph interrupts) complete.

## Locked decisions (design to these — do NOT re-litigate)

1. **In-process async streaming**: `POST /trigger` runs the graph in-process via
   `build_graph_for` + `graph.astream(stream_mode="updates")` (NOT a subprocess). SSE emits
   one event per node as it completes, live, from the SAME running graph.
   (`docs/v2/roadmap-m2.md:32`).
2. **Localhost-only, no auth** (M2 single-operator sandbox): bind `127.0.0.1`, no token.
   `DRY_RUN` default still applies; external still routes through Lớp B. Exposing this
   beyond localhost REQUIRES auth — deferred to a later phase. Documented in the app
   module docstring + `docs/v2`.
3. **Trigger↔stream wiring**: `POST /api/agents/{id}/trigger` starts the run in an asyncio
   background task, returns `{run_id, thread_id}` immediately. `GET /api/runs/{run_id}/stream`
   (SSE) attaches to watch it. An in-memory run registry (`run_id → RunHandle{queue, ...}`)
   bridges them. Supports trigger-now-watch + multiple watchers.
4. **Concurrency**: concurrent runs across DIFFERENT agents up to a per-process cap of **4**
   (matches `service.py:33 _CONCURRENCY_CAP`). Same-agent same-thread concurrent run is
   REFUSED (collides on checkpoint `thread_id = <id>:<kind>:<audience>`) → `409`. Over global
   cap → `503` busy.

## Verified facts (from the offline LangGraph 1.2.6 smoke, this session)

Smoke built a 4/5-node graph (perceive→analyze→compose_report→[approval_gate]→deliver) with
SYNC nodes that `time.sleep`, an `InMemorySaver` checkpointer, and an `interrupt()` gate —
mirroring the real `report_graph.py` shape. Findings:

- **V1 — astream "updates" shape**: `graph.astream({}, config, stream_mode="updates")` yields
  ONE dict per super-step, keyed by the node name → that node's returned state-delta:
  `{'perceive': {'n': 1}}`, then `{'analyze': {...}}`, etc. One event per node, in order.
- **V2 — interrupt surfaces in astream**: when the external graph hits `approval_gate`'s
  `interrupt()`, astream yields a final chunk
  `{'__interrupt__': (Interrupt(value={'summary': ...}, id='...'),)}` then the stream ENDS
  (no `deliver` chunk). `graph.get_state(cfg).next == ('approval_gate',)` confirms the graph
  is paused. So the SSE generator detects the `__interrupt__` key → emits a terminal
  `interrupted` event carrying the `thread_id` and the interrupt `summary`.
- **V3 — sync nodes do NOT block the event loop**: LangGraph 1.2.6 `astream` auto-offloads
  each sync node to a thread (`run_in_executor`). A concurrent asyncio heartbeat kept ticking
  with `max_gap=0.011s` while nodes each blocked `0.3s` of `time.sleep`. **CONCLUSION: no
  manual `to_thread`/`run_in_executor` bridge is needed — `astream` already keeps the loop
  free.** This resolves the central technical risk (Q6) in the simplest way (KISS).
- **V4 — concurrency is real**: 4 concurrent `astream` runs (different graphs/threads) each
  = 2×0.3s serial work completed in `wall=0.62s` (parallel, not serialized). Default
  `ThreadPoolExecutor` ≈ 14 workers (cpu_count+4), comfortably above our cap of 4.
- **V5 — versions**: `langgraph 1.2.6`, `langchain-core 1.4.8`, `langgraph-checkpoint-sqlite
  3.1.0`. FastAPI/uvicorn/sse-starlette NOT installed (greenfield confirmed).
- **Import paths confirmed**: `from langgraph.graph import StateGraph, START, END`,
  `from langgraph.types import interrupt`. `CompiledStateGraph.astream` is the async API.

Smoke scripts: `/tmp/astream_smoke.py`, `/tmp/astream_block2.py`, `/tmp/concurrency.py`
(research artifacts; not committed).

## Reusable primitives (re-verified file:line, this session)

- `src/runtime/worker.py:54` `build_graph_for(loaded, settings, kind, audience) -> CompiledStateGraph`
  — network-free build (LLM key lazy at compose). Nodes: perceive, analyze, compose_report,
  approval_gate (external only), deliver.
- `src/runtime/registry.py:30` `load_registry(path=None) -> tuple[RegistryEntry(id, enabled), ...]`.
- `src/runtime/service.py:72` `_last_run_event(agent_id) -> dict | None` (reads last
  `runs.jsonl` line). **Decision: lift this into `run_event.py` as a shared reader**
  (`read_last_run_event`) so the new service does not import a service-private; refactor
  `service.py` to call it (DRY, no behavior change). See Slice 1.
- `src/runtime/run_event.py:17` `append_run_event(data_dir, event)` (already owns append).
- `src/llm/budget_tracker.py:34` `BudgetTracker(settings)` → `.spent_this_month() -> float`;
  cap = `settings.monthly_budget_usd` (`config_builders.py:58`, default 50.0).
- `src/actions/action_gateway.py:272` `ActionGateway.pending_approvals() -> list[...]`. Build
  per `mpm_manage_cmds.py:30-34`:
  `ActionGateway(loaded.settings, external_channels=loaded.config.slack_external_channels)`.
- `src/profile/loader.py:60` `load_profile(agent_id, *, profiles_dir=None, data_dir=None) -> LoadedProfile`
  (settings/config/soul/project/memory/name/enabled). Pass `data_dir=agent_data_dir(id)`.
- `src/runtime/agent_paths.py:35` `agent_data_dir(id)`, `:45` `agent_thread_id(id, kind, audience)`
  = `"<id>:<kind>:<audience>"`.
- Resume happens via CLI `mpm agent resume <id> <thread_id> --decision approve|reject`
  (`src/entrypoints/mpm.py:58`, `mpm_resume_cmd.py`) — the stream does NOT block on it.

## The 4 routes (exact)

| Method + path | Behavior |
|---|---|
| `GET /api/agents` | `[{id, name, enabled, last_run}]` from `load_registry()` + `load_profile(id).name` + `read_last_run_event(id)`. |
| `GET /api/agents/{id}/status` | `{id, name, enabled, last_run, budget:{spent,cap,ratio}, pending_approvals:<count>}`. 404 if id ∉ registry. |
| `POST /api/agents/{id}/trigger` | Body/query `kind,audience,dry_run` → starts in-process run, returns `{run_id, thread_id}`. 404 unknown agent; 409 same-agent-thread already running; 503 over global cap. |
| `GET /api/runs/{run_id}/stream` | SSE (`text/event-stream`): one event per node update + a terminal event (`delivered|not_delivered|interrupted|error`). 404 unknown run_id. |

## SSE event schema (decided)

Each SSE `data:` line is JSON. Two event types:

```json
{ "event": "node",     "node": "perceive",       "data": { ...non-PII summary... } }
{ "event": "terminal", "status": "delivered",    "data": { ...non-PII summary... } }
```

Per-node non-PII `data` (NEVER persona/project/memory or per-assignee rows — P5 red line):

- `perceive`   → `{ }` (or coarse `{ "signal_count": N }` only if cheaply derivable; default empty)
- `analyze`    → `{ "risk_count": len(risks) }`
- `compose_report` → `{ "cost_usd": <float|null> }`
- `approval_gate` → `{ "state": "paused" }` (external; surfaced as the terminal `interrupted`)
- `deliver`    → `{ "delivered": bool, "summary": delivery_summary }`
- terminal statuses: `delivered` | `not_delivered` | `interrupted` (with `thread_id`,
  `summary`) | `error` (with a short `message`, NO stack/PII).

The node→data projection is a single pure function `summarize_node(node, delta)` (allowlist of
keys per node; anything else dropped). This is the PII firewall — unit-tested directly.

## Slices (each independently runnable + committable + green suite)

| Slice | Scope | Risk | File |
|---|---|---|---|
| **1** | Read-only routes (`/api/agents`, `/status`) + app skeleton + deps + shared `read_last_run_event` + offline TestClient tests. NO graph run. | Low | `phase-01-readonly-routes-and-skeleton.md` |
| **2** | Run manager (registry, background task, concurrency cap, eviction) + `POST /trigger`, tested with a FAKE async graph. NO SSE yet. | Med | `phase-02-run-manager-and-trigger.md` |
| **3** | `GET /stream` SSE + `summarize_node` PII firewall + interrupt-terminal + uvicorn `__main__` entrypoint + streaming tests with a fake graph. | Med | `phase-03-sse-stream-and-entrypoint.md` |

Rationale: Slice 1 proves the FastAPI wiring at zero graph risk. Slice 2 lands the
concurrency/lifecycle core against a fake graph (deterministic). Slice 3 adds the streaming
surface + the real `build_graph_for` wiring behind an injection seam, still tested offline.
Each slice ends green.

## Dependencies

- Slice 1 → blocks → Slice 2 (needs the app + `RunManager` seam + shared run-event reader).
- Slice 2 → blocks → Slice 3 (stream drains the manager's queue + reads its terminal sentinel).
- External deps: add `fastapi`, `uvicorn`, `sse-starlette` to `pyproject.toml` in Slice 1
  (see phase 1 for pinned versions). `uv sync` after.
- All slices: offline only (fake graph / injected `build_graph`), NO real LLM/MCP/network.

## Acceptance criteria (measurable)

- [ ] `uv run python -m src.server.app` binds `127.0.0.1:<port>` (no external bind); `app` is
  importable for `TestClient`.
- [ ] `GET /api/agents` returns one entry per registry agent with `name/enabled/last_run`.
- [ ] `GET /api/agents/{id}/status` returns budget + pending count; `404` for unknown id.
- [ ] `POST /api/agents/{id}/trigger` returns `{run_id, thread_id}`; second trigger of the
  SAME (agent,thread) while running → `409`; over the global cap of 4 → `503`; unknown id → `404`.
- [ ] `GET /api/runs/{run_id}/stream` streams one `node` event per node then a `terminal`
  event; external run → `approval_gate` then terminal `interrupted` with `thread_id`;
  unknown `run_id` → `404`.
- [ ] A graph exception in the background task → terminal `error` SSE event + run evicted; the
  server never crashes.
- [ ] `summarize_node` never emits persona/project/memory or per-assignee data (unit test
  feeds a delta containing those keys and asserts they are dropped).
- [ ] Full suite green (443 existing + new), `ruff check` clean, every new file < 200 LOC.

## Risks (likelihood × impact → mitigation)

| # | Risk | L×I | Mitigation |
|---|---|---|---|
| R1 | Sync graph nodes block the event loop, starving other requests. | was High | **RESOLVED by V3**: astream auto-offloads sync nodes; loop stays free. Guard with a streaming test that the loop accepts a 2nd request mid-run. |
| R2 | PII leak in an SSE node event (persona/project/memory). | M×High | `summarize_node` allowlist firewall + direct unit test feeding poisoned deltas. |
| R3 | Run registry memory leak (no client attaches; queue fills). | M×Med | Bounded `asyncio.Queue(maxsize=256)` + completion always pushes a terminal sentinel; evict run on stream-close OR TTL (default 300s) after terminal, whichever first. A run with no watcher still completes and self-evicts. |
| R4 | Concurrency check race (two triggers, single loop). | L×Med | Single event loop ⇒ the check-then-insert in `RunManager.start` is atomic (no `await` between read and write). Documented; no lock needed. |
| R5 | Real LLM/MCP hit in tests. | L×High | All tests inject a fake graph via the `build_graph` seam; no `OPENROUTER_API_KEY` in test env; assert no network. |
| R6 | Pinned FastAPI/Starlette versions drift / break import. | L×Low | Pin compatible floors (phase 1), `uv sync`, run a 1-route smoke before building out. |
| R7 | `app.py` or `run_manager.py` exceeds 200 LOC. | M×Low | Pre-split: routes in `routes_agents.py` + `routes_runs.py`, manager in `run_manager.py`, event projection in `sse_events.py`. See phase files. |

## Rollback

- Per-slice: each slice is one focused commit on a feature branch. Revert the commit → tree
  returns to the prior green state (the `server/` package is additive; only `run_event.py` +
  `service.py` are touched, by a behavior-preserving extract in Slice 1 — revert restores the
  private helper).
- No migrations, no schema, no data writes from the service except the run it triggers (which
  is the existing worker path's behavior, already audited/budgeted). Removing `server/` leaves
  P1–P5 fully intact.
- `pyproject.toml` dep additions revert with the commit; `uv sync` restores the lockfile.

## Test matrix

| Layer | What | How |
|---|---|---|
| Unit | `summarize_node` PII firewall; `RunManager` concurrency cap + eviction | pytest, pure functions / fake graph |
| Integration | 4 routes via `fastapi.testclient.TestClient` | offline, fake `build_graph` |
| E2E (offline) | trigger→stream happy path; interrupt→terminal; error→terminal | TestClient SSE read of a fake async graph yielding canned `updates` chunks |
| Contract | `app` importable; `python -m src.server.app` binds localhost | import + a bind smoke (mock `uvicorn.run`) |

No real LLM, MCP, or network in any test.

## Phase files

- `phase-01-readonly-routes-and-skeleton.md`
- `phase-02-run-manager-and-trigger.md`
- `phase-03-sse-stream-and-entrypoint.md`

## Open questions

See each phase + the Status block at the end of the planning report.
