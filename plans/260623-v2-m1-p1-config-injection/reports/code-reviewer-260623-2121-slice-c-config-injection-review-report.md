# Slice C — Config-Injection Refactor: Code Review

Scope: uncommitted working-tree diff. 10 source files + 6 test files (325 insertions / 207 deletions).
Verification run locally: `uv run pytest -q` → 282 passed (0.45s); `uv run ruff check` (10 src files) → all checks passed.
Focus: logic/security correctness tests cannot catch (external_channels drop, precedence inversion, missed weekly call site).

## Overall Assessment

The slice is correct and complete against all six acceptance criteria. The refactor is mechanical and disciplined: singleton reads removed, `config`/`settings` threaded through every collaborator, override precedence preserved, and the guardrail external-channel set is passed explicitly to every gateway. No blocking findings. The only non-blocking item is the documented C→D entrypoint boundary, which is expected.

## Acceptance Criteria — Verified

(a) ZERO residual singleton reads — CONFIRMED.
- `grep get_reporting_config|get_settings|build_settings_from_env` across all 10 files → none.
- No aliased/lazy re-import smuggling: only `ReportingConfig`/`Settings` type imports remain. `_load_external_channels()` in `action_gateway.py` still references the singleton, but that file is out of Slice C scope and is the documented Slice-D fallback.

(b) ActionGateway external-channels invariant — CONFIRMED in all 3 factories:
- `src/agent/report_graph.py:79` `ActionGateway(settings, external_channels=config.slack_external_channels)`
- `src/agent/okr_report_graph.py:80` same
- `src/agent/resource_report_graph.py:82` same
- `settings` is the first positional param of `ActionGateway.__init__` (`action_gateway.py:124`); `slack_external_channels: frozenset[str]` (`reporting_config.py:62`) matches `external_channels: frozenset[str] | None` (`action_gateway.py:128`). Binding and type are correct — the guardrail set is not dropped.
- Defense-in-depth note: even the pre-Slice-C `ActionGateway(settings)` did not silently drop the set; `__init__` falls back to `_load_external_channels()` when `external_channels is None`. Slice C makes the dependency explicit and removes reliance on that fallback. No silent-drop window existed or was introduced.

(c) `server`/`repo`/`project_key` override precedence preserved — CONFIRMED in all 4 fetchers:
- `jira_read.get_open_issues` `project_key or config.jira_project_key`; `get_active_sprint`/`get_sprint_issues` `server or config.jira_server`.
- `github_read.get_open_prs`/`get_recent_ci` `repo or config.github_repo`; `stale_days if stale_days is not None else config.pr_stale_days`.
- `okr_read.get_epic_progress` `server or config.jira_server`; `get_epic_progress_map` forwards `config=config, server=server` per epic.
- `confluence_read.get_page_content` `server or config.confluence_server`. Explicit arg still wins in every case.

(d) No stray `cfg` — CONFIRMED. `grep -w cfg` across all 10 files → none. All converted to `config`.

(e) No secret/token regression — CONFIRMED. Slice C only threads `config=config` into writer call args; `LlmClient(settings)` and `ActionGateway(settings, ...)` receive `settings` as constructor deps, never onto an action payload. No `token`/`secret`/`api_key`/`password` placed on any action dict in the diff. Writers/handlers remain closure-based (Slice B); payloads unchanged.

(f) `from __future__ import annotations` where types are TYPE_CHECKING-only — CONFIRMED. Present in all 3 graph factories + both weekly-section helpers + audience_delivery; each guards `ReportingConfig`/`Settings` under `if TYPE_CHECKING`. The 4 tool fetchers import `ReportingConfig` at runtime (top-level), which is correct: no circular dependency exists back to `src.tools`, and `McpServerSpec` was already imported from the same module. Acceptable per criterion (f), which only requires future-annotations for annotation-only TYPE_CHECKING usage.

## Edge Cases Scouted

- All non-test callers of the 9 changed fetcher functions pass `config=` — verified by grep across `src/`; no missed call site. `report_graph._fetch_issues` covers all three weekly/daily branches (`get_active_sprint`, `get_sprint_issues`, `get_open_issues` x2), each with `config=config`.
- Weekly+internal compose path (the path that only fails on weekly): `weekly_okr_section(today, config)` and `weekly_resource_section(today, config, settings)` at `report_graph.py:124-125`; slack lines `weekly_okr_slack_line(config)` / `weekly_resource_slack_line(config, settings)` at `:156-157`. Arity proven by `tests/test_weekly_resource_section.py` which monkeypatches with the exact new signatures (`lambda d, config, settings:`) and asserts markers appear — a real behavioral test, not a phantom.
- `get_epic_progress_map` memoization preserved; `config` forwarded into each `get_epic_progress` without altering the dedup-by-key logic.

## Non-Blocking (Known / Accepted C→D Boundary)

- `src/entrypoints/cli.py:60,64,68` and `src/entrypoints/cron.py:48,52,55` call `build_*_graph(cp, audience=...)` / `build_report_graph(cp, report_kind=..., audience=...)` WITHOUT `config`/`settings`. With `deps=None`, these now raise `ValueError(... needs config + settings when deps is not provided)`. This is the documented broken runtime report path until Slice D wires config at the entrypoint. Confirmed this is the ONLY broken runtime path: the hello path (`build_graph`) is untouched.
- No unit test exercises the broken real path: cli report-dispatch tests patch the builder (e.g. `tests/test_resource_report.py:202` `monkeypatch.setattr(rc_graph_mod, "build_resource_graph", lambda cp, audience="internal": _FakeGraph())`); graph tests use the `deps=_fake_deps()` injection path which short-circuits before the `config is None` check. All `default_*_deps` test call sites pass both `config=` and `settings=`.

## Coverage Note (informational, not blocking)

The audience-delivery and okr/resource deps tests inject an explicit `gateway=gw`, so the `ActionGateway(settings, external_channels=config.slack_external_channels)` construction line is NOT directly asserted by any test — its correctness rests on the code-inspection above (b). If Slice D adds an end-to-end factory test, asserting `gw._external_channels == config.slack_external_channels` would lock in invariant (b) against future regressions. Optional hardening, not required for Slice C.

## Metrics

- Full suite: 282 passed.
- Ruff (10 changed src files): clean.
- Residual singleton reads: 0. Stray `cfg`: 0. Missed fetcher call sites: 0.

## Unresolved Questions

None.
