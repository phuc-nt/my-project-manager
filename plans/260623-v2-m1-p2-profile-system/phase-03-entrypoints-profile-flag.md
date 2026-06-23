# Phase 3 — Entrypoints take `--profile` (default = `default`)

> Status: DONE (dd04271). Slice 3 of [plan.md](plan.md). Wires the loader + context into `cli.py` / `cron.py`
> behind `--profile <id>` (default `default` = v1-equivalent). Closing slice.
> Depends on Slices 1 + 2.

## Context (verified file:line)

- **`cli.py` builds config from env today** at `src/entrypoints/cli.py:219`
  (`settings = build_settings_from_env()`) and `:225/:227/:229/:239`
  (`build_reporting_config_from_env()` per management/report path). `main(argv)` at
  `:204-241`. Report dispatch `_run_report(kind, audience, settings, config)` at
  `:51-80`; builds graphs at `:57/:61/:65` (all already take `config=`, `settings=`).
- **`cron.py` builds from env** at `src/entrypoints/cron.py:69-70`
  (`build_settings_from_env()` + `build_reporting_config_from_env()`). `main(argv)` at
  `:63-90`; `_build_graph(kind, audience, settings, config)` at `:45-60`.
- **Existing flag parsing helpers:** `cli.py` `_flag_value(args, flag)` at `:106-112`,
  `_parse_report_kind` at `:83-94`, `_parse_audience` at `:97-103`. `cron.py` parses
  inline at `:25-42`. Reuse `_flag_value` for `--profile`.
- **CLI test invocation pattern:** `tests/test_graph_and_cli.py` calls
  `cli_main([...])` directly (`:47,:61`); `test_cli_no_key_returns_one` monkeypatches
  `settings_mod.REPO_ROOT` + clears env (`:50-61`). cron no-key test lives in
  `test_sprint_and_report_kind.py` (noted `test_graph_and_cli.py:64-65`).
- **Slice-2 `default_*_deps` now accept `context: ProfileContext = EMPTY`** — the
  entrypoints build a `ProfileContext` from the loaded profile and pass it. The graph
  `build_*_graph(...)` wrappers (`report_graph.py:221`, `okr_report_graph.py:165`,
  `resource_report_graph.py:174`) call `default_*_deps` when `deps is None`; they need
  to forward `context`. **So `build_*_graph` also gains `context` kwarg in Slice 3**
  (or Slice 2 — assign to Slice 2's graph-factory edits since it already owns those
  3 files; Slice 3 only edits the entrypoints + their tests). ➜ **Ownership note:**
  the `context=` kwarg on `build_*_graph` belongs to Slice 2 (it owns the 3 graph
  files). Slice 3 only PASSES it from the entrypoints. Keep this boundary.

## Requirements

1. `cli.py` + `cron.py` accept `--profile <id>` (default `"default"`).
2. Both call `load_profile(profile_id)` → `LoadedProfile`, then use
   `loaded.settings` / `loaded.config` instead of `build_*_from_env()`, and build a
   `ProfileContext(persona=loaded.soul, project=loaded.project, memory=loaded.memory)`
   passed into the graphs.
3. DELETE the `build_*_from_env()` calls from BOTH entrypoints (the loader is now the
   single config source). `default` profile reproduces v1 ⇒ no behavior change.
4. A bad `--profile` id ⇒ `FileNotFoundError` from the loader ⇒ a clear CLI error +
   non-zero exit (catch and print, don't dump a traceback).
5. `--profile` default keeps the v1 command working: `cli report --daily` (no
   `--profile`) == `cli report --daily --profile default` == v1 output (anchor).

## Files to modify

- `src/entrypoints/cli.py`:
  - Add `_parse_profile(args)` using `_flag_value(args, "--profile")` (default
    `"default"`).
  - In `main` (`:204-241`): replace `settings = build_settings_from_env()` (`:219`)
    with `loaded = load_profile(_parse_profile(args))` wrapped in try/except
    `FileNotFoundError` → print + return non-zero. Use `loaded.settings`,
    `loaded.config`, and a `ProfileContext` built from `loaded`.
  - The management paths (`approvals`/`approve`/`reject` at `:224-229`) currently each
    call `build_reporting_config_from_env()` — replace with `loaded.config`.
  - Remove the `build_*_from_env` import (`:18-21`); import `load_profile` +
    `ProfileContext`.
  - Thread `context=` into `_run_report` → `build_*_graph(..., context=ctx)`.
  - Update the usage string (`:208-213`) to mention `--profile <id>`.
- `src/entrypoints/cron.py`:
  - Add `--profile` parse (default `"default"`); replace `build_*_from_env()`
    (`:69-70`) with `load_profile(...)`; thread `context=` into `_build_graph`.
  - Catch `FileNotFoundError` → print + return 1.
- `tests/test_graph_and_cli.py`:
  - `test_cli_no_key_returns_one` (`:50-61`): now the CLI loads `profiles/default/`
    instead of env. Adjust: the test must point at a profiles dir that exists. Either
    (a) rely on the committed `profiles/default/` and monkeypatch its
    `OPENROUTER_API_KEY` env to empty so `_require_key` returns 1; or (b) pass
    `--profile default` and clear `OPENROUTER_API_KEY`. Keep asserting exit code `1`.
  - Add `test_cli_bad_profile_returns_error`: `cli_main(["report","--profile","nope"])`
    ⇒ non-zero, prints a clear message (no traceback).

## Files to create

- `tests/test_profile_entrypoints.py`:
  - **Anchor (acceptance, the v1-equivalence):** `cli report --daily` with no
    `--profile` builds the SAME graph config as `--profile default`. Assert by
    injecting a fake `load_profile`/fake deps so no network: confirm the dispatched
    `report_kind`/`audience` + that `loaded.config` flows to `build_report_graph`.
    (The deep "byte-identical output" is covered by Slice 1's golden config test +
    Slice 2's byte-identical prompt tests — here assert the WIRING: default profile
    id is used when `--profile` absent, and the loader's config reaches the graph.)
  - `--profile acme` (a tmp profile dir via monkeypatched `profiles_dir`) loads that
    profile's config, not default.
  - cron `--profile` default + explicit parse.

## Implementation steps

1. `cli.py`: add `_parse_profile`; rewire `main` to `load_profile` + try/except;
   replace the 4 `build_*_from_env` call sites; build `ProfileContext`; thread
   `context=` into `_run_report`'s graph builds; update usage + imports.
2. `cron.py`: same rewire (smaller surface — one config build, one graph build).
3. Update `tests/test_graph_and_cli.py` for the loader-based no-key path + bad
   profile.
4. Write `tests/test_profile_entrypoints.py`.
5. Run focused tests, then full suite + ruff.

## Tests / validation

```
uv run pytest tests/test_graph_and_cli.py tests/test_profile_entrypoints.py \
  tests/test_sprint_and_report_kind.py -q
uv run pytest -q     # full suite green (acceptance f)
uv run ruff check src/entrypoints tests
# manual smoke (DRY_RUN, no real writes), proves the v1-equivalence anchor:
uv run python -m src.entrypoints.cli report --daily              # default profile
uv run python -m src.entrypoints.cli report --daily --profile default
```

## Acceptance (slice)

- `cli report --daily` (no `--profile`) loads `profiles/default/` and produces the v1
  report (anchor); explicit `--profile default` is identical.
- `--profile <bad-id>` ⇒ clear error, non-zero exit, no traceback dump.
- `build_*_from_env` no longer called in `cli.py`/`cron.py` (grep the two files = 0
  hits for `build_settings_from_env`/`build_reporting_config_from_env`).
- ruff clean; full suite green; entrypoint files ≤ 200 LOC (`cli.py` was 246 → watch
  the gate; if the rewire keeps it over, note the pre-existing over-gate per P1, but
  prefer extracting the profile-load helper to stay under).

## Risks / rollback

- **Risk: CLI tests that assumed env-built config break** (the no-key test). →
  Enumerated above; the only behavioral change is the config SOURCE (profile vs env),
  and `default` reproduces env, so assertions hold once the test points at the
  committed `profiles/default/`.
- **Risk: `cli.py` over the 200-LOC gate after the rewire.** → Extract a
  `_load_profile_or_exit(args)` helper; if still over, it is a pre-existing over-gate
  (246 LOC today) — note per P1 deviation, do not block.
- **Rollback:** revert `cli.py` + `cron.py` to the `build_*_from_env` calls + delete
  the new test; revert the test edits. Slices 1 + 2 remain (loader + context exist,
  unused by entrypoints) — v1 behavior fully restored.

## Open questions

**None** — all 4 prior open questions are RESOLVED and baked into the plan. See the
"Open questions" section of [plan.md](plan.md#open-questions) for the resolution summary:
Slack dual-token = fixed v1 env names (P3 defers per-agent); `schedule`/`reports`/`enabled`
= parsed-but-unused, CLI flags NOT gated on `reports`; Atlassian = single shared token
(v1 parity); `config.example.env` defaults read + baked into the
[phase-01 profile.yaml spec](phase-01-loader-default-profile.md#profilesdefaultprofileyaml-spec-concrete--verified-vs-configexampleenv).
</content>
