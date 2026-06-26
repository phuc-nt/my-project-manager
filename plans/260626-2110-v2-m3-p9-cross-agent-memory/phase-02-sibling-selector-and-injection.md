# Phase 02 — `SiblingFactSelector` + internal-only injection + write boundary

**Slice S2.** Status: done (commit `ba046af`). Adds the injectable ranker, folds sibling text into the 3 builders' INTERNAL
branch behind an empty default, adds `ProfileContext` fields, and hardens the write
boundary. Prompts stay byte-identical until S3 passes non-empty facts, so the suite stays
green this slice too.

## Context links
- `src/skills/skill_selector.py` — the EXACT template (`SkillSelector` Callable,
  `make_llm_selector` graceful-on-failure, `select_skill_text` internal gate at :60-63,
  `render_skills` block, `_parse_names`).
- `src/profile/context.py:28-41` — `ProfileContext` frozen dataclass (add 2 fields).
- `src/llm/report_prompt.py:71-126` (`_skill_block` + `build_report_messages`),
  `:141-201` (`build_detail_messages`) — external early-return then internal branch
  `build_context_block(project,memory) + _skill_block(skills) + user`.
- `src/llm/okr_report_prompt.py:121-161` (`skills` param at :129, fold at :158-161,
  external return at :151).
- `src/llm/resource_report_prompt.py:161-215` (`skills` at :170, fold at :212-215,
  external return at :179).
- `src/agent/report_graph.py:115-131` (`_compose`: `select_skill_text` at :120, passes
  `skills=skill_text` at :130).
- `src/agent/okr_report_graph.py:104-119` (`_narrate`: `skills=select_skill_text(...)` :119).
- `src/agent/resource_report_graph.py:108-125` (`_narrate`: same :125).
- `src/agent/memory_node.py:43-63` — `remember` writes `store.put((agent_id,"memory"),...)`.

## Decisions (resolved here)
- **Selector failure default = `[]`** (drop all siblings). Rationale: a sibling-LLM outage
  must neither degrade the report (so we don't hard-fail) nor flood it (so we don't pass
  everything through unranked). `[]` is the only value satisfying both; the read-side
  `MAX_SIBLING_FACTS` cap (S1) is the separate flood guard for the SUCCESS path. Mirrors
  `make_llm_selector` in `skill_selector.py:42-43` returning `[]` on exception.
- **Own labeled block** = `--- Bộ nhớ agent khác (project: <slug>) ---`, rendered SEPARATE
  from the self-memory block, so the LLM never attributes a sibling's fact to itself. The
  block is a distinct string appended after `_skill_block` in the INTERNAL user message.

## Files
### Create `src/agent/sibling_selector.py` (< 110 LOC) — mirror `skill_selector.py`
- `SiblingFactSelector = Callable[[list[str], str], list[str]]` — `(facts, kind_context)
  -> kept facts` (rank → subset; returns a subset of the input facts, not names).
- `make_llm_selector(client) -> SiblingFactSelector`: prompt the LLM (Vietnamese system
  string) to keep only facts relevant to the report kind, one per line; on ANY exception
  `logger.warning(...)` + `return []`. Parse the reply, then **filter back to the input
  set** (drop any line the LLM invented — same hallucination guard as
  `select_skill_text`'s name filter at `skill_selector.py:63-64`).
- `select_sibling_text(context, audience, *, kind, project_group) -> str`:
  - Gate (identical shape to `select_skill_text:55`): `if audience != "internal" or not
    context.sibling_facts or context.sibling_selector is None: return ""`.
  - `kept = context.sibling_selector(list(context.sibling_facts), kind)`; keep input order;
    `return render_sibling_facts(kept, project_group)`.
- `render_sibling_facts(facts, project_group) -> str`: `"" if not facts`; else
  `f"--- Bộ nhớ agent khác (project: {project_group}) ---\n" + "\n".join(facts)`.
  **NOTE:** `select_sibling_text` needs `project_group` for the label. Pass it via a new
  `ProfileContext.sibling_project` field set at the entry point (S3), OR thread it from the
  graph. Decision: store it on `ProfileContext` (one place, frozen) → field `sibling_project:
  str | None = None`. The render label uses it; when `None` (no siblings) the gate already
  returned "".

### Modify `src/profile/context.py`
Add to `ProfileContext` (after `skill_selector`, keep frozen, keep `EMPTY` valid):
```
sibling_facts: tuple[str, ...] = ()        # M3-P9 sibling memory (internal only)
sibling_selector: SiblingFactSelector | None = field(default=None)
sibling_project: str | None = None         # label slug for the sibling block
```
Add the `TYPE_CHECKING` import for `SiblingFactSelector`. Docstring: same red line as
project/memory/skills — internal only, default empty ⇒ no injection.

### Modify the 3 prompt builders — add `sibling_facts: str = ""`, fold INTERNAL only
For `report_prompt.py` (`build_report_messages` AND `build_detail_messages`),
`okr_report_prompt.py` (`build_okr_narrative_messages`), `resource_report_prompt.py`
(`build_resource_narrative_messages`):
- Add `sibling_facts: str = ""` kwarg (after `skills`).
- In the INTERNAL branch ONLY (AFTER the `if audience == "external": return [...]`), append
  the sibling block to the user content, AFTER `_skill_block(skills)`:
  `build_context_block(project, memory) + _skill_block(skills) + _sibling_block(sibling_facts) + user`
  where `_sibling_block(s) = f"{s.strip()}\n\n" if s.strip() else ""` (define once per
  module, parallel to `_skill_block`; or reuse the inline `f"{x.strip()}\n\n" if ...` form
  the okr/resource modules already use).
- **External branch UNTOUCHED** — `sibling_facts` is never referenced there (R1).
- Update each docstring: `sibling_facts` internal-only, default "" ⇒ v1/pre-P9 prompt.

### Modify the 3 compose closures — call `select_sibling_text`, pass the result
- `report_graph.py` `_compose`: add
  `sibling_text = select_sibling_text(context, audience, kind=report_kind, project_group=context.sibling_project)`
  next to the existing `skill_text` line; pass `sibling_facts=sibling_text` into
  `build_detail_messages`.
- `okr_report_graph.py` `_narrate`: pass
  `sibling_facts=select_sibling_text(context, audience, kind="okr", project_group=context.sibling_project)`.
- `resource_report_graph.py` `_narrate`: same with `kind="resource"`.
- Add `from src.agent.sibling_selector import select_sibling_text` to each graph module.

### Modify `src/agent/memory_node.py` — WO-self write boundary (fail loud)
In `make_memory_node`'s `remember`, before the write loop, assert the target namespace is
self's. Concretely, keep writing `(agent_id, _NAMESPACE_KIND)` (already correct), and add a
guard helper so a future/buggy caller cannot widen it:
```
def _assert_self_namespace(ns, agent_id):
    if ns != (agent_id, _NAMESPACE_KIND):
        raise PermissionError(
            f"memory write denied: {ns!r} is not this agent's namespace "
            f"({(agent_id, _NAMESPACE_KIND)!r}); agents write only their own memory."
        )
```
Call it with the namespace actually used in `store.put`. This makes RO-sibling/WO-self an
enforced invariant (decision 3) rather than an implicit one. Keep `memory_node.py` < 200
LOC (currently 101).

### Create `tests/test_sibling_selector.py`
- `test_select_sibling_text_internal_returns_block` — fake selector returns a subset; block
  contains the label `project: acme` + the kept facts. (AC5)
- `test_select_sibling_text_external_returns_empty` — `audience="external"` ⇒ `""`. (AC5)
- `test_select_sibling_text_no_selector_or_no_facts_empty` — both ⇒ `""`. (AC5)
- `test_make_llm_selector_graceful_on_failure` — client raising ⇒ selector returns `[]` ⇒
  `select_sibling_text` ⇒ `""`. (AC6)
- `test_selector_drops_hallucinated_facts` — LLM returns a fact not in input ⇒ filtered out.
- `test_render_empty_is_empty_string`.

### Create `tests/test_sibling_write_boundary.py`
- `test_memory_node_writes_own_namespace` — `remember` on a delivered internal run writes
  `(self,"memory")` (assert via InMemoryStore). (AC7)
- `test_memory_node_rejects_foreign_namespace` — drive `_assert_self_namespace((other,
  "memory"), self_id)` (or a node built to target a foreign ns) ⇒ raises `PermissionError`.
  (AC7, R2)

### Red-line tests — `test_external_ignores_sibling_facts` per builder (in the selector test file or a dedicated one)
For each of the 4 builder entry points (report, detail, okr, resource): build INTERNAL
messages with `sibling_facts="X-SIBLING-MARKER"` and EXTERNAL messages with the SAME arg;
assert the external messages equal the external messages built with `sibling_facts=""`
(byte-identical), and that the marker is absent from external but present in internal.
(AC8, R1)

## Validation
```
uv run pytest tests/test_sibling_selector.py tests/test_sibling_write_boundary.py \
  tests/test_profile_context.py tests/test_memory_node_extract_and_mirror.py \
  tests/test_okr_report.py tests/test_resource_report.py -q
uv run ruff check src/agent/sibling_selector.py src/profile/context.py \
  src/llm/report_prompt.py src/llm/okr_report_prompt.py src/llm/resource_report_prompt.py \
  src/agent/report_graph.py src/agent/okr_report_graph.py src/agent/resource_report_graph.py \
  src/agent/memory_node.py
uv run pytest -q   # full suite stays green; prompts byte-identical (default "" everywhere)
```

## Risks + rollback
- **R1 (external leak):** sibling text folded ONLY after the external early-return; gate in
  `select_sibling_text`; per-builder byte-identical tests. The external message list never
  references `sibling_facts`.
- **R2 (write boundary):** `_assert_self_namespace` raises; dedicated test.
- **R3 (backward-compat drift):** every new param defaults `""`/`()`/`None`; with S3 not
  yet wired, no entry point passes non-empty facts ⇒ prompts identical ⇒ suite green.
- **R5 (selector non-determinism):** all tests inject a FAKE selector; no live LLM.
- **Rollback:** delete `sibling_selector.py` + 2 tests; revert the `sibling_facts` param +
  fold lines in the 3 prompt modules and 3 graphs; revert the `ProfileContext` fields and
  the `_assert_self_namespace` guard. Default-"" design means a partial revert never breaks
  callers (they pass nothing). Suite returns to S1 state.

## Unresolved
- None blocking. Confirm `_sibling_block` helper vs inline form per module to keep each file
  < 200 LOC and ruff-clean (report_prompt.py is the largest at 209 — adding a 2-line helper
  + one param keeps it near limit; prefer the inline `f"{x.strip()}\n\n"` form there to
  avoid crossing 200, OR extract the shared `_block(x)` helper to `context.py` and import it
  — decide at impl based on the exact LOC after edit).
