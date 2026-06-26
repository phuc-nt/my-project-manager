# Phase 03 — entry-point wiring + offline e2e (red line + backward-compat)

**Slice S3.** Status: done (commit `1512e5a`). Flips the switch: the 3 entry points build the sibling context (via S1's
helper) and pass it into the `ProfileContext` (via S2's fields). Proves the red line and
backward-compat end-to-end, offline.

## Context links
- `src/runtime/worker.py:54-93` — `build_graph_for` builds `ProfileContext` at :67-70,
  `st = get_store(settings)` at :72; this is the single graph-build seam (resume reuses it).
- `src/entrypoints/cron.py:89-127` — `main` builds `ProfileContext` at :105-108; the store
  is built inside `_build_graph` at :59. **Asymmetry:** the store needed for the sibling
  read is NOT in scope at cron's ProfileContext-build site → build it there too (see steps).
- `src/entrypoints/cli.py:71-79` — `_context_of(loaded, settings)` builds `ProfileContext`;
  the store is built in `_run_report` at :110. Same asymmetry as cron.
- `src/skills/skill_pool.py:43` — `build_skill_context(loaded, settings)` is the parallel
  helper each entry point already calls; A3 adds `build_sibling_context(loaded, settings,
  store, registry)` right beside it.
- `tests/test_skill_graph_e2e.py` — the e2e template (recording fake `LlmClient`, real
  `default_*_deps`, per-builder red-line assertions).
- `src/runtime/registry.py:30` — `load_registry()`.

## Wiring strategy (resolve the store/registry availability asymmetry)
`build_sibling_context` needs BOTH the Store (read sibling facts) AND the registry
(enumerate siblings). The 3 sites differ:
- **worker** `build_graph_for`: `st = get_store(settings)` already at :72 — but it is built
  AFTER the `ProfileContext` at :67. Reorder: build `st` first, call
  `load_registry()`, then `build_sibling_context(loaded, settings, st, registry)`, then pass
  the result into `ProfileContext`. The same `st` already flows into the graph at :79/:86/:92
  (one store instance — sibling read + remember write share it, correct).
- **cron** `main`: store is built inside `_build_graph` (:59). Build a store + registry in
  `main` BEFORE the `ProfileContext` (:105) for the sibling read, and pass it down so
  `_build_graph` reuses the SAME store rather than building a second one. Simplest:
  `_build_graph` already builds its own store; to avoid two stores, thread the
  sibling-context inputs through `main` only (build a throwaway store JUST for the read is
  acceptable for InMemoryStore — but for Postgres two connections is wasteful). **Decision:**
  add a `store` param to `_build_graph(... , store=None)`; build `st = get_store(settings)`
  once in `main`, use it for `build_sibling_context` AND pass it to `_build_graph` (which
  uses the passed store when given, else builds its own — backward-compatible default).
- **cli** `_context_of(loaded, settings)`: change signature to
  `_context_of(loaded, settings, store, registry)` and build `st`+registry at the call site
  (`cli.py:303` region) before `_context_of`, threading the same `st` into `_run_report`
  (which currently builds its own at :110 — reuse it, same pattern as cron).

In ALL three: when `build_sibling_context` returns `((), None)` (no project group), the
`ProfileContext` gets `sibling_facts=(), sibling_selector=None, sibling_project=None` ⇒
the `select_sibling_text` gate returns "" ⇒ prompt byte-identical (backward-compat, R3).
Set `sibling_project=loaded.project_group` on the context.

## Files
### Modify `src/runtime/worker.py`
`build_graph_for`: move `st = get_store(settings)` above the `ProfileContext`; add
`from src.runtime.registry import load_registry` + `from src.agent.sibling_memory import
build_sibling_context`; `sib_facts, sib_sel = build_sibling_context(loaded, settings, st,
load_registry())`; pass `sibling_facts=sib_facts, sibling_selector=sib_sel,
sibling_project=loaded.project_group` into `ProfileContext`.

### Modify `src/entrypoints/cron.py`
`main`: build `st = get_store(settings)` + `registry = load_registry()` before the
`ProfileContext`; `sib_facts, sib_sel = build_sibling_context(loaded, settings, st,
registry)`; add the 3 sibling fields to the `ProfileContext`. Add `store` param to
`_build_graph` and pass `st` from `main` (so one store instance serves read + write).

### Modify `src/entrypoints/cli.py`
`_context_of(loaded, settings, store, registry)`: add `build_sibling_context` call + 3
fields. At the call site (`:303` region) build `st`+registry, pass into `_context_of`, and
reuse `st` in `_run_report` (replace its internal `get_store` with the passed store).

### Create `tests/test_sibling_graph_e2e.py` (template = `test_skill_graph_e2e.py`)
Offline, recording fake `LlmClient`. Build a tmp `profiles/` with 2 agents A,B both
`project: acme`, seed B's `(B,"memory")` Store with a fact `SIBLING-FACT-MARKER`, and run A
through each of the 3 real graphs via `default_report_deps`/`default_okr_deps`/
`default_resource_deps` + a FAKE `SiblingFactSelector` that keeps the marker fact.
- `test_internal_injects_sibling_fact_marker_<kind>` ×3 — the recorded INTERNAL user
  message contains `SIBLING-FACT-MARKER` + the `project: acme` label. (AC9)
- `test_external_omits_sibling_fact_marker_<kind>` ×3 — same setup, `audience="external"`,
  recorded external message does NOT contain the marker NOR the label, and equals the
  external message with no siblings. (AC9, R1)
- `test_backward_compat_no_project_byte_identical` — a single-agent registry (A only, no
  `project:`): `build_sibling_context` ⇒ `((), None)`; the recorded INTERNAL message equals
  the message recorded for a pre-P9-shaped `ProfileContext` (no sibling fields). (AC10, R3)
- `test_sibling_context_allocation_free_no_group` — single agent, no `project:` ⇒
  `build_sibling_context` returns `((), None)` and (monkeypatched) constructs no `LlmClient`.
  (AC2)

### Modify `docs/system-architecture.md`
Add an A3 subsection under the memory section: (1) sibling facts read per-sibling from the
Store namespace `(sibling_id,"memory")` (no wildcard; works InMemory + Postgres); (2) the
RED LINE — sibling facts INTERNAL-only, never external, never Action Gateway, same gate as
project/memory/skills; (3) **threat-model change (R6):** A3 WIDENS exposure — agent B now
reads agent A's unfiltered remembered facts; memory facts are NOT secret-scanned
(`memory_extractor.py:13-17` accepted residual risk), so the mitigation is the internal-only
boundary (no new external surface is created). State this explicitly so a future maintainer
does not route sibling facts externally.

## Validation
```
uv run pytest tests/test_sibling_graph_e2e.py tests/test_profile_entrypoints.py \
  tests/test_graph_and_cli.py tests/test_server_agents.py -q
uv run ruff check src/runtime/worker.py src/entrypoints/cron.py src/entrypoints/cli.py \
  tests/test_sibling_graph_e2e.py
uv run pytest -q   # full suite: ≥ 593 + new, all green
```

## Risks + rollback
- **R1 (external leak):** e2e per-kind external test asserts the marker is absent AND the
  external message equals the no-sibling external message. The M2-P6 server path inherits
  worker's `build_graph_for`, so it is covered transitively (note in plan).
- **R3 (backward-compat drift):** `((), None)` no-op path + the byte-identical e2e test; the
  committed `registry.yaml` + `default` profile are untouched (no `project:`).
- **R4 (sibling load crash):** enumeration's per-sibling try/except (S1) protects the live
  run; e2e includes an unloadable-sibling variant if cheap, else covered by S1.
- **Store-reuse regressions (cron/cli):** the `store=` threading must not change the
  no-sibling behavior — the existing graph-and-cli + entrypoints tests guard this; run them
  explicitly above.
- **Rollback:** revert the 3 entry-point edits (restore original `ProfileContext`
  construction + the inner `get_store`), delete the e2e test, revert the architecture doc
  paragraph. S1+S2 code stays in tree but dormant (no caller passes facts) — suite stays
  green at the S2 state.

## Unresolved
- None. VERIFIED 2026-06-26: the FastAPI server has NO independent graph-build seam —
  `src/server/graph_runner.py:37,43` calls `worker.build_graph_for`, so the server inherits
  A3 sibling wiring transitively through worker. No extra file joins S3's Ownership table;
  the server's external-no-leak is covered by worker's wiring + the per-kind e2e tests.
