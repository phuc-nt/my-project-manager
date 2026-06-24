# Phase 01 — `approval_gate` node + interrupt in report_graph (daily/weekly)

## Context

- `src/agent/report_graph.py` — `_make_nodes` (perceive/analyze/compose_report/deliver
  closures over a `box` dict), `build_report_graph` (linear edges, `compile(checkpointer)`).
- `src/agent/state.py` — `ReportState` TypedDict (`total=False`), serializable primitives only.
- `src/actions/hard_block.py:79` — `needs_interrupt(action, *, external_channels)` source-of-truth.
- `src/agent/audience_delivery.py` — external routing + `SLACK_OK_STATUSES`.
- LangGraph API (verified, 1.2.6): `from langgraph.types import interrupt, Command`.

## Requirements

1. Add a NEW pure node `approval_gate` BETWEEN `compose_report` and `deliver`, external only.
2. For `audience="external"`: the node calls `interrupt(payload)` with a NON-PII action summary;
   the resume value (`"approve"` | `"reject"`) is written to a new state key.
3. A conditional edge routes `approval_gate` → `deliver` on approve, → `END` on reject (reject
   stops the graph clean; `deliver` never runs).
4. For `audience="internal"`: the node is a pass-through (returns `{}`); the edge always routes
   to `deliver`. Existing internal behavior UNCHANGED.
5. The interrupt payload carries NO profile data (persona/project/memory) — external PII red line.

## Files to create / modify / delete

- CREATE `src/agent/approval_gate.py` (~70 LOC) — the reusable gate factory + router, shared by
  all three graphs (Slice 2 imports it). Holds:
  - `def make_approval_gate(audience: str, *, summary: Callable[[], str]) -> Callable` — returns
    the node closure. Internal ⇒ returns `{}`. External ⇒ `decision = interrupt({"kind": ...,
    "summary": summary()}); return {"approval_decision": decision}`.
  - `def route_after_gate(state: ReportState) -> str` — returns `"deliver"` if
    `state.get("approval_decision", "approve") == "approve"` else `END`. (Default `"approve"`
    so an internal graph that never set the key always proceeds.)
  - `def add_approval_gate(builder, *, audience, summary, deliver_node="deliver") -> None` — the
    single helper each graph calls to register the node + rewire `compose_report → approval_gate`
    + the conditional edge, so the 3 graphs stay DRY (one wiring site).
- MODIFY `src/agent/state.py` — add `approval_decision: str` to `ReportState` (primitive,
  checkpoint-safe). Document it carries the Lớp B resume decision.
- MODIFY `src/agent/report_graph.py`:
  - Build the audience-external summary (tool + stakeholder channel + report title only — reuse
    `resolve_audience_delivery` to get the channel; NO profile context). Keep it offline (no LLM).
  - In `build_report_graph`, replace `builder.add_edge("compose_report", "deliver")` with a call
    to `add_approval_gate(builder, audience=audience, summary=_summary)`; keep `deliver → END`.
- CREATE `tests/test_approval_gate_interrupt.py`.

## Implementation steps

1. Write `approval_gate.py` with `make_approval_gate`, `route_after_gate`, `add_approval_gate`.
   - `interrupt` + `END` imports: `from langgraph.types import interrupt`; `from langgraph.graph
     import END`.
   - `add_approval_gate`: `builder.add_node("approval_gate", make_approval_gate(...))`;
     `builder.add_edge("compose_report", "approval_gate")`; `builder.add_conditional_edges(
     "approval_gate", route_after_gate, {"deliver": deliver_node, END: END})`.
2. Add `approval_decision: str` to `ReportState`.
3. In `report_graph.build_report_graph`, define `_summary()` returning a non-PII string, e.g.
   `f"external {report_kind} report → Slack {channel}"` (channel from `resolve_audience_delivery`,
   guarded for internal where channel is None ⇒ summary unused). Call `add_approval_gate(...)`.
   Remove the direct `compose_report → deliver` edge (now via the gate).
4. Tests (offline, in-memory `SqliteSaver`, fake deps mirroring `_fake_deps()` in
   `tests/test_slack_write_and_report_graph.py`):
   - `test_external_pauses_at_gate`: build with `audience="external"` + fake deps whose `deliver`
     records calls; `out = graph.invoke({}, cfg)`; assert `"__interrupt__" in out`, deliver NOT
     called, `graph.get_state(cfg).next == ("approval_gate",)`.
   - `test_resume_approve_delivers`: after the pause, `graph.invoke(Command(resume="approve"),
     cfg)`; assert `out["delivered"] is True`, deliver called exactly once.
   - `test_resume_reject_stops_clean`: `Command(resume="reject")`; assert deliver NOT called,
     `delivered` falsy, `graph.get_state(cfg).next == ()`.
   - `test_internal_no_pause`: `audience="internal"`; assert no `__interrupt__`, `delivered` set —
     pass-through unchanged.
   - `test_interrupt_payload_has_no_profile`: assert the `Interrupt.value` summary string contains
     none of the persona/project/memory markers (build with a non-empty `ProfileContext` and check
     the payload is channel/title only).

## Test / validation points

- `uv run pytest tests/test_approval_gate_interrupt.py tests/test_slack_write_and_report_graph.py -q`
- `uv run pytest -q` (full suite — confirm 414 still green + new tests).
- `uv run ruff check src/agent/approval_gate.py src/agent/report_graph.py src/agent/state.py`
- Confirm `approval_gate.py` and the modified `report_graph.py` stay < 200 LOC (`report_graph.py`
  is 270 LOC today — it is already over the soft limit; this change is edge-rewiring, +~6 LOC. If
  it crosses a hard concern, extract the `_summary` builder into `approval_gate.py`. Note for
  reviewer: pre-existing length, not introduced here).

## Risks + rollback

- Risk: the conditional edge default lets an internal graph route to deliver even if the key is
  unset — that is the intended pass-through. Test `test_internal_no_pause` guards it.
- Risk: `interrupt()` re-runs the node body on resume — node is PURE (only `interrupt` + return),
  so re-run is harmless; `deliver` (side effects) runs once after the gate.
- Rollback: revert the commit — `add_approval_gate` is additive; the linear edge returns.
