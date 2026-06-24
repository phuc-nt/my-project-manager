# Phase 1 — `mpm` skeleton + `agent list` + `agent register`

> Status: DONE (94604b7). Slice 1 of [plan.md](plan.md). Depends on P1–P3 (done). Ships the new
> multi-agent entrypoint `python -m src.entrypoints.mpm` with its dispatch shell + the first
> two read-only/scaffold commands. **Fully offline, no worker spawn** — provable with a tmp
> profiles dir + a tmp registry + tmp per-agent data dirs. Additive: `cli.py`/`cron.py`
> untouched.

## Context (verified file:line)

- **No `mpm.py` today** (verified `ls src/entrypoints/` → only `cli.py`, `cron.py`,
  `__init__.py`).
- **Registry loader (consume):** `load_registry(path: Path | None = None) -> tuple[RegistryEntry, ...]`
  (`src/runtime/registry.py:30`); `RegistryEntry(id, enabled)` frozen (`:22`). Default path
  `REPO_ROOT / "registry.yaml"` (`:19`). Raises `RuntimeError` on a malformed file / duplicate
  id; raises `FileNotFoundError` if missing.
- **Id validation (consume):** `_validate_agent_id(agent_id) -> str` (`src/runtime/agent_paths.py:25`),
  regex `^[a-z0-9][a-z0-9_-]*$` (`:22`); raises `ValueError` on a bad id.
  `agent_data_dir(id) -> Path` = `DATA_DIR / "agents" / <id>` (`:35`).
- **Profile loader (consume):** `load_profile(profile_id, *, profiles_dir=None, data_dir=None)`
  (`src/profile/loader.py:60`). `LoadedProfile.name` (`:104`), `.enabled` (`:105`). Raises
  `FileNotFoundError` if `profile.yaml` missing (`:76`), `RuntimeError` on a config error.
  `_PROFILES_DIR = REPO_ROOT / "profiles"` (`:31`).
- **Run-event line shape (consume for last-run):** `append_run_event` writes
  `{ts, agent_id, kind, audience, status, cost_usd, delivered}` to `<data_dir>/runs.jsonl`
  (`src/runtime/run_event.py:17-27`). Last-run = the LAST non-blank line, `json.loads`'d
  (mirror `service._last_run_event` `src/runtime/service.py:72-83`).
- **Register template source (verified):** `profiles/default/profile.yaml` (2663 B, holds only
  `token_env` NAMES + empty per-deploy fields — no secrets). `profiles/default/SOUL.md` is a
  one-line HTML comment placeholder; PROJECT.md / MEMORY.md likewise.
- **gitignore (verified):** `profiles/*` + `!profiles/default/` + `!profiles/default/**`
  (`.gitignore:21-23`); `git check-ignore profiles/acme` → `profiles/acme` (a new agent dir IS
  ignored — expected, decision #4). `registry.yaml` is committed (P3).
- **Arg-parse precedent (mirror):** `cli._flag_value(args, flag)` (`src/entrypoints/cli.py:161`),
  `cron._report_kind` (`src/entrypoints/cron.py:33`). `main(argv=None)` + `if __name__ ==
  "__main__": raise SystemExit(main())` (`cli.py:259,306`).
- **Entrypoint test precedent (mirror):** `tests/test_profile_entrypoints.py` — monkeypatch
  `load_profile` / `load_registry`, assert exit codes + captured stdout/stderr, no network.
  `conftest.settings_factory` builds Settings at a tmp `data_dir` (`tests/conftest.py:12`).

## Requirements

1. **`src/entrypoints/mpm.py`** — the dispatch shell:
   - `main(argv: list[str] | None = None) -> int`. Top-level grammar: `mpm agent <subcommand> …`.
   - No args / unknown top-level ⇒ usage to stderr, exit 2. `agent` with no subcommand ⇒ usage,
     exit 2. Unknown subcommand ⇒ usage, exit 2.
   - Routes `list` / `register` to `mpm_registry_cmds` (this slice). `run` and the management
     subcommands are added in Slices 2 & 3 (their `elif` branches land then). Until then an
     unrecognized-but-future subcommand falls into the generic "unknown subcommand" usage.
   - Shared `_flag_value(args, flag)` helper (copy the `cli`/`cron` shape; it's tiny — DRY
     across the mpm modules is served by living in `mpm.py` and being imported, OR duplicated
     per the existing per-entrypoint pattern; **decision: keep one `_flag_value` in `mpm.py`**
     and import it where a group helper needs it).
   - `logging.basicConfig(level=INFO, …)` once (mirror `cli.main`).
2. **`src/entrypoints/mpm_registry_cmds.py`** — `list` + `register`:
   - `run_list(args) -> int`:
     - `entries = load_registry()`. For each entry: resolve `name` via `load_profile(id)`
       (catch `FileNotFoundError`/`RuntimeError` ⇒ render an **error row** with the id + the
       error, do NOT crash). last-run via `_last_run(agent_data_dir(id))`.
     - Print one aligned row per agent: `id  name  enabled  last-run`. last-run = `"<kind>
       <status> @<ts[:19]>"` from the last `runs.jsonl` line, or `"never run"` if the file is
       absent/empty. Exit 0. Empty registry ⇒ "(no agents registered)".
   - `run_register(args) -> int`:
     - `agent_id = args[0]` (missing ⇒ usage, exit 2).
     - `_validate_agent_id(agent_id)` FIRST (catch `ValueError` ⇒ clean error, exit 2, NO writes).
     - Collision check: error (exit 1) if `profiles/<id>/` exists OR `id` is already in
       `load_registry()`. (Check BOTH before any write.)
     - Create `profiles/<id>/`; copy `profiles/default/profile.yaml` → `profiles/<id>/profile.yaml`
       (verbatim — it's the template); write `SOUL.md`/`PROJECT.md`/`MEMORY.md` each with a
       one-line placeholder comment (mirror `profiles/default/SOUL.md`).
     - **Text-append** `\n  - id: <id>\n    enabled: true\n` to `registry.yaml` (open `"a"`),
       then re-read via `load_registry()` to confirm it parses (a malformed result ⇒ error).
     - Print "registered <id>: profiles/<id>/ + registry.yaml". Exit 0.
   - **Injectable paths for tests:** `run_list`/`run_register` take optional
     `registry_path: Path | None = None` and `profiles_dir: Path | None = None` kwargs
     (default `None` ⇒ the real `registry.yaml` / `profiles/`). The dispatcher passes the real
     ones; tests pass tmp paths. (KISS: two optional kwargs, no env magic.) `run_list` also
     needs the data-dir base injectable for last-run; reuse `agent_data_dir` and monkeypatch
     `agent_paths.DATA_DIR` to a tmp dir in the test (the precedent in `test_worker.py`).

## Files to create

- `src/entrypoints/mpm.py` — dispatch shell (~60 LOC). `main(argv)` + the `agent` router +
  `_flag_value` + usage text + `if __name__ == "__main__": raise SystemExit(main())`.
- `src/entrypoints/mpm_registry_cmds.py` — `run_list` + `run_register` + `_last_run` helper
  (~85 LOC). Keep ≤ 200; if it nears the gate, extract `_scaffold_profile_dir` / `_append_registry`
  into named helpers (they're already discrete).
- `tests/test_mpm_dispatch.py` — top-level grammar: no-args ⇒ 2 + usage; `agent` alone ⇒ 2;
  unknown subcommand ⇒ 2; `agent list` routes to `run_list` (monkeypatch a spy). No I/O.
- `tests/test_mpm_registry_cmds.py` — list + register against tmp paths (below).

## Files to modify

None. (Slice 1 is purely additive.)

## Implementation steps

1. `mpm_registry_cmds.py`:
   - `_last_run(data_dir) -> str`: read `<data_dir>/runs.jsonl`; absent/empty ⇒ "never run";
     else `json.loads` the last non-blank line, format `"<kind> <status> @<ts[:19]>"`
     (best-effort; a `JSONDecodeError` ⇒ "never run"). Mirror `service._last_run_event`.
   - `run_list(args, *, registry_path=None, profiles_dir=None)`: iterate `load_registry(registry_path)`;
     per entry try `load_profile(id, profiles_dir=profiles_dir).name`, on error use a `"<error:
     …>"` name; compute last-run via `agent_data_dir(id)`. Print aligned rows.
   - `_scaffold_profile_dir(profiles_dir, agent_id)`: mkdir; copy the default `profile.yaml`;
     write the 3 placeholder md files.
   - `_append_registry(registry_path, agent_id)`: append the block; re-validate via
     `load_registry(registry_path)`.
   - `run_register(args, *, registry_path=None, profiles_dir=None)`: validate id → collision
     check (dir + registry) → scaffold → append → print.
2. `mpm.py`: `main` parses `argv`; if `argv[0] != "agent"` ⇒ usage/2; `sub = argv[1]`;
   `rest = argv[2:]`; route `list`/`register` to the registry cmds; else usage/2.
3. Tests (below). Focused first, then full suite + ruff.

## Tests / validation

`tests/test_mpm_registry_cmds.py` (offline; tmp registry + tmp profiles + tmp data dir):

- **register creates the dir + appends the block.** Build a tmp `profiles/` with a `default/`
  (copy the real `profiles/default/profile.yaml` or a minimal stand-in) + a tmp `registry.yaml`
  seeded with a comment line + the `default` entry. `run_register(["acme"], registry_path=…,
  profiles_dir=…)` ⇒ exit 0; assert `profiles/acme/profile.yaml` exists + the 3 md files exist;
  assert the tmp registry still contains the comment + `default` AND now parses (via
  `load_registry(tmp)`) to include `acme`.
- **idempotent: second register errors, no change.** A second `run_register(["acme"], …)` ⇒
  exit 1, stderr contains "already"; the registry line count + the profile dir are unchanged.
- **bad id ⇒ exit 2, no writes.** `run_register(["../x"], …)` ⇒ exit 2 (from `_validate_agent_id`);
  assert NO `profiles/../x` created and the registry is byte-identical (no append).
- **registry-collision (dir absent but id in registry) ⇒ error.** Seed the tmp registry with
  `beta` but no `profiles/beta/`; `run_register(["beta"], …)` ⇒ exit 1 "already in registry".
- **list happy.** Seed the tmp registry with `default` + `acme`; tmp profiles for both; a
  `runs.jsonl` under `agent_data_dir("acme")` (monkeypatch `agent_paths.DATA_DIR` → tmp) with
  one line `{"kind":"daily","status":"delivered","ts":"2026-06-24T08:00:00+00:00",…}`.
  `run_list(…)` ⇒ exit 0; captured stdout shows an `acme` row with "daily delivered" and a
  `default` row with "never run".
- **list with a broken/missing profile ⇒ error row, no crash.** Registry has `ghost` with no
  `profiles/ghost/`; `run_list` ⇒ exit 0, the `ghost` row shows an error marker, no traceback.

`tests/test_mpm_dispatch.py`:

- no args ⇒ 2 + usage on stderr; `["agent"]` ⇒ 2; `["agent","bogus"]` ⇒ 2.
- `["agent","list"]` routes to `mpm_registry_cmds.run_list` (monkeypatch it to a spy returning
  0; assert it was called).

Shell validation:
```
uv run pytest tests/test_mpm_dispatch.py tests/test_mpm_registry_cmds.py -q
uv run ruff check src/entrypoints/mpm.py src/entrypoints/mpm_registry_cmds.py \
  tests/test_mpm_dispatch.py tests/test_mpm_registry_cmds.py
uv run pytest -q   # full suite green
# Optional manual smoke (mutates the real registry — do in a throwaway checkout):
#   uv run python -m src.entrypoints.mpm agent register smoke && \
#   uv run python -m src.entrypoints.mpm agent list
```

## Acceptance (slice)

- `mpm agent register <id>` (tmp paths) scaffolds `profiles/<id>/` from the default template +
  appends a `{id, enabled: true}` registry block, preserving comments + existing entries; a
  second register and a bad id both error cleanly with NO partial writes (a bad id creates no
  dir; the collision check fires before any write).
- `mpm agent list` (tmp paths) prints id/name/enabled/last-run for every registry entry;
  last-run reads the per-agent `runs.jsonl` ("never run" when absent); a missing profile dir is
  an error row, not a crash.
- The dispatch shell returns exit 2 + usage on no-args / unknown subcommand.
- New files ≤ 200 LOC; ruff clean; full suite green.

## Risks / rollback

- **Risk: `register` clobbers `registry.yaml` comments.** → text-append (open `"a"`) ONE block,
  never yaml-dump; re-validate with `load_registry`. Tested against a tmp registry seeded with a
  comment + `default` — assert both survive.
- **Risk: partial register (dir made, append fails).** → validate + collision-check BOTH targets
  BEFORE any write; the error after a created dir tells the operator the dir exists (a re-run
  then reports "profile dir exists" — the collision pre-check is the recovery). No transaction
  (KISS); documented.
- **Risk: a test mutates the committed `registry.yaml`/`profiles/`.** → every test passes a TMP
  `registry_path` + `profiles_dir`; the real files are never opened in `"a"`/write mode by the
  suite.
- **Rollback:** delete `src/entrypoints/mpm.py`, `src/entrypoints/mpm_registry_cmds.py`, the 2
  test files. Zero impact on `cli.py`/`cron.py`/the P3 runtime. A `register` that already wrote
  a local `profiles/<id>/` + a registry block is undone by `rm -rf profiles/<id>/` + deleting
  the appended 2-line block.
