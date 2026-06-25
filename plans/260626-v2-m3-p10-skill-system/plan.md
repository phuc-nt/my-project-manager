---
title: "v2 M3-P10 — PM Skill System (C1 bundled, LLM auto-select)"
description: "Bundled PM SKILL.md instructions auto-selected by an injectable LLM selector and injected into the INTERNAL compose prompt only."
status: pending
priority: P1
effort: 9h
branch: main
tags: [v2, m3, skills, llm]
created: 2026-06-26
---

# v2 M3-P10 — PM Skill System (C1)

A skill system: bundled PM `SKILL.md` files (markdown instructions on how the agent
approaches PM tasks) that an injectable LLM selector picks from before compose, then
injects into the INTERNAL report compose prompt — the same path persona/project/memory
travel. The agent runs the FIXED graph (perceive→analyze→compose→deliver), so there is
NO slash activation; skills auto-load via the selector. C1 only: 5 bundled markdown
skills, NO `.skill` ZIP upload, NO `allowed-tools` enforcement.

## Locked Decisions (design to these — do NOT re-litigate)

1. **C1 only.** Skill-system core + 5 bundled `SKILL.md`. NO C2 `.skill` ZIP upload
   (deferred — avoids the untrusted-unzip / zip-slip surface). NO slash activation.
   Skills are MARKDOWN INSTRUCTIONS only — they do NOT grant `allowed-tools` or execute
   code this round. Frontmatter MAY carry an `allowed-tools` field for forward-compat
   but it is parsed-and-ignored (NOT enforced/used) — documented as such.
2. **Auto-load via an INJECTABLE LLM selector.** Before compose, a selector looks at the
   enabled skills' name+description and picks the relevant subset; their bodies inject
   into the prompt. The selector MUST be injectable so tests run offline with a FAKE
   returning a fixed pick (mirrors the P8 `MemoryExtractor` injectable pattern). The LLM
   call is non-deterministic → isolated behind the injectable seam.
3. **Internal-only injection (RED LINE P5).** Skill bodies inject into the INTERNAL
   compose prompt ONLY — the same path `build_context_block`/`prepend_persona` use. The
   EXTERNAL path takes NOTHING from the profile/skills. A test MUST assert external
   reports contain NO skill content.
4. **Per-agent candidate pool via `profile.yaml` `skills:` block.** `profile.yaml` gains
   a `skills: [flag-risk, estimate-effort]` list = the candidate pool the selector
   chooses FROM. No `skills:` block (or empty) → ZERO skills loaded → behavior IDENTICAL
   to today (backward-compat; the baseline tests stay green). The `default` profile gets
   NO skills block → unchanged.
5. **Backward-compat is non-negotiable.** With no skills configured, the compose prompt
   is byte-identical to today. Skill injection is purely additive when skills ARE enabled.

## Verified Facts (read 2026-06-26 @ e984222)

- **Internal-only injection mechanism** — `src/profile/context.py`:
  - `prepend_persona(system, persona)` (`context.py:36`) → persona PREPENDED to system;
    empty persona ⇒ unchanged.
  - `build_context_block(project, memory)` (`context.py:49`) → labeled block PREPENDED to
    the INTERNAL user message; both empty ⇒ `""`.
  - `ProfileContext` frozen dataclass (`context.py:23`) fields `persona/project/memory`,
    all default `""`; `EMPTY = ProfileContext()` (`context.py:33`).
- **Compose-prompt builders, all 3 share the same shape** — external branch returns EARLY
  with NO persona/project/memory; internal branch uses `prepend_persona` + `build_context_block`:
  - `src/llm/report_prompt.py:71` `build_report_messages(risks, *, report_date, audience="internal", persona="", project="", memory="")`
  - `src/llm/report_prompt.py:130` `build_detail_messages(risks, *, report_date, kind="daily", sprint_context=None, audience="internal", persona="", project="", memory="")`
    — external returns at `:159`; internal returns at `:183`.
  - `src/llm/okr_report_prompt.py:121` `build_okr_narrative_messages(rollup, *, report_date, audience="internal", persona="", project="", memory="")` — external returns at `:152`; internal at `:156`.
  - `src/llm/resource_report_prompt.py:161` `build_resource_narrative_messages(resource, cost, *, report_date, audience="internal", persona="", project="", memory="")` — external returns at `:191`; internal at `:211`.
- **Injectable LLM pattern (mirror exactly)** — `src/agent/memory_extractor.py`:
  - `MemoryExtractor = Callable[[str], list[str]]` (`:31`).
  - `make_llm_extractor(client) -> MemoryExtractor` (`:41`) — wraps `client.complete`,
    tolerates failure with `except Exception → return []` (`:53`).
  - `_parse_facts(content)` (`:60`) — line-split + strip bullets.
- **Profile loader + `LoadedProfile`** — `src/profile/loader.py`:
  - `LoadedProfile` frozen dataclass (`:40`) ALREADY carries `schedule: dict`, `reports:
    tuple[str,...]` (`:57`) — parsed but P3-consumed. `skills` follows `reports` EXACTLY.
  - `reports` parsed at `loader.py:104` & `:118`: `reports = yaml_doc.get("reports") or []`
    → `tuple(str(r) for r in reports) if isinstance(reports, list) else ()`.
  - `yaml` already imported (`loader.py:20`).
- **Graph builders — `context` is the injection vector** — all 3 take `context:
  ProfileContext = EMPTY` and pass it to `default_*_deps(context=...)`, which the
  `_compose`/`_narrate` closures read via `context.persona/.project/.memory`:
  - `build_report_graph` (`report_graph.py:251`) → `default_report_deps` (`:65`) →
    `_compose` (`:114`) calls `build_detail_messages(..., persona=context.persona, ...)` (`:119`).
  - `build_okr_graph` (`okr_report_graph.py:193`) → `default_okr_deps` (`:59`) → `_narrate`
    (`:103`) calls `build_okr_narrative_messages(..., persona=context.persona, ...)` (`:111`).
  - `build_resource_graph` (`resource_report_graph.py:200`) → `default_resource_deps`
    (`:61`) → `_narrate` (`:107`) calls `build_resource_narrative_messages(...)` (`:116`).
- **THREE graph-build entry points (NOT one — scout said "single seam"; that is WRONG):**
  - `src/runtime/worker.py:54` `build_graph_for` — builds `ProfileContext` at `:65`.
  - `src/entrypoints/cron.py:53` `_build_graph` — builds `ProfileContext` at `:102` (in `main`).
  - `src/entrypoints/cli.py:98` `_run_report` — builds `ProfileContext` via `_context_of` (`:71`).
  - ALL THREE construct `ProfileContext(persona=loaded.soul, project=loaded.project,
    memory=loaded.memory)` and pass `context=` to the builders. **`ProfileContext` is the
    DRY injection vector** — extend it once and all 3 entry points inherit skills for free.
- **Greenfield confirmed** — no `skills/` dir, no `*skill*` in `src/`, no `skills` token in
  `src/` or `profiles/`. `profiles/` has only `default/`.
- **External-clean test precedent** — `tests/test_audience_prompts.py:119`
  `test_external_with_hostile_persona_project_memory_no_pii` — asserts a hostile
  persona/project/memory yield ZERO internal facts in the external blob. The new skill
  external-clean test mirrors this exactly (add a `skills=` hostile arg, assert absent).
- **Baseline:** 482 test functions across `tests/`; suite reported as 545 tests (parametrized).
  Clean tree at `e984222`.

## Architecture (data flow)

```
profile.yaml  skills: [flag-risk, estimate-effort]   (candidate pool, per-agent)
      │  parsed in loader_mapping/loader (like `reports`)
      ▼
LoadedProfile.skills: tuple[str,...]
      │  entry point (worker/cron/cli) loads bundled skills + filters to pool
      ▼
skill_loader.load_skills(dir) → [Skill(name, description, applies_to, body), ...]
      │  filter to pool → candidate Skills
      ▼
ProfileContext(persona, project, memory, skills=tuple[Skill], skill_selector=Callable)
      │  threads through context= into build_*_graph (all 3 entry points, unchanged call shape)
      ▼
default_*_deps(context=...) → _compose / _narrate closure
      │  audience=="internal" ONLY:
      │    names = skill_selector(candidate_skills, kind_context)   # LLM, injectable
      │    skill_text = render(<chosen skill bodies>)
      ▼
build_*_messages(..., skills=skill_text)   # NEW param, injected into INTERNAL branch only
      │  external branch: skills param has NO effect (returns early, pre-skills)
      ▼
LLM compose call → report body
```

Selector tolerates failure → `[]` (no skills, graceful — like the extractor). Empty pool
→ skip the selector call entirely → `skills=""` → byte-identical to today.

## The 5 Bundled Skills (C1)

Flat `skills/<name>.md`, one file per skill (KISS — 5 files; dir-per-skill is C2/ZIP
territory). Each = YAML frontmatter (`name`, `description`, `applies_to?`,
`allowed-tools?` parsed-but-ignored) + a SHORT markdown body of real PM guidance.

| name | description | applies_to (hint) |
|---|---|---|
| `flag-risk` | Rank + name the single highest-impact risk | daily, weekly |
| `estimate-effort` | Translate scope signals into rough effort calls | weekly, resource |
| `fetch-jira-epics` | How to read epic/sprint progress signals | weekly, okr |
| `parse-github-labels` | Interpret PR/issue labels for blocker/priority | daily, weekly |
| `prioritize-blockers` | Order the action list blocker > overdue > stale-PR | daily, weekly |

(5th = `prioritize-blockers`; chosen over `summarize-sprint` because it sharpens the
existing "lead with the signal" design-guideline the compose prompt already states.)

## Slices

Each slice is independently runnable, committable, and leaves the suite green.

| Slice | Title | Effort | File |
|---|---|---|---|
| **S1** | Skill loader + 5 bundled SKILL.md + `skills:` profile block + `LoadedProfile.skills` | ~3h | [phase-01-skill-loader-and-profile-block.md](phase-01-skill-loader-and-profile-block.md) |
| **S2** | Injectable selector + internal-only compose injection (3 builders) + ProfileContext wiring | ~4h | [phase-02-selector-and-compose-injection.md](phase-02-selector-and-compose-injection.md) |
| **S3** | Wire candidate-pool loading through the 3 entry points + end-to-end offline graph tests | ~2h | [phase-03-entrypoint-wiring-and-e2e.md](phase-03-entrypoint-wiring-and-e2e.md) |

**Why split S2/S3:** S2 is pure prompt/selector plumbing (offline, no graph, no entry
points) — provable byte-identical + external-clean with unit tests on the builders +
selector. S3 is the integration: load the pool, filter, build `ProfileContext` with
skills, and run a real graph with a fake selector through each entry point. Splitting
keeps each file < 200 LOC of touched surface and isolates the "did the prompt change?"
proof (S2) from the "did the wiring reach the LLM?" proof (S3). The 3-builder change in
S2 is mechanical and symmetric, so it stays one slice.

## Dependency Graph

```
S1 (loader + bundled skills + profile block)  ── no blockers
        │  S2 imports Skill dataclass + load_skills from S1
        ▼
S2 (selector + compose injection)             ── blocked by S1
        │  S3 imports the selector + threads ProfileContext.skills (S2 fields)
        ▼
S3 (entry-point wiring + e2e)                 ── blocked by S2
```

Strictly sequential — no parallelism (each slice's output is the next slice's input). No
two slices touch the same file with conflicting intent (see File Ownership below).

## File Ownership (no cross-slice conflict)

| File | S1 | S2 | S3 |
|---|---|---|---|
| `skills/*.md` (5 new) | CREATE | — | — |
| `src/skills/skill_loader.py` (new) | CREATE | — | — |
| `src/skills/models.py` (new, `Skill`) | CREATE | — | — |
| `src/profile/loader.py` | EDIT (+`skills` field+parse) | — | — |
| `src/profile/loader_mapping.py` | (no — see S1 note) | — | — |
| `src/skills/skill_selector.py` (new) | — | CREATE | — |
| `src/profile/context.py` | — | EDIT (+`skills`,`skill_selector`) | — |
| `src/llm/report_prompt.py` | — | EDIT (+`skills` param ×2) | — |
| `src/llm/okr_report_prompt.py` | — | EDIT (+`skills` param) | — |
| `src/llm/resource_report_prompt.py` | — | EDIT (+`skills` param) | — |
| `src/agent/report_graph.py` | — | EDIT (`_compose` selects+injects) | — |
| `src/agent/okr_report_graph.py` | — | EDIT (`_narrate` selects+injects) | — |
| `src/agent/resource_report_graph.py` | — | EDIT (`_narrate` selects+injects) | — |
| `src/skills/skill_pool.py` (new, load+filter helper) | — | — | CREATE |
| `src/runtime/worker.py` | — | — | EDIT (build pool+selector→context) |
| `src/entrypoints/cron.py` | — | — | EDIT (same) |
| `src/entrypoints/cli.py` | — | — | EDIT (same) |
| `tests/test_skill_loader.py` (new) | CREATE | — | — |
| `tests/test_skill_selector.py` (new) | — | CREATE | — |
| `tests/test_skill_compose_injection.py` (new) | — | CREATE | — |
| `tests/test_skill_graph_e2e.py` (new) | — | — | CREATE |

`context.py` is edited in S2 only; the 3 builders + 3 graphs in S2 only; the 3 entry
points in S3 only. No file is edited by two slices.

## Acceptance Criteria (measurable)

- **S1:** `load_skills(skills_dir)` returns 5 `Skill` frozen dataclasses with parsed
  `name/description/applies_to/body`; a malformed SKILL.md (no frontmatter / bad YAML) is
  SKIPPED (logged, not raised). `profile.yaml` with `skills: [flag-risk]` →
  `LoadedProfile.skills == ("flag-risk",)`; absent/empty → `()`. `default` profile →
  `skills == ()`. Full suite green (additive only).
- **S2:** `build_*_messages(..., skills="<body>")` injects the body into the INTERNAL
  branch (user message) and the EXTERNAL branch is byte-identical to `skills=""`.
  `build_*_messages(..., skills="")` == the pre-P10 call (byte-identical, no `skills` arg).
  `SkillSelector` fake returns a fixed pick; `make_llm_selector(client)` tolerates LLM
  failure → `[]`. Full suite green.
- **S3:** running each graph (daily/weekly/okr/resource) INTERNAL with a fake selector +
  a non-empty pool → the chosen skill bodies appear in the composed `report_text`'s prompt
  path (assert via a recording fake LLM client capturing messages). EXTERNAL run → NO
  skill body in any message. Empty pool → messages byte-identical to a no-skills run. The
  545 baseline tests stay green.
- **Global:** every new `.py` < 200 LOC. `ruff` clean (line-length 100). No new
  dependency. Code/identifiers English; SKILL.md bodies may be Vietnamese PM prose.

## Test Matrix

| Concern | Level | Slice | Test |
|---|---|---|---|
| Frontmatter parse (---  split + `yaml.safe_load`) | unit | S1 | `test_skill_loader.py` |
| Malformed SKILL.md skipped gracefully | unit | S1 | `test_skill_loader.py` |
| 5 bundled skills load with expected names | unit | S1 | `test_skill_loader.py` |
| `skills:` block → `LoadedProfile.skills` tuple | unit | S1 | `test_skill_loader.py` (or `test_profile_loader`) |
| absent/empty `skills:` → `()` ; `default` unchanged | unit | S1 | same |
| selector fake returns fixed pick | unit | S2 | `test_skill_selector.py` |
| `make_llm_selector` tolerates LLM error → `[]` | unit | S2 | `test_skill_selector.py` |
| internal prompt carries injected skill body | unit | S2 | `test_skill_compose_injection.py` |
| external prompt has NO skill body (RED LINE) | unit | S2 | `test_skill_compose_injection.py` |
| `skills=""` byte-identical to pre-P10 | unit | S2 | `test_skill_compose_injection.py` |
| pool load + filter to candidate names | unit | S3 | `test_skill_graph_e2e.py` |
| e2e internal graph → chosen bodies in messages | integration | S3 | `test_skill_graph_e2e.py` |
| e2e external graph → no skill bodies | integration | S3 | `test_skill_graph_e2e.py` |
| empty pool → messages == no-skills run | integration | S3 | `test_skill_graph_e2e.py` |
| 545 baseline suite stays green | regression | S1–S3 | full `pytest` |

## Risks

| # | Risk | L×I | Mitigation |
|---|---|---|---|
| R1 | Skill body leaks into EXTERNAL report (PII red-line breach) | L×**High** | Inject ONLY in the internal branch (after the `audience=="external"` early-return). Dedicated external-clean test per builder + per graph. Mirror `test_external_with_hostile_persona_project_memory_no_pii`. |
| R2 | Backward-compat break: no-skills prompt drifts from today | L×**High** | `skills: str = ""` defaults; injection is `if skills.strip()` guarded. Byte-identical test vs no-arg call (S2) + 545-green gate every slice. |
| R3 | Scout's "single seam" wrong → cron/cli miss skills | **M**×M | VERIFIED 3 entry points; thread skills via `ProfileContext` (the shared vector all 3 already build) so one extension covers all. S3 tests each entry point's wiring. |
| R4 | Non-deterministic LLM selector breaks offline tests | L×M | Selector is injectable (`SkillSelector = Callable`); fake in every test. Real `make_llm_selector` is never called in tests. |
| R5 | Malformed/oversized SKILL.md crashes load at runtime | L×M | Loader skips bad files (try/except per file, log warning), never raises; empty/garbage frontmatter → skip. Bundled skills are short + committed. |
| R6 | `allowed-tools` frontmatter misread as an enforcement hook | L×M | Parsed-and-ignored; documented in loader docstring + skill files comment. NO code path reads it for authority this round. |
| R7 | Selector picks a skill name not in the pool (LLM hallucination) | M×L | Compose filters the selector's returned names against the candidate pool before rendering — unknown names dropped. |
| R8 | New `skills/` top-level dir collides w/ packaging/import | L×L | `skills/` is DATA (markdown), not a Python package; loaded by path from `REPO_ROOT / "skills"`. Code lives in `src/skills/`. |

## Rollback

Each slice is one commit; revert is `git revert <sha>` with no data migration (skills are
read-only markdown; no DB, no schema, no checkpoint shape change).

- **S3 revert:** entry points stop building the pool → `ProfileContext.skills` stays
  empty default → no injection. Graphs + builders still accept the (unused) `skills`
  param. Suite green.
- **S2 revert:** removes `skills` param + selector + ProfileContext fields. Builders back
  to persona/project/memory only. (Revert S3 first — S3 depends on S2 symbols.)
- **S1 revert:** removes the loader + bundled skills + the `skills` profile field. (Revert
  S3, S2 first.) `default` profile already has no `skills:` block, so existing deployments
  are unaffected at any rollback point.

No cascading damage: at every rollback point a profile without a `skills:` block behaves
exactly as today (the additive-only invariant holds in reverse).

## Out of Scope (explicit)

- C2 `.skill` ZIP upload / untrusted unzip / zip-slip handling.
- `allowed-tools` enforcement (parsed-and-ignored only).
- Slash activation / chat-loop skill commands.
- Per-skill cost accounting or token budgeting of injected bodies.
- Skill versioning, hot-reload, or a skill registry.

## Resolved Decisions (user, 2026-06-26)

1. **Selector context = report-kind ONLY** (KISS). `kind_context` = the report kind; the
   selector does NOT see the live risk summary (no coupling to analyze output, deterministic
   input, easier offline tests).
2. **`applies_to` = SOFT HINT** handed to the LLM selector — the LLM stays authoritative
   (can pick a skill outside its `applies_to`). NOT a hard pre-filter. Matches the
   "LLM auto-selects" decision.
3. **No skill-body size cap** this round — bundled skills are short + trusted/authored by us.
   A length cap is deferred to C2 (when untrusted uploaded skills arrive).
