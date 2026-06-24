# Phase 03 — Worker `--resume` + `mpm agent resume` + run-event status / exit codes

## Context

- `src/runtime/worker.py` (154 LOC) — `main(argv, *, run_report)`, `_flag_value`, `_report_kind`,
  `_audience`, `_default_run_report` (builds graph + `get_checkpointer` + `graph.invoke({}, cfg)`),
  `_event(...)`, run-event append. Exit codes: 0=delivered, 1=ran-not-delivered/error, 2=bad
  invocation / load failure.
- `src/runtime/agent_paths.py` — `agent_thread_id(id, kind, audience)` = `"<id>:<kind>:<audience>"`
  (parse on resume). `agent_data_dir(id)`.
- `src/runtime/run_event.py` — `append_run_event(data_dir, event)`.
- `src/entrypoints/mpm.py` — `agent` dispatcher; `mpm_run_cmd.run_agent` spawns the worker via
  `service._worker_argv` / `_supervise` / `_real_spawn`.
- `src/runtime/service.py` — `_worker_argv(id, kind, audience)`, `_supervise(spawn, argv, timeout)`
  (only checks `exit_code == 0` for delivered; non-zero ⇒ not delivered).
- LangGraph API (verified): `graph.invoke(Command(resume=decision), cfg)`; paused result has an
  `__interrupt__` key; `graph.get_state(cfg).next == ("approval_gate",)` while paused.

## Requirements

1. Fresh external run that pauses at `approval_gate`: detect the `__interrupt__` in the result,
   append a run-event `status="interrupted"`, exit with the new "paused" exit code (propose **3**).
2. New worker invocation: `python -m src.runtime.worker --agent-id <id> --resume --thread
   <thread_id> --decision approve|reject`. It:
   - parses `kind` + `audience` from `thread_id` (`<id>:<kind>:<audience>`), validates the id
     prefix matches `--agent-id`,
   - rebuilds the SAME graph (daily/weekly/okr/resource) with the agent's checkpointer,
   - calls `graph.invoke(Command(resume=decision), config={"configurable": {"thread_id": thread}})`,
   - appends a run-event (`status="delivered"` / `"rejected"` / `"not_delivered"`), exits
     0 (approve delivered) / 1 (reject, or approve-but-not-delivered).
3. New `mpm agent resume <id> <thread> --decision approve|reject` — mirrors `mpm agent run`:
   spawn the worker with the resume argv, collect the outcome, print it.
4. Existing run path + gateway queue path UNCHANGED; the one-shot `pending_approval` return still
   works for the subprocess case.

## Files to create / modify / delete

- CREATE `src/runtime/worker_resume.py` (~90 LOC) — keep `worker.py` under 200 LOC. Holds:
  - `def parse_thread_id(thread_id) -> tuple[str, str, str]` — split into (id, kind, audience),
    validate 3 parts + the id rule (reuse `_validate_agent_id` from `agent_paths`).
  - `def build_graph_for(kind, *, loaded, settings, audience, checkpointer)` — the dispatch
    currently inlined in `worker._default_run_report` (daily/weekly/okr/resource), extracted so
    BOTH the fresh run and the resume path build IDENTICAL graphs (the checkpoint only resumes if
    the rebuilt structure matches). Refactor `_default_run_report` to call it (no behavior change).
  - `def resume_report(loaded, settings, thread_id, decision) -> dict` — build the matching graph,
    `graph.invoke(Command(resume=decision), cfg)`, return the result dict.
  - `def is_interrupted(result: dict) -> bool` — `"__interrupt__" in result`.
- MODIFY `src/runtime/worker.py`:
  - Add `--resume`, `--thread`, `--decision` handling in `main`. When `--resume`: load profile
    (same preflight), call `resume_report`, map the result to a run-event + exit code.
  - In the fresh-run path, after `run_report(...)`, if `is_interrupted(result)`: append
    `status="interrupted"` run-event, return **3**. (Keep the delivered/not_delivered branches.)
  - Extend `_event` (or add fields) so `status` can be `interrupted` / `rejected`.
  - Refactor the inline graph build to call `build_graph_for` (DRY with resume).
- CREATE `src/entrypoints/mpm_resume_cmd.py` (~50 LOC) — `run_resume(args)`: parse `<id>`,
  `<thread>`, `--decision`; existence pre-check (mirror `mpm_run_cmd`); build the resume argv
  (`_worker_argv` extended OR a new `_resume_worker_argv`); `_supervise`; print outcome.
- MODIFY `src/entrypoints/mpm.py` — add `resume` to the subcommand dispatch.
- MODIFY `src/runtime/service.py` — add `_resume_worker_argv(agent_id, thread, decision)` (the
  resume argv), OR parametrize `_worker_argv`. Keep `_supervise` unchanged. (Service auto-resume
  is OUT of scope — P7.)
- CREATE `tests/test_worker_resume.py`, `tests/test_mpm_resume_cmd.py`.

## Implementation steps

1. Extract `build_graph_for` into `worker_resume.py`; point `_default_run_report` at it (verify
   existing `test_worker.py` + `test_slack_write_and_report_graph.py` still green — no behavior
   change).
2. Add `parse_thread_id`, `resume_report`, `is_interrupted`.
3. Wire `--resume` into `worker.main`:
   - resume branch: require `--thread` + `--decision in {approve, reject}` (else exit 2); parse the
     thread; preflight key; `result = resume_report(...)`; `delivered = bool(result.get("delivered"))`;
     status = `delivered` if delivered else (`rejected` if decision=="reject" else `not_delivered`);
     append run-event; return `0 if delivered else 1`.
   - fresh branch: after the existing `run_report`, branch on `is_interrupted(result)` → status
     `interrupted`, exit **3**.
4. Add `mpm_resume_cmd.run_resume` + the `resume` dispatch in `mpm.py` + the resume argv in
   `service.py`.
5. Tests:
   - `tests/test_worker_resume.py` (offline, injected `run_report` / `resume_report` stubs +
     `_patch_data_dir`, mirroring `test_worker.py`):
     - `test_fresh_external_interrupted_exit_3` — `run_report` returns `{"__interrupt__": [...]}`;
       assert exit 3 + run-event `status="interrupted"`.
     - `test_resume_approve_delivered_exit_0` — resume stub returns `{"delivered": True}`; assert
       exit 0 + run-event `status="delivered"`.
     - `test_resume_reject_exit_1` — decision=reject, result `{}`; assert exit 1 + status `rejected`.
     - `test_resume_missing_thread_exit_2` / `test_resume_bad_decision_exit_2`.
     - `test_parse_thread_id` — `"default:daily:external"` → `("default","daily","external")`;
       reject malformed (`"a:b"`, path-escape id).
     - `test_build_graph_for_matches_fresh` — `build_graph_for("daily", ...)` and `("okr", ...)`
       compile (offline, fake deps) — proves resume rebuilds a valid graph per kind.
   - `tests/test_mpm_resume_cmd.py` (injected spawn, mirror `test_mpm_run_cmd.py`):
     - `test_resume_argv_shape` — asserts the exact resume argv (`--resume --thread <t> --decision
       approve`).
     - `test_unknown_agent_exit_1`, `test_bad_decision_exit_2`.
     - `test_mpm_dispatch_resume` (in `test_mpm_dispatch.py` style) — `agent resume` routes to
       `run_resume`.

## Test / validation points

- `uv run pytest tests/test_worker_resume.py tests/test_mpm_resume_cmd.py tests/test_worker.py tests/test_mpm_run_cmd.py tests/test_mpm_dispatch.py tests/test_service.py -q`
- `uv run pytest -q` (full suite green; gateway queue tests `test_action_gateway.py`,
  `test_lop_b_and_audit_query.py`, `test_mpm_manage_cmds.py` MUST stay green — AC6).
- `uv run ruff check src/runtime/worker.py src/runtime/worker_resume.py src/entrypoints/mpm_resume_cmd.py src/runtime/service.py src/entrypoints/mpm.py`
- LOC check: `worker.py` must stay < 200 after additions (extraction to `worker_resume.py` is the
  lever); `worker_resume.py` < 200; `mpm_resume_cmd.py` < 200.

### E2E (manual, real Slack — AC5, same harness as P4 E2E)

- Fresh: `python -m src.runtime.worker --agent-id default --report daily --audience external`
  (DRY_RUN off, key set, SCRUM/channel as P4) → exits 3, run-event `interrupted`, NO Slack post.
- Approve: `mpm agent resume default default:daily:external --decision approve` → resumes →
  Slack post LIVE; second resume of the same thread is deduplicated (no double post).
- Reject: fresh run again (new period or cleared dedup) → `... resume default <thread> --decision
  reject` → no post, run-event `rejected`, gateway audit shows the rejection.

## Risks + rollback

- Risk: a thread checkpointed by a PRE-P5 worker has no `__interrupt__` to honor — resuming it is
  undefined. Mitigation: paused threads are CREATED by this version; document that a pre-P5 thread
  simply re-runs from START. No migration.
- Risk: exit code 3 confuses the service (`_supervise` only checks `== 0`). Today a 3 reads as
  "not delivered" — acceptable for M2; P6/P7 can map 3 → "pending" explicitly. Confirm no other
  caller asserts a specific non-zero code.
- Risk: `worker.py` crosses 200 LOC. Mitigation: the graph-build dispatch + all resume logic live
  in `worker_resume.py`; `worker.py` only gains arg parsing + 2 small branches.
- Rollback: revert the commit — `--resume` flag, `worker_resume.py`, `mpm_resume_cmd.py`, and the
  service resume argv are all additive. The fresh-run path returns to its prior delivered/
  not_delivered exit mapping (the `interrupted` branch is removed cleanly).
