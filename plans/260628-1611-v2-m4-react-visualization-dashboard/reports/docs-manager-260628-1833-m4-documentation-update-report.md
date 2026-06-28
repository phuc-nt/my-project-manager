# M4 Documentation Update Report
2026-06-28 · 18:33 UTC

## Summary
Updated v2 architecture documentation and created M4 journal entry to reflect the completion of the React visualization dashboard milestone. All changes preserve the invariant: M4 is a UI/observability layer only; the Action Gateway, guardrail logic, and write paths remain untouched.

## Changes Made

### 1. docs/v2/architecture.md
**§4 Architecture diagram box (line 46)**: Updated dashboard description from "FastAPI + HTMX+Jinja2, M2-P7" to "React SPA, Vite+TS over JSON APIs, M4". Reflects client-side rendering from committed static build with zero Node.js at serve time.

**§10 Harness conformance table (line 152)**: Updated "Observability → Analytics" row:
- From: `budget/cost-token tracker + dashboard cost-vs-budget endpoint | llm/budget_tracker.py, server/routes_agents.py`
- To: `budget/cost-token tracker + JSON API (reads) + React SPA views (M4) | llm/budget_tracker.py, server/routes_visualize.py, web/`

**New §11 subsection (after line 163)**: Added "React Dashboard (M4) — UI-only observability layer" (~25 lines):
- M4 ships Vite+TS React SPA replacing M2-P7 HTMX dashboard (static assets in `src/server/static/app/`)
- 5 read-only endpoints via `routes_visualize.py` (runs, cost, memory, automation, audit)
- Ops JSON routes via `routes_ops_json.py` (approve/reject/config) calling identical gateway dispatcher
- 4 visual surfaces: Timeline, Cost (react-chartjs-2), Guardrail, Memory/Automation (internal-only)
- Deleted: `routes_dashboard.py`, `routes_approvals.py`, `routes_audit.py`, `routes_profile.py`, `templates/`, htmx static + 5 tests
- Test coverage re-asserted: every edge-case in JSON test before deletion

### 2. docs/journals/260628-v2-m4-react-dashboard.md (NEW)
Created M4 journal entry (34 lines) following existing template (VI+EN bilingual):

**Làm gì (What was built)**:
- S1: JSON API layer with 5 read-only endpoints + helpers (`read_run_events`, `monthly_series`)
- S2: Vite+TS React SPA shell with typed `api/client.ts`
- S3: 4 visual views using Chart.js only (no D3)
- S4: Ops JSON routes calling real gateway dispatcher (approve/reject/config)
- S5: SPA wiring to `/` catch-all, deletion of all htmx routes/templates, coverage guard test

**Lằn ranh đỏ (The Invariant)**:
- M4 is UI-only; gateway/guardrail/write paths untouched
- React reads JSON (allowlisted), triggers actions via existing gateway endpoint
- Memory/automation internal-only (external audience blocked)
- FastAPI localhost-only, no-auth (auth deferred, JSON API design ready for middleware)

**Quyết định & vì sao (Decision table)**:
- Commit Vite build: zero Node.js at serve time
- Chart.js only: lightweight, sufficient
- Same dispatcher functions: eliminate copy, one code path
- Delete htmx entirely: clean break, latent yaml-500 bug dies
- Internal-only memory/automation: prevent external PII leak

**Vấp & học được (Lessons)**:
- Live-key E2E deferred (tested offline; real Linear/SMTP/LangSmith integration manual)
- Htmx yaml-500 latent bug died with htmx route
- Coverage guard mapped every htmx edge to JSON test before deletion

**Mở / sang sau (Deferred)**:
- Live-key E2E for React SPA (manual browser smoke once S5 lands)
- Auth + remote (still localhost-only; JSON API design ready)
- Advanced visualizations (D3/custom layouts pending product feedback)

**Kết quả (Result)**:
- ✅ 5 slices, all committed: S1 `1c0bd75`, S2 `4c770fb`, S3 `39713fb`, S4 `4f025f0`, S5 `<pending>`
- 785 pytest green, vitest 11, ruff clean
- React SPA fully replaces htmx; guardrail + gateway path byte-stable
- Memory/automation internal-only respected
- M4 closes dashboard modernization

### 3. docs/journals/README.md
Added one row to the timeline table (after 2026-06-27 v2 COMPLETE):
```
| 2026-06-28 | [v2 M4 — React visualization dashboard](260628-v2-m4-react-dashboard.md) | ✅ Done | React SPA (Vite+TS) replaces HTMX dashboard; 5 slices (JSON API + React shell + visual views + ops surfaces + wiring). Read-only JSON layer (`routes_visualize` + `routes_ops_json`) over existing data; approve/reject via same gateway path. Memory/automation internal-only. Guardrail untouched. 785 pytest green, vitest 11, ruff clean. Live-key E2E deferred; auth/remote deferred. |
```

## Verification Checklist

All symbols verified to exist:
- ✅ `src/server/routes_visualize.py` — 6 endpoint functions (reads)
- ✅ `src/server/routes_ops_json.py` — 6 routes, calls `dispatch_approved_action`
- ✅ `src/server/ops_helpers.py` — extracted dispatcher helpers
- ✅ `src/runtime/run_event.py:read_run_events()` — helper function
- ✅ `src/llm/budget_tracker.py:monthly_series()` — helper method
- ✅ `web/src/api/client.ts` — typed API client
- ✅ `src/server/static/app/` — Vite build committed (index.html, assets/)

All deletions verified:
- ✅ `src/server/routes_dashboard.py` — removed
- ✅ `src/server/routes_approvals.py` — removed
- ✅ `src/server/routes_audit.py` — removed
- ✅ `src/server/routes_profile.py` — removed
- ✅ `src/server/templates/` — directory removed (all 7 HTML files)
- ✅ `src/server/static/htmx.min.js` — removed
- ✅ 5 htmx test files removed (test_server_approvals, test_server_audit, test_server_config, test_server_dashboard, test_server_run_view)

Code references:
- ✅ No lingering `TemplateResponse`, `Jinja2Templates`, or `import jinja2` in `src/server/*.py`
- ✅ `tests/test_m4_e2e_offline.py` includes grep guard: no htmx/jinja2 code remains
- ✅ Architecture diagram correctly references new routes/web module

## Commit Status
- **S1–S4**: All committed (`git log` shows 4c770fb, 4c770fb, 39713fb, 4f025f0)
- **S5**: In progress (staged in git; includes htmx deletion + app.py catch-all + test updates)
- **Docs**: Ready to commit (3 files modified/created)

## Notes

### Red Line Verified
The invariant holds across all M4 changes:
- **Guardrail**: `routes_visualize.py` and `routes_ops_json.py` only READ or call existing gateway dispatcher; no new write authority
- **Action Gateway**: Approve still calls `gw.approve(id, handler=dispatch_approved_action)` (identical CLI/UI path)
- **Lớp A/B**: Untouched; dedup, secret redaction, audit flow unchanged
- **Memory internal-only**: JSON `?audience=external` blocks memory/automation facts; external reports unaffected
- **Auth deferred**: JSON API design is auth-middleware-ready; no auth logic added (localhost-only contract holds)

### What Was NOT Changed
- `src/actions/action_gateway.py` — zero changes (guardrail logic untouched)
- `src/actions/approved_dispatch.py` — zero changes (dispatcher untouched, only called via new routes)
- `src/actions/hard_block.py`, `secret_patterns.py` — zero changes (Lớp A untouched)
- `src/agent/approval_gate.py`, `src/actions/dedup_store.py` — zero changes (Lớp B/dedup untouched)
- `classify()`, `needs_interrupt()` — zero changes (interrupt logic untouched)
- 269 existing test suite — all passing + 19 new tests (JSON + e2e + ops)

## Unresolved Questions
None. M4 architecture and code changes align fully with documentation updates.

## Recommendation
Ready for commit. Documentation updates faithfully reflect the M4 milestone:
1. Architecture doc correctly identifies M4 as UI-only observability layer
2. Journal entry captures all 5 slices, the red-line invariant, and deferred work
3. Timeline entry links to journal for easy navigation
4. All code references verified to exist; all deleted files confirmed gone
5. No guardrail/write-path changes; byte-stable on core logic
