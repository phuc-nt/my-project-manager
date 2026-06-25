# S2 — Injectable selector + internal-only compose injection

**Status:** done (commit `3413261`) · **Effort:** ~4h · **Blocks:** S3 · **Blocked by:** S1

## Goal

Add the injectable `SkillSelector`, extend `ProfileContext` to carry the candidate skills
+ selector, and inject the chosen skill bodies into the INTERNAL compose prompt of all 3
builders — external byte-identical, no-skills byte-identical. Still no entry-point wiring
(S3); here we prove the prompt mechanics in isolation.

## Context Links

- Injectable LLM pattern to MIRROR: `src/agent/memory_extractor.py` —
  `MemoryExtractor = Callable` (`:31`), `make_llm_extractor(client)` (`:41`), failure →
  `[]` (`:53`), `_parse_facts` line-split (`:60`).
- Internal-only injection helpers: `src/profile/context.py` — `prepend_persona` (`:36`),
  `build_context_block` (`:49`), `ProfileContext` (`:23`).
- The 3 builders' internal/external branches (inject point = internal branch only):
  - `report_prompt.py:130` `build_detail_messages` (external returns `:159`, internal `:183`).
    Also `report_prompt.py:71` `build_report_messages` (external `:101`, internal `:112`).
  - `okr_report_prompt.py:121` `build_okr_narrative_messages` (external `:152`, internal `:156`).
  - `resource_report_prompt.py:161` `build_resource_narrative_messages` (external `:191`, internal `:211`).
- Compose closures that call the builders (select+inject site):
  - `report_graph.py:114` `_compose` → `build_detail_messages(...)` `:119`.
  - `okr_report_graph.py:103` `_narrate` → `build_okr_narrative_messages(...)` `:111`.
  - `resource_report_graph.py:107` `_narrate` → `build_resource_narrative_messages(...)` `:116`.
- External-clean test precedent to mirror: `tests/test_audience_prompts.py:119`.

## Requirements

1. `SkillSelector = Callable[[list[Skill], str], list[str]]` — input `(candidate_skills,
   kind_context)`, output chosen skill NAMES.
2. `make_llm_selector(client) -> SkillSelector` — default LLM impl; asks "which of these
   skills are relevant to a `<kind>` report?"; tolerates failure → `[]`.
3. A `render_skills(skills) -> str` helper → `<pm_skills>\n{body1}\n\n{body2}\n</pm_skills>`
   (empty list → `""`).
4. `ProfileContext` gains `skills: tuple[Skill, ...] = ()` and
   `skill_selector: SkillSelector | None = None` (both default → no injection).
5. The 3 builders gain `skills: str = ""` — injected into the INTERNAL user message ONLY,
   alongside the `build_context_block` output. External branch unaffected.
6. The 3 compose closures: if `audience=="internal"` AND `context.skills` AND
   `context.skill_selector`: call the selector, FILTER returned names to the candidate
   pool, render the chosen bodies, pass `skills=<rendered>`; else `skills=""`.

## Files to Create

- `src/skills/skill_selector.py` — `SkillSelector` type, `make_llm_selector`,
  `render_skills`, a `_parse_names` helper (< 110 LOC). Mirror `memory_extractor.py`'s
  shape closely.
- `tests/test_skill_selector.py`.
- `tests/test_skill_compose_injection.py`.

## Files to Modify

- `src/profile/context.py`:
  - Import `Skill` (from `src.skills.models`) + `SkillSelector` (TYPE_CHECKING to avoid a
    runtime cycle if needed).
  - Add `skills: tuple[Skill, ...] = ()` and `skill_selector: SkillSelector | None = None`
    to `ProfileContext` (after `memory`). `EMPTY` stays valid (all defaulted).
- `src/llm/report_prompt.py`:
  - `build_report_messages` + `build_detail_messages`: add `skills: str = ""`. In each
    INTERNAL branch, fold the skill block into the user message:
    `build_context_block(project, memory) + _skill_block(skills) + user`
    where `_skill_block(s) = (s.strip() + "\n\n") if s.strip() else ""`. External branch:
    untouched (no `skills` reference before its early return).
- `src/llm/okr_report_prompt.py`: same `skills: str = ""` + internal-branch fold on
  `build_okr_narrative_messages`.
- `src/llm/resource_report_prompt.py`: same on `build_resource_narrative_messages`.
- `src/agent/report_graph.py` `_compose` (`:114`): before `build_detail_messages`, compute
  `skill_text = _select_skill_text(context, audience, kind=report_kind)`; pass `skills=skill_text`.
- `src/agent/okr_report_graph.py` `_narrate` (`:103`): same, `kind="okr"`.
- `src/agent/resource_report_graph.py` `_narrate` (`:107`): same, `kind="resource"`.

  `_select_skill_text` is a small shared helper (put in `skill_selector.py`):
  ```
  def select_skill_text(context, audience, *, kind) -> str:
      if audience != "internal" or not context.skills or context.skill_selector is None:
          return ""
      names = set(context.skill_selector(list(context.skills), kind))
      chosen = [s for s in context.skills if s.name in names]   # filter to pool (R7)
      return render_skills(chosen)
  ```

## Implementation Steps

1. `skill_selector.py`: `SkillSelector` type alias; `make_llm_selector` (system prompt
   lists name+description, asks for relevant names; `client.complete`; `_parse_names`
   splits lines/commas; `except Exception → []`); `render_skills`; `select_skill_text`.
2. `context.py`: add the two fields. Keep frozen.
3. Edit the 3 builder modules: add `skills: str = ""` param + internal-branch fold. Do NOT
   reference `skills` anywhere in the external branch.
4. Edit the 3 compose closures to call `select_skill_text(...)` and pass `skills=`.
5. Tests.

## Test / Validation (offline)

`tests/test_skill_selector.py`:
- `test_fake_selector_returns_fixed` — a fake `Callable` returns `["flag-risk"]`.
- `test_make_llm_selector_tolerates_failure` — inject a client whose `.complete` raises →
  selector returns `[]` (mirror the extractor test).
- `test_render_skills_empty_is_blank` and `test_render_skills_wraps_bodies`.
- `test_select_skill_text_external_is_blank` — `audience="external"` → `""` even with a
  pool + selector.
- `test_select_filters_unknown_names` (R7) — selector returns a name NOT in the pool → it
  is dropped.

`tests/test_skill_compose_injection.py` (per builder — report/detail/okr/resource):
- `test_internal_injects_skill_body` — `build_*_messages(..., skills="<pm_skills>BODY</pm_skills>")`
  → `"BODY"` in the INTERNAL user message.
- `test_external_ignores_skills` (RED LINE) — same call with `audience="external"` →
  `"BODY"` NOT in any message; assert byte-identical to `audience="external"` w/o `skills`.
- `test_empty_skills_byte_identical` — `build_*_messages(..., skills="")` == the call with
  no `skills` arg (backward-compat). Pair with the existing
  `test_*_internal_unchanged` style.

Commands:
```
uv run pytest tests/test_skill_selector.py tests/test_skill_compose_injection.py -q
uv run pytest tests/test_audience_prompts.py -q     # regression on the shared builders
uv run pytest -q                                    # full 545 green
uv run ruff check src/skills src/llm src/profile/context.py src/agent
```

## LOC Watch

`skill_selector.py` < 110. The 3 builder files each gain ~3 lines (param + fold) — well
under 200. `context.py` gains 2 fields. If a builder nears 200, it was already large
(`report_prompt.py` is ~195 — adding 1 param to 2 functions is ~4 lines; confirm it stays
< 200, else split the external strings further — but they already live in
`audience_external_prompts`).

## Risks / Rollback

- **R1 (external leak):** `skills` referenced ONLY after the external early-return.
  Dedicated `test_external_ignores_skills` per builder. Highest-priority assertion.
- **R2 (backward-compat):** `skills: str = ""` default + `_skill_block` guards on
  `.strip()`. Byte-identical test per builder.
- **R4 (non-determinism):** selector injectable; tests use a fake; real selector never
  called offline.
- **R7 (hallucinated name):** `select_skill_text` filters returned names to the pool.
- **Rollback:** revert removes the param + selector + `ProfileContext` fields. Builders
  back to persona/project/memory. (Revert S3 first if present.)

## Done = Observable

Internal prompt carries the injected `<pm_skills>` body; external prompt has none and is
byte-identical to no-skills; `skills=""` byte-identical to pre-P10; fake selector drives a
fixed pick; real selector tolerates failure; 545 green; ruff clean.
