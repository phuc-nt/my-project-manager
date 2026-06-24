# Phase 2 — Run manager + POST /trigger (in-process background run)

**Goal**: The concurrency + lifecycle core. An in-memory `RunManager` that starts a graph run
in an asyncio background task, enforces the concurrency rules, drains node events into a
per-run queue, and evicts on completion. Plus `POST /api/agents/{id}/trigger`. Tested with a
FAKE async graph — NO real LLM/MCP. NO SSE endpoint yet (Slice 3 consumes the queue).

## Context links

- `plan.md` — locked decision 4 (concurrency), verified facts V1–V4.
- `src/runtime/worker.py:54` `build_graph_for`; `src/runtime/agent_paths.py:45` `agent_thread_id`.
- `src/runtime/service.py:33` `_CONCURRENCY_CAP = 4` (the cap to match).
- Phase 1: `src/server/app.py`, `agent_views._load_for`.

## Requirements

1. **`RunHandle`** (frozen dataclass + a mutable queue): `run_id: str`, `agent_id: str`,
   `thread_id: str`, `kind: str`, `audience: str`, `queue: asyncio.Queue`, `task: asyncio.Task`,
   `status: str` (`running|terminal`), `created_at: float`. (The queue/task are set at
   creation; status mutated — keep `RunHandle` a plain class if frozen fights the mutation, or
   store mutable state beside a frozen identity record. Prefer a small mutable `@dataclass` here
   since it carries a live task — frozen is for value types, this is a live handle.)
2. **`RunManager`** (one instance per app, lives for the process):
   - `start(agent_id, kind, audience, dry_run, *, build_graph) -> RunHandle` — the only mutating
     entry. Steps, all synchronous up to task creation (atomic on the single loop, no `await`
     between check and insert — see R4):
     1. compute `thread_id = agent_thread_id(agent_id, kind, audience)`.
     2. if `(agent_id, thread_id)` already active → raise `SameThreadRunningError` (router→409).
     3. if `len(active) >= cap` (cap=4) → raise `CapReachedError` (router→503).
     4. create `run_id` (`uuid4().hex`), a bounded `asyncio.Queue(maxsize=256)`, register the
        handle in `_runs[run_id]` and the key in `_active`, then
        `task = asyncio.create_task(self._drive(handle, build_graph, dry_run))`.
     5. return the handle (router returns `{run_id, thread_id}` immediately).
   - `get(run_id) -> RunHandle | None`.
   - `_drive(handle, build_graph, dry_run)` — the background coroutine (see lifecycle below).
   - `_evict(run_id)` — remove from `_runs` + `_active`. Idempotent.
   - cap + a clock are injectable for tests (`cap=4`, `now=time.monotonic`).
3. **`build_graph` seam**: `start` takes a `build_graph` callable
   `(agent_id, kind, audience, dry_run) -> CompiledStateGraph` (async-streamable). DEFAULT
   wraps `load_profile(id, data_dir=agent_data_dir(id))` + (`replace(settings, dry_run=True)`
   if `dry_run`) + `build_graph_for(loaded, settings, kind, audience)`. Tests inject a fake that
   returns a graph whose `.astream` yields canned `updates` chunks — so NO real LLM/MCP.
4. **`_drive` lifecycle** (the background task):
   - `cfg = {"configurable": {"thread_id": handle.thread_id}}`.
   - `async for chunk in graph.astream({}, config=cfg, stream_mode="updates"):` push each chunk
     onto `handle.queue` (raw chunk; Slice 3's `summarize_node` projects it). On a chunk with key
     `"__interrupt__"` → push it, mark interrupt, break.
   - On normal completion → push a TERMINAL sentinel (`_Terminal(status=...)`): derive status
     from the last `deliver` delta (`delivered` true→`delivered`, false→`not_delivered`); an
     `__interrupt__` chunk → `interrupted` (+ thread_id + summary); any exception → `error`
     (+ short message). The terminal sentinel is ALWAYS pushed exactly once (finally-block
     guarantee), so a watcher never hangs.
   - **Error isolation**: wrap the astream loop in `try/except Exception` → push terminal
     `error`, log, never re-raise (a graph crash must not kill the task-group / server).
   - After the terminal sentinel: schedule eviction. Eviction policy: evict on the LATER of
     (a) the stream closing (Slice 3 calls `manager.on_stream_closed(run_id)`) and (b) a TTL
     (default 300s) after terminal — whichever first, but NEVER before the terminal is pushed.
     Simplest KISS impl that satisfies R3: keep the handle until TTL-after-terminal; a
     `asyncio.get_event_loop().call_later(ttl, self._evict, run_id)`. A run with no watcher
     still completes (terminal pushed to its bounded queue) and self-evicts at TTL. Bounded
     queue (maxsize 256) caps worst-case memory if no one drains.
5. **`POST /api/agents/{id}/trigger`**: parse `kind` (default `daily`), `audience` (default
   `internal`), `dry_run` (optional bool) from JSON body OR query. Validate `id` ∈ registry
   (else 404 — reuse `agent_views`/`load_registry`). Call `manager.start(...)`. Map
   `SameThreadRunningError`→409, `CapReachedError`→503. Return `{run_id, thread_id}`.

## Files to create

| File | LOC est | Purpose |
|---|---|---|
| `src/server/run_manager.py` | ~110 | `RunHandle`, `RunManager`, the exceptions, `_drive`, eviction. The single source of concurrency truth. |
| `src/server/graph_runner.py` | ~40 | the default `build_graph` callable + the `_Terminal` sentinel + `_terminal_status_from(chunk/last_delta)` helper. Keeps the LLM/profile wiring out of `run_manager` (so the manager is fake-graph-testable with zero profile deps). |
| `src/server/routes_runs.py` | ~40 | `POST /trigger` route (the `/stream` route is added here in Slice 3). |
| `tests/test_run_manager.py` | ~120 | manager unit tests with a fake async graph. |
| `tests/test_server_trigger.py` | ~70 | `POST /trigger` route tests via TestClient + fake build_graph. |

## Files to modify

- `src/server/app.py` — instantiate ONE `RunManager` on the app (`app.state.run_manager` or a
  module singleton), mount `routes_runs`. The manager lifetime = process lifetime (R4: single
  loop, single instance). Document this.

## Step-by-step

1. `graph_runner.py`: the fake-friendly seam + terminal derivation + `_Terminal` sentinel.
2. `run_manager.py`: `RunHandle`, exceptions, `RunManager.start/get/_drive/_evict`.
3. `app.py`: attach the manager, mount `routes_runs`.
4. `routes_runs.py`: `POST /trigger` with the 404/409/503 mapping.
5. Tests, then `ruff check`.

## Tests / validation (offline — fake async graph)

Fake graph: an object with an `async def astream(self, _input, *, config, stream_mode)` that
`yield`s a fixed list of `updates` chunks (e.g. `{'perceive':{}}`, `{'analyze':{'risks':[...]}}`,
`{'compose_report':{'cost_usd':0.01}}`, `{'deliver':{'delivered':True,'delivery_summary':'ok'}}`).
A second fake yields up to `{'__interrupt__': (...,)}` then stops. A third raises inside
`astream` to exercise error isolation.

- `test_start_returns_handle_and_runs_to_terminal` — drive a fake; queue ends with a
  `delivered` terminal.
- `test_same_agent_thread_refused` — start, then start the SAME (agent,kind,audience) while
  active → `SameThreadRunningError`.
- `test_different_agents_run_concurrently_up_to_cap` — start 4 distinct → ok; 5th →
  `CapReachedError`.
- `test_interrupt_yields_interrupted_terminal` — interrupt fake → terminal `interrupted` with
  `thread_id`.
- `test_graph_exception_yields_error_terminal_and_evicts` — raising fake → terminal `error`,
  task does not propagate, run evicted (after TTL or on close).
- `test_no_watcher_still_completes_and_evicts` — start, never drain, advance the injected clock
  → handle evicted, no leak.
- Route: `test_trigger_returns_run_id_and_thread_id`, `test_trigger_unknown_id_404`,
  `test_trigger_same_thread_409`, `test_trigger_over_cap_503`.

Validation gate: `uv run pytest tests/test_run_manager.py tests/test_server_trigger.py -q`
green + `ruff check`. Re-run the full suite at slice end.

## Risks + rollback

- **R4 (concurrency race)**: the check-then-register in `start` must have NO `await` between the
  `_active` read and the insert. It does not (all sync until `create_task`). Single event loop ⇒
  no true parallelism in `start` ⇒ no lock needed. Documented in the manager docstring.
- **R3 (memory leak)**: bounded queue + guaranteed terminal sentinel + TTL eviction. Test
  `test_no_watcher_still_completes_and_evicts` is the guard.
- **R-task-orphan**: if the app shuts down with tasks live, they are best-effort (M2 sandbox,
  single operator). Note it; a graceful-shutdown drain is out of scope (YAGNI for localhost).
- **Rollback**: revert the commit; `app.py` drops the manager + `routes_runs`. Slice 1 routes
  unaffected.

## File-size guard

`run_manager.py` ~110 LOC. If it crosses 200, split eviction/TTL into `run_eviction.py`. Keep
`_drive` < ~40 lines; if the terminal-derivation grows, it already lives in `graph_runner.py`.
