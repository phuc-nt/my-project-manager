---
title: "v2 M3-P12 — Automation + observability (B4 tracing · B3 replay · D3 workflow automation)"
description: "Final M3 phase: LangSmith tracing opt-in, run replay from checkpoint, READ-ONLY+PROPOSE workflow automation — all writes still gate through the Action Gateway."
status: completed
priority: P2
effort: 14h
branch: main
tags: [v2, m3, observability, automation, langsmith, replay, workflow, action-gateway]
created: 2026-06-27
completed: 2026-06-27
---

# v2 M3-P12 — Automation + observability

Final M3 phase. Three features from `docs/v2/feature-proposals.md:90` (B4 + B3 + D3),
sliced cheap/safe → risky. Adds observability (tracing, replay) and a declarative
READ-ONLY+PROPOSE workflow engine. NO new write authority.

## THE INVARIANT (non-negotiable — restated in every phase)

D3 workflow automation MUST NOT bypass the Action Gateway. A workflow reads freely
(Jira/GitHub/Linear/Confluence reads bypass the gateway by design) and PROPOSES writes
by building the SAME action dict shape the report graphs build, then calling
`ActionGateway.execute()` — which enqueues it as Lớp B (`pending_approval`) exactly as
today. The user approves via the existing CLI/dashboard. There is NO auto-execute path,
NO new bypass, NO new write allowlist entry. A workflow step that resolves to a
destructive action hits Lớp A hard-deny in the gateway. (Memory: "Action Gateway is
allowlist + Lớp A hard-deny, not denylist; new tools deny by default".)

Grep-guard: the automation module imports `ActionGateway` only — never `slack_write` /
`linear_write` / `email_write` / `confluence_write` / `call_tool` directly.

## Phases

| # | Slice | File | Status | Effort | Blocks |
|---|-------|------|--------|--------|--------|
| 1 | B4 — LangSmith tracing opt-in | [phase-01-b4-langsmith-tracing.md](phase-01-b4-langsmith-tracing.md) | ✅ done (e8c3e58) | 2.5h | — |
| 2 | B3 — Run replay / time-travel | [phase-02-b3-run-replay.md](phase-02-b3-run-replay.md) | ✅ done (6cda62d) | 3.5h | — |
| 3 | D3 — Workflow automation engine | [phase-03-d3-workflow-automation.md](phase-03-d3-workflow-automation.md) | ✅ done (ed36383) | 6h | — |
| 4 | Wiring + offline e2e + red-line + docs | [phase-04-wiring-e2e-redline-docs.md](phase-04-wiring-e2e-redline-docs.md) | ✅ done (1fc0397) | 2h | 1,2,3 |

## Dependencies

- S1, S2, S3 touch DISJOINT files (see ownership below) — can proceed in any order /
  parallel. Suggested order is risk-ascending: S1 (warm-up) → S2 → S3 (the big one).
- S4 integrates: depends on S1+S2+S3 done. Consolidated e2e + red-line + docs.

## File ownership (no two phases touch the same file)

- **S1 (B4)**: `pyproject.toml` (dep), `src/runtime/run_config.py` (NEW), `src/config/settings.py`
  (+1 field), `src/config/config_builders.py`, `src/profile/loader_mapping.py` (+tracing flag).
  Threads `callbacks` into the invoke config at `worker.py` / `cli.py` / `run_manager.py`
  via the new helper — those 3 call sites are S1's (see S4 note: no overlap with S2/S3).
- **S2 (B3)**: `src/runtime/replay.py` (NEW), `src/entrypoints/mpm_replay_cmd.py` (NEW),
  `src/entrypoints/mpm.py` (+`replay` dispatch line).
- **S3 (D3)**: `src/automation/` (NEW pkg: `schema.py`, `prompts.py`, `engine.py`,
  `propose.py`), `src/entrypoints/mpm_automate_cmd.py` (NEW), `src/entrypoints/mpm.py`
  (+`automate` line).
- **mpm.py overlap (S2+S3)**: both add ONE dispatch line. S4 owns the final merge of the
  two one-line additions to avoid a parallel-edit collision (or do S2→S3 serially).
- **S4**: `docs/v2/architecture.md`, `docs/v2/roadmap-m2.md`, journal, consolidated test files.

## Acceptance criteria

- **B4**: tracing DEFAULT OFF ⇒ byte-identical to pre-P12 (no `callbacks` key, no
  `langsmith` import on the hot path). Flag ON (env `LANGCHAIN_TRACING_V2`/`LANGSMITH_API_KEY`
  + profile `runtime.tracing: true`) ⇒ a `callbacks` list with a LangChainTracer is present
  in the invoke `RunnableConfig`. Tested with NO real network call.
- **B3**: `mpm agent replay <id> <thread> [--checkpoint <id>]` lists checkpoint history
  for a thread and resumes from a saved checkpoint (replay-from-checkpoint = frozen state,
  no re-fetch — the KISS default; re-fetch deferred). Tested on a tmp SQLite checkpoint.
- **D3**: `mpm agent automate <id> <automation.yaml> [--dry-run]` parses a minimal schema
  (step types `read` / `analyze` / `propose`; `analyze` = NAMED prompts only; `when` =
  single `field == value`), chains READ steps, and a `propose` step ENQUEUES a Lớp B
  action via `ActionGateway.execute()` ⇒ lands in `ApprovalStore` as `pending_approval`,
  NEVER executed. `--dry-run` prints the planned action(s) WITHOUT enqueuing (ApprovalStore
  stays empty). Destructive propose ⇒ Lớp A hard-deny. Secret in a proposed action ⇒
  CREDENTIAL deny.
- **Backward-compat**: no tracing flag + no `automation.yaml` ⇒ byte-identical to pre-P12.
- **Tests**: `uv run pytest -q` ⇒ 775 green (704 baseline + 71 new), all offline; ruff clean.

**Status: ✅ ALL ACCEPTANCE CRITERIA MET.** Code-review DONE per slice (S1 DONE_WITH_CONCERNS→fixed, S2 DONE_WITH_CONCERNS→fixed incl. the un-checkpointed fetch-box HIGH, S3 DONE adversarial-confirmed, S4 integration). Deferred (non-blocking): live-key LangSmith trace run, Postgres-checkpoint replay, re-fetch/time-travel replay, boolean `when`, schedule-triggered automation.

## Verified seams (re-grepped 2026-06-27)

- 3 invoke seams: `src/runtime/worker.py:107`, `src/entrypoints/cli.py:152`,
  `src/server/run_manager.py:140,144` (`cfg = {"configurable": {"thread_id": ...}}` +
  `graph.stream(...)`). B4 threads `callbacks` through ALL THREE via one helper (DRY).
- Graph build: `src/runtime/worker.py:54` `build_graph_for(loaded, settings, kind, audience)`
  (shared by worker + `cli._run_report` + `server/graph_runner.py:43`). B3 replay reuses it.
- Checkpointer: `src/agent/checkpoint.py:31` `get_checkpointer(settings)` (SQLite default).
  B3 reads checkpoint history off this saver.
- Gateway: `src/actions/action_gateway.py:133` `execute()` → enqueues Lớp B via
  `ApprovalStore.enqueue` (`:205`), returns `pending_approval`. D3 PROPOSE calls this.
- Action-dict shape to mirror: `src/actions/slack_write.py:80-87`,
  `src/actions/linear_write.py:86-89` (`{"type":"mcp_tool","server","tool","args",...}`).
- Resume CLI template: `src/entrypoints/mpm_resume_cmd.py` (B3 replay mirrors this).
- Config seams: `src/profile/loader_mapping.py:73` `runtime:` block (B4 tracing flag added
  here, mirroring P8 `checkpointer`/`store`); `src/config/config_builders.py:47`
  `build_settings_from_dict`.
- Read tools D3 chains: `src/tools/{jira_read,github_read,linear_read,confluence_read,okr_read}.py`.

See each phase file for full context, steps, tests, risks, rollback.
