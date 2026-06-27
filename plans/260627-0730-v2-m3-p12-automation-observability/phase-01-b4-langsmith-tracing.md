# Phase 01 — B4 LangSmith tracing opt-in (the warm-up)

**Status**: pending · **Effort**: 2.5h · **Blocks**: none · **Blocked by**: none

Smallest blast radius. Add LangSmith tracing as opt-in callbacks at the graph invoke
seam. DEFAULT OFF ⇒ byte-identical to pre-P12. LangGraph is native LangChain, so a
`callbacks` list in the `RunnableConfig` at invoke time is the only hook — ZERO core
graph change.

## Context (verified 2026-06-27)

- 3 invoke seams that need `callbacks` threaded in (all build the config dict by hand):
  - `src/runtime/worker.py:107` — `graph.invoke({}, config={"configurable": {"thread_id": thread_id}})`
  - `src/entrypoints/cli.py:152` — `graph.invoke({}, config={"configurable": {"thread_id": thread}})`
  - `src/server/run_manager.py:140` — `cfg = {"configurable": {"thread_id": handle.thread_id}}`
    then `:144` `graph.stream({}, config=cfg, stream_mode="updates")`
- Config build pattern to mirror (P8 `runtime:` infra): `src/profile/loader_mapping.py:73,91-93`
  (`runtime` section → `checkpointer`/`store`/`postgres_dsn`), `src/config/config_builders.py:47-63`
  (`build_settings_from_dict`), `src/config/settings.py:51-53` (the 3 P8 fields).
- Deps already present: `langchain-core>=1.4.8`, `langgraph>=1.2.6` (`pyproject.toml:6-15`).
  `langsmith` is the NEW dep (LangChainTracer lives in `langchain_core.tracers` but the
  `langsmith` client SDK is what it ships traces to).

## Requirements

1. Opt-in via BOTH: env (`LANGCHAIN_TRACING_V2=true` AND/OR `LANGSMITH_API_KEY` present)
   + a profile flag `runtime.tracing: true`. Resolution mirrors P8 runtime fields
   (yaml → env → omit). DEFAULT OFF.
2. When OFF ⇒ the invoke config has NO `callbacks` key ⇒ byte-identical to today.
3. When ON ⇒ the invoke config carries a `callbacks` list with a LangChain tracer.
4. DRY: one helper builds the `callbacks` list + merges it into the per-thread config;
   all 3 seams call it. No copy-pasted tracer logic.
5. KISS/YAGNI: do NOT build a custom callback. Use LangChain's stock tracer. No
   per-node spans, no custom run names beyond the default. Tracing is a thin toggle.

## Files

**Create**
- `src/runtime/run_config.py` (~60 LOC) — the single helper:
  - `tracing_enabled(settings) -> bool` — true only when `settings.tracing` AND the env
    is configured (`LANGCHAIN_TRACING_V2` truthy OR `LANGSMITH_API_KEY` set). Keeping the
    env check here means a profile flag alone never silently fails to ship traces.
  - `build_callbacks(settings) -> list | None` — `None` when disabled (caller omits the
    key); else `[LangChainTracer()]`. Lazy-import the tracer INSIDE the function so the
    OFF path never imports langsmith/tracer modules (keeps OFF byte-identical + import-light).
  - `invoke_config(thread_id, settings) -> dict` — returns
    `{"configurable": {"thread_id": thread_id}}` when OFF (byte-identical to today's
    literal), and adds `"callbacks": [...]` when ON. This is the DRY seam.

**Modify**
- `pyproject.toml` — add `langsmith>=0.x` to `dependencies` (pin a minor floor consistent
  with the langchain-core version). Run `uv lock`.
- `src/config/settings.py` — add `tracing: bool = False` to `Settings` (after the P8
  fields, frozen dataclass keeps a default so all existing constructions stay valid).
- `src/config/config_builders.py:47` `build_settings_from_dict` — read `tracing` key
  (`_d_bool(d, "tracing", False)`); `build_settings_from_env` — add
  `"tracing": os.getenv("LANGCHAIN_TRACING_V2")` to the env dict.
- `src/profile/loader_mapping.py:build_settings_dict` (~line 91) — add
  `_put(out, "tracing", _explicit_bool(runtime, "tracing", "LANGCHAIN_TRACING_V2"))`
  in the M2-P8 runtime block (boolean variant, present-yaml-wins).
- `src/runtime/worker.py:107` — replace the literal config with
  `config=invoke_config(thread_id, settings)`.
- `src/entrypoints/cli.py:152` — same (`invoke_config(thread, settings)`); also
  `_run_hello` (`:104`) if tracing should cover hello — KISS: cover report+hello both via
  the helper (`invoke_config("cli", settings)` for hello).
- `src/server/run_manager.py:140` — `cfg = invoke_config(handle.thread_id, settings)`.
  NOTE: `_drive` does not currently hold `settings`; thread it from the graph build or
  read it once when the run is submitted. Verify lifetime: `RunManager` is ONE per server
  process (run_manager.py:10 "one RunManager per process") but each run loads its own
  profile/settings via `graph_runner.build_graph` — pass settings into `_drive` alongside
  `build_graph` rather than storing on the shared manager (no cross-run state leak).

## Implementation steps

1. Add `langsmith` dep + `uv lock`. Confirm `from langchain_core.tracers import LangChainTracer`
   imports (verify exact import path against installed version — `[UNVERIFIED]` until run).
2. Add `Settings.tracing` field + the two config_builders reads + the loader_mapping line.
3. Write `src/runtime/run_config.py` with the 3 functions; lazy-import the tracer.
4. Swap the 3 (4 incl. hello) invoke/stream config literals to `invoke_config(...)`.
5. For `run_manager._drive`, thread `settings` in (do NOT add a field to the shared
   RunManager — pass per-run).

## Tests / validation

`tests/test_run_config_tracing.py` (NEW, offline, NO network):
- OFF default: `invoke_config("t", settings_default)` == `{"configurable":{"thread_id":"t"}}`
  EXACTLY (assert no `callbacks` key) — proves byte-identical.
- OFF when flag set but env missing: `tracing_enabled` False ⇒ no callbacks (flag alone
  never ships).
- ON: monkeypatch env (`LANGSMITH_API_KEY`, `LANGCHAIN_TRACING_V2=true`) + `tracing=True`
  ⇒ `invoke_config` has a `callbacks` list, len 1, instance is a LangChainTracer. Assert
  NO network call (the tracer is constructed, not flushed — construction is offline).
- `build_callbacks` returns None when disabled (lazy import not triggered).

Commands:
```
uv run pytest -q tests/test_run_config_tracing.py
uv run pytest -q tests/  # full suite stays green
uv run ruff check src/ tests/
```

## Risks + rollback

| Risk | L×I | Mitigation |
|------|-----|------------|
| Tracer construction makes a network call in tests | M×M | Construct only (no flush); monkeypatch env; never call a real LangSmith endpoint. If tracer construction itself probes the network, wrap behind a no-op test double injected via the helper. |
| OFF path imports langsmith ⇒ not byte-identical / import cost | L×M | Lazy-import the tracer INSIDE `build_callbacks`; OFF returns None before any import. Test asserts no `callbacks` key. |
| `run_manager` settings lifetime — storing settings on the shared manager leaks across runs | M×H | Pass `settings` PER-RUN into `_drive` (each run has its own profile/settings); never add a settings field to the process-singleton RunManager. |
| `langsmith` dep drags transitive bloat / version conflict with langchain-core | L×M | Pin a floor consistent with `langchain-core>=1.4.8`; `uv lock` resolves; CI runs full suite. |
| Tracer import path wrong for installed version | M×L | Verify `from langchain_core.tracers import LangChainTracer` at step 1; tagged `[UNVERIFIED]` until run. |

**Rollback**: revert the 4 invoke-config swaps to their literals + delete `run_config.py`
+ drop the `tracing` field/reads + remove the dep. No data migration — tracing writes no
local state. Default-OFF means a half-applied state is still safe (literals unchanged).

## INVARIANT (restated)

B4 is observability-only — it adds NO action path. Tracing never touches the gateway,
never proposes or executes a write. It only attaches read-only callbacks to graph
execution. The Action-Gateway red line is untouched.

## Unresolved questions

1. Exact `langsmith` version floor to pin against `langchain-core>=1.4.8`? (Resolve at
   `uv add langsmith` — let the resolver pick, then pin the floor.)
2. Should the worker emit a `runs.jsonl` event carrying the LangSmith run/trace URL when
   ON (so a past run links to its trace)? Proposed: defer to S2/S4 if cheap; not required
   for B4 acceptance. KISS default = no extra event this slice.
3. Cover the hello path with tracing too, or report-only? Proposed: cover both via the
   one helper (no extra cost), but confirm acceptance only requires the report path.
