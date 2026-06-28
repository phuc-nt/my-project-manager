---
phase: 3
title: Visual views
status: completed
effort: L
---

# Phase 3: Visual views

## Overview

Build the 4 visualization views consuming the S1 JSON APIs through the S2 `api` client:
**Timeline** (run list + per-node progress), **Cost** (Chart.js cost-vs-budget),
**Memory + Automation** (facts list + pending proposals), **Guardrail/Audit** (verdict
breakdown + recent events). Charts use **Chart.js only** (no D3 — brainstorm cap). This is the
largest slice (L): 4 views + their components + component tests. Read-only; no write path.

## Requirements

- **Timeline view** (`/api/runs/{id}`): chronological run list (ts/kind/audience/status/cost/
  delivered) with status styling; optional live node-progress for an in-flight run via the
  existing SSE stream (`GET /api/runs/{run_id}/stream`, `src/server/routes_runs.py:58-70`),
  reusing the `summarize_node` allowlist payload (`src/server/sse_events.py:17-35`). Static run
  history first; live overlay is a stretch within this slice.
- **Cost view** (`/api/cost/{id}`): **MONTHLY ONLY** (decided) — line/bar of `series` (the last
  12 months of `total_usd`) with the budget `cap` drawn as a reference line and the `warn_ratio`
  band; current-month spend + ratio callout. No per-run cost trend this round. Rendered via
  `react-chartjs-2` (the decided binding).
- **Memory + Automation view**: facts list from `/api/memory/{id}` (**internal-only** — render
  nothing / an "internal-only" notice if the API returns empty for external) + pending proposals
  from `/api/automation/{id}` (id/reason/status/created_at/action_summary). This view is READ
  here; the approve/reject actions are S4 (link out to the ops surface).
- **Guardrail/Audit view** (`/api/audit/{id}`): a verdict-breakdown chart (Chart.js doughnut/bar
  over the aggregated counts: allow/deny/dry_run/skipped/pending/reject) + a recent-events table
  (timestamp/action_type/tool/verdict/reason).
- All views fetch via the S2 `api/client.ts` (no direct `fetch`).
- vitest component tests render each view from **mocked api data** (no network, no real backend).

## Architecture

```
web/src/views/
  Timeline.tsx   ──getRuns(id)────────▶  RunList + (opt) live SSE node-progress
  Cost.tsx       ──getCost(id)────────▶  <CostChart> (Chart.js: series vs cap line)
  MemoryAuto.tsx ──getMemory + getAutomation(id)─▶ FactsList + PendingProposals (read)
  Guardrail.tsx  ──getAudit(id)───────▶  <VerdictChart> (counts) + AuditTable (recent)

web/src/components/charts/  ── thin react-chartjs-2 wrappers over Chart.js
```

**Chart integration (DECIDED):** use **`react-chartjs-2`** over `chart.js` (deps added in S2).
Two reusable wrappers: `CostChart` (line/bar + reference line) and `VerdictChart` (doughnut/bar).
Keep wrappers thin and data-driven; register only the used Chart.js components (tree-shake); no
global plugin sprawl.

**SSE reuse (Timeline live overlay):** the live stream already exists and is firewall-projected
— the view consumes `node` events (`{node, data}` where `data` = `summarize_node` allowlist:
`risk_count`/`cost_usd`/`state`/`delivered`+`summary`) and a `terminal` event. No new SSE
contract; the view only renders what the existing stream emits. If a run isn't live, show
history only.

**PII discipline at the view layer:** the views render ONLY what S1 returns (already
allowlisted). No view requests raw state; the memory view honors the internal-only contract
(empty/"internal-only" notice rather than fabricating facts).

## Related Code Files

### Create
- `web/src/views/Timeline.tsx`, `web/src/views/Cost.tsx`, `web/src/views/MemoryAuto.tsx`,
  `web/src/views/Guardrail.tsx` — the 4 views.
- `web/src/components/RunList.tsx`, `web/src/components/PendingProposals.tsx`,
  `web/src/components/FactsList.tsx`, `web/src/components/AuditTable.tsx` — presentational pieces.
- `web/src/components/charts/CostChart.tsx`, `web/src/components/charts/VerdictChart.tsx` — react-chartjs-2 wrappers.
- `web/src/hooks/useSse.ts` — small SSE subscription hook for the Timeline live overlay (consumes
  the existing `/api/runs/{run_id}/stream`).
- `web/src/views/*.test.tsx` (4) + chart-wrapper tests — vitest, mocked api data.

### Modify
- `web/package.json` — `chart.js` + `react-chartjs-2` already added in S2's dep set; confirm present.
- `web/src/routes.tsx` — point the 4 placeholder routes at the real views.

### Delete
- None.

## Implementation Steps

1. Confirm `chart.js` + `react-chartjs-2` present in `web/package.json` (added in S2).
2. Build `Cost.tsx` + `CostChart` first (smallest, proves the react-chartjs-2 wrapper); render the
   12-month series vs cap line from mocked then real `/api/cost`.
3. Build `Guardrail.tsx` + `VerdictChart` + `AuditTable` from `/api/audit`.
4. Build `Timeline.tsx` + `RunList` (static history) from `/api/runs`; then layer `useSse` live
   overlay against `/api/runs/{run_id}/stream` (stretch).
5. Build `MemoryAuto.tsx` (`FactsList` internal-only + `PendingProposals` read-only) from
   `/api/memory` + `/api/automation`.
6. Wire all 4 into `routes.tsx`.
7. Write vitest tests rendering each view from mocked api payloads (assert the chart receives the
   expected dataset; assert the memory view shows the internal-only notice when facts empty).
8. `vite build`; manually verify each view against seeded backend data.

## Success Criteria

- [ ] All 4 views render real data from the S1 APIs (manual check against seeded dataset).
- [ ] Cost view draws the 12-month series + budget cap reference line + current-month ratio
      (monthly only — no per-run trend).
- [ ] Guardrail view shows verdict-count chart + recent-events table.
- [ ] Timeline view lists run history; live SSE overlay renders node-progress for an in-flight run
      (or degrades cleanly to history-only).
- [ ] Memory view honors internal-only (no facts → notice, never fabricated).
- [ ] Charts use react-chartjs-2/Chart.js only (no D3 in `package.json`).
- [ ] vitest component tests green from mocked data (local-only, `npm test` in `web/` — not in
      the pytest gate).
- [ ] No backend change; backend pytest suite still green (776 baseline — unchanged this slice).

## Risk Assessment

| Risk | Likelihood × Impact | Mitigation |
|---|---|---|
| **Scope creep** (rich dashboards, extra charts, animations) — the brainstorm's #1 risk | High × High | Hard cap: 4 views, 2 chart types, react-chartjs-2 only, cost monthly-only. Each view is "data on screen", not a design exercise. Defer polish. |
| **Chart bundle / config sprawl** | Medium × Low | Two thin react-chartjs-2 wrappers; register only used Chart.js components (tree-shake). |
| **SSE live overlay complexity** balloons the slice | Medium × Medium | Static history is the must-have; live overlay is explicitly a stretch — ship history-only if it risks the slice. |
| **PII via a new view requesting raw data** | Low × High | Views consume ONLY S1 allowlisted payloads; no view adds a raw-state request. Memory internal-only honored at the view. |
| **Mocked-only tests miss real-shape drift** | Medium × Medium | Manual seeded-backend pass (step 8) per view; S5 e2e validates the real wire. |

**Invariant restatement:** Views are read-only renderers of allowlisted JSON. No guardrail
logic, no write path, no raw-state access. Memory/automation stay internal-only. Live overlay
reuses the existing firewall-projected SSE stream — no new event contract.

## Unresolved Questions

None — all resolved. (Chart lib = react-chartjs-2; cost = monthly-only. Recorded default for the
Timeline live overlay: ship run-history in S3; the live SSE overlay is a stretch — if it risks the
slice, ship history-only and add the overlay alongside the S4 trigger view.)
