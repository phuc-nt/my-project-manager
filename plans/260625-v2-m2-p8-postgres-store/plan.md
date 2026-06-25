---
title: "v2 M2-P8 — Postgres checkpointer + LangGraph Store (cross-thread agent memory)"
description: "Opt-in Postgres durable state + a namespaced Store with LLM-extracted memory mirrored to MEMORY.md."
status: completed
priority: P1
effort: 9h
branch: main
tags: [v2, m2, postgres, store, memory]
created: 2026-06-25
completed: 2026-06-25
commits: [304fc72, 57b6973, 9106073]
---

# v2 M2-P8 — Postgres checkpointer + LangGraph Store (cross-thread agent memory)

Two orthogonal halves, both this round:

- **A. Postgres checkpointer** — opt-in durable graph state across processes/machines. **SQLite stays the DEFAULT** (no infra dependency for the common case).
- **B. LangGraph Store + agent memory** — after a real internal delivery, an injectable LLM extracts salient facts → a Store namespaced by `agent_id` AND mirrors them into the MEMORY.md agent-managed section. A later run reads them back via the existing P2 MEMORY.md injection.

P7 (web dashboard) was SKIPPED by the user; P8 is orthogonal infra and does not depend on it.

## Locked decisions (design to these — do NOT re-litigate)

1. **Checkpointer type** `sqlite | postgres`, resolved by the established 3-tier rule (profile.yaml → env → default). **SQLite is the DEFAULT.** Postgres opt-in via a DSN. `get_checkpointer` returns the selected saver.
2. **Store: memory default, Postgres opt-in.** `InMemoryStore` (`langgraph.store.memory`, VERIFIED importable) by default; `PostgresStore` (`langgraph.store.postgres`, dep-gated) opt-in. Passed to `graph.compile(store=...)`; nodes read it.
3. **Memory write = INTERNAL, NOT through the Action Gateway.** The gateway governs EXTERNAL mutations only (Slack/Jira/Confluence allowlist). Store + MEMORY.md writes are internal agent state (like the checkpointer) → they bypass the gateway. Keeps the M1 "gateway = external-only" model intact.
4. **Memory content = LLM-extracted facts.** After a successful real deliver, an LLM step extracts salient facts → Store + MEMORY.md. The extractor client MUST be injectable so tests run offline with a FAKE extractor. Non-determinism isolated behind the injectable client.
5. **Mirror to MEMORY.md in an AGENT-MANAGED SECTION.** The agent appends ONLY between `<!-- AGENT-MEMORY:START -->` and `<!-- AGENT-MEMORY:END -->` markers; human content above/below is preserved verbatim. On read/inject (P2 loader), the whole file is injected (human + agent sections).
6. **E2E = offline only this round.** SQLite + InMemoryStore fully unit-tested offline. The Postgres checkpointer + Postgres Store paths are WIRED + importable (deps added) but NOT run against a real PG. The SELECTION logic is unit-tested; the actual PG connection is exercised only by asserting the right branch is REACHED (patch the constructor) — no live connect.

## Verified facts (offline smoke + re-grep, 2026-06-25)

- **Baseline**: 490 tests collected, clean tree at `d12214d`. Python 3.12.12, langgraph 1.2.6, langgraph-checkpoint-sqlite 3.1.0, langgraph-checkpoint 4.1.1.
- **Store API** (offline smoke, `InMemoryStore`):
  - `store.put(namespace: tuple[str,...], key: str, value: dict)` → `None`.
  - `store.get(ns, key) -> Item | None`; `Item` has `.value` (dict), `.key`, `.namespace`.
  - `store.search(namespace_prefix, *, query=None, filter=None, limit=10, offset=0) -> list[SearchItem]`.
  - `g.compile(checkpointer=..., store=...)` accepts both. VERIFIED a node `put` persisted and a later node read it back in one `invoke`.
  - **Node store access — TWO mechanisms both work**: (a) a node param `def node(state, *, store: BaseStore = None)`; (b) `from langgraph.config import get_store; get_store()` (sig `() -> BaseStore`). **Plan uses (a) the explicit param** (matches the project's inject-everything convention; no global lookup).
- **Imports**: `from langgraph.store.memory import InMemoryStore` OK. `from langgraph.store.postgres import PostgresStore` and `from langgraph.checkpoint.postgres import PostgresSaver` → `ModuleNotFoundError` until the dep is added (expected, P8 adds it).
- **Dep**: a SINGLE package `langgraph-checkpoint-postgres>=3.1.0` ships BOTH `langgraph.checkpoint.postgres.PostgresSaver` AND `langgraph.store.postgres.PostgresStore` (confirmed: GitHub `libs/checkpoint-postgres/langgraph/store/postgres/base.py`). It pulls `psycopg>=3.2.0` + `psycopg-pool>=3.2.0`. One dep covers both halves.
- **checkpoint.py:24** `get_checkpointer(db_path: Path) -> SqliteSaver` — the ONLY checkpointer factory; opens `sqlite3.connect(..., check_same_thread=False)` + `SqliteSaver(conn)` + `.setup()`; sets `LANGGRAPH_STRICT_MSGPACK`.
- **`get_checkpointer` callers = 3** (re-grepped): `worker.py:64`, `cron.py:55`, `cli.py:27` — ALL call `get_checkpointer(settings.data_dir / "checkpoints.db")`. (cli.py wraps it in `_checkpointer(settings)`; cron.py inlines in `_build_graph`.)
- **The 4 graph builders** type-hint `checkpointer: SqliteSaver | None` and compile via `builder.compile(checkpointer=checkpointer)`: `report_graph.build_report_graph` (report_graph.py:249,299), `okr_report_graph.build_okr_graph` (okr_report_graph.py:191,230), `resource_report_graph.build_resource_graph` (resource_report_graph.py:198,237), `graph.build_graph` (graph.py:56,74). They functionally accept any saver.
- **`build_graph_for`** (worker.py:54) is the ONLY place that calls `get_checkpointer` for the report graphs (worker.py:64) and the SINGLE seam P5-resume (`worker_resume` via `build_graph=build_graph_for`, worker.py:145) AND P6 server (`graph_runner.default_build_graph` → `build_graph_for`, graph_runner.py:43) both reuse — so they inherit checkpointer + store selection automatically. CONFIRMED by re-grep.
- **MEMORY.md injection is INTERNAL-ONLY**: `context.py:49 build_context_block(project, memory)` folds `memory` into the **internal user message only**; `context.py:11-13` docstring states project+memory are NOT injected on the external path. So agent memory affects ONLY internal reports — a guardrail-relevant invariant the extract+mirror design preserves.
- **Settings** (`settings.py:25`, frozen dataclass) built by `build_settings_from_dict` (config_builders.py:47) from a dict keyed by lowercased env names; the profile loader maps profile.yaml → that dict in `build_settings_dict` (loader_mapping.py:69) using the 3-tier `_fallback`/`_explicit` helpers.
- **profiles/default/MEMORY.md** already anticipates P8: header comment "agent self-writes land in M2-P8".

## Slices (each independently runnable, committable, green suite)

| Slice | Phase file | Scope | Status |
|-------|-----------|-------|--------|
| S1 | `phase-01-checkpointer-selection.md` | `CheckpointerType` config + `get_checkpointer(settings)` + widen builder hints to `BaseCheckpointSaver` + postgres branch (selection-tested) + dep | ✅ `304fc72` |
| S2 | `phase-02-store-wiring.md` | Store factory (memory/postgres) + `store=` on the 4 builders + worker/cron/cli wire it + `compile(store=...)` | ✅ `57b6973` |
| S3 | `phase-03-memory-extract-mirror.md` | memory-extract `remember` node (injectable extractor, internal+delivered+not-dry-run) + Store `put` (content-hash) + MEMORY.md agent-section rewrite + cross-thread read via P2 injection | ✅ `9106073` |

**Final:** 518 tests (490 baseline + 28 new), ruff clean. New modules <200 LOC. Review caught + fixed 2 CRITICAL bugs: S1 Postgres conn-leak (`from_conn_string().__enter__()` GC-closes the connection → raw-connection fix), S3 MEMORY.md marker-doubling (`_split` re-added markers → corruption every write; fixed + 5-write regression test). Guardrail held: memory is internal-only, never through the gateway, never external (verified). Postgres checkpointer + Store paths wired + selection-tested but NOT run against a real PG (opt-in; live-PG smoke deferred).

Natural slicing rationale: S1 and S2 are pure infra plumbing (no observable behavior change with defaults); S3 is the only slice that changes runtime behavior, and it depends on the Store seam (S2) and the unchanged checkpointer config (S1). Each slice keeps the SQLite/InMemory defaults so the 490-test baseline stays green at every commit.

## Dependencies (DAG)

```
S1 (checkpointer selection + dep)  ──┐
                                     ├──► S3 (memory extract + mirror + read)
S2 (store wiring)  ──────────────────┘
S2 depends on S1 only for the shared dep add (langgraph-checkpoint-postgres);
the store factory itself is independent of the checkpointer factory.
S3 depends on S2 (needs the Store passed to nodes) and S1 (config shape settled).
```

S1 → S2 → S3 is the safe linear order. S1 and S2 could run parallel ONLY if the dep add lands first; recommend linear (the dep add is a 1-line pyproject change in S1, reused by S2).

## Acceptance criteria (measurable)

- **AC0**: `uv sync` succeeds with the new dep; `from langgraph.checkpoint.postgres import PostgresSaver` and `from langgraph.store.postgres import PostgresStore` both import. No existing test breaks. (S1)
- **AC1**: `get_checkpointer(settings)` returns a `SqliteSaver` when `settings.checkpointer == "sqlite"` (default), opening at `settings.data_dir / "checkpoints.db"` — byte-identical path to today. (S1)
- **AC2**: With `settings.checkpointer == "postgres"` + a `postgres_dsn`, `get_checkpointer` REACHES the `PostgresSaver` branch (asserted by patching the constructor — NO live connect). With `postgres` but NO dsn → a clear `ValueError`. (S1)
- **AC3**: All 3 callsites (worker.py:64, cron.py:55, cli.py:27) call the new signature; 490 baseline tests still green. (S1)
- **AC4**: `get_store(settings)` returns an `InMemoryStore` by default; with `settings.store == "postgres"` + dsn it REACHES the `PostgresStore` branch (patched). Builders accept `store=` and `compile(store=...)`; default run with `InMemoryStore` is behavior-identical to today. (S2)
- **AC5**: A real internal deliver runs the memory-extract node: the FAKE extractor returns facts → they appear in the Store under `(agent_id, "memory")` AND in MEMORY.md's agent section. A dry-run or non-delivered run writes NOTHING. (S3)
- **AC6**: The MEMORY.md rewrite preserves human content verbatim (above + below markers) and only mutates the agent section; the pure rewrite fn is unit-tested for: no markers present (creates them), markers present with prior agent facts (appends, capped to last N), human content untouched. (S3)
- **AC7**: Cross-thread read: a second `load_profile` after a write reads MEMORY.md (now with the agent section) into `LoadedProfile.memory`, which the internal prompt injects via the existing P2 path — "run 1 writes, run 2 reads" satisfied with ZERO new read wiring. External path still injects nothing (re-assert the guardrail). (S3)
- **AC8**: ruff clean (line-length 100); no source file exceeds 200 LOC (new memory helpers split into their own module).

## Risks (likelihood × impact → mitigation)

| # | Risk | L×I | Mitigation |
|---|------|-----|------------|
| R1 | `get_checkpointer` signature change breaks 3 callsites + tests | M×M | All 3 callsites enumerated (worker/cron/cli); update in the SAME commit; keep the sqlite path byte-identical (same db_path); run full suite. |
| R2 | Postgres dep pulls psycopg and breaks `uv sync` on macOS (no libpq) | L×H | `psycopg>=3.2.0` (pure-python core; binary optional). Verify `uv sync` green BEFORE any code change; if libpq missing, pin `psycopg[binary]`. AC0 gates this. |
| R3 | PostgresSaver `.from_conn_string` is a context manager — keeping it open for process lifetime | M×M | Mirror the sqlite approach: open the underlying connection directly (not the `with` block) so the saver stays usable. Since no live PG this round, the branch is selection-tested (constructor patched); document the lifecycle TODO for the real-PG round. |
| R4 | Memory node runs through the gateway by accident (violates "internal-only") | L×H | The node does NOT import/use ActionGateway; it calls `store.put` + the file rewrite directly. A test asserts the gateway is never invoked by the memory node. |
| R5 | MEMORY.md rewrite clobbers human content | L×H | Pure rewrite fn operating ONLY on the marker-delimited region; unit-tested with human content above + below; atomic write (temp file + rename). |
| R6 | Memory written on dry-run / failed deliver pollutes memory with noise | M×M | Node gated on `state["delivered"] is True` AND `not settings.dry_run`; tests cover both negatives writing nothing. |
| R7 | Unbounded MEMORY.md growth | M×L | Agent section capped to last N facts (e.g. N=50); rewrite trims oldest. Tested. |
| R8 | Extractor leaks secrets into memory | L×M | Facts are INTERNAL-only (never sent external — MEMORY.md is internal-prompt-only, re-verified context.py:11-13). Extractor prompt instructs "salient project facts, no tokens/keys". Documented as accepted internal-only risk (mirrors the existing Atlassian-token residual-risk posture). |
| R9 | Store namespace mismatch between write (agent_id) and any future read | L×M | Namespace = `(agent_id, "memory")` constant, single helper; agent_id derived from thread_id or passed via config. This round MEMORY.md is the read path, so Store-read mismatch is not on the critical path. |

## Rollback

- **S1**: revert checkpoint.py + the 3 callsites + Settings fields + loader_mapping + pyproject. The sqlite path is unchanged, so revert is a clean diff with no data migration (checkpoints.db format unchanged).
- **S2**: revert the store factory + the `store=` params; builders default `store=None` → `compile(store=None)` is the pre-P8 behavior. No persisted artifact to clean.
- **S3**: revert the memory node + the MEMORY.md helper + the deliver-edge wiring. The agent section in any MEMORY.md is inert text between markers (the P2 loader already reads the whole file); leaving it is harmless, or strip the marker block. No schema/data migration.
- All three slices are independent commits; revert any one without cascading to the others (S3 revert leaves S1/S2 plumbing dormant with defaults).

## Test matrix

| Layer | What | How (offline) |
|-------|------|---------------|
| Unit | `get_checkpointer(settings)` sqlite branch | real SqliteSaver at a tmp data_dir |
| Unit | postgres checkpointer branch reached | monkeypatch `PostgresSaver` constructor, assert called with dsn; assert `ValueError` when dsn missing |
| Unit | Settings new fields + 3-tier resolution | `build_settings_from_dict` + `build_settings_dict` (yaml/env/default) |
| Unit | `get_store(settings)` memory + postgres branches | real InMemoryStore; patched PostgresStore |
| Integration | builder accepts `store=`, node reads it | compile with InMemoryStore, invoke, assert node saw the store |
| Unit | MEMORY.md rewrite pure fn | no-markers / with-markers / human-preserved / cap-to-N |
| Integration | memory-extract node end-to-end | fake extractor + InMemoryStore + tmp MEMORY.md; assert Store + file written |
| Negative | dry-run / not-delivered writes nothing | assert Store empty + MEMORY.md unchanged |
| Guardrail | gateway never called by memory node | spy gateway, assert 0 calls |
| Guardrail | external path injects no memory | re-assert context.py internal-only (existing test extended) |
| Regression | full suite | `uv run pytest -q` green at each slice commit |

## Resolved decisions (user, 2026-06-25)

- **yaml config location**: a NEW `runtime:` block in profile.yaml holds the infra keys (`checkpointer`, `postgres_dsn`, `store`). Separate from `safety:`/`budget:`/`deployment:`. Profiles without it → sqlite/memory defaults (backward-compat).
- **Store put-key scheme**: **content-hash** of the fact text → identical facts across runs collapse to one Store entry (dedup). Deterministic + offline-testable.
- **Memory-node scope**: **all 3 report graphs** (report daily/weekly + okr + resource), NOT the phase-0 `graph.py`.

## Open questions

The cross-cutting one (Store-read vs MEMORY.md-read) is RESOLVED: **MEMORY.md is the inject/read path** (reuses P2, zero new read wiring); the **Store is the structured durable copy** for future cross-agent / queryable memory. "Run 1 writes, run 2 reads" is satisfied via MEMORY.md injection. Confirmed coherent against context.py + loader.py.
