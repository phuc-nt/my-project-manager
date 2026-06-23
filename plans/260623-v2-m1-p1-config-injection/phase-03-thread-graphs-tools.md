# Slice C — Thread config through graph/section factories + tool fetchers

> Status: pending · Depends on: A, B · Owns the 6 agent files + 4 tool files + 5 test
> files in the ownership table for C. Builds the per-flow `ActionGateway` WITH
> injected config (the gateway B made injectable). Does NOT touch entrypoints (D) or
> delete the singletons (D).

## Goal

Add `config: ReportingConfig` + `settings: Settings` to the three `default_*_deps`
factories and the three `build_*_graph` builders; add `config` to the weekly section
helpers and the four tool fetchers; build every `ActionGateway` / `LlmClient` inside
the factories WITH injected config. After this slice, no graph/section/tool code
reads a singleton — only the entrypoints (Slice D) still call the wrappers.

## Context (verified 2026-06-23)

### Graph factories (read singletons inside)

- `src/agent/report_graph.py`: `default_report_deps(*, report_kind, audience, client,
  gateway)` `:51`; reads `cfg = get_reporting_config()` `:70`, builds
  `gw = gateway or ActionGateway()` `:71`, builds `LlmClient()` `:98`, uses
  `cfg.blocker_label_substring` `:167`. `build_report_graph(checkpointer, *, deps,
  report_kind, audience)` `:210`; default deps at `:223`.
- `src/agent/okr_report_graph.py`: `default_okr_deps(*, audience, gateway)` `:46`;
  `gw = gateway or ActionGateway()` `:70`. `build_okr_graph` `:149`.
- `src/agent/resource_report_graph.py`: `default_resource_deps(*, audience, gateway)`
  `:48`; `gw = gateway or ActionGateway()` `:72`. `build_resource_graph` `:160`.

### Weekly section helpers (read singletons inside, lazy-imported)

- `src/agent/okr_weekly_section.py`: `build_okr_rollup()` `:26` reads
  `cfg = get_reporting_config()` `:36`; `weekly_okr_section(report_date)` `:54` gates
  on `get_reporting_config().okr_confluence_page_id` `:64`;
  `weekly_okr_slack_line()` `:76` gates on the same `:81`.
- `src/agent/resource_weekly_section.py`: `build_resource_rollup()` `:25` reads
  `cfg = get_reporting_config()` `:37` + `settings = get_settings()` `:40`;
  `weekly_resource_section(report_date)` `:59` gates on
  `get_reporting_config().jira_project_key` `:69`;
  `weekly_resource_slack_line()` `:79` gates on the same `:83`.
- `src/agent/audience_delivery.py`: `resolve_audience_delivery(audience, kind, today)`
  `:24` reads `get_reporting_config().slack_stakeholder_channel` `:33`.

> These helpers are called from `report_graph._compose` / `_deliver` (`:112-116`,
> `:120-127`, `:143-147`) when `report_kind == "weekly" and audience == "internal"`.
> So the config the report deps hold must be PASSED INTO these helpers.

### Tool fetchers (read singleton inside; already take an override param)

- `src/tools/jira_read.py`: `get_open_issues(...)` `:88` reads cfg `:99`;
  `get_active_sprint(...)` `:128` reads cfg `:135`; `get_sprint_issues(...)` `:156`
  reads cfg `:160`.
- `src/tools/github_read.py`: `get_open_prs(...)` `:93` reads cfg `:97`;
  `get_recent_ci(repo=None, *, limit=20)` `:112` reads cfg `:114`.
- `src/tools/okr_read.py`: `get_epic_progress(epic_key, *, server=None)` `:65` reads
  cfg `:73`; `get_epic_progress_map(epic_keys, *, server=None)` `:82` does NOT read
  the singleton — it forwards to `get_epic_progress(key, server=server)` `:96`. So it
  needs a `config` param ONLY to forward it down to `get_epic_progress`.
- `src/tools/confluence_read.py`: `get_page_content(page_id, *, server=None)` `:75`
  reads cfg `:82`.

## Design decisions for this slice

### Factories: add `config` + `settings`, build collaborators with them

`default_report_deps(*, config: ReportingConfig, settings: Settings, report_kind,
audience, client=None, gateway=None)`:
- Drop `cfg = get_reporting_config()` — use the passed `config`.
- `gw = gateway or ActionGateway(settings=settings,
  external_channels=config.slack_external_channels)` — inject both (this is the
  hand-off Slice B set up; the gateway no longer needs `_load_external_channels`).
- `llm` default becomes `LlmClient(settings=settings)` (was bare `LlmClient()` at
  `:98`) — `settings` now required (Slice B).
- The fetcher closures (`_fetch_issues` etc.) pass `config=config` into
  `jira_read.*` / `github_read.*`.
- The compose/deliver closures pass `config` into `create_report_page` /
  `deliver_report` (Slice B added the param) and into the weekly section helpers.

Same shape for `default_okr_deps` and `default_resource_deps` (`resource` also needs
`settings` for its budget band — it currently reads `get_settings()` via the weekly
section helper `:40`; thread `settings` through).

`build_report_graph(checkpointer, *, config: ReportingConfig, settings: Settings,
deps=None, report_kind, audience)`:
- `resolved = deps or default_report_deps(config=config, settings=settings,
  report_kind=report_kind, audience=audience)`.
- Same for `build_okr_graph` / `build_resource_graph`.

> BREAKING signature change — accepted. Callers are the entrypoints (Slice D) and the
> tests in this slice + D.

### Weekly section helpers: take `config` (+ `settings` for resource)

- `build_okr_rollup(config)`, `weekly_okr_section(report_date, config)`,
  `weekly_okr_slack_line(config)`.
- `build_resource_rollup(config, settings)`,
  `weekly_resource_section(report_date, config, settings)`,
  `weekly_resource_slack_line(config)`.
- `resolve_audience_delivery(audience, kind, today, config)` — takes `config`, reads
  `config.slack_stakeholder_channel`.
- Remove the lazy `from src.config... import get_*` imports inside these functions.

> The `report_graph` weekly branch (`:112-116`, `:143-147`) and the okr/resource
> graphs call these helpers — update those call sites to pass `config` (and
> `settings` for resource). These are WITHIN Slice C's owned files.

### Tool fetchers: add `config` param

Each fetcher gains a `config: ReportingConfig` parameter (keyword), replacing the
internal `cfg = get_reporting_config()`:
- `get_open_issues(*, config, ...)`, `get_active_sprint(*, config, ...)`,
  `get_sprint_issues(sprint_id, *, config, ...)`.
- `get_open_prs(*, config, ...)`, `get_recent_ci(*, config, limit=20)`.
- `get_epic_progress(epic_key, *, config, server=None)`,
  `get_epic_progress_map(epic_keys, *, config, server=None)` — `_map` forwards
  `config` into each `get_epic_progress` call (no direct cfg read of its own).
- `get_page_content(page_id, *, config, server=None)`.

> Keep the existing optional `server` / `repo` overrides; they coexist with `config`
> (an explicit `server` still wins, else derive from `config`). Verify each fetcher's
> exact use of cfg (project_key, repo, server spec) and pass the right field.

## Files

- **Modify (source, 10):** `src/agent/report_graph.py`,
  `src/agent/okr_report_graph.py`, `src/agent/resource_report_graph.py`,
  `src/agent/okr_weekly_section.py`, `src/agent/resource_weekly_section.py`,
  `src/agent/audience_delivery.py`, `src/tools/jira_read.py`,
  `src/tools/github_read.py`, `src/tools/okr_read.py`,
  `src/tools/confluence_read.py`.
- **Modify (tests, 5):** `tests/test_sprint_and_report_kind.py`,
  `tests/test_weekly_resource_section.py`, `tests/test_audience_delivery.py`,
  `tests/test_slack_write_and_report_graph.py`, `tests/test_resource_analyzer.py`.

## Implementation steps

1. Tool fetchers (leaf-first — fewest dependents): add `config` to the 4 files'
   public fetchers; remove the internal singleton reads + imports.
2. Section helpers + `audience_delivery`: add `config` (+ `settings` for resource);
   remove internal singleton reads; update their internal call sites.
3. Graph factories: add `config` + `settings` to the 3 `default_*_deps` + 3
   `build_*_graph`; build `ActionGateway` / `LlmClient` with injected config; pass
   `config` into the fetcher closures, writers, and section helpers; update the
   weekly-branch call sites.
4. Update the 5 test files: tests that monkeypatched the singletons migrate to
   passing `config=`:
   - `test_sprint_and_report_kind.py:85-87` (`monkeypatch.setattr(rc,
     "get_reporting_config", lambda: _Cfg())`) → pass `config=_Cfg()` into the
     fetcher / `default_report_deps`. Also `:137-142` `get_settings.cache_clear()`
     → remove (build a `settings_factory()` and inject).
   - `test_weekly_resource_section.py:28` (`setattr(rc, ...)`) → pass `config=` (+
     `settings=`) into `weekly_resource_section` / `build_resource_rollup`.
   - `test_audience_delivery.py:26` (`setattr(rc, "get_reporting_config", lambda:
     _Cfg(stakeholder))`) → pass `config=_Cfg(stakeholder)` into
     `resolve_audience_delivery`.
   - `test_slack_write_and_report_graph.py` — uses `settings_factory`; thread
     `config=` + `settings=` into `build_report_graph` / `default_report_deps`.
   - `test_resource_analyzer.py` — uses `settings_factory`; inject as needed.

## Tests / validation

- Focused per file as each is migrated:
  `uv run pytest tests/test_sprint_and_report_kind.py
  tests/test_weekly_resource_section.py tests/test_audience_delivery.py
  tests/test_slack_write_and_report_graph.py tests/test_resource_analyzer.py -q`.
- Then full: `uv run pytest -q` (entrypoints still use the wrappers in Slice C — they
  call `build_*_graph` WITHOUT config until D, so those CLI/cron paths would now fail
  the new required args). **Therefore: the entrypoint call sites in `cli.py`/`cron.py`
  must be updated in the SAME commit boundary as D, OR Slice C temporarily leaves a
  bridging default.** Decision: keep C and D in sequence; C's full-suite run EXCLUDES
  the cli/cron E2E tests that call the entrypoints (those migrate in D). Run the
  graph/tool unit tests green in C; the cli/cron entrypoint tests
  (`test_graph_and_cli.py`, `test_okr_report.py`, `test_resource_report.py`) go green
  in D. Note this explicitly so C is not blocked on D's files.
- `uv run ruff check src tests`.

## Acceptance

- `grep -n "get_reporting_config\|get_settings" src/agent/report_graph.py
  src/agent/okr_report_graph.py src/agent/resource_report_graph.py
  src/agent/okr_weekly_section.py src/agent/resource_weekly_section.py
  src/agent/audience_delivery.py src/tools/jira_read.py src/tools/github_read.py
  src/tools/okr_read.py src/tools/confluence_read.py` → 0 hits.
- Every `ActionGateway` built in a factory receives `external_channels` +
  `settings` (no `_load_external_channels` reliance).
- Graph/tool unit tests green; ruff clean. (cli/cron entrypoint tests green in D.)

## Risks / rollback

- **Risk:** the cli/cron entrypoints call `build_*_graph` without the new required
  `config`/`settings` → those paths break until D. *Mitigation:* C and D are
  consecutive; C's acceptance scopes to graph/tool unit tests; the entrypoint tests
  are D's gate. Keep the C→D gap to one working session.
- **Risk:** a weekly-branch call site missed → `TypeError` at runtime only on the
  weekly+internal path (not covered by daily tests). *Mitigation:* enumerate the 4
  weekly call sites (`report_graph.py:112-116, 143-147`, plus the okr/resource graph
  helper calls) and assert a weekly-internal test exercises them
  (`test_sprint_and_report_kind.py` covers weekly).
- **Risk:** a tool fetcher's `server`/`config` precedence inverted (explicit `server`
  no longer wins). *Mitigation:* preserve the `server or <from config>` order; unit
  test the okr/confluence fetchers with an explicit `server=` to confirm it still
  wins.
- **Rollback:** revert the 10 source + 5 test diffs. Slices A+B remain; the factories
  go back to reading the wrappers. Suite green.
