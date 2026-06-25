# S3 — Entry-point wiring + end-to-end offline graph tests

**Status:** pending · **Effort:** ~2h · **Blocks:** none · **Blocked by:** S2

## Goal

Wire the candidate-pool loading + the real selector into all THREE graph-build entry
points, so a profile with a `skills:` block actually injects at compose time. Prove
end-to-end (offline, fake selector + recording fake LLM): internal carries skills,
external carries none, empty pool == today.

## Context Links

- THREE entry points (scout said "single seam" — WRONG; all 3 build `ProfileContext`):
  - `src/runtime/worker.py:54` `build_graph_for` — `ProfileContext(...)` at `:65`.
  - `src/entrypoints/cron.py:53` `_build_graph`; `ProfileContext(...)` at `main` `:102`.
  - `src/entrypoints/cli.py:71` `_context_of`; used by `_run_report` `:98`.
- `LoadedProfile.skills` (from S1) = the candidate-pool NAMES.
- `load_skills` (S1) + `ProfileContext.skills`/`.skill_selector` (S2).
- Selector default: `make_llm_selector(LlmClient(settings))` — mirror how
  `build_remember_node` builds `make_llm_extractor(LlmClient(settings))`
  (`memory_node.py:91`).

## Requirements

1. A `skill_pool.py` helper: `load_skill_pool(skill_names) -> tuple[Skill, ...]` — calls
   `load_skills(BUNDLED_SKILLS_DIR)`, filters to `skill_names`, preserves pool order,
   warns on a named-but-missing skill. Empty `skill_names` → `()` (no disk read needed).
2. Each entry point: build the pool from `loaded.skills` + build the selector, and pass
   both into the `ProfileContext` it already constructs.
3. The selector is built ONLY when the pool is non-empty (avoid an `LlmClient` for the
   default profile — keeps the no-skills path allocation-free + identical).

## Files to Create

- `src/skills/skill_pool.py` — `load_skill_pool` + `build_skill_context(loaded, settings)`
  returning `(skills_tuple, selector_or_None)` (< 70 LOC). Centralizes the wiring so the 3
  entry points each call ONE helper (DRY — no copy-paste of pool+selector logic).
- `tests/test_skill_graph_e2e.py`.

## Files to Modify

- `src/runtime/worker.py` (`build_graph_for`, `:65`):
  ```
  skills, selector = build_skill_context(loaded, settings)
  context = ProfileContext(
      persona=loaded.soul, project=loaded.project, memory=loaded.memory,
      skills=skills, skill_selector=selector,
  )
  ```
- `src/entrypoints/cron.py` (`main`, `:102`): same extension to the `ProfileContext(...)`.
- `src/entrypoints/cli.py` (`_context_of`, `:71`): extend to build skills+selector. Note
  `_context_of` currently takes only `loaded`; it needs `settings` to build the selector —
  change its signature to `_context_of(loaded, settings)` and update its call site in
  `_run_report` (`:98`, which already has `settings`). Verify no other caller of
  `_context_of` (grep before edit).

`build_skill_context(loaded, settings)`:
```
def build_skill_context(loaded, settings):
    pool = load_skill_pool(loaded.skills)        # () when no skills: block
    if not pool:
        return (), None
    from src.skills.skill_selector import make_llm_selector
    from src.llm.client import LlmClient
    return pool, make_llm_selector(LlmClient(settings))
```

## Implementation Steps

1. `skill_pool.py`: `load_skill_pool` (filter+order+warn) + `build_skill_context`.
2. Edit the 3 entry points to call `build_skill_context` and pass the two new
   `ProfileContext` kwargs. (3 small, symmetric edits.)
3. `tests/test_skill_graph_e2e.py` using a recording fake LLM client + fake selector +
   injected `deps=None` real wiring with a stub `LlmClient`. Prefer building the graph
   with an explicit `context` carrying a fake selector + a 1-skill pool, and a fake LLM
   client that records the messages it receives, then assert on the captured messages.

## Test / Validation (offline)

`tests/test_skill_graph_e2e.py`:
- `test_load_skill_pool_filters` — `load_skill_pool(("flag-risk",))` → 1 Skill named
  `flag-risk`; `load_skill_pool(())` → `()`; an unknown name → warned + dropped.
- `test_internal_graph_injects_skill_body` — build a report graph (daily) with a
  `ProfileContext(skills=(flag_risk,), skill_selector=lambda s,k: ["flag-risk"])` and a
  recording fake LLM client; invoke; assert the captured compose messages contain the
  `flag-risk` body. Repeat for okr + resource (their `_narrate`).
- `test_external_graph_no_skill_body` (RED LINE) — same pool/selector but
  `audience="external"`; assert NO skill body in any captured message.
- `test_empty_pool_messages_identical` — pool `()` → captured messages byte-identical to a
  context with no skills (a no-skills baseline run).
- `test_build_skill_context_no_skills_returns_none` — `loaded.skills == ()` →
  `build_skill_context` returns `((), None)` WITHOUT constructing an `LlmClient` (assert no
  network/key needed — call with a settings missing the key, must not raise).

Commands:
```
uv run pytest tests/test_skill_graph_e2e.py -q
uv run pytest tests/test_worker.py tests/test_cron.py tests/test_cli.py -q   # entry regressions (names per repo)
uv run pytest -q                                   # full 545 green
uv run ruff check src/skills src/runtime/worker.py src/entrypoints
```

How to record messages: inject a fake `LlmClient` whose `.complete(messages)` stores
`messages` and returns a canned `CompletionResult`. Pass it via the graph's `deps`
(`default_report_deps(..., client=fake)`) OR build `deps` directly with a `_compose` that
uses the fake — choose the path the existing graph tests already use (grep
`tests/test_report_graph*.py` for the established fake-LLM helper and reuse it; do NOT
invent a new fake if one exists).

## LOC Watch

`skill_pool.py` < 70. Entry-point edits are ~3 lines each. `cli._context_of` signature
change is the only contract touch — confirm its sole caller is `_run_report`.

## Risks / Rollback

- **R3 (entry points):** all 3 verified; `build_skill_context` is the single shared helper
  so wiring can't diverge. Each entry point gets an e2e assertion.
- **R1 (external leak end-to-end):** `test_external_graph_no_skill_body` per kind.
- **No-skills allocation:** `build_skill_context` returns early on empty pool — no
  `LlmClient`, so the default profile path is unchanged (proven by
  `test_build_skill_context_no_skills_returns_none`).
- **Rollback:** revert the entry-point edits → `ProfileContext` built without skills →
  injection inert (S2 builders still accept the unused param). No data/schema change.

## Done = Observable

A profile with `skills: [flag-risk]` running an internal graph injects the `flag-risk`
body into the compose messages; the external graph injects none; an empty pool yields
byte-identical messages; the default profile builds no selector; all 545 baseline tests
green; ruff clean.

## Post-Implementation

Update `docs/system-architecture.md` (skill-system data flow) + `docs/project-roadmap.md`
(mark M3-P10 done) ONLY after S3 lands. Optionally suggest an end-to-end verification run
of one internal + one external report to confirm the red line holds live.
