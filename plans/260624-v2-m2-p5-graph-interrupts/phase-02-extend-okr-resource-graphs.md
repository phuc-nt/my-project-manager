# Phase 02 — Extend `approval_gate` to okr + resource graphs

## Context

- `src/agent/okr_report_graph.py` — `build_okr_graph`, `_make_okr_nodes` (perceive/analyze/
  compose_report/deliver), linear edges START→…→deliver→END. `default_okr_deps` supports
  `audience="external"` (stakeholder channel via `resolve_audience_delivery`).
- `src/agent/resource_report_graph.py` — same shape; `default_resource_deps` supports external
  (names-free narrative, `short_url=None` for external).
- `src/agent/approval_gate.py` — created in Slice 1 (`add_approval_gate`, `route_after_gate`).
- `src/agent/audience_delivery.py` — `resolve_audience_delivery` (channel for the summary).

## Requirements

1. Add the SAME `approval_gate` node + conditional edge to `build_okr_graph` and
   `build_resource_graph`, external only, by reusing `add_approval_gate` from Slice 1.
2. The non-PII summary for each: `f"external {kind} report → Slack {channel}"` (kind="okr" /
   "resource"; channel from `resolve_audience_delivery` for external, guard internal).
3. Internal behavior for both graphs UNCHANGED (pass-through gate).
4. No change to `state.py` (the key already exists from Slice 1). No change to the deps wiring.

## Files to create / modify / delete

- MODIFY `src/agent/okr_report_graph.py` — in `build_okr_graph`, replace
  `builder.add_edge("compose_report", "deliver")` with `add_approval_gate(builder,
  audience=audience, summary=_summary)`; keep `deliver → END`. Add the offline `_summary`.
- MODIFY `src/agent/resource_report_graph.py` — same change.
- CREATE `tests/test_approval_gate_okr_resource.py`.

## Implementation steps

1. In each builder, import `from src.agent.approval_gate import add_approval_gate` and (for the
   channel) `from src.agent.audience_delivery import resolve_audience_delivery`.
2. Define `_summary()` returning the non-PII string; for internal the gate is pass-through so the
   summary is never evaluated — still guard `channel = None` cleanly.
3. Rewire: remove the direct `compose_report → deliver` edge; call `add_approval_gate(...)`.
4. Tests (offline, in-memory `SqliteSaver`, fake `OkrReportDeps` / `ResourceReportDeps` whose
   `deliver` records calls — mirror the fake-deps pattern in `tests/test_okr_report.py` /
   `tests/test_resource_report.py`):
   - `test_okr_external_pauses_and_resume_approve` — pause at gate, `__interrupt__` present,
     deliver not called; resume approve → delivered, deliver called once.
   - `test_okr_external_reject_stops` — resume reject → deliver not called, `state.next == ()`.
   - `test_okr_internal_no_pause` — straight through.
   - Same three for resource: `test_resource_external_pauses_and_resume_approve`,
     `test_resource_external_reject_stops`, `test_resource_internal_no_pause`.

## Test / validation points

- `uv run pytest tests/test_approval_gate_okr_resource.py tests/test_okr_report.py tests/test_resource_report.py -q`
- `uv run pytest -q` (full suite green).
- `uv run ruff check src/agent/okr_report_graph.py src/agent/resource_report_graph.py`
- Both graph files are ~211 / ~219 LOC today (already over the soft 200 limit). This change is
  edge-rewiring (+~6 LOC each). Flag for reviewer as pre-existing; if it pushes a hard concern,
  the `_summary` builder is the extraction candidate (move to `approval_gate.py`). Do NOT
  refactor the whole file in this slice — out of scope, would touch unrelated lines.

## Risks + rollback

- Risk: okr/resource use a different deps shape than `report_graph` — the gate is graph-level
  (operates on `ReportState`), independent of deps, so the SAME `add_approval_gate` works. Tests
  prove it per graph.
- Risk: resource external already sets `short_url=None` to avoid leaking the per-assignee link;
  the gate does not change that — the summary string must likewise carry no assignee data (it is
  only kind + channel). Asserted in the payload test pattern from Slice 1.
- Rollback: revert the commit — additive, restores the linear edge in both graphs.
