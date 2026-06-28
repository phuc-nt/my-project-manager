# Code Review — v2 M4 Slice S3: Visual views

Date: 2026-06-28
Reviewer: code-reviewer
Base: HEAD=4c770fb (working tree)
Scope: 4 React views + presentational components + 2 chart wrappers + shared fetch hook + tests; rebuilt committed dist.

## Scope

- Files (new): `web/src/views/{Cost,Guardrail,Timeline,MemoryAuto}.tsx`,
  `web/src/components/{RunList,AuditTable,FactsList,PendingProposals}.tsx`,
  `web/src/components/charts/{CostChart,VerdictChart}.tsx`,
  `web/src/hooks/use-agent-data.ts`, `web/src/views/views.test.tsx`.
- Files (modified): `web/src/App.tsx` (imports real views), committed dist
  `src/server/static/app/index.html` + `assets/index-CapGeBeh.js`.
- Files (deleted): `web/src/views/placeholders.tsx`, old dist `assets/index-2WLARupY.js`.
- LOC: ~290 source (views+components+hook), ~95 test.
- Focus: read-only invariant, PII/internal-only discipline, hook correctness, chart scope, build/test green.

## Overall Assessment

Clean, disciplined slice. Read-only invariant holds; PII/internal-only contract honored
end-to-end (and defended server-side regardless of the client). No backend/guardrail change.
Scope cap respected — exactly 4 views, 2 chart types, monthly-only cost, plain CSS, no D3/UI-kit.
Build (tsc strict + vite) and tests (7/7) green; rebuilt dist is byte-consistent with source.
One real UX edge bug (stuck "Loading…" on the no-selected-agent path) and a cosmetic CSS gap
(advertised status/verdict coloring is unstyled). Neither blocks; both are MEDIUM/LOW.

## Verification performed

- Backend untouched: `git diff 4c770fb --name-only -- src/ | grep -v static/app` → EMPTY. Only
  the committed dist under `static/app` changed. Python suite/ruff out of this slice's scope and
  unchanged (no `.py` diff).
- No D3 / Tailwind / shadcn / UI kit in `web/package.json` (only `chart.js@^4.5.1` +
  `react-chartjs-2@^5.3.1`).
- No `audience=external`, no raw-state/raw-args, no `getState`/`/api/state` reference anywhere in
  `web/src` → grep NONE.
- No direct `fetch(` outside `api/client.ts` → grep NONE (every view goes through the client).
- `npm run build` → succeeds, emits `index-CapGeBeh.js` (412.40 kB) matching the committed dist
  filename; `index.html` references it. `tsc -b` exit 0.
- `npm test` → 2 files, 7 tests pass.
- Server-side memory gate confirmed at `src/server/visualize_views.py:71-74`: `audience != "internal"`
  ⇒ `{facts: [], internal_only: True}` BEFORE opening any store. Frontend default
  `audience='internal'` (`api/client.ts:36`) is belt; the server is the firewall.

## Critical Issues

None. The read-only / no-write / no-guardrail-change / PII invariants all hold.

## High Priority

None.

## Medium Priority

### M1 — `useAgentData` leaves `loading=true` forever when `selected` is null
`web/src/hooks/use-agent-data.ts:16-17`

```ts
useEffect(() => {
  if (!selected) return   // early return: loading stays at its initial `true`
  ...
```

`loading` initializes to `true` (line 13). When `selected` is `null` — empty agent list, or
`getAgents` still in flight / failed (`agent-context.tsx:29` sets `selected` to
`list[0]?.id ?? null`) — the effect early-returns without ever calling `setLoading(false)`. The
view then renders its `if (loading) return <p>Loading …</p>` branch permanently (Cost.tsx:10,
Timeline.tsx:11, Guardrail.tsx:11, MemoryAuto.tsx:19/28). `Layout` does NOT gate the `<Outlet/>`
on a non-null selected (`components/Layout.tsx`), so the stuck spinner is reachable.

Impact: bounded — the seeded/normal case always has ≥1 agent, so this only bites on the
empty-agents or agents-fetch-error path (where the user sees an eternal "Loading cost…" with no
error). Not a security issue.

Fix (either is fine):
```ts
if (!selected) { setLoading(false); return }
```
or have `Layout`/views render an explicit "no agent selected" state when
`useAgent().selected == null`. The context already exposes `agents`/`error` to drive that.

## Low Priority

### L1 — Advertised status/verdict coloring is unstyled (className hooks without CSS)
`components/RunList.tsx:24` (`status-${r.status}`), `AuditTable.tsx:23` (`verdict-${r.verdict}`),
plus `chart-box`, `runs-table`, `audit-table`, `proposals-table`, `facts-list`, `muted`.

App.css (13 lines) styles only `table/th/td/.error` and the shell/nav. None of the new
status/verdict/table-variant classes have rules, so the comments' promises ("Status-styled",
"allow=green, deny=red, …" in VerdictChart applies to the chart arcs, but the AuditTable verdict
cells and RunList status cells render plain). Data is fully visible; this is cosmetic only and
consistent with the slice's "data on screen, defer polish" cap. Either add a few rules or drop the
unused className hooks + the "status-styled" comment to avoid implying behavior that isn't there.

### L2 — Index-in-key for run/audit rows
`RunList.tsx:20` (`key={`${r.ts}-${i}`}`), `AuditTable.tsx:19` (`key={`${r.timestamp}-${i}`}`).

Acceptable: lists are static (fetched once per agent, never reordered/inserted in place), and `ts`
prefixes the index so collisions across re-fetch are unlikely. `FactsList.tsx:12` (`f.key ?? i`)
and `PendingProposals.tsx:20` (`p.id`) are better (stable ids). No React key warnings observed in
the test run. Leave as-is unless these lists gain in-place mutation later.

### L3 — `tension: 0.2` / colors are literals in CostChart, fine but note
`charts/CostChart.tsx:27,24-25,31-33`. Hardcoded styling constants (line tension, brand colors,
dash pattern) are presentation, not data — acceptable. The cap dataset is correctly data-driven:
`labels.map(() => cap)` draws a flat reference line across all month labels (CostChart.tsx:31).
No hardcoded agent/series data anywhere.

## Edge Cases Found by Scout

- **Stuck loading on null-selected** — see M1 (the one with teeth).
- **Empty series / counts** handled: Cost shows "No cost history yet." when `series.length===0`
  (Cost.tsx:23) and avoids divide-by-zero with `cap > 0 ? … : 0` (Cost.tsx:14); Guardrail hides the
  chart when `total===0` (Guardrail.tsx:20); RunList/AuditTable/FactsList/PendingProposals each
  render an empty notice. Good.
- **Nullable run cost** handled: `r.cost_usd != null ? …toFixed(4) : '—'` (RunList.tsx:25)
  correctly distinguishes 0 from null/undefined. `data?.facts ?? []` / `data?.pending ?? []`
  (MemoryAuto.tsx:24,33) safe under strict.
- **Fast agent switch race**: the `cancelled` flag (use-agent-data.ts:18,23,26,29,31-33) guards
  setState-after-unmount and out-of-order resolves on rapid `selected` changes. Correct.
- **Effect-loop risk on `[selected, fetcher]`**: `fetcher` is `api.getCost` etc. The `api` object
  is a module-level `const` singleton (`api/client.ts:31`), so each method is a stable reference
  across renders — no new identity per render, no infinite refetch. NOTE: `api` is NOT
  `Object.freeze`d (the review brief's "frozen api object" is slightly inaccurate), but freezing is
  irrelevant to ref stability here — the module singleton is what makes the deps safe. A consumer
  could in principle reassign `api.getCost`, but nothing does. No action needed.
- **MemoryAuto double-hook**: two independent `useAgentData` calls (MemoryAuto.tsx:11-12) each own
  their own state and cancellation. Sound — two parallel GETs, independent loading/error. No shared
  mutable state between them.

## Invariant confirmation (explicit, per brief)

CONFIRMED: **S3 is read-only, changes no backend/guardrail, honors PII/internal-only, and stayed
within the scope cap.**

- Read-only: every view uses only the client's GET methods; no POST/write/mutation; zero non-dist
  `src/` diff; Action Gateway untouched.
- PII / internal-only: no view requests `audience=external` or raw state/args; `getMemory` defaults
  to `internal` and the server gates externally regardless; `FactsList` renders an explicit notice
  on empty rather than fabricating; `PendingProposals` shows `action_summary` (already projected by
  S1), never raw args; AuditTable/RunList render only S1-allowlisted fields.
- Scope cap: exactly 4 views, 2 chart types (Line + Doughnut), monthly-only cost, no animations, no
  extra charts, plain CSS, no UI kit, no D3. Live SSE overlay deferred per plan (history-only
  shipped) — acceptable per phase doc decisions.

## Test quality

Tests are meaningful, not tautological. Charts are stubbed (jsdom has no canvas) but the stubs
assert the real payload reaches the wrapper: `cost-chart` renders `series.length` months,
`verdict-chart` renders `Object.keys(counts).length`, so the view→chart data path is exercised
(views.test.tsx:13-22,48,59). Memory tests cover BOTH the internal-only empty notice (line 77) and
a seeded fact+proposal render (line 94-95). `React.ReactElement` is used in the test helper without
importing React (line 32) — this is type-clean under `jsx: react-jsx` + `@types/react`'s global
JSX/React namespace, and the build (tsc -b exit 0) + test run confirm it. Not fragile in this
config, though an explicit `import type { ReactElement } from 'react'` would be marginally more
robust if the jsx runtime config ever changes. LOW, optional.

## Metrics

- Type coverage: strict mode ON (`tsconfig.app.json:11`), `noUnusedLocals`/`noUnusedParameters` ON;
  `tsc -b` exit 0. No `any` introduced (catch handlers use `unknown` then narrow).
- Test coverage: 7 vitest tests pass (4 view paths + 2 memory states + ratio assertion); local-only,
  not in the pytest gate (as planned).
- Lint: web/ is out of ruff scope (Python). No eslint run configured in this slice; build is the gate.
- Backend: unchanged (no `.py` diff); pytest/ruff not re-run as nothing backend changed.

## Recommended Actions

1. (MEDIUM) Fix M1: clear `loading` on the null-selected early return, or gate the routed view on a
   selected agent. Prevents the eternal-spinner dead end on empty/failed agent load.
2. (LOW) Resolve L1: either add the few status/verdict/table CSS rules the components reference, or
   remove the unused className hooks and the "status-styled" comments so the code doesn't advertise
   styling it doesn't deliver.
3. (LOW, optional) Add `import type { ReactElement } from 'react'` in the test helper for resilience.

## Unresolved Questions

1. M1 fix direction: is an explicit "no agent selected" empty state preferred (Layout-level) over a
   silent `setLoading(false)` in the hook? Product/UX call — both close the bug.
2. L1: is the missing status/verdict CSS an intentional defer-to-later-polish, or an oversight? If
   deferred, dropping the dead className hooks now keeps the code honest.

---

Status: DONE_WITH_CONCERNS
Summary: S3 is read-only, changes no backend/guardrail, honors PII/internal-only, and stays within
the scope cap; build + 7 tests green and dist matches source. One MEDIUM UX bug (stuck "Loading…"
when no agent is selected) and one LOW cosmetic gap (advertised status/verdict coloring is unstyled).
Concerns: M1 (eternal spinner on empty/failed agent load); L1 (unstyled className hooks contradict
the "status-styled" comments).
