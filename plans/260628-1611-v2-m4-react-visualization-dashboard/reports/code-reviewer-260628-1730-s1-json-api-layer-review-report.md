# Code Review — v2 M4 Slice S1: JSON API layer

Date: 2026-06-28
Reviewer: code-reviewer
Base: HEAD=898c496 (uncommitted working tree)
Plan: plans/260628-1611-v2-m4-react-visualization-dashboard/phase-01-json-api-layer.md

## Scope

- Files (6): 2 new modules, 2 pure-addition modifications, 1 one-line wiring, 1 new test.
  - NEW `src/server/routes_visualize.py` (54 LOC)
  - NEW `src/server/visualize_views.py` (142 LOC)
  - MOD `src/runtime/run_event.py` (+`read_run_events`, pure addition)
  - MOD `src/llm/budget_tracker.py` (+`monthly_series`, +`Any` import, pure addition)
  - MOD `src/server/app.py` (+import +include_router, 2 lines)
  - NEW `tests/test_server_visualize.py` (7 tests)
- Focus: read-only invariant, memory red line, PII allowlist, fd discipline.

## Verdict on the core invariant

**CONFIRMED: S1 adds only read-only JSON. The guardrail is untouched.**

- `git diff 898c496 -- src/actions/` is EMPTY. `action_gateway.py`, `hard_block.py`
  (which holds `classify`/`needs_interrupt`), Lớp A/B: ZERO diff. Verified directly.
- New modules call only read fns: `read_run_events`, `monthly_series`, `spent_this_month`,
  `store.search`, `ApprovalStore.list_pending` (a `SELECT`), `AuditLog.query`. No
  `gw.approve`, `execute`, `record_cost`, `check_allowed` anywhere. Grep confirms the only
  matches in the new modules are doc-comments and `action["server"]`/`action["tool"]` dict
  *reads*.
- `budget_tracker.py` and `run_event.py` diffs have ZERO removed lines (`git diff | grep '^-'`
  empty) — genuinely additive; `read_last_run_event`, `check_allowed`, `record_cost`,
  `spent_this_month` unchanged.

**One caveat to that confirmation — see CRITICAL-1 (Postgres `setup()` DDL on memory read).**

## Test + lint evidence

- `uv run pytest tests/test_server_visualize.py -q` → **7 passed**.
- `uv run pytest -q` → **783 passed**, 1 warning (pre-existing Starlette deprecation). Matches
  the claimed count; no existing server test regressed.
- `uv run ruff check` on all 5 changed `.py` → **All checks passed**.
- LOC: routes 54, views 142 — both < 200. OK.

---

## CRITICAL

### CRITICAL-1 — Postgres memory backend issues DDL (`setup()`) on every `/api/memory` read; also leaks a DB connection per request

`src/server/visualize_views.py:74-78` calls `get_store(settings)` and never closes it.
`src/agent/store.py:36-54` shows the postgres branch of `get_store`:

```python
conn = Connection.connect(settings.postgres_dsn, autocommit=True, ...)
store = PostgresStore(conn)
store.setup()   # <-- DDL: CREATE TABLE/INDEX IF NOT EXISTS migrations
return store
```

Two distinct problems when `settings.store == "postgres"`:

1. **Write-on-read (invariant-adjacent).** `setup()` runs schema-migration DDL. So the
   "read-only" memory endpoint executes DDL writes against the DB on *every* call. The Store
   is explicitly documented as INTERNAL agent state that does NOT pass the Action Gateway
   (`store.py:1-7`), so this is *not* a guardrail-gateway breach — but it contradicts the
   plan's literal "no write path" wording and is wasteful/surprising for a GET.
2. **Connection leak (fd discipline — the exact risk the plan flags).** Each request opens a
   fresh raw psycopg `Connection` (process-lifetime by design in `worker.py`, which holds ONE
   store for the whole run) and `memory_view` never closes it. On a long-lived FastAPI server
   this leaks one DB connection per `/api/memory` call until the pool/server dies. The plan's
   own Risk table ("fd leak — long-lived server leaks SQLite/Store connections per request,
   Medium×Medium, mitigation: open→close in finally") names this precisely, and it is
   unhandled for the Store (only `ApprovalStore` gets the finally/close at lines 87-91).

**Why the tests miss it:** default is `store: str = "memory"` (`settings.py:52`), and the test
seeds `build_settings_from_dict` without `store`, so `InMemoryStore` (no conn, no `setup`, no
`close`) is always exercised. The postgres path is selection-only, untested here.

**Severity rationale:** CRITICAL *conditional on the postgres deployment*. For the default
in-memory deployment this is a non-issue (InMemoryStore has no fd and no `setup` side effect).
Given M4 is observability-only and the dashboard is the first always-on `/api/memory` caller,
this will bite the first postgres-backed operator. At minimum it must be a documented,
accepted limitation, not silent.

**Fix options (pick one):**
- (a) Guard the postgres path: in `memory_view`, if `settings.store == "postgres"`, either
  reuse a single app-lifetime Store (inject it, like the worker holds one) or wrap in
  `try/finally` with `store.close()` — and confirm `PostgresStore`/its conn exposes a close.
- (b) Add a read-only store accessor that does NOT call `setup()` (the table already exists at
  read time in any real deployment), avoiding DDL-on-read entirely.
- (c) Explicitly scope S1 to InMemoryStore and add an inline comment + plan note that the
  postgres memory view is deferred (matches the "selection-tested only" posture of
  `_postgres_store`). Acceptable for this slice IF stated, since postgres memory is opt-in and
  untested end-to-end anyway.

Recommend (a) or (c). Do not leave it silent.

---

## HIGH

### HIGH-1 — `memory_view` hardcodes the `"memory"` namespace literal instead of the shared constant (silent-empty regression risk)

`src/server/visualize_views.py:78`:

```python
items = store.search((agent_id, "memory"))
```

The single source of truth for this namespace is `memory_node._NAMESPACE_KIND = "memory"`
(`memory_node.py:25`). The writer (`memory_node.py:72`) and the existing reader
(`sibling_memory.py:19,79`) both use that constant precisely to stay in sync —
`sibling_memory` even comments "single source of the 'memory' namespace". The new view
re-introduces the magic string.

Currently CORRECT (the literal equals the constant), so no live bug. But if the constant is
ever renamed, the view silently reads the wrong namespace and `/api/memory?audience=internal`
returns `[]` forever — and **no test would catch it**: the red-line test only asserts
external→`[]`, and `test_memory_internal_returns_facts` only asserts `internal_only is True`
with an empty InMemoryStore, never asserting a seeded fact is actually returned.

**Fix:** import and use the constant —
`from src.agent.memory_node import _NAMESPACE_KIND` then `store.search((agent_id, _NAMESPACE_KIND))`.
Move the local `get_store` import up alongside it. (DRY; matches `sibling_memory`.)

### HIGH-2 — No test proves the internal memory path returns a real fact (phantom-coverage gap)

`test_memory_internal_returns_facts` asserts only `internal_only is True` against a fresh
`InMemoryStore` (always empty). Combined with HIGH-1, the *happy path* of the memory endpoint
(read → project → return facts) is never exercised end-to-end. The `_fact` projection
(`visualize_views.py:129-132`) — including whether it correctly pulls `value["fact"]` from the
real Store item shape `{"fact":..., "ts":...}` written at `memory_node.py:76` — is untested.

**Fix:** seed a fact via the same store (`get_store(settings).put((agent_id,_NAMESPACE_KIND),
key,{"fact":"X","ts":...})`) within the test's patched settings, then assert
`/api/memory?audience=internal` returns `[{"fact":"X", ...}]`. This also locks in the namespace
match from HIGH-1.

---

## MEDIUM

### MEDIUM-1 — Corrupt budget file makes `/api/cost` return 500, not a degraded chart

`monthly_series` (`budget_tracker.py:79`) calls `self._read(month)` per file; `_read`
(`budget_tracker.py:52-55`) re-raises a corrupt file as `RuntimeError`. `cost_view` does not
catch it, and `routes_visualize._guard` only maps `UnknownAgentError`. So one corrupt
`budget-*.json` returns an unhandled 500 for the whole cost endpoint.

This is consistent with the plan's deliberate "corrupt budget file surfaces, not silently
zeroed" decision (`phase-01:160`, Risk table), and matches the writer's posture — so it is an
**accepted design choice, not a defect**. Flagging only because: for an *observability* GET, a
500 is a poor UX vs. returning the readable months plus a per-month error marker. Confirm the
intent: surfacing as 500 is fine for the budget *gate*, but the dashboard chart arguably wants
to render the good months and flag the bad one. Low-effort improvement, not blocking.

### MEDIUM-2 — `runs_view` clamp ceiling (500) exceeds the route default (100) but route exposes no real upper bound check

Route `get_runs` accepts `limit: int = 100` with no max; `runs_view` clamps to
`_RUN_LIMIT_MAX=500` (`visualize_views.py:49`). A caller can pass `?limit=10000` and get 500
rows — bounded, fine. But `limit=-5` → `max(1, min(-5,500))=1` returns 1 row silently rather
than rejecting. Same pattern in `audit_view` (clamp 200). Behavior is safe (bounded, no
crash), just silently coercing nonsense input. Acceptable; note for consistency with
`routes_audit.py` which uses the same `max(1,min(...))` idiom. No change required.

---

## LOW

### LOW-1 — `_fact` `value.get("text")` fallback is dead code

`visualize_views.py:132`: `value.get("fact") or value.get("text")`. No writer ever stores
`text` (writer uses `{"fact":...,"ts":...}` at `memory_node.py:76`). Harmless, but YAGNI —
drop the `text` branch or document why it's anticipated. Minor.

### LOW-2 — `_fact` drops `ts`, so the memory timeline has no timestamp

The stored fact carries `ts`, but `_fact` projects only `fact` + `key`. If the dashboard wants
to show *when* a fact was remembered, `ts` is non-PII and already in the allowlist spirit
(the plan suggested `text + ts`). Consider adding `"ts": value.get("ts")`. Not a defect — the
allowlist is correctly restrictive; just possibly under-projected vs. the plan's stated shape.

### LOW-3 — `monthly_series` reads each file twice (glob lists the file, then `_read(month)` re-opens it)

`budget_tracker.py:77-79` globs the path, derives `month` from the stem, then `_read(month)`
recomputes the path and re-opens. One extra stat+open per month, max 12/call — negligible.
Could pass the already-globbed `path` to a `_read_path` helper. Not worth changing.

---

## Per-CRITICAL-check confirmations (from the task)

1. **Guardrail invariant** — CONFIRMED read-only; zero diff to gateway/classify/needs_interrupt;
   no write fn imported. Sole caveat: postgres `setup()` DDL-on-read (CRITICAL-1), Store-internal,
   not a Gateway breach.
2. **Memory red line** — CONFIRMED robust. `memory_view:71` gates on `audience != "internal"`
   BEFORE importing/constructing the store (line 74 import is after the early return), so any
   value other than exactly `"internal"` → `{"facts": []}` with no store read. Default
   `audience="internal"` is intentional (default + localhost posture per plan/routes_runs.py:44
   precedent). Test `test_memory_external_leaks_nothing` asserts `facts == []`. No bypass.
3. **PII allowlist** — CONFIRMED. `_pick` selects an explicit tuple; runs test asserts
   `secret_report_text` dropped; automation test asserts raw `args`/"secret message body" absent
   (`_action_summary` emits only `type:server:tool`); audit test asserts `rationale` absent
   (`_AUDIT_FIELDS` drops `result_summary`/`rationale`). No raw-dict echo. `_fact` exposes only
   `fact`+`key` (see LOW-1/LOW-2). Good.
4. **fd discipline** — PARTIAL. `ApprovalStore` correctly open→`close()` in `finally`
   (`visualize_views.py:87-91`). Store (`memory_view`) is NOT closed — non-issue for the default
   InMemoryStore (no fd), but a real per-request connection leak on the postgres backend. See
   CRITICAL-1.
5. **Side-effect-free cost** — CONFIRMED. `cost_view`/`monthly_series` never call
   `check_allowed`. Over-budget test (999.0) returns 200. `monthly_series` only globs + `_read`
   + sort + slice. Corrupt-file 500 is by design (MEDIUM-1).
6. **404 consistency** — CONFIRMED. All 5 routes go through `_guard`; all 5 views call
   `_require_agent(agent_id)` first (lines 48, 56, 70, 85, 109). `UnknownAgentError`→404.

## Specific sub-questions answered

- **`monthly_series` month extraction/sort/clamp** — CORRECT. `path.stem.removeprefix("budget-")`
  yields e.g. `2026-06`. `sorted(glob)` then explicit `series.sort(key=month)` (redundant but
  harmless) ascending; `series[-clamp:]` keeps the NEWEST 12 after ascending sort. Verified by
  `test_cost_endpoint_monthly_series`. The double-sort is dead effort — glob is already sorted by
  the same key — but not a bug.
- **`audit_view` newest-first** — CONFIRMED. `AuditLog.query` does `out.reverse() # newest first`
  (`audit_log.py:103`), so `all_rows[:clamp]` takes the newest `clamp` rows. Counts iterate the
  full list (unaffected by clamp). Correct.
- **Test monkeypatch correctness** — CONFIRMED MEANINGFUL. `load_registry`/`load_profile` are
  patched in `visualize_views`' namespace (the module binds them at import: lines 20, 22), which
  is exactly where the view looks them up, so the real view code runs against seeded data. Not a
  source-module patch that would miss the binding. `agent_views.load_registry` also patched for
  the 404 sentinel's registry. Good. (Gap is coverage breadth — HIGH-2 — not patch correctness.)

## Recommended actions (prioritized)

1. **CRITICAL-1**: Decide postgres memory handling. Either close the Store / reuse one
   app-lifetime instance / use a non-`setup()` read path, OR explicitly scope S1 to
   InMemoryStore with an inline comment + plan note. Do not ship it silent.
2. **HIGH-1**: Replace the `"memory"` literal with `_NAMESPACE_KIND` (DRY, prevents silent-empty).
3. **HIGH-2**: Add an internal-memory happy-path test that seeds and asserts a returned fact
   (locks HIGH-1 + exercises `_fact`).
4. **MEDIUM-1**: Confirm 500-on-corrupt-budget is the intended dashboard behavior or degrade
   gracefully.
5. **LOW**: drop dead `text` fallback; consider exposing `ts` in `_fact`.

## Metrics

- Tests: 783 passed (full), 7 new. Lint: 0 issues. LOC: routes 54 / views 142 (both <200).
- New-module read-only grep: clean. Guardrail diff: empty.

## Unresolved questions

1. **Is a postgres-backed memory store in scope for S1's `/api/memory`?** If yes, CRITICAL-1
   must be fixed before ship. If no (InMemoryStore only this round), a one-line scope note +
   inline comment closes it. Needs a product/scope decision.
2. **Should `/api/cost` degrade (render good months + per-month error) on a corrupt budget file,
   or is a 500 acceptable for the dashboard?** Plan says "surface, not silently zero" — confirm
   that posture also applies to the read-only chart endpoint vs. the budget gate.

---
Status: DONE_WITH_CONCERNS
Summary: S1 is read-only and the guardrail (gateway/classify/needs_interrupt/Lớp A/B) has zero
diff; memory red line and PII allowlist are correctly enforced; 783 tests + ruff green. Two
issues need attention before ship: (CRITICAL) the postgres memory backend runs `setup()` DDL and
leaks a connection per `/api/memory` read because the Store is never closed, and (HIGH) the memory
namespace is a magic string instead of the shared constant with no happy-path test, masking a
silent-empty regression.
Concerns: postgres memory write-on-read + fd leak (CRITICAL-1); namespace DRY + coverage gap
(HIGH-1/2). All non-issues for the default in-memory deployment.
