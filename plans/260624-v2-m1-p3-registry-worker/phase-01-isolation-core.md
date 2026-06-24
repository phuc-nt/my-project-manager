# Phase 1 — Isolation core (per-agent data dir + once-only migrate + thread_id)

> Status: DONE (e046f25). Slice 1 of [plan.md](plan.md). Self-contained, commits alone. Delivers the per-agent
> `data_dir` override (the crux), the once-only v1 auto-migration, and the agent-prefixed
> thread_id — **proving full isolation with two `load_profile` calls at two tmp dirs, no
> subprocess, no daemon.** After this slice isolation is REAL for any caller passing `data_dir`.

## Context (verified file:line)

- **The crux — `load_profile` hard-codes the global `DATA_DIR`:**
  `src/profile/loader.py:88` →
  `settings = build_settings_from_dict(build_settings_dict(yaml_doc, DATA_DIR))`.
  `build_settings_dict(yaml_doc, data_dir)` (`src/profile/loader_mapping.py:69`) ALREADY
  takes a `data_dir` param and writes it into the settings dict at `:73`
  (`out = {"data_dir": data_dir}`). So the only change needed is to let `load_profile`
  receive a `data_dir` and forward it — `loader_mapping.py` is NOT modified.
- **`DATA_DIR` / `REPO_ROOT`:** `src/config/settings.py:17-18` —
  `REPO_ROOT = Path(__file__).resolve().parents[2]`, `DATA_DIR = REPO_ROOT / ".data"`.
- **Every store keys off `settings.data_dir` (isolation falls out of it):**
  - `ActionGateway.__init__` (`src/actions/action_gateway.py:124-127`): `data_dir =
    self._settings.data_dir`; `AuditLog(data_dir/"audit"/"audit.jsonl")`,
    `DedupStore(data_dir/"dedup.db")`, `ApprovalStore(data_dir/"approvals.db")`. Comment at
    `:122`: "per-agent in v2".
  - `BudgetTracker` (`src/llm/budget_tracker.py:39`): `self._budget_dir =
    self._settings.data_dir / "budget"`; file `budget-<month>.json` at `:42`.
  - Checkpointer: `get_checkpointer(db_path)` (`src/agent/checkpoint.py:24`); callers pass
    `settings.data_dir / "checkpoints.db"` (`cli.py:26`, `cron.py:54`).
- **thread_id sites (flat today):**
  - `src/entrypoints/cli.py:69` — hello path `"cli"` (NOT an agent flow; leave as-is).
  - `src/entrypoints/cli.py:103` — `thread = f"report-{report_kind}-{audience}"`.
  - `src/entrypoints/cron.py:104` — `f"cron-{report_kind}-{audience}"`.
  - Both entrypoints already have the profile id in scope (`_parse_profile(args)` /
    `_profile_id(args)`); pass it to the helper.
- **`load_profile` callers (enumerate — only 2, both entrypoints):**
  `src/entrypoints/cli.py:44` (`load_profile(_parse_profile(args))`) and
  `src/entrypoints/cron.py:86` (`load_profile(_profile_id(args))`). Plus tests in
  `tests/test_profile_loader.py` / `tests/test_profile_entrypoints.py`. The new kwarg is
  keyword-only with default `None` ⇒ ALL existing callers/tests are unchanged.
- **Live legacy data to migrate (verified present):** `.data/{approvals.db, audit/, budget/,
  checkpoints.db, dedup.db}` exist; `.data/agents/` does NOT exist yet.
- **`.gitignore`** already has `.data/` (so `.data/agents/` is covered — verify with
  `git check-ignore`).
- **Test precedent for isolation:** `tests/conftest.py:12-44` `settings_factory` builds
  `Settings` via `build_settings_from_dict({..., "data_dir": tmp_path})` — two invocations
  with two `tmp_path`s give two isolated Settings. Reuse this to drive the isolation matrix
  WITHOUT a subprocess.

## Requirements

1. `agent_data_dir(agent_id) -> Path` = `DATA_DIR / "agents" / agent_id`. `agent_thread_id(
   agent_id, kind, audience) -> str` = `f"{agent_id}:{kind}:{audience}"`. (Contracts 1 & 2.)
2. `load_profile(profile_id, *, profiles_dir=None, data_dir=None)` — when `data_dir is None`
   use `DATA_DIR` (P2-identical); else forward to `build_settings_dict(yaml_doc, data_dir)`.
3. `migrate_legacy_data_dir()` — once-only, idempotent, allowlisted MOVE of the 5 known v1
   stores into `.data/agents/default/` (Contract 3). Logged. Never touches `.data/agents/` or
   unknown files. Safe to call on every worker startup.
4. `cli.py` / `cron.py` report thread_ids use `agent_thread_id(profile_id, kind, audience)`.
   The hello path keeps `"cli"`.
5. NO change to `loader_mapping.py`, `action_gateway.py`, `budget_tracker.py`, `checkpoint.py`
   — isolation falls out of the `data_dir` value.

## Files to create

- `src/runtime/__init__.py` — package marker; export `agent_data_dir`, `agent_thread_id`,
  `migrate_legacy_data_dir`.
- `src/runtime/agent_paths.py` — the two pure helpers. ~30 LOC.
  ```
  from pathlib import Path
  from src.config.settings import DATA_DIR

  def agent_data_dir(agent_id: str) -> Path:
      return DATA_DIR / "agents" / agent_id

  def agent_thread_id(agent_id: str, kind: str, audience: str) -> str:
      return f"{agent_id}:{kind}:{audience}"
  ```
- `src/runtime/legacy_migration.py` — `migrate_legacy_data_dir()`. ~50 LOC. Known set:
  `_LEGACY_STORES = ("audit", "budget", "checkpoints.db", "dedup.db", "approvals.db")`.
  Guard on `(.data/agents/default).exists()`; per-store target-absent check; `shutil.move`
  (atomic rename on same fs); `logging.getLogger(__name__).info(...)` per move.
- `tests/test_agent_isolation.py` — the headline matrix (acceptance 1-6) driven by two
  `Settings` at two tmp dirs (no subprocess).
- `tests/test_legacy_migration.py` — acceptance 7 (full move / second-call no-op /
  unrelated-file-untouched), using `tmp_path` as a fake `.data/` root.

## Files to modify

- `src/profile/loader.py` — add `data_dir: Path | None = None` keyword-only param to
  `load_profile`; at `:88` use `data_dir if data_dir is not None else DATA_DIR`. Update the
  docstring (one line). `DATA_DIR` is already imported (`:28`).
- `src/entrypoints/cli.py` — import `agent_thread_id`; at `:103` replace
  `f"report-{report_kind}-{audience}"` with `agent_thread_id(profile_id, report_kind,
  audience)`. `profile_id` is `_parse_profile(args)` — thread it into `_run_report` (it
  currently isn't passed; add a param OR compute it in `_run_report`'s caller). Leave `:69`
  (`"cli"`) unchanged.
- `src/entrypoints/cron.py` — import `agent_thread_id`; at `:104` replace
  `f"cron-{report_kind}-{audience}"` with `agent_thread_id(loaded.profile_id, report_kind,
  audience)` (`loaded` is in scope at `:91`).

> **Note on `migrate_legacy_data_dir` wiring in Slice 1:** Slice 1 ships the function +
> its unit test but does NOT call it from `cli.py`/`cron.py` (those keep the global
> `DATA_DIR` path — they are single-agent and must not silently move the user's data on a
> plain `cli report`). The migration is invoked at WORKER startup (Slice 2), which is the
> first code that runs an agent out of `.data/agents/<id>/`. This keeps the data move tied
> to the multi-agent path, not the legacy single-agent CLI. (If a user runs only `cli`,
> nothing moves; the day they run the worker for `default`, it migrates once.)

## Implementation steps

1. Create `src/runtime/__init__.py` + `agent_paths.py` with the two helpers.
2. Create `legacy_migration.py`:
   - `target_root = DATA_DIR / "agents" / "default"`; if `target_root.exists()`: return
     (already migrated — idempotent).
   - `legacy_present = [n for n in _LEGACY_STORES if (DATA_DIR / n).exists()]`; if empty:
     return (nothing to migrate — fresh install).
   - `target_root.mkdir(parents=True, exist_ok=True)`.
   - For each `n` in `legacy_present`: if `(target_root / n)` is ABSENT, `shutil.move(str(DATA_DIR
     / n), str(target_root / n))` and log; else log a skip (target already there).
   - Never iterate anything but `_LEGACY_STORES`; never touch `DATA_DIR / "agents"`.
3. `loader.py`: add the kwarg + use it at `:88`.
4. `cli.py` / `cron.py`: thread the profile id into the report thread_id via `agent_thread_id`.
5. Write the two test files (below). Run focused tests, then full suite + ruff.

## Tests / validation

`tests/test_agent_isolation.py` (the headline matrix — two agents via two tmp dirs):

- **acceptance 1 (separate dirs):** build `s_a = build_settings_from_dict({"data_dir":
  tmp_a, ...})`, `s_b = ...tmp_b`; assert `ActionGateway(s_a)` audit/dedup/approval paths are
  under `tmp_a` and `BudgetTracker(s_a)` budget under `tmp_a`; same for B under `tmp_b`; the
  two sets are disjoint.
- **acceptance 2 (audit no-mix):** run one audited dry-run/skipped action through each
  gateway; assert `tmp_a/audit/audit.jsonl` has A's line and `tmp_b/...` has B's, neither
  contains the other's.
- **acceptance 3 (dedup no-mix):** reserve a `dedup_hint` in A's gateway; assert the SAME
  action through B's gateway is NOT deduplicated (B's `dedup.db` is independent).
- **acceptance 4 (budget A-100% doesn't block B):** `s_a` with `monthly_budget_usd` tiny;
  drive A's `BudgetTracker` past the cap so it raises `BudgetExceededError`; assert B's
  `BudgetTracker` (own data dir) still admits a call. (Reuse `tests/test_budget_tracker.py`
  patterns.)
- **acceptance 5 (approval A not in B's queue):** queue a Lớp B action via A's gateway
  (`execute` returns `pending_approval`); assert B's `ApprovalStore` (own `approvals.db`) has
  zero pending.
- **acceptance 6 (thread_id no-collide):** `agent_thread_id("acme-web","daily","internal")
  != agent_thread_id("beta-app","daily","internal")`; each contains its agent_id.

`tests/test_legacy_migration.py` (acceptance 7 — `tmp_path` as a fake `.data/`,
monkeypatch `legacy_migration.DATA_DIR` to it):

- **full move:** create `tmp/.data/{audit/,budget/,checkpoints.db,dedup.db,approvals.db}` +
  an unrelated `tmp/.data/foo.txt`; no `tmp/.data/agents/default`; call
  `migrate_legacy_data_dir()`; assert all 5 now live under `.data/agents/default/`, the
  top-level copies are gone, and `foo.txt` is UNTOUCHED at `.data/foo.txt`.
- **second-call no-op:** call again; assert no error, no further movement, `.data/agents/default/`
  unchanged.
- **fresh install:** empty `.data/` (no legacy stores) ⇒ call is a no-op, `.data/agents/default/`
  is NOT created (nothing to migrate). [Decide: creating an empty default dir is fine too;
  pick no-create to keep it minimal — assert accordingly.]
- **partial pre-existing target:** `.data/agents/default/dedup.db` already exists + legacy
  `dedup.db` at top level ⇒ the existing target is NOT clobbered (the legacy one is left in
  place / skipped with a log). Assert the target file's content is preserved.

Shell validation (end of slice):
```
uv run pytest tests/test_agent_isolation.py tests/test_legacy_migration.py -q
git check-ignore .data/agents/default/checkpoints.db   # MUST print (ignored under .data/)
uv run ruff check src/runtime src/profile/loader.py src/entrypoints tests/test_agent_isolation.py tests/test_legacy_migration.py
uv run pytest -q   # full suite still green (thread_id change must not break existing tests)
```

> The existing cli/cron tests assert on thread_id-independent behavior, but check
> `tests/test_graph_and_cli.py` / `test_okr_report.py` / `test_resource_report.py` for any
> assertion that hard-codes `"report-daily-internal"` or `"cron-..."`. If one does, update it
> to the new `default:daily:internal` form (BREAKING accepted) — enumerate before commit.

## Acceptance (slice)

- The 6-row isolation matrix (acceptance 1-6) passes via two tmp data dirs (no subprocess).
- Once-only migration (acceptance 7): full move, second-call no-op, unrelated-file-untouched,
  partial-target-safe.
- `load_profile(profile_id, data_dir=tmp)` builds a Settings whose `data_dir == tmp`;
  `load_profile(profile_id)` is byte-identical to P2 (`data_dir == DATA_DIR`).
- cli/cron report thread_ids are agent-prefixed; hello path unchanged.
- `src/runtime/*` files ≤ 200 LOC; ruff clean; full suite green.

## Risks / rollback

- **Risk: the thread_id change breaks a test that pins the old flat id.** → Grep the test
  suite for the old literals before commit; update to the new form (BREAKING accepted).
- **Risk: migration moves data on a plain `cli report` and surprises a single-agent user.** →
  Slice 1 does NOT call the migration from cli/cron; only the worker (Slice 2) calls it. The
  single-agent CLI keeps using global `DATA_DIR` until the user opts into the worker.
- **Risk: `shutil.move` across filesystems is a copy+delete (non-atomic).** → `.data/` and
  `.data/agents/` are the same filesystem (same parent) ⇒ `move` is a rename. Documented; the
  target-absent guard makes even a partial copy safe (a re-run skips already-moved stores).
- **Rollback:** delete `src/runtime/`, the two test files; revert the `loader.py` kwarg and
  the two thread_id edits. The migration is one-way DATA movement — reverting the code does
  not un-move data, but `.data/agents/default/` IS the v1 stores, so a manual move-back
  restores the v1 single-agent layout if ever needed (not expected).
