---
title: "v2 M1-P1 — Config-injection refactor (kill the config singletons)"
description: "Replace the two @lru_cache config singletons (get_settings / get_reporting_config) with from_dict-core + from_env-wrapper builders, then thread ReportingConfig + Settings as explicit params through 19 caller files. from_env stays byte-identical to v1 (backward-compat anchor); from_dict is the contract P2's profile loader plugs into. BREAKING of the singleton accepted."
status: completed
priority: P1
effort: 11h
branch: main
tags: [v2, m1, p1, config-injection, kill-singletons, dependency-injection, from-dict, breaking]
created: 2026-06-23
completed: 2026-06-23
---

# v2 M1-P1 — Config-injection refactor (kill the config singletons)

v1 config is two `@lru_cache(maxsize=1)` singletons reading a global `.env`:
`get_settings()` (`src/config/settings.py:79`) and `get_reporting_config()`
(`src/config/reporting_config.py:103`). 19 source files call them at 30 invocation
sites. P1 removes the singletons and threads config as an explicit parameter, so a
future P2 can build per-agent config from a `profiles/<id>/profile.yaml` instead of
global env.

The key design call (user-confirmed): provide a **`from_dict` core + `from_env`
wrapper**. `build_settings_from_dict(d)` / `build_reporting_config_from_dict(d)` are
pure (dict in → frozen dataclass out, including the Phase-5 stakeholder-channel
validation). `build_settings_from_env()` / `build_reporting_config_from_env()` are
thin wrappers that `load_dotenv` + read `os.environ` into a dict and call the
`from_dict` core. P2 does `profile.yaml → dict → from_dict`, reusing all validation.

**The `from_dict` dict-shape is a contract P2 depends on** — defined in full in
[The from_dict contract](#the-from_dict-contract-p2-depends-on-this) below and in
[phase-01-config-builders.md](phase-01-config-builders.md).

## Confirmed decisions (do NOT re-litigate)

1. **`from_dict` core + `from_env` wrapper.** `from_dict` is pure (no I/O, no
   `load_dotenv`, no `os.environ`); it holds ALL validation incl. the Phase-5
   stakeholder-channel rule. `from_env` does the `load_dotenv` + `os.environ` read
   into a dict, then delegates to `from_dict`.
2. **`from_env` keeps v1 behavior byte-identical** — same defaults, same env var
   names, same validation, same `data_dir = REPO_ROOT/.data`. An entrypoint that
   calls `build_*_from_env()` once and threads it down produces output identical to
   v1. This is the backward-compat anchor.
3. **Remove the `@lru_cache` singletons entirely.** Acceptance:
   `grep -rn "get_reporting_config\|get_settings" src/` → ZERO hits (the functions
   are deleted, replaced by the from_env/from_dict builders). Callers receive config
   as a parameter.
4. **BREAKING is allowed.** `build_report_graph` / `build_okr_graph` /
   `build_resource_graph` gain `config: ReportingConfig` + `settings: Settings`
   params; `default_*_deps(...)` gain them; tools/actions/stores receive them.
   Test fixtures will be updated (accepted).
5. **Run mode = auto** (continuous low-risk; stop before commit).

## The `from_dict` contract (P2 depends on this)

> **This is the load-bearing deliverable.** P2's `src/profile/loader.py` maps
> `profile.yaml` → these two dicts → `from_dict`. Document is duplicated verbatim
> in phase-01 so the builder author and the P2 author share one source of truth.

**Dict-key shape decision: mirror the env var names, lowercased, flat.** Rationale
(KISS + DRY): the env-var names are already the stable v1 vocabulary; a 1:1
lowercase map means `from_env` is a trivial `{k.lower(): os.getenv(K)...}` pass and
P2's loader has an obvious target. No nested restructuring, no second naming scheme
to keep in sync. A nested shape was rejected as gratuitous indirection (YAGNI).

Every key is **optional**: `from_dict` applies the SAME defaults `from_env` applies
today, so `from_dict({})` == the all-defaults config. Values are already-typed
where natural (a caller may pass `dry_run=True` as a real bool, or `"true"` as a
string — `from_dict` coerces strings via the same `_env_bool`/`_env_float` helpers
so env and profile paths converge).

### `build_settings_from_dict(d: dict) -> Settings`

| dict key | type | default | maps to `Settings` field |
|----------|------|---------|---------------------------|
| `openrouter_api_key` | str \| None | None | `openrouter_api_key` |
| `openrouter_model` | str | `"minimax/minimax-m2.7"` (`DEFAULT_MODEL`) | `openrouter_model` |
| `openrouter_referer` | str | `"https://github.com/local/my-project-manager"` | `openrouter_referer` |
| `openrouter_title` | str | `"my-project-manager"` | `openrouter_title` |
| `dry_run` | bool \| str | `True` | `dry_run` |
| `write_disabled` | bool \| str | `False` | `write_disabled` |
| `monthly_budget_usd` | float \| str | `50.0` | `monthly_budget_usd` |
| `budget_warn_ratio` | float \| str | `0.8` | `budget_warn_ratio` |
| `data_dir` | Path \| str | `REPO_ROOT/.data` | `data_dir` |

> Note: `from_env` reads env var `AGENT_WRITE_DISABLED` into dict key `write_disabled`
> (the only name that is NOT a 1:1 lowercase — documented exception, because the
> dataclass field is `write_disabled`). P2 sets `write_disabled` from
> `profile.yaml safety.write_disabled`. `data_dir` is the per-agent isolation hook
> P3 needs (`.data/agents/<id>/`); P1 leaves it at the v1 default.

### `build_reporting_config_from_dict(d: dict) -> ReportingConfig`

| dict key | type | default | maps to `ReportingConfig` field |
|----------|------|---------|----------------------------------|
| `jira_project_key` | str \| None | None | `jira_project_key` |
| `github_repo` | str \| None | None | `github_repo` |
| `slack_report_channel` | str \| None | None | `slack_report_channel` |
| `slack_external_channels` | str \| Iterable[str] | `""` → `frozenset()` | `slack_external_channels` (frozenset) |
| `slack_stakeholder_channel` | str \| None | None | `slack_stakeholder_channel` |
| `confluence_space_key` | str \| None | None | `confluence_space_key` |
| `confluence_space_id` | str \| None | None | `confluence_space_id` |
| `atlassian_site_name` | str \| None | None | `atlassian_site_name` |
| `pr_stale_days` | int \| str | `7` | `pr_stale_days` |
| `blocker_label_substring` | str | `"block"` | `blocker_label_substring` |
| `okr_confluence_page_id` | str \| None | None | `okr_confluence_page_id` |
| `okr_behind_threshold` | float \| str | `0.5` | `okr_behind_threshold` |
| `resource_overload_ratio` | float \| str | `1.5` | `resource_overload_ratio` |
| `labor_cost_per_issue` | float \| str | `0.0` | `labor_cost_per_issue` |

Server specs (3 `McpServerSpec`) are built from these keys (each a dist-path
override + a server-env block):

| dict key | default | used for |
|----------|---------|----------|
| `jira_mcp_dist` | `~/workspace/jira-cloud-mcp-server/dist/index.js` | `jira_server.dist_path` |
| `slack_mcp_dist` | `~/workspace/slack-browser-mcp-server/dist/index.js` | `slack_server.dist_path` |
| `confluence_mcp_dist` | `~/workspace/confluence-cloud-mcp-server/dist/index.js` | `confluence_server.dist_path` |
| `atlassian_site_name` | `""` | jira + confluence server env (`ATLASSIAN_SITE_NAME` / `CONFLUENCE_SITE_NAME`) |
| `atlassian_user_email` | `""` | jira + confluence server env |
| `atlassian_api_token` | `""` | jira + confluence server env (NOT a `ReportingConfig` top field) |
| `slack_xoxc_token` | `""` | slack server env |
| `slack_xoxd_token` | `""` | slack server env |
| `slack_team_domain` | `""` | slack server env |

> **Validation (moves into `from_dict`):** if `slack_stakeholder_channel` is set and
> NOT in `slack_external_channels`, raise `RuntimeError` (the Phase-5 guardrail —
> currently at `reporting_config.py:145-150`). This MUST live in `from_dict` so BOTH
> env and profile paths enforce it. Unit-tested in Slice A.
>
> **P2 mapping note (for the loader author):** `profile.yaml bindings.slack` maps
> `report_channel`→`slack_report_channel`, `stakeholder_channel`→`slack_stakeholder_channel`,
> `external_channels`→`slack_external_channels`; `bindings.*.token_env` resolves the
> NAMED env var to a value at spawn time and fills the `*_token` keys (P2 concern,
> not P1 — P1's `from_env` reads the tokens directly from env as v1 does).

## Slices (ordered, each independently testable + committable)

All four slices DONE + committed (2026-06-23). Phase COMPLETE — grep-0-hits gate closed; 282 tests pass; ruff clean.

| # | Slice | File | Status | Commit | Depends on |
|---|-------|------|--------|--------|-----------|
| A | Config builders: add `build_settings_from_dict/from_env` + `build_reporting_config_from_dict/from_env` (validation moves into from_dict). KEEP the old singletons (re-expressed as `from_env` wrappers) so nothing breaks yet. Unit-test: from_env == old singleton byte-identical + from_dict defaults + from_dict stakeholder-channel raise. Purely additive + safe. | [phase-01-config-builders.md](phase-01-config-builders.md) | DONE | `031a543` | — |
| B | Thread config through storage (4) + budget/llm (2) + action layer (3). Remove singleton fallbacks; require injected config/settings/path. Update their direct callers + the tests that constructed them. | [phase-02-thread-storage-budget-action.md](phase-02-thread-storage-budget-action.md) | DONE | `8bafe54` | A |
| C | Thread config through graph/section factories (5) + tool fetchers (4): `default_*_deps(config, settings, ...)`, section helpers gain config params, tool fetchers gain `config=`. Build the per-flow `ActionGateway` WITH injected config. | [phase-03-thread-graphs-tools.md](phase-03-thread-graphs-tools.md) | DONE | `8aba547` | A, B |
| D | Entrypoints (cli.py, cron.py) build-from-env-and-inject; DELETE the old `get_settings`/`get_reporting_config` singletons; migrate ALL remaining test fixtures; acceptance grep = 0 hits; full suite green + ruff clean. | [phase-04-entrypoints-delete-singletons.md](phase-04-entrypoints-delete-singletons.md) | DONE | (this commit) | A, B, C |

### Accepted deviation (whole phase)

Acceptance #4 stated "no source file exceeds 200 LOC". Several PRE-EXISTING files
remain over (hard_block 436, action_gateway 331, report_graph 259, cli 241,
confluence_read 217, resource_report_prompt 237, resource_report_graph 206). P1 did
NOT introduce these — they predate the refactor and are established modules. P1 is
plumbing-only (net-neutral LOC); modularizing them is out of P1 scope, deferred.

**Dependency graph: A → B → C → D.** A is purely additive (the builders exist, the
singletons still work as wrappers, nothing else changes — safe to commit alone). B
and C each remove singleton reads from a disjoint set of files and update their
callers/tests; both depend on A's builders existing but are independent of each
other in file ownership EXCEPT the `ActionGateway` construction (C builds the gateway
that B made injectable) — so C must follow B. D is the closing slice: it flips the
entrypoints to inject, deletes the singletons, and is the ONLY slice where the
grep-0-hits gate can pass.

## File ownership (no two slices touch the same source file)

| Slice | Creates | Modifies |
|-------|---------|----------|
| A | `src/config/config_builders.py` (new — the 4 builders, kept <200 LOC), `tests/test_config_builders.py` | `src/config/settings.py` (singleton → `from_env` wrapper), `src/config/reporting_config.py` (singleton → `from_env` wrapper; validation moves to builder) |
| B | — | `src/agent/checkpoint.py`, `src/actions/approval_store.py`, `src/actions/dedup_store.py`, `src/audit/audit_log.py`, `src/llm/budget_tracker.py`, `src/llm/client.py`, `src/actions/confluence_write.py`, `src/actions/slack_write.py`, `src/actions/action_gateway.py`, + tests: `test_budget_tracker.py`, `test_action_gateway.py`, `test_confluence_write.py`, `test_lop_b_and_audit_query.py` |
| C | — | `src/agent/report_graph.py`, `src/agent/okr_report_graph.py`, `src/agent/resource_report_graph.py`, `src/agent/okr_weekly_section.py`, `src/agent/resource_weekly_section.py`, `src/agent/audience_delivery.py`, `src/tools/jira_read.py`, `src/tools/github_read.py`, `src/tools/okr_read.py`, `src/tools/confluence_read.py`, + tests: `test_sprint_and_report_kind.py`, `test_weekly_resource_section.py`, `test_audience_delivery.py`, `test_slack_write_and_report_graph.py`, `test_resource_analyzer.py` |
| D | — | `src/config/settings.py` (DELETE `get_settings`), `src/config/reporting_config.py` (DELETE `get_reporting_config`), `src/actions/action_gateway.py` (DELETE `_load_external_channels`), `src/agent/graph.py` (hello path: thread `settings` into bare `LlmClient()` at `:36`), `src/entrypoints/cli.py`, `src/entrypoints/cron.py`, + tests: `tests/conftest.py` (align `settings_factory` with `from_dict`), `test_graph_and_cli.py`, `test_okr_report.py`, `test_resource_report.py`, `test_audience_prompts.py` |

A and D both touch `settings.py` + `reporting_config.py` — that is **sequential, not
parallel** (A converts the singleton to a wrapper; D deletes the wrapper). No two
slices run in parallel on the same file. (If parallelizing later: A and D on the
config files must serialize; B and C are file-disjoint with each other and could run
in parallel AFTER A, but C constructs the injected gateway from B, so keep B before C.)

## Acceptance criteria (whole phase)

1. **Grep-0-hits gate (TOP).** After Slice D:
   `grep -rn "get_reporting_config\|get_settings" src/` returns ZERO hits. The two
   functions no longer exist anywhere in `src/`. (Builder module names are
   `build_*_from_env` / `build_*_from_dict`, which do not match the grep.)
2. **`from_env` byte-identical to v1.** A unit test (Slice A) constructs
   `build_settings_from_env()` / `build_reporting_config_from_env()` under a fixed
   env and asserts every field equals what the v1 singleton produced (captured as
   golden values in the test, since the singleton is being removed). `cli report
   --daily` output is unchanged vs current v1 (the backward-compat anchor).
3. **`from_dict` is pure + validated.** `build_*_from_dict({})` returns the
   all-defaults dataclass with NO `load_dotenv`/`os.environ` access (test asserts no
   env read — e.g. run under a cleared env and assert defaults still apply). The
   stakeholder-channel-not-in-external case raises `RuntimeError` from `from_dict`
   (test asserts the raise on the dict path, independent of env).
4. **Full suite green.** `uv run pytest` passes (~269 collected / 227 test fns,
   parametrize-expanded). Tests that previously monkeypatched the singletons are
   migrated to inject config (see per-slice test notes). `uv run ruff check src
   tests` clean. No source file exceeds 200 LOC (split if a builder file would).
5. **Graph logic unchanged.** No change to risk analysis, gateway guardrail chain
   (Lớp A/B, audit, budget, dedup), prompt builders, or delivery logic — P1 is
   plumbing only. Verified by: the existing behavioral test files pass UNCHANGED in
   assertions (only their config-injection setup lines change).

## Risks (phase-level; per-slice detail in phase files)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Missed call site → runtime `NameError`/`AttributeError` after singleton deletion (the spread is 19 files / 30 sites) | M×H | Grep-driven, enumerated per slice (every site listed with file:line in phase files). Slice D's grep-0-hits gate is the catch-all; full suite green confirms no live path lost its config. The singletons survive as wrappers through A-C so a partial state never crashes. |
| `from_env` drifts from v1 (a default typo, a missed env var) → silent behavior change | L×H | Slice A golden test pins every field to the captured v1 value BEFORE the singleton is deleted. `from_env` is a literal extraction of the current singleton body into a dict + delegate — diff-reviewable line-for-line. |
| Validation only on one path (env enforces, profile doesn't, or vice versa) → Phase-5 guardrail hole reappears for P2 | L×H | Validation lives ONLY in `from_dict`; `from_env` calls `from_dict`, so it cannot bypass. Test asserts the raise via BOTH `from_dict` directly and `from_env` (setenv a bad combo). |
| `ActionGateway` built inside a deps factory still reads the singleton via `_load_external_channels()` fallback (`action_gateway.py:103-110`) | M×M | Slice C builds every `ActionGateway` with `external_channels=config.slack_external_channels` (and `settings=`) explicitly. Slice D deletes `_load_external_channels` (its only caller is the now-removed default). Test asserts a gateway built from config has the injected channels, no env read. |
| Test fixtures break in non-obvious ways (3 distinct patterns: `setattr(rc,...)`, `cache_clear()+setenv`, `setattr(cli,...)`) | M×M | Each pattern enumerated in the owning slice with the migration target. `cache_clear()` calls MUST be removed (the function is no longer `@lru_cache`). `settings_factory` (conftest) stays but is re-pointed at `from_dict` so it can't drift from the real builder. |
| `reporting_config.py` grows past 200 LOC when builders added | M×L | Builders live in a NEW file `src/config/config_builders.py`; `settings.py`/`reporting_config.py` keep only the dataclass + a thin `from_env` re-export wrapper. LOC checked in each slice. |
| Hidden coupling: `report_graph.py` is already 236 LOC (pre-existing over-gate) | L×L | P1 does NOT restructure it — only swaps the `get_reporting_config()` read for a passed param (net-neutral LOC). Pre-existing over-gate is out of P1 scope (noted; not introduced by this change). |

## Rollback

Each slice reverts by reverting its diffs (and deleting its created file/test).
Because the singletons survive as `from_env` wrappers through slices A-C, reverting
D restores the singletons and the entrypoints to v1; reverting C/B restores the
in-factory singleton reads; reverting A removes the new builders. No migrations, no
schema, no data changes — config is build-time only. A partial state (A+B+C without
D) is fully functional: the singletons still exist (as wrappers) and the factories
that were threaded simply receive config that the entrypoint still derived from the
wrapper. The grep-0-hits gate only closes at D, so D is the point of no easy return —
revert D first if the suite regresses.

## Out of scope (P1)

- Multi-agent CLI / registry / worker / per-agent data dirs (`.data/agents/<id>/`) —
  that is M1-P3/P4. P1 keeps `data_dir = REPO_ROOT/.data` (single-agent) but makes it
  an injectable field so P3 can override it.
- The profile loader (`profiles/<id>/` parsing, `SOUL/PROJECT/MEMORY.md`) — that is
  M1-P2. P1 only delivers the `from_dict` contract P2 consumes.
- Any change to prompt content, risk analysis, or the gateway guardrail chain.
- Resolving the pre-existing 236-LOC `report_graph.py` over-gate.

## Open questions

See the end of [phase-04-entrypoints-delete-singletons.md](phase-04-entrypoints-delete-singletons.md).
