---
phase: 2
title: React shell + Vite
status: completed
effort: M
---

# Phase 2: React shell + Vite

## Overview

Scaffold the Vite + TypeScript React SPA, decide the source dir and how its static build lands
where FastAPI serves it, set up client-side routing + a base layout/nav, and build the `api`
client module that hits the S1 JSON layer. Ship ONE "Overview" view (the index replacement)
proving the end-to-end path: `vite build` → FastAPI serves `index.html` at `/` → React fetches
`/api/agents` and renders. The htmx dashboard stays live in parallel until S5 deletes it.

## Requirements

- New frontend dir `web/` at repo root (chosen over `frontend/` for brevity; self-documenting
  enough, and keeps `src/` purely Python). Vite + React + TS.
- **Build output integration:** `vite build` emits to `src/server/static/app/` (a NEW subdir
  under the already-mounted static root). FastAPI already mounts `/static` →
  `src/server/static/` at `src/server/app.py:53-57`, so the built assets are served with **zero
  app change in this slice**. The SPA `index.html` lives at `src/server/static/app/index.html`
  and is reachable at `/static/app/`. (S5 wires the clean `/` catch-all + removes the htmx
  index; this slice does NOT yet touch `app.py` routing, so the htmx `/` index at
  `src/server/routes_dashboard.py:26-31` keeps working.)
- **The built dist is COMMITTED** into `src/server/static/app/` (NOT gitignored). This preserves
  the "FastAPI serves static, zero extra runtime process" property — `python -m src.server.app`
  runs with no Node build step. Trade-off accepted: a rebuilt dist produces a noisy git diff.
  `.gitignore` MUST ignore `web/node_modules` but MUST NOT exclude `src/server/static/app/`.
- Client routing via `react-router` (hash or browser router — see Architecture) for the view
  groups: Overview, Timeline, Cost, Memory+Automation, Guardrail (routes declared now, views
  filled in S3/S4).
- A single typed `api` client module wrapping `fetch` for the `/api/*` endpoints (one fn per
  endpoint), reused by every later view. Centralizes base URL + error handling.
- Base layout: top/side nav linking the 5 view groups + an agent picker.
- Dev workflow: `vite dev` with a proxy so `/api/*` and `/static/*` forward to the FastAPI
  server on `127.0.0.1:8765`; prod workflow: `vite build` → static → FastAPI serves it.
- TypeScript strict; a frontend test runner (**vitest**) wired for S3 component tests. **vitest
  is LOCAL-ONLY** (`npm test` in `web/`), separate from the backend gate: `uv run pytest` stays
  the authoritative suite (776-baseline) and does NOT run JS tests. "Full suite green" per slice =
  pytest 776+new (backend); FE vitest is a separate local check.

## Architecture

```
DEV:   vite dev (:5173)  ──/api/* , /static/* proxy──▶  uvicorn FastAPI (:8765)
                 │ HMR React
                 ▼
            web/src/* (TS/React)

PROD:  vite build  ──emit──▶  src/server/static/app/{index.html, assets/*}
                                       │ already mounted at /static (app.py:53-57)
                                       ▼
                              GET /static/app/  → SPA  → fetch /api/* (S1)
```

**Router choice (DECIDED):** **browser router with `basename="/static/app"`** for this slice
(assets resolve under the static mount). In S5, when the SPA moves to a real `/` catch-all and
the htmx index is removed, the basename drops to `/`. Carried to S5 explicitly. (Hash-router was
the alternative; browser-router chosen for cleaner URLs — the basename churn at S5 is accepted.)

**Why not Next.js / SSR:** localhost single-operator, no SEO/auth this round — SSR is YAGNI and
adds a Node runtime process. Vite static keeps the deploy model identical to today (FastAPI
serves static), zero new process. (Locked in the brainstorm, Approach B.)

**api client shape:** `web/src/api/client.ts` exports `getAgents()`, `getAgentStatus(id)`,
`getRuns(id)`, `getCost(id)`, `getMemory(id)`, `getAutomation(id)`, `getAudit(id)`,
`triggerRun(id, params)` — typed against the S1 payloads. Single `request()` helper does base
URL + JSON parse + error mapping. Later slices import this; no view calls `fetch` directly.

## Related Code Files

### Create
- `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html` — Vite+TS scaffold.
  `vite.config.ts`: `build.outDir = "../src/server/static/app"`, `base = "/static/app/"`, a dev
  `server.proxy` for `/api` + `/static` → `http://127.0.0.1:8765`. **Dep set (capped):** `react`,
  `react-dom`, `react-router`, `chart.js` + **`react-chartjs-2`** (the DECIDED chart binding,
  used in S3), `vitest` (dev). No UI kit, no D3.
- `web/src/main.tsx`, `web/src/App.tsx` — router + layout root.
- `web/src/api/client.ts` — typed JSON API client (one fn per S1/M2-P6 endpoint).
- `web/src/types.ts` — TS types mirroring S1 payload shapes.
- `web/src/routes.tsx` — route table (5 view groups; Overview filled, others placeholders).
- `web/src/views/Overview.tsx` — agent list (replaces the index), fetches `/api/agents`.
- `web/src/components/Layout.tsx`, `web/src/components/AgentPicker.tsx` — nav shell.
- `web/vitest.config.ts` + `web/src/views/Overview.test.tsx` — first component test (mocked api).
- `web/.gitignore` — ignore `node_modules` only. The built `src/server/static/app/` dist is
  COMMITTED (do NOT add it here).

### Modify
- repo `.gitignore` — add `web/node_modules`; ensure NO rule excludes `src/server/static/app/`
  (the committed dist).
- (No `src/server/app.py` change this slice — the static mount already covers `/static/app/`.)

### Delete
- None (htmx stays until S5).

## Implementation Steps

1. `npm create vite@latest web -- --template react-ts` (or equivalent); set Node/npm versions.
2. Configure `vite.config.ts`: `build.outDir`, `base`, dev `server.proxy`.
3. Add `react-router`; build `App.tsx` + `routes.tsx` + `Layout` + `AgentPicker`.
4. Write `api/client.ts` + `types.ts` against S1 + the M2-P6 `/api/agents` shape
   (`src/server/routes_agents.py:16-28`).
5. Implement `Overview.tsx` consuming `getAgents()`.
6. Wire vitest; write `Overview.test.tsx` (renders from mocked api data — no network). Runs via
   `npm test` in `web/` (local-only, not in the pytest gate).
7. `vite build`; commit the dist under `src/server/static/app/`; start uvicorn; verify
   `GET /static/app/` serves the SPA and Overview renders real `/api/agents` data.
8. Add a backend (`uv run pytest`) test asserting the committed `index.html` is served via the
   static mount. Since the dist is committed, the artifact always exists — no skip-if-missing
   needed.

## Success Criteria

- [ ] `vite build` succeeds; the dist is COMMITTED under `src/server/static/app/`.
- [ ] `GET /static/app/` returns the SPA `index.html`; Overview renders live `/api/agents` data.
- [ ] `vite dev` proxies `/api/*` to FastAPI (manual dev-loop check documented).
- [ ] `api/client.ts` is the single fetch surface; no view calls `fetch` directly.
- [ ] vitest runs locally (`npm test` in `web/`); `Overview.test.tsx` green from mocked data.
- [ ] htmx dashboard still works at `/` (unchanged this slice).
- [ ] Backend pytest suite still green (776 baseline + the new static-serve test; no backend
      behavior changed).

## Risk Assessment

| Risk | Likelihood × Impact | Mitigation |
|---|---|---|
| **Static path mismatch** — SPA assets 404 because `base` ≠ mount path | Medium × Medium | `base = "/static/app/"` aligned to the existing mount (`app.py:53-57`); verify with a real build+serve in step 7, not just config review. |
| **Build artifact in git** — the committed `static/app/` dist bloats diffs / can desync from source | Medium × Low | Commit decision is FINAL (accepted trade-off): keeps the zero-Node-step serve. Mitigate desync by always rebuilding + committing the dist in the same change as a `web/src` edit. |
| **Dev/prod path drift** — works under `vite dev` proxy, breaks on static build (or vice versa) | Medium × Medium | Test BOTH paths each slice; the basename note carried to S5. |
| **Node toolchain creep** — a heavy design system / extra deps balloon scope | Medium × Medium | Capped dep set: react, react-dom, react-router, chart.js + react-chartjs-2 (S3), vitest. No UI kit / no D3 (brainstorm cap). |
| **Two UIs to maintain** during S2–S4 | Certain × Low | Intentional + temporary; S5 deletes htmx. Don't add features to htmx in the interim. |

**Invariant restatement:** This slice adds a frontend + (in S3+) reads JSON. It changes NO
backend behavior and NO guardrail logic. The SPA triggers actions only via existing endpoints
(S4). localhost-only/no-auth posture preserved (the dev proxy targets 127.0.0.1).

## Unresolved Questions

None — all resolved.
