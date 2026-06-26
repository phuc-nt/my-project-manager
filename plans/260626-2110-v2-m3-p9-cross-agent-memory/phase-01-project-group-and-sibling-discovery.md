# Phase 01 — `project:` profile field + sibling discovery/read helper

**Slice S1.** Status: done (commit `10a60f1`). Ships the grouping field and a tested read helper. ZERO prompt change — the
suite stays green and every compose prompt is byte-identical to pre-P9 (nothing calls the
helper yet).

## Context links
- `src/profile/loader.py:40-58` — `LoadedProfile` (note `project: str` = PROJECT.md at
  :54, the field we must NOT clash with); `load_profile` parse block :110-122.
- `src/agent/store.py:29` — `get_store(settings)` → `(agent_id, "memory")` namespace.
- `src/agent/memory_node.py:25,59` — `_NAMESPACE_KIND = "memory"`; write key =
  `sha256(fact)[:16]`, value `{"fact":..., "ts":...}`.
- `src/runtime/registry.py:30,71` — `load_registry()` → `tuple[RegistryEntry(id, enabled)]`.
- `src/runtime/agent_paths.py` — `agent_data_dir`, `_validate_agent_id`.
- `src/skills/skill_pool.py:43-57` — `build_skill_context` allocation-free pattern to mirror.

## Decisions (resolved here)
- **Field name `project_group`** (clean: grep confirms no existing `project_group`/`team`
  symbol; `project` is taken by PROJECT.md contents).
- **Read source = Store namespace `(sibling_id,"memory")`** (NOT the sibling's MEMORY.md).
  Decision 5 mandates per-sibling `store.get`; the Store is the durable source of truth and
  is the only consistent source under Postgres (a sibling's MEMORY.md file need not be
  co-located with the reader). MEMORY.md is the human mirror, not the read path here.
- **Fact type** = plain `str` list (the `"fact"` value the writer stored), to feed the
  selector exactly like skills feed `select_skill_text`.

## Files
### Modify `src/profile/loader.py`
- Add to `LoadedProfile` (after `skills`, keep frozen):
  `project_group: str | None = None  # M3-P9: sibling group slug (None ⇒ no siblings)`
- In `load_profile`, parse from the YAML doc directly (top-level key, like `name`/`skills`
  — NOT via `loader_mapping`, which only maps settings/reporting sections):
  read `yaml_doc.get("project")`, coerce to a non-empty stripped `str` or `None`
  (blank/absent ⇒ `None`). Pass `project_group=...` to the constructor.

### Create `src/agent/sibling_memory.py` (< 120 LOC)
Single shared helper the 3 entry points (S3) call. Mirrors `skill_pool.build_skill_context`:
returns the no-op WITHOUT constructing an `LlmClient` when there is nothing to do.

- `MAX_SIBLING_FACTS: int = 40` — read-side hard cap (bounds the prompt even if the
  selector passes everything; see R: flood).
- `enumerate_siblings(self_id, self_group, registry, *, profiles_dir=None, data_dir=None)
  -> list[str]`:
  - `self_group is None` ⇒ `[]`.
  - For each `RegistryEntry` where `enabled` and `id != self_id`: `load_profile(id, ...)`
    inside `try/except (FileNotFoundError, RuntimeError)` → on failure `logger.warning(...)`
    and `continue` (R4). Keep a sibling only when its `project_group == self_group`.
  - Return the kept ids (deterministic registry order).
- `read_sibling_facts(sibling_ids, store) -> list[str]`:
  - For each id: `items = store.search((id, _NAMESPACE_KIND))` if available, else iterate.
    **Use the documented namespace-keyed API:** `store.search((id,"memory"))` returns the
    items in that namespace for BOTH `InMemoryStore` and `PostgresStore` (namespace-scoped,
    not a cross-prefix wildcard — satisfies decision 5). Each item's `.value["fact"]` is the
    fact string. (If `search` is unavailable in the pinned langgraph, fall back to the
    per-sibling enumeration documented in store base — confirm the exact method name against
    the installed langgraph during implementation; do NOT assume a prefix query.)
  - Collect facts, stop at `MAX_SIBLING_FACTS`, return.
  - Import `_NAMESPACE_KIND` from `src.agent.memory_node` (single source of the `"memory"`
    namespace constant — DRY).
- `build_sibling_context(loaded, settings, store, registry) -> tuple[tuple[str,...], object|None]`:
  - `loaded.project_group is None` ⇒ `return (), None` (NO `LlmClient`, allocation-free).
  - `ids = enumerate_siblings(...)`; empty ⇒ `return (), None`.
  - `facts = read_sibling_facts(ids, store)`; empty ⇒ `return (), None`.
  - Else `from src.agent.sibling_selector import make_llm_selector` +
    `from src.llm.client import LlmClient`; `return tuple(facts), make_llm_selector(LlmClient(settings))`.
  - **NOTE:** `sibling_selector` module is created in S2. To keep S1 independently green,
    S1 ships `build_sibling_context` returning ONLY `tuple(facts)` and `None` selector
    (the `make_llm_selector` import line is added in S2 when the module exists). S1's test
    asserts the facts tuple + `None`; S2 updates the helper to pair the real selector and
    updates that one assertion. (This keeps the S1/S2 boundary clean: S1 = read, S2 =
    rank+inject.)

### Create `tests/test_sibling_memory.py`
Build tmp `profiles/` dirs + a tmp `registry.yaml`; use `InMemoryStore`; pre-seed sibling
facts with `store.put((sibling_id,"memory"), key, {"fact": ..., "ts": ...})`.
- `test_project_group_parsed_present_absent_blank` — `project: acme` ⇒ `"acme"`; no key
  ⇒ `None`; `project: "   "` ⇒ `None`. (AC1)
- `test_enumerate_siblings_filters_group_and_excludes_self` — A,B,C; A,B share `acme`, C
  in `beta`; from A ⇒ `["B"]` (not A, not C). (AC3)
- `test_enumerate_skips_disabled_and_unloadable` — a disabled registry entry skipped; a
  sibling whose `profile.yaml` is missing logged-and-skipped, no raise; others still
  returned. (AC4)
- `test_read_sibling_facts_from_store_namespace` — seed B's `(B,"memory")` with 2 facts;
  from A ⇒ those 2 fact strings; A's own facts excluded. (AC3, decision 5)
- `test_read_sibling_facts_capped` — seed > `MAX_SIBLING_FACTS`; result length ==
  `MAX_SIBLING_FACTS`.
- `test_build_sibling_context_noop_allocation_free` — `project_group=None` ⇒ `((), None)`
  and (monkeypatch `LlmClient.__init__` to raise) no `LlmClient` constructed; same for a
  1-agent group. (AC2)

## Validation
```
uv run pytest tests/test_sibling_memory.py tests/test_profile_loader.py -q
uv run ruff check src/profile/loader.py src/agent/sibling_memory.py tests/test_sibling_memory.py
```
Then the full suite must stay green (no prompt path touched):
```
uv run pytest -q
```

## Risks + rollback
- **R4 (sibling load fails → crash):** every `load_profile` in `enumerate_siblings` is in
  try/except → warn + skip. Test asserts no raise.
- **R7 (Postgres can't enumerate):** namespace-scoped `store.search((id,"memory"))`, not a
  prefix wildcard — confirm the method name against installed langgraph before finalizing
  steps; both backends expose namespace-scoped listing.
- **Backward-compat:** new field defaults `None`; `default` profile has no `project:` ⇒
  unaffected. Helper unused until S3 ⇒ no prompt change this slice.
- **Rollback:** revert `loader.py` field + delete `sibling_memory.py` + its test. No
  schema/data migration, no shared-state change — clean revert, suite returns to 593.

## Unresolved (confirm during impl, not blocking the plan)
- Exact langgraph Store listing method (`search` vs `list`/iterate) on the pinned version —
  verify against `langgraph.store.base.BaseStore` before writing `read_sibling_facts`.
