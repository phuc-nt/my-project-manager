# Phase 02 — Store wiring (factory + builder store= param + compile(store=...))

Status: pending · Slice S2 · Effort ~2.5h · Depends on S1 (dep added, Settings.store field present)

## Context

- Store API VERIFIED (offline smoke): `InMemoryStore()` from `langgraph.store.memory`; `store.put(ns_tuple, key, dict)`, `store.get(ns,key)->Item|None` (`.value`/`.key`/`.namespace`), `store.search(prefix, ...)->list`. `compile(checkpointer=..., store=...)` accepts both; a node reads via an explicit `store=` param (project convention) — VERIFIED a node `put` round-tripped in one `invoke`.
- `PostgresStore` ships in the SAME `langgraph-checkpoint-postgres` dep added in S1 (`langgraph.store.postgres`, dep-gated).
- `build_graph_for` (worker.py:54) is the single seam P5-resume + P6-server reuse → wiring the store here propagates to all run paths.
- The 4 builders compile at: `report_graph.py:299`, `okr_report_graph.py:230`, `resource_report_graph.py:237`, `graph.py:74`.

## Requirements

1. A store factory: `get_store(settings) -> BaseStore` — `InMemoryStore` default, `PostgresStore` opt-in (dep-gated, selection-tested).
2. The 4 builders gain a `store: BaseStore | None = None` param and pass it to `compile(store=...)`.
3. `build_graph_for` builds the store and passes it. Default (InMemoryStore) = behavior-identical to today (no node uses the store yet — that is S3).

## Files to create

- `src/agent/store.py` — `get_store(settings) -> BaseStore`. Branch on `settings.store`: `"memory"` → `InMemoryStore()`; `"postgres"` → lazy `from langgraph.store.postgres import PostgresStore` built from `settings.postgres_dsn` (mirror the checkpointer: long-lived; `.setup()`); `ValueError` if postgres + no dsn. Mirrors `checkpoint.py` structure for symmetry.
- `tests/test_store_selection.py` — selection + builder-store-param tests.

## Files to modify

- `src/runtime/worker.py` `build_graph_for` (worker.py:54-82) — after `cp = get_checkpointer(settings)`, add `st = get_store(settings)`; pass `store=st` to each `build_*_graph(...)` call.
- `src/agent/report_graph.py` `build_report_graph` (249) — add `store: BaseStore | None = None`; `compile(checkpointer=checkpointer, store=store)` (line 299).
- `src/agent/okr_report_graph.py` `build_okr_graph` (191) — same.
- `src/agent/resource_report_graph.py` `build_resource_graph` (198) — same.
- `src/agent/graph.py` `build_graph` (56) — same (line 74). (Phase-0 graph; harmless but keep symmetric so all builders share the signature.)
- `src/entrypoints/cron.py` `_build_graph` (53-74) — it builds graphs directly (not via build_graph_for). Add `st = get_store(settings)` + `store=st`. (cli.py uses `build_graph` (phase-0) directly at `_checkpointer`; pass `store=get_store(settings)` for symmetry, or leave `store=None` — phase-0 has no memory node. Recommend pass for consistency.)

NOTE: `import` of `BaseStore` for hints — `from langgraph.store.base import BaseStore` under `TYPE_CHECKING` in the builders (type-only; keeps graph-build import-light, matching the existing `SqliteSaver`/TYPE_CHECKING pattern).

## Implementation steps

1. Create `src/agent/store.py` (`get_store(settings)`), structurally mirroring `checkpoint.py`.
2. Add `store=` param + `compile(store=...)` to all 4 builders (type-only hint via TYPE_CHECKING).
3. Wire `get_store(settings)` in `build_graph_for` (worker) + `_build_graph` (cron) + cli.
4. Tests, then full suite.

## Test / validation (offline)

- `get_store(default settings)` → `InMemoryStore`. postgres + dsn → patched `PostgresStore` reached; postgres + no dsn → `ValueError`.
- Builder accepts `store=InMemoryStore()`; compile succeeds; a probe node reading the store via its `store=` param sees the instance (integration smoke).
- Regression: full suite green (no node uses the store yet → behavior unchanged with the InMemory default).
- ruff clean.

## Risks + rollback

- Risk: a builder's `compile(store=...)` with `store=None` must equal the pre-P8 `compile(checkpointer=...)`. VERIFIED in the smoke (compile accepts `store=` and `store=None` is the no-store default). Low.
- Rollback: revert `store.py` + the `store=` params + the factory calls. `compile(store=None)` ≡ pre-P8. No persisted artifact.

## LOC watch

- `store.py` new, ~50 LOC. The 3 report builders are ~230-238 LOC ALREADY (over 200) — adding a `store=` param + one compile arg is ~2 lines each; it does NOT meaningfully worsen them and splitting them is out of scope for P8 (note for a later cleanup). graph.py ~75 LOC fine.

## Open questions

- Should the Phase-0 `graph.build_graph` (cli) get a store at all? It has no memory node; passing `store=None` is fine. Recommend symmetric signature, `store=None` default — no behavior change.
