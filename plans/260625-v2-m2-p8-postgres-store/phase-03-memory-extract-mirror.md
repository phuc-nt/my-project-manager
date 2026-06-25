# Phase 03 — Memory extract + mirror (node + MEMORY.md agent section + cross-thread read)

Status: pending · Slice S3 · Effort ~3.5h · Depends on S2 (Store passed to nodes) + S1 (config settled)

## Context

- The 4 report graphs end `... → compose_report → [approval_gate] → deliver → END`. `deliver` returns `{"delivered": bool, "delivery_summary": str}` (report_graph.py:228-237; same shape in okr/resource).
- Store reaches a node via the explicit `store=` param (S2 wiring; VERIFIED in the offline smoke).
- MEMORY.md: read verbatim into `LoadedProfile.memory` (loader.py:110) and injected INTERNAL-ONLY (`context.py:49 build_context_block`; external path injects nothing — context.py:11-13). `profiles/default/MEMORY.md` already reserves space for "agent self-writes land in M2-P8".
- Injectable LLM pattern: `LlmClient` (client.py:46); report graphs already inject a fake llm in tests.
- `agent_id` source: `thread_id` is `agent_thread_id(agent_id, kind, audience)` (agent-prefixed); the node can recover `agent_id` from config `thread_id`, OR `build_graph_for` passes it explicitly. Recommend: pass `agent_id` + the MEMORY.md path into the node closure at build time (deterministic, no thread_id parsing).

## Locked design (from plan)

- Write ONLY on a real internal deliver: gate on `state["delivered"] is True` AND `not settings.dry_run`. Dry-run / not-delivered → write nothing.
- Internal-only: the memory node is added to the graph but its WRITE is a no-op unless the run is internal+delivered. (External reports already never inject memory; writing memory from an external run would be pointless and risks the internal/external boundary — gate the write on `audience == "internal"` too. Recommend: only wire/run the extract on the INTERNAL audience.)
- NOT through the gateway: the node calls `store.put` + the file rewrite directly. No ActionGateway import.
- Extractor injectable: a `MemoryExtractor` callable `(report_text) -> list[str]` (facts). Default wraps `LlmClient`; tests inject a FAKE returning fixed facts. Non-determinism isolated here.
- Store namespace `(agent_id, "memory")`; key = a stable id (e.g. `f"{date}-{n}"` or a content hash); value `{"fact": str, "ts": iso}`.
- MEMORY.md mirror: append facts into the `<!-- AGENT-MEMORY:START -->`…`<!-- AGENT-MEMORY:END -->` region, preserving everything outside. Cap to last N (e.g. 50). Pure rewrite fn (path-content + facts → new content) + atomic write.

## Files to create

- `src/agent/memory_extractor.py` — the `MemoryExtractor` protocol/callable + the default LLM-backed impl (injectable; reuses `LlmClient`). The extraction prompt: "salient internal project facts worth remembering across reports; no tokens/keys/secrets; short bullet facts." Returns `list[str]`.
- `src/agent/memory_mirror.py` — the PURE MEMORY.md rewrite: `rewrite_agent_section(existing: str, facts: list[str], *, cap: int = 50) -> str` (creates markers if absent, appends within the region, trims to cap, preserves human content) + a thin `write_memory_file(path, facts)` (read → rewrite → atomic temp+rename). Pure core is the unit-tested seam.
- `src/agent/memory_node.py` — the graph node factory `make_memory_node(*, extractor, store, agent_id, memory_path, settings, audience)` returning a node fn that: gates on delivered+internal+not-dry-run, extracts facts, `store.put((agent_id,"memory"), key, value)` for each, then `write_memory_file(memory_path, facts)`. Returns `{}` (no state change needed) — or a small `{"memory_written": n}` for observability.
- `tests/test_memory_node_extract_and_mirror.py` — node + mirror + negatives + guardrail tests.

## Files to modify

- `src/agent/report_graph.py`, `okr_report_graph.py`, `resource_report_graph.py` — add a `remember` node AFTER `deliver`: `deliver → remember → END` (replace the `deliver → END` edge). Only wire it when `audience == "internal"` (external keeps `deliver → END`). The node gets `store` (the compiled store is available via the node's `store=` param) + `agent_id`/`memory_path` (passed through the builder, sourced in `build_graph_for`). The phase-0 `graph.py` is NOT touched (no report → nothing to remember).
- `src/runtime/worker.py` `build_graph_for` — thread `agent_id` (already known: derive from `loaded.profile_id`) + the MEMORY.md path (`profiles/<id>/MEMORY.md`) into the builder so the memory node can mirror. (The builder signatures gain `agent_id`/`memory_path` optional params, default None → memory node disabled, so non-worker callers/tests are unaffected.)
- `profiles/default/MEMORY.md` — (optional) pre-seed the marker block so the first write is an append, not a marker-create. Not required (rewrite creates markers).

## Cross-thread read (no new wiring)

Run 1 (internal, delivered) writes facts → MEMORY.md agent section. Run 2 calls `load_profile` → reads the WHOLE MEMORY.md (human + agent section) into `LoadedProfile.memory` → the internal prompt injects it via the existing P2 `build_context_block`. "Run 1 writes, run 2 reads" satisfied with ZERO new read code. The Store is the durable/queryable copy for future cross-agent use; MEMORY.md is the read path THIS round. (RESOLVED in plan; coherent vs context.py + loader.py.)

## Implementation steps

1. `memory_mirror.py` pure rewrite + atomic write. Unit-test FIRST (no-markers/with-markers/human-preserved/cap).
2. `memory_extractor.py` protocol + default LLM impl + a `FakeMemoryExtractor` test helper (or define the fake in the test).
3. `memory_node.py` factory with the delivered+internal+not-dry-run gate.
4. Wire `deliver → remember → END` in the 3 report builders (internal audience only); thread `agent_id`/`memory_path` through `build_graph_for`.
5. Tests: end-to-end (fake extractor + InMemoryStore + tmp MEMORY.md), negatives (dry-run, not-delivered → nothing), guardrails (gateway never called; external injects no memory — extend the existing context test).
6. Full suite + ruff.

## Test / validation (offline)

- E2E: internal+delivered run with a fake extractor → Store has the facts under `(agent_id,"memory")`; tmp MEMORY.md agent section contains them; human content intact.
- Negative: `settings.dry_run=True` → Store empty, MEMORY.md unchanged. `delivered=False` → same.
- Mirror pure fn: 4 cases (AC6).
- Guardrail G1: spy/stub gateway, assert the memory node makes 0 gateway calls.
- Guardrail G2: external run injects no memory (existing context.py test extended) AND (recommended) external run does not run the remember node.
- Cross-thread: write via run 1, `load_profile` again, assert `LoadedProfile.memory` contains the agent facts; assert the internal prompt builder includes them and the external one does not.
- Regression: full suite green.

## Risks + rollback

- R4 (gateway bypass): node never imports ActionGateway; G1 test. R5 (clobber): pure region-only rewrite + atomic write; AC6. R6 (noise): delivered+internal+not-dry-run gate; negatives tested. R7 (growth): cap N; tested. R8 (secrets): internal-only facts, extractor prompt forbids secrets; accepted internal-only risk (mirrors Atlassian-token posture).
- Rollback: revert the 3 node files + the `deliver→remember` edges + the build_graph_for threading. Any agent section already written is inert text the P2 loader reads harmlessly; strip the marker block if desired. No schema/data migration.

## LOC watch

- 3 new small modules (extractor ~40, mirror ~60, node ~60) — each < 200, keeps the report builders from growing (the node lives in its own file, the builder just adds an edge + one node registration ~3 lines). report/okr/resource builders are ALREADY ~230-238 LOC; adding ~4 lines each is acceptable; do NOT inline the node logic into them.

## Open questions

- Key scheme for `store.put` (date+index vs content hash). Recommend a content hash to dedup identical facts across runs. Confirm if dedup matters this round (MEMORY.md cap already bounds growth).
- Should the remember node run for OKR/resource graphs, or only the daily/weekly report graph? They all deliver internal reports worth remembering — recommend all 3 report builders, NOT phase-0 graph.py. Confirm scope.
