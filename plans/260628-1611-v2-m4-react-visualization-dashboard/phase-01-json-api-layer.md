---
phase: 1
title: JSON API layer
status: completed
effort: M
---

# Phase 1: JSON API layer

## Overview

Expose the 4 visualization data groups (timeline runs, cost series, memory + automation,
guardrail/audit) as **read-only JSON endpoints** over the per-agent data sources that already
exist. No business logic is rewritten and no guardrail code is touched — this slice only adds
a thin router + a view-assembly layer that projects raw state to a **non-PII allowlist**,
mirroring the `summarize_node` discipline. This is the boring-but-mandatory foundation: the
backend renders HTML today, so React cannot start until JSON is available.

## Requirements

- New JSON endpoints (mirror the clean pattern at `src/server/routes_agents.py:13-28`:
  `APIRouter(prefix="/api/...")`, thin route → `*_views` layer):
  - `GET /api/runs/{agent_id}` — run timeline (list of run-events).
  - `GET /api/cost/{agent_id}` — MONTHLY cost series (last 12 months) + cap + warn-ratio. No
    per-run cost trend this round (deferred — see Architecture).
  - `GET /api/memory/{agent_id}?audience=internal` — remembered facts (**internal-only**, gated
    by an explicit `audience` query param: `external` ⇒ empty/403, mirroring the strict-audience
    validation at `routes_runs.py:44`).
  - `GET /api/automation/{agent_id}` — pending Lớp B proposals (incl. D3 workflow proposals).
  - `GET /api/audit/{agent_id}` — guardrail events: aggregated verdict counts + recent rows.
- Each view layer keys off `agent_data_dir(id)` and **opens-then-closes** any store
  (fd-leak discipline) exactly like `agent_views._pending_count` at
  `src/server/agent_views.py:81-92`.
- Each payload is projected to an explicit allowlist; raw state never dumped. The audit/
  approval data is already redacted at write time, but the view still selects fields rather
  than echoing the whole record.
- Unknown agent id → 404 (reuse the registry-membership check used across the routers).
- No change to `classify()`, `needs_interrupt()`, Action Gateway, or any write path.
- Design for a later auth middleware: keep all new routes under the `/api/` prefix and free
  of per-route auth assumptions, so a single FastAPI dependency/middleware can later gate
  `/api/*` without touching handlers.

## Architecture

```
React (S2+) ──GET /api/{runs,cost,memory,automation,audit}/{id}──▶ routes_visualize.py (thin)
                                                                        │ delegate
                                                                        ▼
                                                          visualize_views.py  (allowlist projection)
                                                                        │ reads (open→close)
        ┌───────────────┬───────────────┬──────────────────┬───────────┴───────────┐
        ▼               ▼               ▼                  ▼                       ▼
 run_event.py     budget_tracker.py  agent/store.py   approval_store.py        audit_log.py
 (runs.jsonl)     (budget-*.json)    (Store search)   (list_pending)           (query)
```

**Data-source seams (verified):**
- **Timeline** — `src/runtime/run_event.py`. `read_last_run_event(agent_id)` (lines 30-48)
  returns only the LAST line; the timeline needs the full list, so add a sibling reader
  `read_run_events(agent_id, limit=...)` in the SAME module that reads `runs.jsonl` newest-first
  with a clamp (mirror `AuditLog.query`'s clamp pattern). Allowlist per event:
  `ts / kind / audience / status / cost_usd / delivered` (all already non-PII; the run-event
  log carries no persona/project text — same fields `agent_views.list_agents` exposes at
  `src/server/agent_views.py:36-52`).
- **Cost** — `src/llm/budget_tracker.py`. **MONTHLY ONLY** (decided): the source of truth is the
  per-month `budget-{month}.json` files. `BudgetTracker(settings)` exposes only
  `spent_this_month()` (line 62), so add a read-only helper `monthly_series()` (or a module fn)
  that globs `settings.data_dir / "budget" / "budget-*.json"` (path shape from `_path_for`,
  line 41-42), parses, sorts by month, and **clamps to the last 12 months** (decided default —
  bounds the chart). Returns `[{month, total_usd}]`. Payload: `{ series: [...12 months],
  cap: monthly_budget_usd, warn_ratio: budget_warn_ratio, spent_this_month, ratio }`. **Do NOT
  call `check_allowed()`** — it raises and gates LLM calls; the view must be side-effect-free.
  *(Deferred future option: a per-run cost trend from `runs.jsonl` `cost_usd` — NOT this round.)*
- **Memory** — `src/agent/store.py`. `get_store(settings)` (line 29) → `store.search((agent_id,
  "memory"))`. **INTERNAL-ONLY, enforced by an explicit `audience` query param** (default
  `internal`): `audience=external` ⇒ the view returns nothing (empty / 403), mirroring the
  strict-audience reject at `routes_runs.py:44` — a typo must NOT silently leak facts. Facts are
  the agent's remembered state and are PII-adjacent. Project each item to a short allowlist
  (`key`/`value` or `text` + `ts`); the gate is the P5 red line — same posture as `summarize_node`
  dropping persona/memory. Default store is `InMemoryStore` (no infra), so the fact list may be
  empty on a fresh process — the view must degrade to `[]`, not error.
- **Automation** — `src/actions/approval_store.py`. `ApprovalStore(data_dir/"approvals.db")`
  → `list_pending()` (lines 80-90) returns `PendingApproval(id, action, reason, status,
  created_at)`; the `action` is ALREADY redacted at enqueue (lines 50-67). Project to
  `{id, reason, status, created_at, action_summary}` where `action_summary` is a short
  derived label (type/tool), not the raw args dict. **Close the store** in a finally.
- **Audit** — `src/audit/audit_log.py`. `AuditLog(path).query(tool=, verdict=, limit=)`
  (lines 70-105) over `agent_data_dir(id)/audit/audit.jsonl` (path shape from
  `src/server/routes_audit.py:26`). Build two things: (a) **aggregated counts** by verdict
  across the file (`allow/deny/dry_run/skipped/pending/reject` — full set confirmed present in
  `src/actions/`), (b) a clamped **recent rows** list (reuse the `limit` clamp `max(1,
  min(limit, 200))` from `routes_audit.py:27`). Rows are already redacted; still select fields
  (`timestamp/action_type/tool/verdict/reason`) rather than echoing `result_summary`/`rationale`.

**PII firewall reference:** every projection mirrors `summarize_node` at
`src/server/sse_events.py:17-35` — allowlist-in, drop everything else; unknown shape → empty.

## Related Code Files

### Create
- `src/server/routes_visualize.py` — thin JSON router, `APIRouter(prefix="/api")`, 5 GET routes,
  404 on unknown id. Mirrors `routes_agents.py`.
- `src/server/visualize_views.py` — allowlist-projecting view assembly (one fn per endpoint),
  open→close store discipline. Mirrors `agent_views.py`.
- `tests/test_server_visualize.py` — endpoint shape + PII-allowlist + memory-internal-only tests.

### Modify
- `src/runtime/run_event.py` — add `read_run_events(agent_id, *, limit=...)` (full-list reader)
  next to `read_last_run_event`. Pure addition; existing fn unchanged.
- `src/llm/budget_tracker.py` — add a read-only `monthly_series()` helper (glob prior months).
  Pure addition; no change to `check_allowed`/`record_cost`/`spent_this_month`.
- `src/server/app.py` — `app.include_router(routes_visualize.router)` (one line; the router list
  pattern at `src/server/app.py:45-52`). No other change in this slice.

### Delete
- None.

## Implementation Steps

1. Add `read_run_events(agent_id, *, limit)` to `run_event.py` (newest-first, clamp, malformed
   line skipped — mirror `AuditLog.query`).
2. Add `monthly_series()` read helper to `budget_tracker.py` (glob `budget-*.json`, parse,
   sort by month, clamp to the last 12; ignore corrupt files defensively but do NOT silently
   zero the cap).
3. Create `visualize_views.py` with `runs_view / cost_view / memory_view / automation_view /
   audit_view`, each: registry-membership check (raise `UnknownAgentError` → 404), load profile
   at `agent_data_dir(id)`, read its source, project to allowlist, close any store.
4. Create `routes_visualize.py` — 5 thin GET routes delegating to the views; map
   `UnknownAgentError` → `HTTPException(404)`.
5. Register the router in `app.py`.
6. Write `tests/test_server_visualize.py`: seed a tmp data dir (follow the `monkeypatch` +
   `agent_paths.DATA_DIR` + `agent_views.load_registry` stub pattern from
   `tests/test_server_approvals.py`), assert each endpoint's JSON shape from seeded data, assert
   raw/sensitive fields are DROPPED (allowlist), and a **red-line test** that
   `/api/memory/{id}?audience=external` returns nothing (empty/403) while `audience=internal`
   returns the seeded facts.
7. Run the focused test, then the server-test subset (`uv run pytest tests/test_server_visualize.py`,
   then the server tests).

## Success Criteria

- [ ] 5 GET endpoints return well-formed JSON from seeded per-agent data.
- [ ] Each payload contains ONLY allowlisted fields; a seeded sensitive field (e.g. raw action
      args, `result_summary`, `rationale`) is asserted absent.
- [ ] `/api/memory/{id}` is internal-only via the explicit `audience` param —
      `audience=external` gets no facts (empty/403); red-line test asserts it.
- [ ] Unknown agent id → 404 on every endpoint.
- [ ] Cost endpoint never raises on an at/over-budget agent (no `check_allowed`).
- [ ] No diff to `classify()`, `needs_interrupt()`, `action_gateway.py`, or any write path.
- [ ] New tests pass; existing server tests still green.

## Risk Assessment

| Risk | Likelihood × Impact | Mitigation |
|---|---|---|
| **Guardrail-invariant breach** — a view mutates state or reaches a write path | Low × Critical | Views are read-only by construction; reuse `query`/`list_pending`/`search`/`spent_this_month` only. No `gw.approve`, no `record_cost`, no `check_allowed`. Red-line test: grep the new modules import no `action_gateway` write fn. |
| **PII leak** — raw state dumped instead of allowlist | Medium × High | Every field is explicitly selected; test asserts a seeded sensitive field is absent. Memory endpoint internal-only. |
| **fd leak** — long-lived server leaks SQLite/Store connections per request | Medium × Medium | Open→close in a `finally`, mirroring `agent_views._pending_count` (`agent_views.py:88-92`). |
| **Cost view side effect** — calling `check_allowed()` raises on over-budget agents | Low × Medium | Use `spent_this_month` + new `monthly_series` reader only; never `check_allowed`. |
| **Corrupt source file** | Low × Low | Skip malformed JSONL lines (existing `query`/`read_last_run_event` pattern); corrupt budget file surfaces, not silently zeroed (existing `_read` behavior at `budget_tracker.py:51-54`). |

**Invariant restatement:** This slice adds READ-only JSON. The Action Gateway, `classify()`,
`needs_interrupt()`, Lớp A/B, audit, budget gating are untouched. Memory/automation views are
internal-only; all payloads are allowlist-projected (the `summarize_node` red line).

## Unresolved Questions

None — all resolved.
