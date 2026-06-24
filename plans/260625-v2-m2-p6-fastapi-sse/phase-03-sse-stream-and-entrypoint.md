# Phase 3 — SSE stream + event schema + uvicorn entrypoint

**Goal**: The streaming surface. `GET /api/runs/{run_id}/stream` drains the run's queue and
emits SSE: one `node` event per node, a terminal event; the `summarize_node` PII firewall; the
interrupt→terminal `interrupted` path; and the `python -m src.server.app` localhost entrypoint.
Tested by streaming a FAKE async graph — NO real LLM/MCP/network.

## Context links

- `plan.md` — SSE event schema, verified facts V1 (updates shape) + V2 (interrupt in astream).
- Phase 2: `RunManager`, `RunHandle.queue`, the `_Terminal` sentinel.
- `src/agent/approval_gate.py:20` — the P5 PII red line (non-PII summary only).

## Requirements

1. **`summarize_node(node, delta) -> dict`** — the PII firewall. An ALLOWLIST per node; any key
   not in the allowlist is DROPPED. Never passes through persona/project/memory/per-assignee
   data even if a future node leaks it into the delta.
   - `perceive` → `{}` (default; optionally `{"signal_count": int}` only if `delta` carries a
     cheap count key — keep `{}` for KISS unless a count already exists).
   - `analyze` → `{"risk_count": len(delta.get("risks", []))}`.
   - `compose_report` → `{"cost_usd": delta.get("cost_usd")}`.
   - `approval_gate` → `{"state": "paused"}`.
   - `deliver` → `{"delivered": bool(delta.get("delivered", False)),
     "summary": str(delta.get("delivery_summary", ""))}`.
   - unknown node → `{}` (drop everything; safe default).
   This is a pure function — the single most important unit test in the slice.
2. **SSE generator** `stream_run(handle) -> AsyncIterator[str/ServerSentEvent]`:
   - drains `handle.queue`; for a raw astream chunk `{node: delta}` → emit
     `{"event":"node","node":node,"data":summarize_node(node,delta)}` as the SSE `data:`.
   - for an `__interrupt__` chunk → DO NOT emit a `node` event; it is folded into the terminal.
   - on the `_Terminal` sentinel → emit
     `{"event":"terminal","status":...,"data":{...}}`; for `interrupted` include
     `{"thread_id": handle.thread_id, "summary": <interrupt summary>}` so the operator knows to
     `mpm agent resume <id> <thread_id> --decision approve|reject`. Then STOP (the stream does
     NOT block waiting for the resume — locked decision).
   - on `error` terminal → `{"status":"error","data":{"message": <short, no stack/PII>}}`.
   - always terminates after the terminal event; calls `manager.on_stream_closed(run_id)` in a
     `finally` so a disconnect mid-stream still releases the watcher.
3. **Route `GET /api/runs/{run_id}/stream`**: `404` if `manager.get(run_id) is None`. Else
   return `EventSourceResponse(stream_run(handle))` (`sse-starlette`), `media_type
   text/event-stream`. Multiple watchers: each `GET` gets its own generator; the queue is the
   shared source — if two watchers must each see all events, give each watcher its own queue
   fanned out from the handle (a list of subscriber queues on the handle) rather than competing
   on one queue. **Decision**: support multi-watcher via per-subscriber queues — `_drive` pushes
   each event to ALL current subscriber queues; a new subscriber that attaches mid-run gets
   events from attach-time onward (trigger-now-watch + late watchers). A subscriber that
   attaches AFTER terminal immediately receives the cached terminal (store the terminal on the
   handle so a late watcher gets one terminal event then closes).
4. **uvicorn entrypoint** in `app.py`:
   - `if __name__ == "__main__": uvicorn.run(app, host="127.0.0.1", port=<8765 default / env
     PORT>)`. Bind `127.0.0.1` ONLY (never `0.0.0.0`). The module docstring restates: no auth,
     localhost-only; external exposure REQUIRES auth (deferred).
   - `app` stays importable for `TestClient`.

## Files to create

| File | LOC est | Purpose |
|---|---|---|
| `src/server/sse_events.py` | ~70 | `summarize_node` (PII firewall) + `format_sse_event(...)` + the `node`/`terminal` dict builders. Pure, no FastAPI import. |
| `src/server/sse_stream.py` | ~70 | `stream_run(handle, manager)` async generator + subscriber attach/detach. |
| `tests/test_sse_events.py` | ~80 | `summarize_node` firewall + builder tests (incl. poisoned delta). |
| `tests/test_server_stream.py` | ~110 | TestClient SSE read of a fake graph: happy path, interrupt, error, multi-watcher. |
| `tests/test_server_entrypoint.py` | ~40 | `app` importable; `__main__` binds 127.0.0.1 (mock `uvicorn.run`, assert host arg). |

## Files to modify

- `src/server/run_manager.py` — add per-subscriber fan-out: `subscribe(run_id) -> Queue`,
  `unsubscribe(run_id, q)`, `on_stream_closed(run_id)`; `_drive` pushes each event to all
  current subscriber queues + caches the terminal on the handle for late watchers.
- `src/server/routes_runs.py` — add the `GET /stream` route.
- `src/server/app.py` — add the `__main__` uvicorn block + import `uvicorn`.

## Step-by-step

1. `sse_events.py`: `summarize_node` allowlist + the two builders. Write
   `tests/test_sse_events.py` FIRST (the firewall is the highest-risk unit) and run it.
2. `run_manager.py`: add subscriber fan-out + terminal cache + `on_stream_closed`.
3. `sse_stream.py`: `stream_run` draining a subscriber queue → SSE strings; `finally`
   unsubscribe.
4. `routes_runs.py`: `GET /stream` → `EventSourceResponse`; 404 on unknown run_id.
5. `app.py`: `__main__` uvicorn bind 127.0.0.1.
6. Remaining tests, `ruff check`, full suite.

## Tests / validation (offline — fake async graph, NO network)

Use `TestClient` which supports streaming responses; read the SSE body and parse the JSON
`data:` lines. Fake graphs as in Slice 2 (canned `updates` chunks; one interrupt fake; one
raising fake).

- `test_summarize_node_drops_pii` — feed `analyze` a delta containing
  `{"risks":[{...}], "persona":"X", "project":"Y", "memory":"Z", "assignees":[...]}` → output is
  ONLY `{"risk_count": 1}`; assert `persona/project/memory/assignees` absent. (R2 guard.)
- `test_stream_happy_path_node_then_terminal` — trigger a fake internal run, stream → 4 `node`
  events in order then `terminal:delivered`.
- `test_stream_external_interrupt_terminal` — interrupt fake → events end with
  `terminal:interrupted` carrying `thread_id` (matches `agent_thread_id(id,kind,'external')`)
  and a `summary`; NO `deliver` node event; stream does NOT hang.
- `test_stream_error_terminal` — raising fake → `terminal:error` with a short `message`, no
  stack; server still responds to a follow-up request (loop not crashed — R1/R5 guard).
- `test_stream_unknown_run_id_404`.
- `test_two_watchers_both_get_all_events` — trigger, attach two streams, both receive the full
  event sequence (multi-watcher fan-out).
- `test_late_watcher_gets_cached_terminal` — attach after terminal → receives one `terminal`
  event then closes.
- `test_loop_not_blocked_during_run` — while a (slow) fake run streams, a concurrent
  `GET /api/agents` returns promptly (R1 guard — astream offloads sync nodes, V3).
- `test_app_importable_and_main_binds_localhost` — `from src.server.app import app`; patch
  `uvicorn.run`, run the `__main__` path, assert `host == "127.0.0.1"`.

Validation gate: `uv run pytest tests/test_sse_events.py tests/test_server_stream.py
tests/test_server_entrypoint.py -q` green + `ruff check src/server tests` + FULL suite
(`uv run pytest -q`) green (443 + new).

## Risks + rollback

- **R2 (PII leak)**: `summarize_node` allowlist + `test_summarize_node_drops_pii`. This is the
  one test that must never be weakened.
- **R1 (loop block)**: resolved by V3 (astream offloads sync nodes); `test_loop_not_blocked`
  is the regression guard. If a future LangGraph drops sync-offload, fall back to the
  to_thread bridge (smoke `to_thread_test` in `/tmp/astream_smoke.py` proves it works) — note
  this in the module docstring as the contingency.
- **R-multiwatcher**: per-subscriber queues add a little state; bounded each (maxsize 256). A
  slow watcher that fills its queue drops-oldest or is dropped — keep it simple: drop-oldest on
  a full subscriber queue (a watcher that can't keep up loses intermediate events but still
  gets the terminal, which is cached). Document.
- **Rollback**: revert the commit. `/stream` + entrypoint drop; Slices 1–2 remain green.

## File-size guard

All new files < 200 LOC (largest test ~110). If `run_manager.py` crosses 200 after the
fan-out addition, split the subscriber registry into `run_subscribers.py`.

## Docs to update at slice end (per documentation-management rule)

- `docs/v2/roadmap-m2.md` — mark P6 done (the service web surface).
- `docs/v2` service/architecture note — record: localhost-only, no auth, in-process streaming,
  concurrency cap 4, resume stays via `mpm agent resume` (stream does not block).
- Only update docs for the user-visible behavior (new HTTP surface) — no changelog noise.
