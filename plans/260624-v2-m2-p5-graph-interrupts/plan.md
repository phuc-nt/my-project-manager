---
title: "M2-P5: Graph-native LangGraph interrupts for Lớp B approval"
description: "Add a real LangGraph interrupt() approval_gate node to the 3 report graphs + worker --resume, augmenting (not replacing) the gateway queue path."
status: pending
priority: P1
effort: 9h
branch: main
tags: [v2, m2, langgraph, interrupt]
created: 2026-06-24
---

# M2-P5 — Graph-native interrupts cho Lớp B

## Goal

Add a REAL LangGraph `interrupt()` so an external-audience report graph PAUSES before
delivery, checkpoint-serializes its state (per-agent `SqliteSaver`), and RESUMES
deterministically via `Command(resume=decision)` — approve → deliver (Slack post LIVE),
reject → stop clean + audited, nothing posted.

**Scope is AUGMENT, not replace.** The existing gateway queue path
(`pending_approval` + `ApprovalStore` + `cli/mpm approve`) stays FULLY INTACT — it is the
path the one-shot worker subprocess uses when it cannot hold a live graph. P5 ADDS the
interrupt path alongside. Replace happens at P8 (Postgres), per `docs/v2/roadmap-m2.md:19`.

## Locked decisions (design to these — do not re-litigate)

1. AUGMENT not replace. Gateway queue path untouched and still wired.
2. Resume target = same-machine `SqliteSaver`, same/new worker process re-attaching to the
   checkpointed thread. NOT cross-machine (that is P8).
3. Interrupt site = a NEW node `approval_gate` placed BETWEEN `compose_report` and `deliver`.
   External audience only. The node consults the gateway's `needs_interrupt` source-of-truth
   for WHAT needs approval; Lớp A hard-deny + audit in the gateway stay untouched.
4. Resume trigger = a NEW `--resume` worker flag + a new `mpm agent resume` subcommand.
5. E2E acceptance: external report → pause at `approval_gate` (interrupt fires, state
   checkpointed) → approve via worker `--resume` → resume → Slack post LIVE; reject → graph
   stops clean, audited, nothing posted. Both branches with real Slack (default profile /
   SCRUM / channel — same as P4 E2E).

## Non-negotiable constraints (project red lines)

- Lớp A hard-deny stays in the gateway, before the LLM, UNCHANGED. Only Lớp B gets interrupt.
- External-audience PII guardrail UNCHANGED: external path takes NOTHING from the profile.
  The `approval_gate` node must not leak profile data into anything external.
- Existing `pending_approval` / `ApprovalStore` / `cli approve` / `mpm approve` keep working.
- Per-agent isolation: everything keys off `settings.data_dir` (`checkpoints.db` already per-agent).
- DRY_RUN default true in dev; external path routes through Lớp B.

## Verified facts (re-grepped at plan time)

- langgraph **1.2.6**, langgraph-checkpoint-sqlite **3.1.0** (`pyproject.toml`, `uv.lock`).
  `from langgraph.types import interrupt, Command` — both present. `Command` has a `resume`
  field. Verified by import + offline smoke (see `reports/` notes below).
- Offline smoke confirmed: first `graph.invoke({}, cfg)` at an external thread returns a dict
  with an `__interrupt__` key (a list of `Interrupt` objects) and NO `delivered`/`cost_usd`
  keys; `graph.get_state(cfg).next == ("approval_gate",)` while paused, `()` once finished.
  `graph.invoke(Command(resume="approve"), cfg)` re-enters the gate node, the `interrupt()`
  call returns `"approve"`, the conditional edge routes to `deliver`. `Command(resume="reject")`
  routes to `END` — `delivered` absent, `state.next == ()`.
- All THREE graphs support external audience and route delivery through Lớp B:
  - `src/agent/report_graph.py` daily/weekly (`_deliver` → `resolve_audience_delivery`).
  - `src/agent/okr_report_graph.py` (`default_okr_deps` audience="external").
  - `src/agent/resource_report_graph.py` (`default_resource_deps` audience="external").
  So `approval_gate` must be added to ALL THREE — not just daily/weekly.
- All three share the identical builder shape: `StateGraph(ReportState)`, nodes
  perceive/analyze/compose_report/deliver, linear edges START→…→deliver→END,
  `compile(checkpointer=...)`. The new node + conditional edge slot in identically.
- The worker (`src/runtime/worker.py`) builds the graph + checkpointer and calls
  `graph.invoke({}, config={"configurable": {"thread_id": thread_id}})`; `thread_id` =
  `agent_thread_id(agent_id, kind, audience)` = `"<id>:<kind>:<audience>"` (encodes kind +
  audience — parse it on resume to rebuild the matching graph).
- Idempotency: the gateway RESERVES the dedup key before executing
  (`action_gateway.py:228-231`, `claim()` INSERT-OR-IGNORE). The external dedup hint is
  `{kind}-external-{today}` (`audience_delivery.py:44`). A double-resume re-posting the same
  day is deduplicated. Confirmed covers the resume case.

## Slices (each independently runnable + committable + green suite)

| # | Slice | Files (own) | Status |
|---|-------|-------------|--------|
| 1 | `approval_gate` node + conditional edge + state key + `interrupt()` in `report_graph` (daily/weekly), offline interrupt/resume tests | `src/agent/approval_gate.py` (new), `report_graph.py`, `state.py`, `tests/test_approval_gate_interrupt.py` (new) | pending |
| 2 | Extend the same `approval_gate` + edge to `okr_report_graph` + `resource_report_graph` | `okr_report_graph.py`, `resource_report_graph.py`, `tests/test_approval_gate_okr_resource.py` (new) | pending |
| 3 | Worker `--resume` + `mpm agent resume` + run-event `interrupted` status + exit code | `worker.py`, `mpm.py`, `mpm_resume_cmd.py` (new), `tests/test_worker_resume.py` (new), `tests/test_mpm_resume_cmd.py` (new) | pending |

Phase files:
- [phase-01-approval-gate-report-graph.md](phase-01-approval-gate-report-graph.md)
- [phase-02-extend-okr-resource-graphs.md](phase-02-extend-okr-resource-graphs.md)
- [phase-03-worker-resume-mpm-resume.md](phase-03-worker-resume-mpm-resume.md)

## Dependencies

- Slice 1 blocks Slice 2 (Slice 2 reuses the `approval_gate` factory + routing helper Slice 1
  creates in `src/agent/approval_gate.py`).
- Slice 1 blocks Slice 3 (the worker resume path needs the interrupt to exist + the state key
  to read the decision from). Slice 3 does NOT need Slice 2 (worker resume rebuilds whichever
  graph the thread_id names; daily/weekly is enough to exercise the resume path) — but ship in
  order 1→2→3 so the E2E in Slice 3 can cover all kinds.
- No two slices touch the same file. Slice 1 owns `report_graph.py` + `state.py` + the new
  `approval_gate.py`; Slice 2 owns the two other graph files; Slice 3 owns worker + mpm files.

## Acceptance criteria (measurable)

- AC1: For `audience="external"`, the daily/weekly/okr/resource graph PAUSES at `approval_gate`
  before `deliver`. First `invoke` returns a dict with `__interrupt__`; `get_state().next ==
  ("approval_gate",)`. No Confluence/Slack write happened (the `deliver` deps were not called).
- AC2: For `audience="internal"`, the graph runs straight through (no pause) — `approval_gate`
  is a pass-through; `delivered` is set as before. (Backwards-compat: every existing graph test
  stays green.)
- AC3: `Command(resume="approve")` re-enters the gate, routes to `deliver`, `deliver` runs once,
  `delivered=True`. `Command(resume="reject")` routes to END; `deliver` never runs; `delivered`
  is absent/False; the rejection is audited.
- AC4: Worker `python -m src.runtime.worker --agent-id <id> --resume --thread <thread> --decision
  approve|reject` rebuilds the SAME graph from the parsed thread_id, resumes, and writes a
  run-event. Fresh external run writes a run-event `status="interrupted"` and exits with the
  paused exit code (proposed 3). Resume-approve that delivers exits 0; resume-reject exits 1.
- AC5: `mpm agent resume <id> <thread> --decision approve|reject` spawns the worker with the
  resume argv and reports the outcome.
- AC6: The gateway queue path is unchanged — `test_action_gateway.py`, `test_lop_b_and_audit_query.py`,
  `test_mpm_manage_cmds.py` all stay green. The one-shot `pending_approval` return still works.
- AC7: Full suite green at each slice boundary (baseline 414 → +N new tests, 0 regressions).
  `ruff check` clean (line-length 100). Every touched/new file < 200 LOC.

## Risks (top-level — per-phase detail in phase files)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Adding a node changes the checkpoint graph shape ⇒ an in-flight v1 thread can't resume | L×M | New thread per (agent,kind,audience); checkpoints.db is local + disposable in dev. No migration of in-flight threads needed — a paused thread is created BY this version. Document: a thread checkpointed pre-P5 simply re-runs from START (no `__interrupt__` to honor). |
| `interrupt()` fires inside a node that has side effects ⇒ re-runs side effects on resume | L×H | `approval_gate` is PURE: it only calls `interrupt()` + returns the decision into state. All side effects stay in `deliver`, which runs ONCE after resume. Verified node ordering: compose (side-effect-free compose deps) → gate (pure) → deliver (writes). |
| Double-resume re-posts to Slack | L×H | Gateway reserve-before-execute dedup on `{kind}-external-{today}` hint covers it (verified `action_gateway.py:228`). Document; no new code. |
| Worker can't tell "paused" from "delivered" (both return a dict) | M×M | Detect `__interrupt__` in the result dict (offline-verified key) AND/OR `graph.get_state(cfg).next`. New run-event status `interrupted` + new exit code 3. |
| Profile data leaks into the interrupt payload (external PII red line) | L×H | The interrupt `value` carries ONLY the action summary (tool + channel + a non-PII title), derived from the same audience-external delivery that already strips profile context. Assert in tests that the payload contains no persona/project/memory. |
| File grows > 200 LOC | M×L | `approval_gate.py` is a small new module (factory + routing helper, ~60 LOC). Worker resume logic extracted to `worker_resume.py` if `worker.py` would exceed 200 (it is at 154 now). mpm resume in its own `mpm_resume_cmd.py`. |

## Rollback

Each slice is one commit. Revert restores the prior linear graph (the `approval_gate` node +
conditional edge are additive; removing them returns START→…→compose_report→deliver→END). The
gateway queue path is never touched, so a revert cannot break existing approvals. Worker
`--resume` is a new flag — a revert removes it without affecting the normal run path.

## Unresolved questions

1. Exit code for "paused awaiting approval": proposed **3** (0=delivered, 1=ran-not-delivered,
   2=bad-invocation). Confirm 3 is free in the service/supervise contract (service only checks
   `exit_code == 0`; a 3 reads as "non-zero / not delivered" today — acceptable, but a distinct
   code lets the service surface "pending" later in P6/P7). Decide in Slice 3.
2. Should the service auto-spawn a resume worker when an approval lands via the UI (P7), or is
   resume always operator-triggered in M2? P5 ships operator-triggered resume only; the
   service-driven auto-resume is a P7 concern. Flagging so Slice 3 does not over-build.
