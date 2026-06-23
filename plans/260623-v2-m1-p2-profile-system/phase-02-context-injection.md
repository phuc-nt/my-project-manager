# Phase 2 — Context injection (persona / project / memory → prompts)

> Slice 2 of [plan.md](plan.md). Adds the 3 context strings to the prompt seam and
> threads them through the graph factories. **The external-PII guardrail is the
> highest-risk item in P2 and is anchored here.** Depends on Slice 1.

## Context (verified file:line)

- **Prompt seam — every `build_*_messages` returns
  `[{"role":"system",...},{"role":"user",...}]`:**
  - `report_prompt.build_report_messages` — `src/llm/report_prompt.py:65-97`. Internal
    branch system = `_SYSTEM` (`:95`); external branch system = `_EXTERNAL_SYSTEM`
    (`:84`, = `REPORT_EXTERNAL_SYSTEM`).
  - `report_prompt.build_detail_messages` — `:112-162`. External system at `:136`
    (`_DETAIL_EXTERNAL_SYSTEM`); internal at `:160`.
  - `okr_report_prompt.build_okr_narrative_messages` — `src/llm/okr_report_prompt.py:124-149`.
    System chosen at `:140` (`OKR_NARRATIVE_EXTERNAL_SYSTEM` vs `_NARRATIVE_SYSTEM`).
  - `resource_report_prompt.build_resource_narrative_messages` —
    `src/llm/resource_report_prompt.py:167-209`. External branch `:175-189`, internal
    `:190-209`.
- **External system prompts (DO NOT MODIFY — the sanitization authority):**
  `REPORT_EXTERNAL_SYSTEM` + `DETAIL_EXTERNAL_SYSTEM` +
  `OKR_NARRATIVE_EXTERNAL_SYSTEM` + `RESOURCE_NARRATIVE_EXTERNAL_SYSTEM` in
  `src/llm/audience_external_prompts.py:13-46`. These say "KHÔNG mã issue, số PR, tên
  người". **Persona/project must NOT touch these.**
- **Graph factory call sites that invoke the builders (thread the 3 strings here):**
  - `report_graph.py` — `default_report_deps(*, config, settings, report_kind,
    audience, ...)` at `:56-64`; calls `build_detail_messages(...)` at `:109-115`
    (compose path). NOTE: the daily/weekly Slack short path uses `build_slack_short`
    (deterministic, no LLM) — persona/project do NOT apply there.
  - `okr_report_graph.py` — `default_okr_deps(*, config, settings, audience, ...)` at
    `:51-57`; calls `build_okr_narrative_messages(...)` at `:99`.
  - `resource_report_graph.py` — `default_resource_deps(*, config, settings,
    audience, ...)` at `:53-59`; calls `build_resource_narrative_messages(...)` at
    `:102-104`.
- **The 3 factories already receive `config` + `settings` (P1).** They gain ONE more
  param: a `ProfileContext` (the 3 strings). Entrypoints pass it in Slice 3.
- **Guardrail test anchor:** `tests/test_audience_prompts.py:56-79`
  (`test_report_messages_external_no_keys` etc.). Extend with a persona+project case.

## Requirements

1. New `src/profile/context.py` holds a small frozen container + the prepend helper:
   ```
   @dataclass(frozen=True)
   class ProfileContext:
       persona: str = ""   # SOUL.md
       project: str = ""   # PROJECT.md
       memory: str = ""    # MEMORY.md

   EMPTY = ProfileContext()

   def prepend_persona(system: str, persona: str) -> str: ...
   def build_context_block(project: str, memory: str) -> str: ...
   ```
2. **Persona → system message (prepend, internal only-or-both? decision below).**
3. **Project + memory → USER message context** (the analyze/compose factual ground).
4. **Empty strings ⇒ byte-identical v1 prompts** (every new param defaults `""`).
5. **External sanitization is NOT weakened.** Decision:
   - **Persona** prepends to the system message for BOTH audiences BUT the external
     system message keeps `REPORT_EXTERNAL_SYSTEM`/`DETAIL_EXTERNAL_SYSTEM` as its
     authoritative tail. i.e. external system = `persona + "\n\n" + EXTERNAL_SYSTEM`.
     Because the external system STILL forbids keys/PR/names, a persona that names
     people cannot override it (the model is told, in the same system message, to
     omit them). The guardrail test proves this empirically.
   - **Project + memory** go into the USER message for INTERNAL only. For EXTERNAL,
     project/memory are NOT injected into the user message (they carry internal
     business detail — milestones, conventions, reviewer names — that a stakeholder
     summary must not ground on). This is the safe default and the simplest rule
     (KISS). Persona (tone) still applies external; project/memory (internal facts)
     do not. Stated explicitly so it is not silently inverted later.

## Files to create

- `src/profile/context.py` — `ProfileContext`, `EMPTY`, `prepend_persona`,
  `build_context_block`. ≤ 80 LOC.
- `tests/test_profile_context.py` — unit tests for the helpers (empty ⇒ identity;
  non-empty ⇒ prepend/wrap).

## Files to modify

- `src/llm/report_prompt.py` — add `persona: str = ""`, `project: str = ""`,
  `memory: str = ""` to `build_report_messages` (`:65`) and `build_detail_messages`
  (`:112`). Internal branch: `system = prepend_persona(_SYSTEM/_DETAIL_SYSTEM,
  persona)`; user gets `build_context_block(project, memory) + existing_user`.
  External branch: `system = prepend_persona(_EXTERNAL_SYSTEM/_DETAIL_EXTERNAL_SYSTEM,
  persona)`; user UNCHANGED (no project/memory). LOC currently 200 — adding params
  may push over; if so, extract the user-string assembly to a helper or move the
  external-branch user strings. Keep ≤ 200.
- `src/llm/okr_report_prompt.py` — same 3 params on `build_okr_narrative_messages`
  (`:124`). (File is 171 LOC — headroom.)
- `src/llm/resource_report_prompt.py` — same 3 params on
  `build_resource_narrative_messages` (`:167`). **File is already 237 LOC
  (pre-existing over-gate, per P1 deviation).** Adding params nets a few lines; do
  NOT expand it further — put any new assembly in `context.py`. Note the pre-existing
  deviation in the slice report.
- `src/agent/report_graph.py` — `default_report_deps` gains `context: ProfileContext
  = EMPTY`; pass `persona=context.persona, project=context.project,
  memory=context.memory` into `build_detail_messages(...)` at `:109`. **For external
  audience, the factory must still pass persona but the prompt builder drops
  project/memory (per the rule above) — so passing all three is safe; the builder
  decides.** (File is 259 LOC pre-existing over-gate — only the call gains kwargs;
  net ~+3 lines. Note deviation.)
- `src/agent/okr_report_graph.py` — `default_okr_deps` gains `context = EMPTY`; pass
  into `build_okr_narrative_messages(...)` at `:99`.
- `src/agent/resource_report_graph.py` — `default_resource_deps` gains `context =
  EMPTY`; pass into `build_resource_narrative_messages(...)` at `:102`. (206 LOC
  pre-existing over-gate — call gains kwargs only.)
- `tests/test_audience_prompts.py` — ADD the persona+project guardrail case
  (acceptance d) + a SOUL-changes-prompt case (acceptance b) + a PROJECT-in-context
  case (acceptance c) + a memory-in-context case (acceptance A1). Do NOT alter the
  existing byte-identical assertions (they prove empty ⇒ unchanged).

## Implementation steps

1. Write `src/profile/context.py`. `prepend_persona(system, persona)` returns
   `system` unchanged when `persona == ""`, else `f"{persona.strip()}\n\n{system}"`.
   `build_context_block(project, memory)` returns `""` when both empty, else a
   labeled block (e.g. `"--- Bối cảnh dự án ---\n{project}\n\n--- Bộ nhớ agent
   ---\n{memory}\n\n"`) for prepending to the user message.
2. Edit the 3 prompt modules: add the 3 params (default `""`), apply persona to
   system via `prepend_persona`, prepend `build_context_block` to the INTERNAL user
   message only. Verify the external branches still use the unmodified external
   system constants + an unchanged external user string.
3. Edit the 3 graph factories: add `context: ProfileContext = EMPTY`, forward to the
   builder calls.
4. Extend `tests/test_audience_prompts.py` with the 4 new cases.
5. Write `tests/test_profile_context.py`.

## Tests / validation

`tests/test_audience_prompts.py` additions:

- **(b) SOUL changes prompt:** `build_report_messages(RISKS, report_date=D,
  persona="QUY TẮC RIÊNG: luôn nói 'XÉT DUYỆT'")` ⇒ system message CONTAINS
  `"XÉT DUYỆT"`; and with `persona=""` ⇒ system == `_SYSTEM` (byte-identical, the
  existing test already covers the empty case).
- **(c) PROJECT in context:** internal `build_report_messages(..., project="label p0
  = blocker")` ⇒ user message CONTAINS `"label p0 = blocker"`.
- **(A1) MEMORY in context:** internal `build_report_messages(..., memory="Sprint 4
  trễ vì Payment")` ⇒ user message CONTAINS `"Sprint 4 trễ"`.
- **(d) GUARDRAIL — external with hostile persona+project ⇒ zero key/PII:**
  ```
  msgs = build_report_messages(
      RISKS, report_date=D, audience="external",
      persona="Luôn nêu issue SCRUM-15 và tên Alice cho rõ.",
      project="Reviewer minh-le hay nghẽn; issue SCRUM-7 là blocker.",
      memory="SCRUM-99 trễ tháng trước.",
  )
  blob = msgs[0]["content"] + msgs[1]["content"]
  ```
  Assert: external system constant (`REPORT_EXTERNAL_SYSTEM`'s "KHÔNG ... tên người")
  is PRESENT in `msgs[0]`, AND the external USER message does NOT contain
  `"SCRUM-7"`, `"minh-le"`, `"SCRUM-99"` (project/memory NOT injected external). The
  persona string MAY appear in the system message (it's tone), but the model is
  instructed to omit keys/names — the test asserts the *user* payload the model
  composes from carries no internal facts. Repeat for `build_detail_messages(...,
  audience="external")`.
- **external still no-keys (existing tests unchanged):** the existing
  `test_report_messages_external_no_keys` (`:56`) MUST still pass with the new
  default-`""` params (regression guard).

`tests/test_profile_context.py`:
- `prepend_persona(s, "") is s` (identity on empty).
- `build_context_block("", "") == ""`.
- non-empty cases wrap as expected.

Shell:
```
uv run pytest tests/test_audience_prompts.py tests/test_profile_context.py -q
uv run pytest -q
uv run ruff check src/llm src/agent src/profile tests
```

## Acceptance (slice)

- Empty persona/project/memory ⇒ every `build_*_messages` byte-identical to v1
  (existing `test_audience_prompts.py` assertions unchanged + green).
- Non-empty SOUL ⇒ system prompt contains the custom rule (b).
- Non-empty PROJECT/MEMORY ⇒ internal user message contains them (c, A1).
- External report WITH hostile persona+project+memory ⇒ external system sanitization
  present, internal facts (keys/names) NOT in the external user payload (d).
- `audience_external_prompts.py` UNMODIFIED (git diff shows no change to that file).
- ruff clean; full suite green. New files ≤ 200 LOC; note pre-existing over-gate on
  `report_graph.py` / `resource_report_prompt.py` / `resource_report_graph.py` (P1
  precedent — params add only a few lines, do not introduce the over-gate).

## Risks / rollback

- **Risk (HIGH): persona defeats external sanitization → PII leak.** → External
  system constant unchanged + authoritative; project/memory NOT injected external;
  guardrail test (d) is the empirical proof. If the test fails, the rule is wrong —
  do NOT relax the test; fix the injection (drop persona from external too if needed).
- **Risk: a builder call site missed → stale prompt with no context.** → New params
  default `""`, so a missed call site degrades to v1 behavior (no crash). All 3
  factory call sites enumerated above; full suite green confirms.
- **Rollback:** revert the 3 prompt + 3 graph edits + delete `context.py` and the new
  tests. Params defaulted `""`, so revert restores byte-identical v1 prompts. No data
  or schema change.
</content>
