---
title: v2 M4 — React visualization dashboard (localhost)
description: >-
  Replace the M2-P7 HTMX dashboard with a Vite+TS React SPA over new read-only
  JSON APIs; guardrail logic untouched.
status: completed
priority: P2
effort: 5 slices (M+M+L+M+M)
branch: main
tags:
  - v2
  - m4
  - dashboard
  - react
  - vite
  - observability
  - frontend
created: 2026-06-28T00:00:00.000Z
---

# v2 M4 — React visualization dashboard (localhost)

## Overview

Replace the server-rendered HTMX dashboard (M2-P7) with a modern Vite + TypeScript React
SPA that visualizes agent activity (timeline runs, cost/budget charts, memory & automation,
guardrail/audit insight) and keeps the ops surfaces (approve/reject, config view+edit,
trigger+SSE). The backend FastAPI app stays; M4 adds a **read-only JSON API layer** over
the existing per-agent data sources and serves the SPA's static build the same way the app
serves the htmx static today. **M4 is a UI/observability layer only — it changes NO guardrail
logic** (Action Gateway, `classify()`, `needs_interrupt()`, Lớp A/B untouched); React reads
via JSON and triggers actions only through the existing gateway-routed endpoints.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [JSON API layer](./phase-01-json-api-layer.md) | Completed |
| 2 | [React shell + Vite](./phase-02-react-shell-vite.md) | Completed |
| 3 | [Visual views](./phase-03-visual-views.md) | Completed |
| 4 | [Migrate ops surfaces](./phase-04-migrate-ops-surfaces.md) | Completed |
| 5 | [Wiring + e2e + remove htmx + docs](./phase-05-wiring-e2e-remove-htmx-docs.md) | Completed |

## Dependencies

Strict order: **S1 → S2 → S3**, **S4 needs S1** (ops UI consumes S1 view layer + existing
write endpoints), **S5 needs S1–S4** (wires the build, deletes htmx, runs full e2e). S2 and
S4 both touch frontend `web/` files but different view modules — sequence them (S2 lays the
shell + api client that S4 reuses), do not parallelize. No two phases edit the same backend
file: S1 adds new `routes_*`/`*_views` modules; S4 leaves backend write endpoints unchanged
(only adds the optional `/api/profile` JSON reads it needs); S5 is the only phase that edits
`src/server/app.py` and deletes `routes_dashboard.py` + `templates/`.

## The invariant (restated in every phase)

M4 is a window, not a new authority. The Action Gateway, `classify()`, `needs_interrupt()`,
Lớp A/B, audit, budget, dedup are **untouched**. React only READS (via the new JSON APIs,
each projecting to a non-PII allowlist mirroring `summarize_node`) and triggers actions through
the EXISTING endpoints — approve still calls `gw.approve(id, handler=dispatch_approved_action)`
with no bypass and no new write path. PII firewall: memory & automation views are
**internal-only** (external audience gets nothing — the P5 red line). Backward-compat: the
M2-P6 `/api/agents` + `/api/runs` routes and the FastAPI localhost-only (127.0.0.1, no-auth)
contract stay; the existing test suite stays green and grows. Auth/remote stays DEFERRED — but
S1's JSON API is designed so an auth middleware can be added later without a rewrite.
