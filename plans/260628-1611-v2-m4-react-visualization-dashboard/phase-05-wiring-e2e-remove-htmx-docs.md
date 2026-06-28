---
phase: 5
title: Wiring + e2e + remove htmx + docs
status: completed
effort: M
---

# Phase 5: Wiring + e2e + remove htmx + docs

## Overview

Finalize: wire the SPA build into `app.py` as the served UI (clean `/`), **delete the htmx
dashboard** (`routes_dashboard.py` + `templates/` + vendored htmx static) now that React covers
all 6 surfaces, confirm the kept API + ops endpoints are unaffected, run an offline e2e (FastAPI
serves the SPA, JSON APIs return data, approve path intact), and update docs. This is the only
slice that edits `app.py` routing and removes files — it depends on S1–S4 being complete.

## Requirements

- **Serve the SPA at `/`:** mount the COMMITTED dist at `src/server/static/app/` via
  `StaticFiles(..., html=True)` at `/` (S2 commits the dist; this slice makes it the served `/`
  artifact — no build step at serve time, the zero-extra-process property). The `html=True` mount
  replaces the htmx index (`src/server/routes_dashboard.py:26-31`) and serves `index.html` for
  unmatched client-routed paths. Mount `/` LAST so `/api/*` and the existing `/static` mount keep
  precedence (see Serve strategy). Update the S2 router `basename` from `/static/app` to `/`, then
  rebuild + re-commit the dist.
- **Delete htmx** once React is verified to cover all 6 surfaces (list/detail · approvals ·
  audit · config · run+SSE):
  - `src/server/routes_dashboard.py` (and its `index` + `agent_detail` HTML routes).
  - `src/server/routes_approvals.py`, `src/server/routes_audit.py`, `src/server/routes_profile.py`
    — the **HTML** ops routes (their JSON replacements live in S1 `routes_visualize.py` /
    S4 `routes_ops_json.py`). **DEPENDENCY:** these import `templates` from `routes_dashboard`
    (`routes_approvals.py:22`, `routes_audit.py:12`, `routes_profile.py:15`) — deleting
    `routes_dashboard` breaks those imports, so all four HTML routers must be removed together,
    and their `include_router` lines dropped from `app.py:49-52`. **KEEP `src/server/ops_helpers.py`**
    (the S4-extracted `_require_agent`/`_gateway`) — `routes_ops_json.py` still imports it; do NOT
    delete it with the htmx routers.
  - `src/server/templates/` (index/agent_detail/base + approvals/audit/config/run subdirs).
  - `src/server/static/htmx.min.js` (vendored htmx).
  - Their tests: `test_server_dashboard.py`, `test_server_approvals.py`, `test_server_audit.py`,
    `test_server_config.py`, `test_server_run_view.py` — **DELETE outright** (decided, NOT port).
    **GUARD (mandatory before deletion):** for each htmx test, confirm the equivalent edge-case
    assertion already exists in an S1 JSON-layer test or an S4 ops-migration test — especially
    `unknown agent id → 404` and `approve → real dispatch_approved_action post path`. If any
    edge-case is htmx-test-only and not yet covered by a JSON/React test, ADD that assertion to
    the JSON/React test FIRST, then delete the htmx test. Net coverage must not drop.
- **Keep + verify unaffected:** `routes_agents.py` (`/api/agents`), `routes_runs.py`
  (`/api/agents/{id}/trigger`, `/api/runs/{id}/stream`), the S1 `routes_visualize.py`, the S4
  `routes_ops_json.py`, and `app.state.run_manager` (`app.py:44`). The M2-P6 contract stays.
- **Offline e2e:** FastAPI serves the SPA shell, the 5 JSON APIs return seeded data, the approve
  path runs the real gateway (stubbed post), trigger+SSE stream works — all without network.
- **Grep guard:** assert no `htmx`, `jinja2`, or `templates.TemplateResponse` references remain
  in `src/server/` (a test or CI grep).
- **Docs:** update `docs/v2/architecture.md` (replace the M2-P7 HTMX dashboard block at
  `architecture.md:45-52` with the M4 React SPA + JSON API description; update the §10 analytics
  row at `architecture.md:152` if the cost endpoint module name changes) and add a journal entry
  under `docs/journals/`. **NO new `docs/v2/roadmap-m4.md`** — consistent with M3 (which had no
  roadmap doc); M4 is tracked via this plan + the journal entry + the architecture update only.

## Architecture

```
BEFORE (M2-P7):  GET /  ──▶ routes_dashboard.index  ──▶ Jinja2 index.html (htmx)
                 /dashboard/agents/{id}/{approvals,audit,config,run} ──▶ HTML partials

AFTER (M4):      GET /  ──▶ StaticFiles(static/app, html=True), mounted LAST  ──▶ React client routing
                 GET /api/{agents,runs,cost,memory,automation,audit}/{id} ──▶ JSON (read)
                 POST /api/.../approve|reject, /config/* , /trigger ; SSE /api/runs/{id}/stream
                 (all write paths via the EXISTING gateway — unchanged)

DELETED:  routes_dashboard.py, routes_approvals.py, routes_audit.py, routes_profile.py (HTML),
          templates/, static/htmx.min.js, + their htmx-specific tests.
```

**Serve strategy (DECIDED):** mount `StaticFiles(directory=str(Path(__file__).parent /
"static/app"), html=True)` at `/`. `html=True` serves `index.html` for `/` and for unmatched
sub-paths, so client-side routes (`/timeline`, `/cost`, ...) deep-link correctly. **Precedence:
mount `/` LAST** — register every API router (`routes_agents`, `routes_runs`, `routes_visualize`,
`routes_ops_json`) AND the existing `/static` mount (`app.py:53-57`) BEFORE the `/` mount, so
`/api/*` and `/static/*` keep precedence over the SPA catch-all. The e2e hits `/api/*` to prove
the precedence holds.

## Related Code Files

### Create
- `tests/test_m4_e2e_offline.py` — full offline e2e (serve SPA shell, 5 JSON APIs, approve red
  line, trigger+SSE) + the grep guard (no htmx/jinja2/template refs in `src/server/`).

### Modify
- `src/server/app.py` — drop the 4 htmx `include_router` lines (`app.py:49-52`); add the SPA
  `StaticFiles(html=True)` mount at `/` registered LAST (after every API router + the `/static`
  mount). Keep `routes_agents`, `routes_runs`, `routes_visualize`, `routes_ops_json`, `run_manager`.
- `web/src/App.tsx` / router — `basename` `/static/app` → `/`.
- `docs/v2/architecture.md` — replace the dashboard block (`:45-52`); adjust §10 analytics row
  (`:152`) if needed.
- A journal entry under `docs/journals/` (the M4 record — no roadmap-m4 doc, per Decision 4).

### Delete
- `src/server/routes_dashboard.py`, `src/server/routes_approvals.py`, `src/server/routes_audit.py`,
  `src/server/routes_profile.py` (HTML routers).
- `src/server/templates/` (entire dir).
- `src/server/static/htmx.min.js`.
- `tests/test_server_dashboard.py`, `tests/test_server_approvals.py`, `tests/test_server_audit.py`,
  `tests/test_server_config.py`, `tests/test_server_run_view.py` — deleted outright AFTER the
  coverage guard confirms each unique edge-case assertion lives in an S1/S4 JSON/React test.

## Implementation Steps

1. Confirm S1–S4 done and React covers all 6 surfaces (manual checklist against the seeded
   dataset BEFORE deleting anything).
2. Update `app.py`: remove the 4 htmx `include_router` lines; add the SPA `StaticFiles(html=True)`
   mount at `/`, registered LAST (after every API router + the `/static` mount, so `/api/*` wins).
3. Update the React `basename` to `/`; `vite build`.
4. **Coverage guard:** map each of the 5 htmx test files' unique edge-case assertions to an
   existing S1/S4 JSON/React test (esp. `unknown agent id → 404`, `approve → real
   dispatch_approved_action post path`); for any gap, ADD the assertion to the JSON/React test
   FIRST. THEN delete the 4 HTML routers, `templates/`, `htmx.min.js`, and the 5 htmx test files.
5. Add `tests/test_m4_e2e_offline.py`: serve the SPA shell, hit the 5 JSON APIs against seeded
   data, run the approve red line (stubbed post → gateway path + audit), trigger+SSE; add the
   grep guard asserting no htmx/jinja2/template refs remain in `src/server/`.
6. Run the FULL backend suite `uv run pytest` (776-baseline; htmx-test deletions offset by S1/S4
   additions — must end green; account for the net change vs 776). Separately run the frontend
   `npm test` (vitest) in `web/` — local-only, NOT part of the pytest gate. Rebuild + re-commit
   the dist (`vite build`).
7. Update docs: architecture dashboard block + §10 row + the journal entry (NO roadmap-m4 doc).
   Verify dates/links/claims match the actual change.
8. Final manual smoke: `python -m src.server.app`, open `/`, exercise each view + approve + config
   + trigger end to end (offline).

## Success Criteria

- [ ] `GET /` serves the React SPA; deep-links to client routes resolve (catch-all to index.html).
- [ ] All 4 visual views + 3 ops surfaces work against the real backend (offline e2e green).
- [ ] Approve still runs the real gateway path (red-line e2e green); audit written; no bypass.
- [ ] `/api/agents` + `/api/runs/{id}/trigger` + `/api/runs/{id}/stream` unaffected (M2-P6 contract).
- [ ] htmx FULLY removed: routes_dashboard + 3 HTML ops routers + templates/ + htmx.min.js gone;
      grep guard asserts no htmx/jinja2/template refs in `src/server/`.
- [ ] Coverage guard satisfied: every unique htmx-test edge-case (esp. `unknown agent id → 404`,
      `approve → real dispatch_approved_action`) is asserted by an S1/S4 JSON/React test BEFORE the
      htmx test files are deleted; net test coverage did not drop.
- [ ] FastAPI app still localhost-only (127.0.0.1, no auth) — `main()` bind unchanged (`app.py:75`).
- [ ] Backend `uv run pytest` green (776 baseline ± htmx-delete/new-test net change); `vite build`
      succeeds + dist re-committed; frontend vitest green locally (`npm test` in `web/`, separate gate).
- [ ] Docs updated: architecture dashboard block + §10 row + a `docs/journals/` entry (NO
      roadmap-m4 doc) — dates/links verified.

## Risk Assessment

| Risk | Likelihood × Impact | Mitigation |
|---|---|---|
| **Premature htmx deletion** — delete before React covers a surface → ops gap | Medium × High | Step-1 coverage checklist BEFORE any delete; e2e (step 5) before merge. Rollback = revert the delete commit (htmx routers are self-contained). |
| **Broken import cascade** — deleting `routes_dashboard` breaks `templates` imports in the 3 ops routers | Certain-if-naive × High | Delete all 4 HTML routers TOGETHER + drop their `include_router` lines in one change; the JSON replacements already exist (S1/S4). Sequenced explicitly above. |
| **`/` mount shadows `/api`** — the `html=True` SPA mount swallows API/asset routes | Medium × High | Mount `/` LAST (after every API router + the `/static` mount); e2e hits `/api/*` + `/static/*` to prove they still route. |
| **Test suite shrinks / hides loss** — deleting htmx tests masks a regression | Medium × Medium | Each deleted htmx test's behavior is re-covered by a named S1/S4 JSON test or the new e2e (map them 1:1 before deleting); the suite ending green from the 776 baseline is necessary but not sufficient — verify the coverage map, not just the count. |
| **localhost/no-auth contract drift** in the serve rewrite | Low × High | `main()` 127.0.0.1 bind untouched (`app.py:64-75`); e2e via TestClient; grep guard doesn't touch bind. |
| **Docs drift** — architecture still describes htmx | Low × Low | Explicit doc edits + a read-after-write verify (date/link/claim). |

**Invariant restatement:** Removing htmx changes the UI delivery only. The Action Gateway,
`classify()`, `needs_interrupt()`, Lớp A/B, audit, budget, dedup, and every write path are
untouched. Approve still routes `gw.approve(handler=dispatch_approved_action)`; memory/automation
stay internal-only; the FastAPI app stays localhost-only/no-auth (auth deferred, S1 JSON API left
auth-middleware-ready).

## Unresolved Questions

None — all resolved. (Serve = `StaticFiles(html=True)` at `/`, mounted LAST so `/api/*` + `/static`
keep precedence. htmx test files deleted outright, gated by the pre-delete coverage guard.)
