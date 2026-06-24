# Phase 3 — Per-agent Lớp B management (`approvals/approve/reject/audit`) + cli.py note

> Status: pending. Slice 3 of [plan.md](plan.md). Depends on Slice 1 (`mpm.py` dispatch shell).
> **The gap-closer:** `cli.py`'s approval/audit commands read the GLOBAL `.data/`; after the P3
> migration that's stale. This slice adds the per-agent equivalents that build the gateway /
> audit-log at `agent_data_dir(<id>)`, so Lớp B management + audit finally point at the migrated
> per-agent store. Plus a one-line `mpm agent` pointer in `cli.py`'s usage. Additive: extends
> `mpm.py` by one router branch + one new file + a one-line cli.py edit.

## Context (verified file:line)

- **The cli.py helpers to MIRROR per-agent (verified):**
  - `cli._gateway(settings, config)` (`src/entrypoints/cli.py:170-178`) =
    `ActionGateway(settings, external_channels=config.slack_external_channels)`. **The per-agent
    version passes the per-agent `settings`** (so the gateway's stores at
    `action_gateway.py:124-127` land under `agent_data_dir(id)`).
  - `cli._run_approvals(settings, config)` (`:181-190`) → `_gateway(...).pending_approvals()`;
    prints `#id  created_at  reason` + `action:`.
  - `cli._run_approve(args, settings, config)` (`:193-208`) → `gw.approve(id, handler=lambda
    action: _dispatch_approved_action(action, config))`; catches `ValueError` ⇒ error/1.
  - `cli._dispatch_approved_action(action, config)` (`:211-225`) → for a slack mcp_tool action,
    `make_slack_post_handler(config.slack_server)(action)`; else raises.
  - `cli._run_reject(args, settings, config)` (`:228-234`) → `_gateway(...).reject(int(id))`.
  - `cli._run_audit(args, settings)` (`:237-256`) → `AuditLog(settings.data_dir / "audit" /
    "audit.jsonl").query(tool=, verdict=, since=, limit=)`; prints rows.
- **The gateway API (consume, verified):** `ActionGateway(settings, …, external_channels=…)`
  (`src/actions/action_gateway.py:106-127`); `.pending_approvals()` (`:253`) →
  `_approvals.list_pending()`; `.approve(id, *, handler)` (`:257`); `.reject(id)` (`:284`).
  Stores key off `settings.data_dir` (`:124-127`) — so a per-agent `settings` ⇒ per-agent
  `approvals.db` / `audit.jsonl`.
- **The per-agent settings source (the gap-closer mechanism):** `load_profile(id, *,
  data_dir=agent_data_dir(id))` (`src/profile/loader.py:60-61,93-94`) builds `settings` with
  `settings.data_dir = agent_data_dir(id)`. `agent_data_dir` (`agent_paths.py:35`). This is the
  ONE difference from `cli.py`: cli loads `load_profile(id)` (global `DATA_DIR`); mpm loads
  `load_profile(id, data_dir=agent_data_dir(id))`.
- **The approve dispatch (consume):** `make_slack_post_handler(server)` (`src/actions/slack_write.py:25`)
  — same handler cli uses. The per-agent `config.slack_server` comes from the loaded profile.
- **The audit log (consume):** `AuditLog(path)` (`src/audit/audit_log.py:50`); `.query(tool=,
  verdict=, since=, limit=)` (`:70`). Path = `agent_data_dir(id) / "audit" / "audit.jsonl"`.
- **Seeding for tests (consume):** `ApprovalStore(db_path)` (`src/actions/approval_store.py:34`);
  `.enqueue(action, *, reason, rationale="")` (`:50`) to seed a pending Lớp B action.
  `conftest.settings_factory` (`tests/conftest.py:12`) builds Settings at a tmp `data_dir`.
- **cli.py usage string (the one-line edit target):** `cli.main`'s `usage:` print
  (`src/entrypoints/cli.py:262-269`) — add a one-line `mpm agent` pointer. The existing P3
  migration warning `_warn_if_migrated_to_per_agent` (`:30-47`) stays.
- **Slice 1 dispatch shell (extend):** add `elif sub in {"approvals","approve","reject","audit"}:
  return mpm_manage_cmds.run_manage(sub, rest)`.

## Requirements

1. **`src/entrypoints/mpm_manage_cmds.py`** — the per-agent management group:
   - A shared loader: `_load_agent(agent_id) -> LoadedProfile | None` =
     `load_profile(agent_id, data_dir=agent_data_dir(agent_id))`; catch
     `(FileNotFoundError, RuntimeError, ValueError)` ⇒ print a clean error, return None
     (so a bad id / missing profile / config error is exit 1, not a traceback — mirrors
     `cli._load_or_exit`).
   - `_gateway(loaded)` = `ActionGateway(loaded.settings,
     external_channels=loaded.config.slack_external_channels)` (the per-agent settings ⇒
     per-agent stores).
   - `run_manage(sub, args) -> int`: `agent_id = args[0]` (missing ⇒ usage/2); `loaded =
     _load_agent(agent_id)` (None ⇒ 1); dispatch:
     - `approvals` → list `_gateway(loaded).pending_approvals()` (mirror `cli._run_approvals`).
     - `approve` → `args[1]` is the approval id (missing/non-digit ⇒ usage/2);
       `_gateway(loaded).approve(int(id), handler=lambda action:
       _dispatch_approved_action(action, loaded.config))`; catch `ValueError` ⇒ error/1.
     - `reject` → `args[1]` id; `_gateway(loaded).reject(int(id))`.
     - `audit` → `AuditLog(agent_data_dir(agent_id) / "audit" / "audit.jsonl").query(
       tool=_flag_value(args,"--tool"), verdict=…, since=…, limit=…)` (mirror `cli._run_audit`).
   - `_dispatch_approved_action(action, config)`: reuse the cli logic — for a slack mcp_tool,
     `make_slack_post_handler(config.slack_server)(action)`; else raise. **Decision: import
     `cli._dispatch_approved_action`** (it is the exact same routing; duplicating it would risk
     drift) OR copy the ~5 lines. Recommend the import — DRY, the function is stable.
2. **`src/entrypoints/mpm.py`** — add ONE router branch for the four management subcommands +
   the `mpm_manage_cmds` import.
3. **`src/entrypoints/cli.py`** — add ONE line to the `usage:` string pointing operators to
   `mpm agent` for the per-agent view (e.g. `"(per-agent view: python -m src.entrypoints.mpm
   agent approvals <id> | audit <id>)"`). No behavior change.

## Files to create

- `src/entrypoints/mpm_manage_cmds.py` — `run_manage` + `_load_agent` + `_gateway` +
  approvals/approve/reject/audit handlers (~75 LOC). Imports `ActionGateway`, `AuditLog`,
  `load_profile`, `agent_data_dir`, `make_slack_post_handler` (lazy, like cli), and
  `cli._dispatch_approved_action` (or a local copy). Keep ≤ 200; the four handlers are small.
- `tests/test_mpm_manage_cmds.py` — the per-agent isolation tests (below).

## Files to modify

- `src/entrypoints/mpm.py` — one `elif sub in {"approvals","approve","reject","audit"}` branch
  + the import (Slice 3 owns this edit; disjoint from Slice 2's `run` branch).
- `src/entrypoints/cli.py` — one-line `mpm agent` pointer in the `usage:` string (`:262-269`).
  No other change; the P3 migration warning is preserved.

## Implementation steps

1. `mpm_manage_cmds.py`: `_load_agent` (per-agent `load_profile`), `_gateway`, the four
   handlers, `run_manage(sub, args)` dispatch.
2. `mpm.py`: add the management router branch + import.
3. `cli.py`: append the one pointer line to the usage string.
4. Tests (below). Focused first, then full suite + ruff.

## Tests / validation

`tests/test_mpm_manage_cmds.py` (offline — tmp per-agent data dirs, seeded stores, no network):

- **per-agent approvals isolation (the headline, acceptance 5).** Monkeypatch
  `agent_paths.DATA_DIR` → tmp; monkeypatch `mpm_manage_cmds.load_profile` to return a
  `LoadedProfile`-stand-in whose `settings.data_dir = agent_data_dir(id)` (use
  `conftest.settings_factory` per id, or build Settings at `tmp/.data/agents/<id>/`). Seed a
  pending Lớp B action in **A's** store: `ApprovalStore(agent_data_dir("A")/"approvals.db")
  .enqueue({"type":"mcp_tool","server":"slack",…}, reason="external report")`. Then:
  - `run_manage("approvals", ["A"])` ⇒ exit 0, stdout lists the pending id.
  - `run_manage("approvals", ["B"])` ⇒ exit 0, stdout "(no pending approvals)" — **B's store is
    separate**.
- **approve A dispatches + does NOT touch B (acceptance 5).** Monkeypatch the slack handler
  (`make_slack_post_handler` → a fake recording the action). `run_manage("approve",
  ["A","<id>"])` ⇒ exit 0; the fake handler was called with A's action; assert
  `ApprovalStore(agent_data_dir("B")/"approvals.db").list_pending()` is still empty AND A's
  approval is now consumed (not pending).
- **reject A.** `run_manage("reject", ["A","<id>"])` after re-seeding ⇒ exit 0; A's approval is
  rejected; B untouched.
- **bad approval id ⇒ exit 1, clean.** `run_manage("approve", ["A","999"])` (no such id) ⇒
  exit 1, stderr "error:", no traceback (the gateway raises `ValueError`, caught).
- **per-agent audit isolation (acceptance 6).** Seed `agent_data_dir("A")/audit/audit.jsonl`
  with two JSON lines (mirror an `AuditEntry` shape). `run_manage("audit", ["A"])` ⇒ exit 0,
  stdout shows the 2 rows; `run_manage("audit", ["B"])` (no file) ⇒ exit 0, "(no audit entries
  match)".
- **missing/bad agent ⇒ exit 1, clean.** `load_profile` raises `FileNotFoundError` ⇒
  `run_manage("approvals", ["ghost"])` ⇒ exit 1, "error:", no traceback. Missing the agent arg
  ⇒ exit 2 usage.

`tests/test_mpm_dispatch.py` (extend if owned here — but it's a Slice 1 file; add the
management-routing assertion as a SEPARATE small test in `test_mpm_manage_cmds.py` to keep file
ownership clean): `mpm.main(["agent","approvals","A"])` routes to `mpm_manage_cmds.run_manage`
(spy).

Shell validation:
```
uv run pytest tests/test_mpm_manage_cmds.py -q
uv run ruff check src/entrypoints/mpm_manage_cmds.py src/entrypoints/mpm.py \
  src/entrypoints/cli.py tests/test_mpm_manage_cmds.py
uv run pytest -q   # full suite green (incl. the existing cli tests — unchanged behavior)
# Optional manual smoke (needs a registered agent with a seeded approval):
#   uv run python -m src.entrypoints.mpm agent approvals default
#   uv run python -m src.entrypoints.mpm agent audit default --limit 5
```

## Acceptance (slice)

- `mpm agent approvals <id>` / `approve <id> <approval-id>` / `reject <id> <approval-id>` build
  the gateway at `agent_data_dir(<id>)` and operate on the agent's OWN `approvals.db`:
  approve/reject of agent A do NOT touch agent B's store (the isolation test seeds A only and
  asserts B is empty). approve dispatches via the same `make_slack_post_handler` path cli uses.
- `mpm agent audit <id> [filters]` reads `agent_data_dir(<id>)/audit/audit.jsonl` — A's entries
  for A, none for B.
- A missing/misconfigured agent ⇒ clean exit 1 ("error:", no traceback); a missing arg ⇒ exit 2.
- `cli.py`'s usage string now points to `mpm agent`; cli's own (global) behavior is unchanged.
- `mpm.py` gains exactly one management router branch. New file ≤ 200 LOC; ruff clean; full
  suite green.

## Risks / rollback

- **Risk: management reads the GLOBAL store (re-opens the gap).** → the gateway/audit-log are
  built EXPLICITLY at `agent_data_dir(<id>)` via `load_profile(id, data_dir=agent_data_dir(id))`.
  The isolation test seeds A's store ONLY and asserts B sees nothing — structurally proves the
  per-agent dir is used. This is the whole point of the slice.
- **Risk: drift between cli's and mpm's approve-dispatch logic.** → import
  `cli._dispatch_approved_action` (one routing function) rather than re-implement. If a reviewer
  rejects an mpm→cli import, copy the ~5 lines and note the duplication.
- **Risk: the cli.py edit accidentally changes cli behavior.** → the edit is ONE string-literal
  line inside the existing `usage:` print; no control-flow change. The existing cli tests
  (`test_profile_entrypoints.py`) must still pass unchanged.
- **Risk: a test mutates a real per-agent store.** → tests monkeypatch `agent_paths.DATA_DIR` →
  tmp and seed via `ApprovalStore(tmp…)`; the real `.data/` is never touched.
- **Rollback:** delete `src/entrypoints/mpm_manage_cmds.py` + `tests/test_mpm_manage_cmds.py`;
  revert the management branch + import in `mpm.py` and the one-line cli.py note. `list`/`register`/`run`
  (Slices 1–2) keep working; cli's own global approval/audit paths are untouched throughout.
