# Phase 02 — B3 run replay / time-travel

**Status**: pending · **Effort**: 3.5h · **Blocks**: none · **Blocked by**: none

Replay a past run from a saved checkpoint. KISS default = **replay-from-checkpoint**
(uses the stored state, NO re-fetch of live Jira/GitHub). Re-execute (re-fetch) is a
deferred future toggle — explicitly out of scope this round.

## Context (verified 2026-06-27)

- Graph build seam (reused verbatim): `src/runtime/worker.py:54`
  `build_graph_for(loaded, settings, kind, audience)`. A replay must rebuild the SAME
  node/edge shape the checkpoint was created with — the `thread_id` encodes
  `<agent>:<kind>:<audience>` and `parse_thread_id` recovers `kind`/`audience`
  (`src/runtime/agent_paths.py`, used by `worker_resume.py:48`).
- Checkpointer: `src/agent/checkpoint.py:31` `get_checkpointer(settings)` — SQLite default
  at `settings.data_dir/checkpoints.db` (per-agent). Replay reads checkpoint history off
  the compiled graph's saver (`graph.get_state_history(config)` /
  `graph.get_state(config)` — LangGraph stock API). `[UNVERIFIED]` exact return type of
  `get_state_history` until run against installed `langgraph>=1.2.6` — verify in step 1.
- CLI template to mirror EXACTLY: `src/entrypoints/mpm_resume_cmd.py` (a subcommand that
  re-attaches to a thread; `_resume_argv` builds the worker argv, `_supervise` collects
  the exit code + last `runs.jsonl` line). Replay is the read-only sibling of resume.
- Dispatcher: `src/entrypoints/mpm.py:58-61` (the `resume` branch is the pattern; add a
  `replay` branch the same way).
- Resume invoke pattern: `src/runtime/worker_resume.py:50` rebuilds the graph + invokes
  with `Command(resume=...)` at the SAME thread config. Replay invokes from a checkpoint
  config instead.

## Requirements

1. `mpm agent replay <id> <thread> [--checkpoint <id>]`:
   - With NO `--checkpoint`: LIST the checkpoint history for the thread (each entry:
     checkpoint_id, step/source, a short non-PII summary) so the user can pick one.
   - With `--checkpoint <id>`: rebuild the matching graph and resume execution from that
     saved checkpoint, using the FROZEN stored state (no re-fetch). Print the outcome.
2. Replay-from-checkpoint is the default and only mode this round. Re-fetch is deferred —
   state this in the module docstring + the help text.
3. Time-travel edit (optionally editing prompt/state mid-run) is OPTIONAL and risky —
   gate it behind an explicit future flag; do NOT build the edit path this round unless
   it is a trivial `graph.update_state` pass-through. Default: resume-as-is. (YAGNI.)
4. Offline-testable: the replay core takes an injected `build_graph` (like
   `worker_resume.run_resume`) so tests run on a tmp SQLite checkpoint, no live data.

## Files

**Create**
- `src/runtime/replay.py` (~90 LOC) — the replay core (mirrors `worker_resume.py`):
  - `list_checkpoints(loaded, settings, thread_id, *, build_graph) -> list[dict]` — rebuild
    the graph (from `parse_thread_id(thread_id)` → kind/audience), call
    `graph.get_state_history({"configurable":{"thread_id":thread_id}})`, return a list of
    `{checkpoint_id, step, source, summary}` (summary = node name(s) + step number only,
    NO PII / report text — keep it like the P5 interrupt summary).
  - `replay_from_checkpoint(loaded, settings, thread_id, checkpoint_id, *, build_graph) -> dict`
    — rebuild the graph, invoke with
    `config={"configurable":{"thread_id":thread_id,"checkpoint_id":checkpoint_id}}` and
    `input=None` (resume from the checkpoint's stored state — frozen, no re-fetch). Return
    the final state dict.
  - CAUTION guard: replay-from-checkpoint must NOT re-run a delivery write unless the
    checkpoint is BEFORE the deliver node. The deliver node already routes mutations
    through the gateway (dedup_hint makes a same-day re-post a `deduplicated` no-op), so a
    replay that reaches deliver is gateway-safe by construction — BUT document that
    replaying past the approval gate re-enters the Lớp B path, not an auto-write. Verify
    against the report graph's deliver node behavior in step 2.
- `src/entrypoints/mpm_replay_cmd.py` (~70 LOC) — mirrors `mpm_resume_cmd.py`:
  - Validate args (`<id> <thread>` required; existence pre-check via `load_registry()`
    like `mpm_resume_cmd.py:50-56`).
  - No `--checkpoint` ⇒ load the agent's profile at its data dir
    (`load_profile(id, data_dir=agent_data_dir(id))`, like `mpm_manage_cmds._load_agent`),
    call `list_checkpoints`, print the table.
  - With `--checkpoint` ⇒ call `replay_from_checkpoint`, print
    `delivered=.. status=..` like resume. This runs IN-PROCESS (read-only/replay is not a
    delivery spawn) — simpler than resume's subprocess; confirm no double-checkpointer
    open issue (open the agent's checkpointer once via `build_graph_for`).

**Modify**
- `src/entrypoints/mpm.py` — add `if sub == "replay": from src.entrypoints.mpm_replay_cmd
  import run_replay; return run_replay(rest)` (mirror the `resume` branch at `:58`) + add
  `replay` to `_USAGE`.

## Implementation steps

1. Verify `graph.get_state_history(config)` + checkpoint-scoped invoke
   (`config={"configurable":{"thread_id":..,"checkpoint_id":..}}`, input `None`) against
   installed `langgraph>=1.2.6`. Adjust the API calls to the real signatures.
2. Verify the report graph's deliver node is gateway-routed + dedup-guarded (confirm a
   replay reaching deliver cannot double-post outside the gateway). Cite the deliver node.
3. Write `replay.py` (inject `build_graph` for offline tests).
4. Write `mpm_replay_cmd.py` (mirror `mpm_resume_cmd.py` structure + existence pre-check).
5. Wire the `replay` dispatch line + usage string in `mpm.py`.

## Tests / validation

`tests/test_replay.py` (NEW, offline, tmp SQLite checkpoint):
- Seed a checkpoint: build a tiny graph with a SqliteSaver in a tmp dir, invoke once so a
  checkpoint exists for a thread. Then `list_checkpoints` returns ≥1 entry with
  `checkpoint_id` populated + summary carrying NO PII (assert no report text in summary).
- `replay_from_checkpoint` from a seeded checkpoint returns a final state dict (resumes
  from frozen state — assert it did NOT re-invoke the perceive/fetch node, e.g. via a
  spy/monkeypatch on a read tool proving 0 calls during replay).
- Unknown thread / unknown checkpoint_id ⇒ clean error, non-zero, no crash.

`tests/test_mpm_replay_cmd.py` (NEW, offline, injected build_graph):
- `replay <id> <thread>` with no checkpoint prints the history table (assert the seeded
  checkpoint_id appears).
- `replay <unknown-id> ...` ⇒ clean "unknown agent" (mirror `mpm_resume_cmd` exit 1).
- Bad invocation (missing thread) ⇒ exit 2.

Commands:
```
uv run pytest -q tests/test_replay.py tests/test_mpm_replay_cmd.py
uv run pytest -q tests/  # full suite green
uv run ruff check src/ tests/
```

## Risks + rollback

| Risk | L×I | Mitigation |
|------|-----|------------|
| Naive replay re-fetches LIVE Jira/GitHub (PM agent pulls live data) | H×H | Replay-from-checkpoint resumes from STORED state with `input=None` — no re-fetch by design. Re-fetch is an explicit deferred toggle, NOT built this round. Test proves 0 read-tool calls during replay. |
| Replay reaches the deliver node and double-posts a report | M×H | Deliver is gateway-routed + `dedup_hint` makes a same-day re-post a `deduplicated` no-op; replaying past the approval gate re-enters Lớp B (not an auto-write). Documented + verified in step 2. |
| `get_state_history` / checkpoint-scoped invoke API differs from assumption | M×M | Verify against installed langgraph in step 1; `[UNVERIFIED]` until then. Core is injectable so a thin API shim is easy to adjust. |
| Postgres checkpoint replay untested (P8 opt-in) | L×L | Same selection-tested-only stance as P8 (`checkpoint.py:59-61`). SQLite path is the tested default; note Postgres replay is a later-round verification. |
| Time-travel edit path opens a state-mutation footgun | M×M | NOT built this round (YAGNI). Resume-as-is only. Edit deferred behind a future flag. |

**Rollback**: delete `replay.py` + `mpm_replay_cmd.py` + remove the one `mpm.py` dispatch
line + usage entry. Replay is read-mostly (reads checkpoint history; a replay invoke only
re-runs an already-checkpointed graph through the same gateway) — no schema change, no
data migration. Reverting leaves all existing commands untouched.

## INVARIANT (restated)

B3 replay re-runs an EXISTING graph whose deliver node already routes every mutation
through the Action Gateway. Replay adds NO new write path and NO gateway bypass: a replay
that reaches a write hits the SAME Lớp A/B chain (and dedup) as the original run. No new
write authority.

## Unresolved questions

1. Exact `get_state_history` entry attributes in installed langgraph (checkpoint_id,
   metadata.step, metadata.source)? Resolve in step 1.
2. Should `replay --checkpoint` run in-process (proposed, simpler) or spawn a worker like
   resume does? Proposed in-process since replay is read-mostly and not a delivery spawn —
   confirm this doesn't conflict with the single-checkpointer-open contract.
3. Does the user want a `mpm agent runs <id>` companion to LIST past runs from
   `runs.jsonl` (B1 log) so they know which threads/checkpoints exist to replay? Proposed:
   nice-to-have; defer unless trivial (the history table already shows checkpoints per
   thread).
