---
title: "M3-P9 A3 cross-agent memory share"
description: "Siblings in the same project read each other's memory facts into the INTERNAL compose prompt only — RO-sibling, WO-self, never external."
status: completed
priority: P2
effort: 7h
branch: main
tags: [memory, multi-agent, profile, internal-only, red-line]
created: 2026-06-26
completed: 2026-06-26
---

> **Completed 2026-06-26.** All 3 slices landed: S1 `10a60f1` (project_group field +
> sibling discovery/read helper), S2 `ba046af` (injectable SiblingFactSelector +
> internal-only injection across all builders + WO-self write boundary), S3 `1512e5a`
> (entry-point wiring + selector pairing + 9 offline e2e + architecture §6.2). 628 tests
> pass (593 baseline + 35 new), ruff clean. Code-reviewer DONE per slice (S1: H1 broken-
> sibling-crash fixed; S2: red line + hallucination guard verified; S3: store-sharing
> invariant + red line through real deps verified). The P5 red line holds defense-in-depth
> (selector gate + builder fold-after-external-return); no-project path allocation-free +
> byte-identical to pre-P9. Operational note: effective cross-process sharing requires
> `store: postgres` (default InMemoryStore is per-process → A3 degrades cleanly to no
> siblings). Live-key E2E NOT run (all proof offline, fake selector + recording LLM).

# M3-P9 — A3 cross-agent memory share

Two agents in the same `project` group read each other's remembered facts. Sibling
facts are **READ-ONLY** (an agent never writes a sibling's namespace), **WRITE-ONLY on
self**, and inject into the **INTERNAL compose prompt only** — never an external/
stakeholder report, never through the Action Gateway. Mirrors the M3-P10 skill-selector
shape exactly (injectable LLM ranker keyed by report kind, fake in tests, graceful on
LLM failure, internal-only gate, allocation-free no-op path).

## Baseline (2026-06-26)
- 593 tests pass, `ruff` clean, last commit `6606513`.
- A2 write pipeline SHIPPED (`memory_node.py`, `store.py`, MEMORY.md mirror).
- M3-P10 skill selector SHIPPED — the exact pattern A3 mirrors.

## Locked decisions (do NOT re-litigate)
1. Sibling grouping = a `project:` field in `profile.yaml`; parsed onto
   `LoadedProfile.project_group` (NOT `project`, which already = PROJECT.md contents,
   `loader.py:54`). No `project:` ⇒ no siblings ⇒ byte-identical to pre-P9. `default`
   gets no `project:`.
2. Injection = injectable `SiblingFactSelector` keyed by report kind, `make_llm_*`
   default tolerating LLM failure, FAKE in all tests, internal-only gate.
3. Write boundary = fail loud: an agent writes ONLY `(self_id, "memory")`; any other
   namespace raises.
4. RED LINE: sibling facts INTERNAL-ONLY, never external, never Action Gateway. Every
   builder's external branch byte-identical with/without sibling facts.
5. Cross-namespace read = enumerate sibling ids, `store.get((sibling_id,"memory"), key)`
   per sibling (works for InMemoryStore AND PostgresStore; no prefix/wildcard).
6. Backward-compat non-negotiable: no `project:` (or a 1-agent group) ⇒ zero sibling
   facts ⇒ compose prompt byte-identical; allocation-free (no `LlmClient`) when nothing
   to do.

## Planner-resolved OPEN decisions (rationale in phase files)
- **Field name** = `project_group` (clean namespace, no clash with `project`=PROJECT.md).
  See [phase-01](phase-01-project-group-and-sibling-discovery.md).
- **Selector failure default** = `[]` (drop all siblings). A sibling-LLM outage must
  never degrade NOR flood a report; `[]` is the only choice that satisfies both. The
  pre-selector hard cap (read-side, `MAX_SIBLING_FACTS`) bounds the prompt even when the
  selector passes everything. See [phase-02](phase-02-sibling-selector-and-injection.md).
- **Labeled block** = OWN labeled block `--- Bộ nhớ agent khác (project: <slug>) ---`,
  separate from the self-memory block, so the LLM never confuses another agent's facts
  for its own. See [phase-02](phase-02-sibling-selector-and-injection.md).
- **Read source** = read each sibling's **Store namespace** `(sibling_id, "memory")`
  directly (decision 5 mandates it; it is the durable source of truth and works under
  Postgres where a sibling's MEMORY.md file may not be co-located). MEMORY.md is only the
  human mirror; the Store is authoritative. See [phase-01](phase-01-project-group-and-sibling-discovery.md).

## Slices (each independently committable, suite stays green)
| # | Slice | File |
|---|-------|------|
| S1 | `project:` profile field + sibling discovery/read helper (no injection yet) | [phase-01](phase-01-project-group-and-sibling-discovery.md) |
| S2 | Injectable `SiblingFactSelector` + internal-only injection into 3 builders + `ProfileContext` fields + WO-self write boundary | [phase-02](phase-02-sibling-selector-and-injection.md) |
| S3 | Wire sibling context through 3 entry points + offline e2e (red line + backward-compat) | [phase-03](phase-03-entrypoint-wiring-and-e2e.md) |

**Slicing rationale:** mirrors P10's 3-slice cut (schema/loader → selector+injection →
entry-point+e2e). S1 ships a tested read helper with zero prompt change (suite green,
prompts byte-identical). S2 adds the selector + folds sibling text into the 3 builders'
INTERNAL branch behind an empty default (suite green, prompts byte-identical until an
entry point passes non-empty facts). S3 flips the switch at the 3 entry points and proves
the red line + backward-compat e2e. No file is edited by two slices (see Ownership).

## Dependency graph
```
S1 (project_group + sibling_memory read helper)
      │  provides: LoadedProfile.project_group, build_sibling_context() returns facts
      ▼
S2 (SiblingFactSelector + ProfileContext fields + 3 builders fold-in + write boundary)
      │  provides: select_sibling_text(), ProfileContext.sibling_facts/sibling_selector,
      │            builders accept sibling_facts="" (no behavior change yet)
      ▼
S3 (worker/cron/cli call build_sibling_context, pass into ProfileContext; e2e proves
    red line + backward-compat)
```
S2 depends on S1's `build_sibling_context` signature + `LoadedProfile.project_group`.
S3 depends on S2's `ProfileContext` fields + builder params. Strictly sequential.

## File ownership (no file edited by two slices)
| File | Slice | Action |
|------|-------|--------|
| `src/profile/loader.py` | S1 | modify (add `project_group` field + parse) |
| `src/agent/sibling_memory.py` | S1 | create (discovery + read helper) |
| `tests/test_sibling_memory.py` | S1 | create |
| `src/agent/sibling_selector.py` | S2 | create (`SiblingFactSelector`, `make_llm_selector`, `select_sibling_text`, render) |
| `src/profile/context.py` | S2 | modify (add `sibling_facts`, `sibling_selector` fields) |
| `src/llm/report_prompt.py` | S2 | modify (add `sibling_facts=""` param, fold into INTERNAL branch) |
| `src/llm/okr_report_prompt.py` | S2 | modify (same) |
| `src/llm/resource_report_prompt.py` | S2 | modify (same) |
| `src/agent/report_graph.py` | S2 | modify (`_compose` calls `select_sibling_text`, passes param) |
| `src/agent/okr_report_graph.py` | S2 | modify (`_narrate` same) |
| `src/agent/resource_report_graph.py` | S2 | modify (`_narrate` same) |
| `src/agent/memory_node.py` | S2 | modify (WO-self write-boundary guard) |
| `tests/test_sibling_selector.py` | S2 | create |
| `tests/test_sibling_write_boundary.py` | S2 | create |
| `src/runtime/worker.py` | S3 | modify (`build_graph_for` builds + passes sibling ctx) |
| `src/entrypoints/cron.py` | S3 | modify (`main` builds + passes) |
| `src/entrypoints/cli.py` | S3 | modify (`_context_of` builds + passes) |
| `tests/test_sibling_graph_e2e.py` | S3 | create |
| `registry.yaml` | S3 (test fixtures only use tmp registries) | none — committed registry unchanged |
| `docs/system-architecture.md` | S3 | modify (note A3 read path + widened threat model) |

## Acceptance criteria (measurable)
- AC1 `LoadedProfile.project_group: str | None`; a `profile.yaml` with `project: acme`
  ⇒ `"acme"`; no `project:` ⇒ `None`. (test, S1)
- AC2 `build_sibling_context(loaded, settings, store, registry)` returns `("", None)`
  (or `()`/`None`) WITHOUT constructing an `LlmClient` when `project_group is None` OR
  the group has only the self agent. (test, S1)
- AC3 Two enabled agents with the same `project_group`: B's `build_sibling_context`
  returns A's stored facts (read from `(A_id,"memory")`), excluding B's own. (test, S1)
- AC4 A sibling profile that fails to load is skipped with a warning; the run does NOT
  crash and other siblings still resolve. (test, S1)
- AC5 `select_sibling_text(ctx, "internal", kind=...)` returns the chosen-and-rendered
  block; `audience="external"` ⇒ `""`; empty facts/None selector ⇒ `""`. (test, S2)
- AC6 Selector raising ⇒ `select_sibling_text` returns `""` (graceful, run never breaks).
  (test, S2)
- AC7 `memory_node` writing any namespace other than `(self_id,"memory")` raises a clear
  error; writing self succeeds. (test, S2)
- AC8 For EACH builder (report/detail, okr, resource): INTERNAL messages with non-empty
  sibling facts contain the sibling block + its marker; EXTERNAL messages are
  byte-identical with vs without sibling facts. (`test_external_ignores_sibling_facts`
  per builder, S2)
- AC9 e2e through the real graph of all 3 kinds (offline, recording fake LLM): a
  sibling's fact marker reaches the INTERNAL prompt, NEVER the external one. (test, S3)
- AC10 Backward-compat: a 1-agent registry (no `project:`) produces an INTERNAL compose
  message byte-identical to a pre-P9 run. (test, S3)
- AC11 Full suite green (≥ 593 + new), `ruff check` clean, every new/edited file < 200
  LOC, frozen dataclasses preserved.

## Test matrix (summary; per-slice detail in phase files)
| Layer | What | Slice |
|-------|------|-------|
| unit | `project_group` parse (present/absent/blank) | S1 |
| unit | sibling enumeration (group filter, self-exclude, disabled-skip) | S1 |
| unit | sibling read from Store (per-sibling get; InMemoryStore) | S1 |
| unit | failing-sibling-profile skip (no crash) | S1 |
| unit | allocation-free no-op (no `LlmClient` when no group) | S1, S2 |
| unit | selector: fake pick, external-gate, none-selector, graceful-failure | S2 |
| unit | render: own labeled block, empty ⇒ "" | S2 |
| invariant | WO-self / RO-sibling write boundary raises | S2 |
| red-line | external byte-identical per builder ×3 | S2 |
| e2e | real graph ×3 kinds, sibling fact internal-only, offline | S3 |
| backward-compat | 1-agent, no-project ⇒ byte-identical INTERNAL prompt | S3 |

## Risks (summary; mitigations in phase files)
| R | Risk | L×I | Mitigation |
|---|------|-----|-----------|
| R1 | Sibling fact leaks to external report / Action Gateway | Low×Critical | `select_sibling_text` early-returns "" for external (same gate as `select_skill_text`); builders fold sibling text AFTER the external return ONLY; dedicated `test_external_ignores_sibling_facts` per builder + e2e |
| R2 | WO-self boundary violated (agent writes sibling ns) | Low×High | `memory_node` asserts namespace == `(self_id,"memory")`; dedicated invariant test |
| R3 | Backward-compat drift (prompt changes with no project) | Med×High | empty-default params; allocation-free `("",None)`; byte-identical backward-compat e2e |
| R4 | A sibling profile fails to load → whole run crashes | Med×High | per-sibling try/except, warn + skip; AC4 test |
| R5 | Selector non-determinism in tests | Med×Med | FAKE selector injected everywhere; no live LLM in tests |
| R6 | Widened secret exposure (B now sees A's unfiltered facts) | Med×Med | internal-only is the mitigation; documented threat-model change in architecture.md; no new external surface |
| R7 | Postgres path can't enumerate sibling facts (no wildcard) | Low×Med | explicit per-sibling `store.get`; namespace-keyed, works on both backends |

## Out of scope
- FastAPI server (M2-P6) gets A3 transitively: `src/server/graph_runner.py:43` calls
  `worker.build_graph_for` (verified 2026-06-26) — no separate server seam to wire.
- No `project:` grouping UI / registry restructure (registry stays flat).
- No write-sharing (A3 is read-only on siblings, by design).
- No live-Postgres sibling read test (selection/InMemory only this round, matching P8/P10).
- No secret-scanning of memory facts (accepted residual risk; internal-only mitigation).

## Operational note (not a code task)
Cross-agent read is only *effective at runtime* when the Store is SHARED across the
sibling processes — i.e. `store: postgres`. With the default `store: memory`
(`InMemoryStore`), each agent process has its OWN store, so B cannot see A's facts in
production multi-process runs; A3 then degrades cleanly to "no sibling facts" (the
backward-compat path). The offline e2e proves the logic with a single shared
`InMemoryStore` instance (same process). Document this Postgres-for-effective-sharing
requirement in `docs/system-architecture.md` alongside the threat-model note (S3).
