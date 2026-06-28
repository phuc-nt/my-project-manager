# Code Review — v2 M4 Slice S2: React shell + Vite

Date: 2026-06-28
Reviewer: code-reviewer
Base: HEAD=1c0bd75 (new files untracked; reviewed against working tree)
Plan: plans/260628-1611-v2-m4-react-visualization-dashboard/phase-02-react-shell-vite.md

## Scope
- New `web/` Vite+React+TS SPA (364 LOC across 13 .ts/.tsx source files), committed dist at `src/server/static/app/`, `.gitignore` edit, 1 new backend test.
- Focus: backend-untouched invariant, committed-dist correctness, single-fetch-surface, secret/PII posture, TS/build, localhost posture.

## Verdict on the three required confirmations
**CONFIRMED:** "S2 changes no backend behavior, the committed dist is served correctly, and the SPA adds no new network/auth surface."
- Backend untouched: `git diff 1c0bd75 -- src/ | grep -v static/app` is EMPTY. Only Python change anywhere is the NEW `tests/test_server_spa_static.py`. No diff to `app.py`, routers, action_gateway, or any behavior.
- Dist served correctly: built `index.html` references `/static/app/assets/...` matching `base=/static/app/` and the existing `/static` mount (`app.py`). Backend test asserting the real serve passes.
- No new network/auth surface: fetch base is relative (`/api`, same-origin); dev proxy targets `127.0.0.1:8765`; no remote URL / token / secret in `web/src`; memory client defaults `audience='internal'` (P5 red line safe).

## Gate Results (run live)
- `uv run pytest -q` → **788 passed**, 1 warning (pre-existing starlette/httpx deprecation, unrelated).
- `uv run pytest tests/test_server_spa_static.py -q` → **4 passed**.
- `uv run ruff check src tests` → **All checks passed**.
- vitest: NOT wired into pytest/pyproject/conftest — confirmed local-only (`"test": "vitest run"` in `web/package.json`). Backend gate does not depend on JS tests. (vitest not run here; node toolchain out of scope and node_modules hook-blocked.)

---

## CRITICAL
None.

## HIGH
**H1 — `strict` (and `strictNullChecks`) is NOT enabled in any tsconfig; violates the plan's "TypeScript strict" requirement.**
- `web/tsconfig.app.json` and `web/tsconfig.node.json` are standalone (no `extends`), and neither sets `strict`, `noImplicitAny`, or `strictNullChecks`. Exhaustive grep across all `web/tsconfig*.json` returns nothing.
- Plan phase-02 Requirements (line 41): "TypeScript strict". The stock Vite `react-ts` template ships `"strict": true` in tsconfig.app.json; it was dropped here.
- Impact: the deliberate nullable typing the code relies on (`AgentSummary.last_run: RunEvent | null`, `selected: string | null`, `api.getAgents` returns, `ApiError`) is NOT compiler-enforced. With `strictNullChecks` off, `null`/`undefined` are assignable to every type, so a future `agents[i].last_run.kind` (no `?.`) would compile and crash at runtime. Build passes today only because the current code is hand-written defensively (`?.`, `?? null`). This silently removes the main safety guarantee the slice was supposed to establish, and the gap compounds in S3/S4 as more views land.
- Fix: add `"strict": true` to `web/tsconfig.app.json` (and node config) under compilerOptions, then re-run `npm run build` and re-commit the dist. Verify the existing source still type-checks (it should — the nullable handling already looks strict-clean).

## MEDIUM
**M1 — Source→dist desync is enforced only by discipline; the committed test cannot catch a stale dist.**
- The dist is committed (accepted decision). `test_server_spa_static.py` asserts the dist *exists* and serves, but not that it matches current `web/src`. If a `web/src` edit lands without a rebuild+recommit, the served SPA silently diverges from source and CI stays green.
- This slice is clean: no `web/src` file is newer than the committed `index-Cj9MJBDv.js`, and the dist JS contains `/api/agents`, `basename`, `/static/app` as expected — so the current dist matches current source. Flagging the *process* risk for S3+, per the plan's own Risk table (the mitigation is "always rebuild+commit in the same change" — there is no automated guard).
- Suggested (optional, not blocking): a local pre-commit/`npm run build` check, or a follow-up note in S5 when `/` catch-all lands. No code change required this slice.

## LOW
**L1 — `Layout.tsx:1-2` comment is inaccurate.** Comment says "The selected agent id is carried in the URL (so views deep-link)". It is carried in React context (`agent-context.tsx`), not the URL. No view reads `selected` except `AgentPicker`. Harmless now but misleading for S3 authors who may assume URL-as-source-of-truth. Fix the comment or actually thread `selected` into the URL when S3 wires per-agent views.

**L2 — `client.ts:37` interpolates `audience` into the query string without `encodeURIComponent`.** For the fixed internal default (`'internal'`/`'external'`) this is safe. When S3/S4 ever passes a user- or state-derived value, switch to `URLSearchParams` to avoid query-param injection / breakage. Not exploitable this slice (no caller passes a dynamic value).

**L3 — Scaffold leftovers.** `web/README.md` (Vite template boilerplate), `web/src/assets/{react.svg,vite.svg,hero.png}`, `web/public/{favicon.svg,icons.svg}` are unused default assets. Harmless; the brief already classifies them as acceptable defaults. Consider pruning `hero.png`/unused svgs to keep the committed tree lean, but not required.

**L4 — `package.json` versions differ from the task brief's assumptions (not a defect).** Installed: `react-router ^8.0.1` (brief assumed v7), `vite ^8.1.0`, `react ^19.2.7`, `typescript ~6.0.2`. The v8 `from 'react-router'` import style is correct — verified against react-router v8 docs (BrowserRouter/Routes/Route/NavLink/Outlet all export from the main `react-router` entry). No action; noting because the brief's "v7" framing is stale.

---

## Edge cases scouted
- **Empty agent list:** `Overview` (`agents.length === 0` → "No agents registered.") and `AgentPicker` (`length === 0` → "no agents") both handle it. Good.
- **API failure:** `agent-context` `.catch` sets `error`; `Overview` renders `Error: {message}`; test covers it. Good.
- **`last_run: null`:** Overview renders "no runs yet"; non-null path uses `?? '?'` fallbacks for missing `kind`/`status`. Good.
- **Provider/hook misuse:** `useAgent()` throws outside `AgentProvider` — correct fail-fast.
- **Effect loop:** `agent-context` effect has `[]` deps and uses functional `setSelected((cur) => cur ?? ...)`, so it runs once and does not re-fire on selection change. No loop. (Under React 18/19 StrictMode dev double-invoke, `getAgents` fires twice in dev only — idempotent GET, harmless.)
- **Non-JSON error body:** `request()` builds the error from `res.statusText` and does NOT parse the error body, so a non-JSON 4xx/5xx won't throw a secondary parse error and won't leak arbitrary server error JSON to the UI. Good.

## Verified non-issues (do not re-raise without new evidence)
- API client is the single fetch surface: `grep "fetch(" web/src` (excl. client.ts) is EMPTY. All views go through `api`.
- Type alignment: `types.ts` is an accurate NON-PII subset of `agent_views.list_agents()` + `visualize_views.*`. All 7 client endpoint paths match the actual routers (`routes_agents` `/api/agents`, `/api/agents/{id}/status`; `routes_visualize` `/api/{runs,cost,memory,automation,audit}/{id}`). `last_run` correctly drops the backend's `agent_id` field (allowlist subset, not a mismatch).
- `.gitignore`: ignores `web/node_modules/` + `web/dist/`; does NOT exclude `src/server/static/app/` (`git check-ignore` confirms NOT ignored). `git add -n web/` stages 0 node_modules paths.
- `erasableSyntaxOnly: true` honored: `ApiError` uses explicit field assignment (`this.status = status`), not TS parameter-properties. Build passes.
- Backend test is meaningful, not tautological: it boots a real `create_app()`, GETs `/static/app/index.html` (asserts 200 + `root` mount point), extracts the hashed JS path from the served HTML and GETs it (asserts 200 + JS content-type), and asserts the htmx `/` index still returns 200. Real serve assertions.
- localhost posture preserved: dev proxy → `127.0.0.1:8765`; no auth/remote introduced.

## Metrics
- Backend tests: 788 passed (784 baseline + 4 new). Ruff clean.
- Web source: 364 LOC, 13 files, all < 100 LOC each (largest ~46). Well within the 200-LOC modularization guidance.
- TS strict coverage: **0% enforced** (strict off — see H1). Type *annotations* are present and correct; they are just not compiler-enforced.
- Direct `fetch` calls outside client.ts: 0.

## Recommended actions (prioritized)
1. **H1 (do before merge):** add `"strict": true` to `web/tsconfig.app.json` (+ node config), rebuild, re-commit dist. This is the slice's stated TS-strict deliverable.
2. L1: fix the `Layout.tsx` URL-vs-context comment.
3. L2: switch `audience` to `URLSearchParams` before S3 passes any dynamic value.
4. M1: add a dist-freshness guard (or document the rebuild-on-edit ritual) before S3 lands more views. Optional this slice.
5. L3: prune unused scaffold assets (optional).

## Unresolved questions
1. Was dropping `"strict": true` intentional (e.g., to unblock the build) or an oversight from hand-editing the Vite template? The plan explicitly requires strict, so I'm treating it as an oversight (H1). If intentional, the plan requirement and the trade-off should be recorded.
2. No `web/vitest.config.ts` exists (the plan's "Create" list named one); vitest config lives inline in `vite.config.ts` `test:` block instead. Functionally equivalent and arguably cleaner — flagging only as a plan/impl naming drift, not a defect.

---
Status: DONE_WITH_CONCERNS
Summary: S2 is correct on every critical axis — backend untouched, committed dist served correctly, no new network/auth surface, single fetch surface, no secret/PII, all backend gates green (788 pass, ruff clean). One real gap: the plan-required TypeScript `strict` mode is not enabled (HIGH), so the slice's nullable type safety is unenforced.
Concerns: H1 (strict off) should be fixed before merge to deliver the slice's TS-strict promise; M1/L1/L2 are forward-looking hygiene for S3+.
