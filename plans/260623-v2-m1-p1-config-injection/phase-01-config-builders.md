# Slice A — Config builders (from_dict core + from_env wrapper)

> Status: DONE (031a543) · Depends on: — · Owns: `src/config/config_builders.py` (new),
> `tests/test_config_builders.py` (new), `src/config/settings.py`,
> `src/config/reporting_config.py`

## Goal

Add the four builders and move all validation into `from_dict`, WITHOUT yet removing
the singletons — re-express `get_settings()` / `get_reporting_config()` as thin
`from_env` wrappers so every existing caller keeps working. This slice is purely
additive + safe to commit alone.

## Context (verified 2026-06-23)

- `Settings` dataclass: `src/config/settings.py:47-75` (9 fields, frozen). Singleton
  `get_settings()`: `:79-94`. Helpers `_env_bool` `:29`, `_env_float` `:37`.
  Constants `REPO_ROOT` `:21`, `DATA_DIR` `:22`, `DEFAULT_MODEL` `:26`.
- `ReportingConfig` dataclass: `src/config/reporting_config.py:59-94` (frozen).
  `McpServerSpec`: `:32-56`. Singleton `get_reporting_config()`: `:103-170`.
  Default dist paths `:25-29`. `_server_dist()` helper `:97`. **Stakeholder-channel
  validation (Phase 5): `:145-150`** — this is what moves into `from_dict`.
- LOC now: `settings.py` 94, `reporting_config.py` 170. Adding builders inline would
  push `reporting_config.py` past the 200-LOC gate → builders go in a NEW file.

## Requirements

1. **New file `src/config/config_builders.py`** holds all four builders:
   - `build_settings_from_dict(d: dict) -> Settings`
   - `build_reporting_config_from_dict(d: dict) -> ReportingConfig`
   - `build_settings_from_env() -> Settings`
   - `build_reporting_config_from_env() -> ReportingConfig`
   It imports the dataclasses + helpers from `settings.py` / `reporting_config.py`.
   Keep it <200 LOC (the env-dict assembly is mechanical). If it would exceed 200,
   split into `config_builders_settings.py` + `config_builders_reporting.py` (decide
   at implementation time; prefer one file if it fits).

2. **`from_dict` is pure.** No `load_dotenv`, no `os.getenv`, no `os.environ`. It
   reads keys from the passed dict with the SAME defaults the singleton uses, coerces
   string values via `_env_bool`-equivalent / `float()` / `int()` so a profile that
   passes `"true"` or a caller that passes `True` both work. (Add small dict-aware
   coercion helpers `_d_bool(d, key, default)` / `_d_float` / `_d_int` in the builder
   module — DRY with the env helpers' semantics, but dict-keyed not env-keyed.)

3. **`from_dict` holds ALL validation.** Move the Phase-5 check (currently
   `reporting_config.py:145-150`): if `slack_stakeholder_channel` set and NOT in
   `slack_external_channels`, raise `RuntimeError` with the same message. This is the
   only validation today; keep the message text identical (a test asserts on it).

4. **`from_env` = load_dotenv + os.environ → dict → from_dict.** Build the dict with
   the EXACT env var names + defaults the current singletons use (the dict-shape
   table in plan.md is the contract). Then call the matching `from_dict`. `from_env`
   is the ONLY place I/O happens.
   - Settings env vars: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default
     `DEFAULT_MODEL`), `OPENROUTER_REFERER` (default the github url),
     `OPENROUTER_TITLE` (default `my-project-manager`), `DRY_RUN` (default `True`),
     `AGENT_WRITE_DISABLED` (default `False`) → dict key `write_disabled`,
     `MONTHLY_BUDGET_USD` (default 50.0), `BUDGET_WARN_RATIO` (default 0.8).
     `data_dir` = `DATA_DIR` (`REPO_ROOT/.data`).
   - Reporting env vars: `JIRA_PROJECT_KEY`, `GITHUB_REPO`, `SLACK_REPORT_CHANNEL`,
     `SLACK_EXTERNAL_CHANNELS` (comma-split → frozenset), `SLACK_STAKEHOLDER_CHANNEL`,
     `CONFLUENCE_SPACE_KEY`, `CONFLUENCE_SPACE_ID`, `ATLASSIAN_SITE_NAME`,
     `PR_STALE_DAYS` (default 7), `BLOCKER_LABEL_SUBSTRING` (default `block`),
     `OKR_CONFLUENCE_PAGE_ID`, `OKR_BEHIND_THRESHOLD` (default 0.5),
     `RESOURCE_OVERLOAD_RATIO` (default 1.5), `LABOR_COST_PER_ISSUE` (default 0).
   - Server dist overrides: `JIRA_MCP_DIST`, `SLACK_MCP_DIST`, `CONFLUENCE_MCP_DIST`.
   - Server env (tokens read directly from env in P1, as v1): `ATLASSIAN_SITE_NAME`,
     `ATLASSIAN_USER_EMAIL`, `ATLASSIAN_API_TOKEN`, `SLACK_XOXC_TOKEN`,
     `SLACK_XOXD_TOKEN`, `SLACK_TEAM_DOMAIN`. (Confluence server reuses the Atlassian
     trio under `CONFLUENCE_*` keys — keep that mapping exactly as `:128-137`.)

5. **`McpServerSpec` construction lives in `from_dict`** (so a profile can override
   dist paths + tokens). `from_dict` reads `jira_mcp_dist`/`slack_mcp_dist`/
   `confluence_mcp_dist` + the token keys from the dict and assembles the three specs
   exactly as `reporting_config.py:107-137` does today.

6. **Re-express the singletons as `from_env` wrappers** (NOT deleted in this slice):
   - `settings.py`: `get_settings()` body becomes
     `return build_settings_from_env()` (keep the `@lru_cache` for now so cache
     semantics + existing `cache_clear()` test calls survive through A-C; D removes
     the function entirely). Import the builder lazily inside the function to avoid a
     circular import (`config_builders` imports from `settings`).
   - `reporting_config.py`: same — `get_reporting_config()` body becomes
     `return build_reporting_config_from_env()`. The validation block is DELETED here
     (it now lives in `from_dict`, reached via `from_env`). Keep `@lru_cache` for now.

   > Circular-import note: `config_builders` imports `Settings`/`McpServerSpec`/
   > `ReportingConfig` + helpers from the two config modules; the two config modules
   > import the builders lazily (inside the wrapper function body), so module-load
   > order is safe. Verify no top-level cycle with a bare `python -c "import
   > src.config.settings, src.config.reporting_config, src.config.config_builders"`.

## Files

- **Create:** `src/config/config_builders.py`, `tests/test_config_builders.py`
- **Modify:** `src/config/settings.py` (singleton → wrapper; export builder import),
  `src/config/reporting_config.py` (singleton → wrapper; DELETE the inline validation
  block, it moves to the builder)

## Implementation steps

1. Write `config_builders.py`: dict coercion helpers, then the two `from_dict`
   functions (incl. the moved validation + the 3 `McpServerSpec` assembly), then the
   two `from_env` wrappers (env→dict→from_dict). Mirror the env var names + defaults
   from the dict-shape table in plan.md exactly.
2. Replace `get_settings()` body with `return build_settings_from_env()` (lazy import).
3. Replace `get_reporting_config()` body with `return build_reporting_config_from_env()`
   (lazy import); remove its inline validation block (`:145-150`).
4. Confirm no circular import (the bare import check above).

## Tests / validation (`tests/test_config_builders.py`)

- **from_env byte-identical golden:** under a controlled env (`monkeypatch.setenv`
  for the key fields + a representative full set), assert `build_settings_from_env()`
  and `build_reporting_config_from_env()` produce a dataclass whose every field equals
  the captured v1 value. Capture goldens by also asserting equality with a frozen
  expected dataclass literal (so the test survives the singleton's deletion in D).
- **from_dict defaults:** `build_settings_from_dict({})` == all-defaults Settings;
  `build_reporting_config_from_dict({})` == all-defaults ReportingConfig. Run this
  with a CLEARED env (`monkeypatch.delenv` the relevant vars or assert via a guard
  that no `os.getenv` is hit) to prove purity.
- **from_dict coercion:** `build_settings_from_dict({"dry_run": "false"})` →
  `dry_run is False`; `{"dry_run": False}` → `False`; `{"monthly_budget_usd": "12.5"}`
  → `12.5`. Same for `pr_stale_days` int coercion.
- **Validation on the dict path:** `build_reporting_config_from_dict({
  "slack_stakeholder_channel": "#exec", "slack_external_channels": ""})` raises
  `RuntimeError` (message mentions `SLACK_STAKEHOLDER_CHANNEL` /
  `SLACK_EXTERNAL_CHANNELS`). The valid case (`stakeholder ∈ external`) does NOT raise.
- **Validation on the env path:** `monkeypatch.setenv` the same bad combo →
  `build_reporting_config_from_env()` raises (proves `from_env` cannot bypass).
- **McpServerSpec assembly:** `from_dict` with custom `jira_mcp_dist` →
  `cfg.jira_server.dist_path == Path(that)`; tokens land in the right server env.
- **Existing suite still green** (the wrappers keep all current callers working):
  `uv run pytest` passes unchanged; `uv run ruff check src tests` clean.

## Acceptance

- Four builders exist; `from_dict` is pure (no I/O) and holds the only validation.
- `from_env` golden test pins every field to v1 values.
- Singletons still resolve (as wrappers) → full suite green, ruff clean.
- `config_builders.py` < 200 LOC (else split per Requirement 1).

## Risks / rollback

- **Risk:** a default typo in the env→dict map silently changes behavior. *Mitigation:*
  the golden test compares every field; `from_env` is a literal extraction of the
  current singleton bodies — review the diff line-for-line against `settings.py:82-93`
  and `reporting_config.py:107-169`.
- **Risk:** circular import between config modules + builder. *Mitigation:* lazy import
  in the wrappers; bare-import smoke check.
- **Rollback:** delete `config_builders.py` + its test, restore the two singleton
  bodies (incl. the inline validation block). No other slice touched yet.
