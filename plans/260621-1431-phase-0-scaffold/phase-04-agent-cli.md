# Phase 04 — Minimal Agent Graph + CLI

## Goal
Prove the LangGraph lifecycle: CLI → graph → 1 real OpenRouter call → printed output, with SQLite checkpointer wired.

## Files created
- `src/agent/state.py` — `AgentState(TypedDict)`: `user_input: str`, `llm_response: str`, `cost_usd: float | None`. (Minimal; full report state is Phase 1.)
- `src/agent/graph.py` — `build_graph(checkpointer)` → `StateGraph(AgentState)` with nodes:
  - `perceive(state)` → normalize input (Phase 0: passthrough; Phase 1 wires tool READ here).
  - `respond(state)` → call `llm.complete([{role:user, content: user_input}])`; budget checked inside complete(); set `llm_response` + `cost_usd`.
  - edges: START→perceive→respond→END. `compile(checkpointer=checkpointer)`.
- `src/agent/checkpoint.py` — `get_checkpointer()` → `SqliteSaver.from_conn_string(".data/checkpoints.db")` + `.setup()`. Set `LANGGRAPH_STRICT_MSGPACK=true`.
- `src/entrypoints/cli.py` — `python -m src.entrypoints.cli "<message>"`: parse arg, build graph, `invoke({user_input}, config={configurable:{thread_id: "cli"}})`, print response + cost line. Clear error if no `OPENROUTER_API_KEY`.
- `src/entrypoints/cron.py` — STUB only: docstring + `main()` that prints "cron entrypoint — Phase 1". No scheduling logic (out of scope).

## Constraints
- agent/ imports llm/ + audit/ (for any future write via gateway) but graph this round does NOT write — read-only LLM echo. No direct API write anywhere.
- Provider-agnostic: graph never imports openai directly; only `llm.complete`.
- Bounded: llm call already has timeout/retry from phase 2.

## Validation
- `uv run python -m src.entrypoints.cli "hello"` → prints model reply + `cost: $x` (phase 5 smoke, needs key).
- Graph builds + compiles without a key (unit: `build_graph` returns compiled graph; no call made).
- checkpoints.db created under `.data/` on first invoke.

## Risks
- If checkpointer `.setup()` API differs from research → adjust to verified current call; do not guess. Confirmed via research: `SqliteSaver.from_conn_string(path)` context manager + `setup()`.
