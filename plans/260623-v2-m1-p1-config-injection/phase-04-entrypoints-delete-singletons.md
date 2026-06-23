# Slice D — Entrypoints build-and-inject + delete the singletons (closing slice)

> Status: pending · Depends on: A, B, C · Owns: `src/entrypoints/cli.py`,
> `src/entrypoints/cron.py`, the DELETION of `get_settings` / `get_reporting_config`
> from the two config files, `tests/conftest.py`, and the 4 remaining entrypoint
> test files. This is the ONLY slice where the grep-0-hits gate can close.

## Goal

Flip `cli.py` + `cron.py` to build config once from env and inject it down. Delete
the two `@lru_cache` singletons and the now-orphaned `_load_external_channels`.
Migrate the last test fixtures. Close the grep-0-hits gate; full suite green.

## Context (verified 2026-06-23)

- `src/entrypoints/cli.py`:
  - `:18` `from src.config.settings import get_settings`; `:22`
    `if not get_settings().openrouter_api_key:` (`_require_key`).
  - `:32` `build_graph(get_checkpointer())` (hello path — Phase 0).
  - `:48/:52/:56-58` `build_resource_graph` / `build_okr_graph` /
    `build_report_graph(get_checkpointer(), ...)` — NO config passed (reads singleton
    internally today; Slice C now requires `config`/`settings`).
  - `:110/:128/:161` `ActionGateway()` bare (approvals / approve / reject).
  - `:171` `AuditLog()` bare (audit query).
- `src/entrypoints/cron.py`:
  - `:19` `from src.config.settings import get_settings`; `:64`
    `if not get_settings().openrouter_api_key:`.
  - `:44` `get_checkpointer()` bare; `:48/:52/:55` `build_*_graph(cp, ...)` — NO
    config.
- Singletons to delete: `get_settings` (`settings.py:79`, a `from_env` wrapper after
  Slice A), `get_reporting_config` (`reporting_config.py:103`, a wrapper after A).
- Orphan to delete: `_load_external_channels` (`action_gateway.py:103-110`) — its only
  caller is the `external_channels` default, which Slice C stopped relying on.

## Design decisions for this slice

### Entrypoints build config once, thread it

In both `cli.py` and `cron.py`, at the top of the run path, build:
```
settings = build_settings_from_env()
config = build_reporting_config_from_env()
```
Then:
- `_require_key()` / cron's key check use `settings.openrouter_api_key` (not the
  singleton).
- `get_checkpointer(settings.data_dir / "checkpoints.db")` (Slice B made the path
  required) — pass the explicit path.
- `build_report_graph(checkpointer, config=config, settings=settings,
  report_kind=..., audience=...)` and the okr/resource builders likewise.
- `ActionGateway(settings=settings,
  external_channels=config.slack_external_channels)` for the approvals/approve/reject
  paths (build it once, pass to those helpers).
- `AuditLog(settings.data_dir / "audit" / "audit.jsonl")` for the audit query (path
  required after B).
- The hello path `build_graph(get_checkpointer(settings.data_dir /
  "checkpoints.db"))` — `build_graph` is the Phase-0 hello agent. **CONFIRMED
  (verified 2026-06-23): `src/agent/graph.py:36` constructs a bare `LlmClient()`**
  inside `_make_respond` when no client is injected. Since Slice B made
  `LlmClient.settings` required, the hello path WILL break unless `settings` is
  threaded. `build_graph(checkpointer, *, client=None)` `:45-48` already accepts an
  optional `client`. **Scope addition for this slice:** add `settings: Settings` to
  `build_graph` / `_make_respond` so the bare-client branch builds
  `LlmClient(settings=settings)`; the cli hello path passes `settings`. `graph.py`
  is therefore a D-owned file (see Files). Small, entrypoint-adjacent.

> The approvals/approve/reject/audit subcommands run BEFORE the key check
> (`cli.py:201-208`) — they still need `settings`/`config` to build the gateway +
> audit log. Build `settings`/`config` at the top of `main()` (or lazily in each
> sub-helper) so those paths get injected config without requiring an OpenRouter key.

### Delete the singletons + orphan

- `settings.py`: delete `get_settings` (and the now-unused `@lru_cache` /
  `load_dotenv` imports if nothing else uses them — verify). Keep the `Settings`
  dataclass + constants + helpers (the builders import them).
- `reporting_config.py`: delete `get_reporting_config`. Keep `ReportingConfig` /
  `McpServerSpec` / `_server_dist` / default dist constants (the builder imports
  them). Verify the `load_dotenv` import is removed if unused.
- `action_gateway.py`: delete `_load_external_channels` (`:103-110`). Decide whether
  `external_channels` becomes required or stays optional-defaulting-to-empty: keep it
  optional defaulting to `frozenset()` (a gateway with no external channels classifies
  nothing as Lớp B via channel — safe default; every real construction passes it).
  Confirm no test relies on the old singleton-reading default.

### Migrate the last test fixtures

- `tests/conftest.py`: `settings_factory` (`:12-36`) builds `Settings(...)` directly.
  **Re-point it at `build_settings_from_dict`** so the fixture cannot drift from the
  real builder: `_make(...)` returns `build_settings_from_dict({...the kwargs...,
  "data_dir": tmp_path})`. Keep the same kwargs surface so existing callers are
  unchanged. (This also gives every test the same coercion/validation path.)
- `tests/test_graph_and_cli.py:58-62` — `settings_mod.get_settings.cache_clear()` →
  remove (no singleton). Migrate the CLI test to monkeypatch
  `build_settings_from_env` / `build_reporting_config_from_env` (the new injection
  point) OR inject via the CLI's now-explicit build path. Prefer monkeypatching the
  `from_env` builders the entrypoint calls.
- `tests/test_resource_report.py:194,208` + `tests/test_okr_report.py:173,188` —
  `monkeypatch.setattr(cli, "get_settings", lambda: ...)`. `cli` no longer imports
  `get_settings`; it calls `build_settings_from_env()`. Migrate to
  `monkeypatch.setattr(cli, "build_settings_from_env", lambda: <fake settings>)` (and
  `build_reporting_config_from_env` where the report path needs config).
- `tests/test_audience_prompts.py:178-184` —
  `monkeypatch.setenv(...) + rc.get_reporting_config.cache_clear()` then
  `rc.get_reporting_config()`. Migrate to building config directly:
  `build_reporting_config_from_dict({"slack_stakeholder_channel": stakeholder,
  "slack_external_channels": external})` (or `from_env` after setenv, WITHOUT
  `cache_clear`). Remove all `.cache_clear()` calls.
- `tests/test_sprint_and_report_kind.py:137-142` — `get_settings.cache_clear()` →
  removed (handled in Slice C's edits to this file; confirm none remain).

## Files

- **Modify (source, 6):** `src/entrypoints/cli.py`, `src/entrypoints/cron.py`,
  `src/config/settings.py` (delete `get_settings`), `src/config/reporting_config.py`
  (delete `get_reporting_config`), `src/actions/action_gateway.py` (delete
  `_load_external_channels`), `src/agent/graph.py` (hello path: thread `settings` into
  the bare `LlmClient()` at `:36`). [The 2 config files were also touched in A —
  sequential, not parallel.]
- **Modify (tests, 5):** `tests/conftest.py`, `tests/test_graph_and_cli.py`,
  `tests/test_okr_report.py`, `tests/test_resource_report.py`,
  `tests/test_audience_prompts.py`.

## Implementation steps

1. `graph.py` (hello path): add `settings: Settings` to `build_graph` /
   `_make_respond`; the bare-client branch (`:36`) builds `LlmClient(settings=settings)`.
   (Confirmed needed — `LlmClient.settings` is required after Slice B.)
2. `cli.py`: import the `from_env` builders; build `settings`/`config` in `main()`;
   thread into `_require_key`, the report builders, the gateway helpers, the audit
   query, the checkpointer path, and the hello path. Remove the `get_settings`
   import.
3. `cron.py`: same — build `settings`/`config`; thread into the key check + the graph
   builder; explicit checkpointer path. Remove the `get_settings` import.
4. Delete `get_settings` (`settings.py`) + `get_reporting_config`
   (`reporting_config.py`) + `_load_external_channels` (`action_gateway.py`); remove
   now-unused imports (`lru_cache`, `load_dotenv` where orphaned).
5. Migrate the 5 test files per the notes above; remove ALL `.cache_clear()` calls.
6. Run the grep gate + full suite.

## Tests / validation

- **Grep-0-hits gate (the headline acceptance):**
  `grep -rn "get_reporting_config\|get_settings" src/` → **0 hits**.
  Also `grep -rn "_load_external_channels\|cache_clear" src/ tests/` → 0 hits.
- Full suite: `uv run pytest -q` → all ~269 collected pass (227 test fns,
  parametrize-expanded). The cli/cron entrypoint tests deferred from Slice C
  (`test_graph_and_cli.py`, `test_okr_report.py`, `test_resource_report.py`) now go
  green.
- `uv run ruff check src tests` → clean. No source file > 200 LOC.
- **Backward-compat anchor (manual, if env available):** `uv run python -m
  src.entrypoints.cli report --daily` produces output identical to current v1 (the
  `from_env` path reproduces the singleton values). If no live MCP/key in the dev env,
  rely on the Slice A golden test + the unchanged behavioral test assertions as the
  proxy.

## Acceptance (this slice = whole-phase close)

1. `grep -rn "get_reporting_config\|get_settings" src/` → 0 hits. The functions do
   not exist in `src/`.
2. `_load_external_channels` deleted; no `cache_clear` anywhere.
3. Entrypoints build config once via `build_*_from_env()` and inject it down; no
   singleton import remains in `cli.py` / `cron.py`.
4. `conftest.settings_factory` routes through `build_settings_from_dict` (cannot drift
   from the real builder).
5. `uv run pytest` green; `uv run ruff check src tests` clean; all source < 200 LOC.

## Risks / rollback

- **Risk:** an entrypoint subcommand (approvals/approve/reject/audit) runs before the
  key check and now needs config that isn't built on that path → `NameError`.
  *Mitigation:* build `settings`/`config` at the very top of `main()` (before the
  subcommand dispatch at `cli.py:201`), or in each sub-helper. Test each subcommand
  (`test_lop_b_and_audit_query.py` covers approvals/audit) green.
- **Risk:** `build_graph` (hello path) has a hidden bare `LlmClient()` → the hello CLI
  path breaks. *Mitigation:* Step 1 traces it; covered by `test_graph_and_cli.py`.
- **Risk:** a test still references `get_settings`/`get_reporting_config` after
  migration → import error. *Mitigation:* the grep gate covers `src/`; run
  `grep -rn "get_settings\|get_reporting_config\|cache_clear" tests/` and migrate any
  stragglers (the suite won't collect otherwise).
- **Risk:** deleting `load_dotenv` import where it's actually still needed by the
  `from_env` builder (which lives in `config_builders.py`, not these files). *Verify*
  the builder module owns its own `load_dotenv` import; the config files no longer
  need it once the singletons are gone.
- **Rollback:** revert D's diffs → the singletons (as A's wrappers) return and the
  entrypoints go back to relying on them. Because A-C left the wrappers functional,
  reverting only D restores a working v1-equivalent. This is the point of no easy
  return for the grep gate — revert D first if the suite regresses.

## Open questions

1. **`data_dir` per-agent (P3 hook).** P1 keeps `data_dir = REPO_ROOT/.data`. The
   `from_dict` contract exposes `data_dir` as an injectable key so P3 can pass
   `.data/agents/<id>/`. Confirm P3 will set it via the dict (not via a new env var) —
   the contract assumes profile/dict-driven. (Low risk; the key exists either way.)
2. **`atlassian_api_token` placement.** It is NOT a top-level `ReportingConfig` field
   (it only feeds the server-env blocks). The contract lists it as a server-env dict
   key. Confirm P2's loader maps `bindings.jira.token_env` → resolves the named env
   var → fills `atlassian_api_token` in the dict at spawn time (P2 concern). P1's
   `from_env` reads it directly from `ATLASSIAN_API_TOKEN` (v1 behavior). No action in
   P1 — flagged so P2 wires the resolution.
3. *(Resolved during planning — not an open question.)* `build_graph` (Phase-0 hello
   agent) constructs a bare `LlmClient()` at `graph.py:36`; `src/agent/graph.py` is in
   D's Files and `settings` is threaded there.
