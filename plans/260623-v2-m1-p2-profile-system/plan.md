---
title: "v2 M1-P2 — Profile system (4-file profile dir + persona/project/memory + default profile)"
description: "Parse profiles/<id>/ (profile.yaml + SOUL/PROJECT/MEMORY.md) into P1's from_dict config + 3 context strings, inject persona/project/memory into the prompt seam (empty ⇒ v1 byte-identical), and ship a `default` profile that reproduces v1 exactly. Entrypoints take --profile (default=default). BREAKING of prompt + entrypoint signatures accepted."
status: completed
priority: P2
effort: 9h
branch: main
tags: [v2, m1, p2, profile-system, persona, project-context, memory-injection, yaml-loader, default-profile, breaking]
created: 2026-06-23
completed: 2026-06-24
---

# v2 M1-P2 — Profile system

v1 reads one global `.env`. P2 makes an **agent** a directory `profiles/<id>/` of 4
concern-split files, parses it into P1's config objects + three context strings,
injects persona/project/memory into the prompt seam, and ships a `default` profile
that reproduces v1 byte-for-byte. This is the centerpiece of v2 (see
[profile-design.md](../../docs/v2/profile-design.md) §3); P3 then runs N of these
isolated agents.

P1 already shipped the input contract this plan plugs into:
`build_settings_from_dict(d)` (`src/config/config_builders.py:47`) and
`build_reporting_config_from_dict(d)` (`src/config/config_builders_reporting.py:75`).
**P2's loader produces exactly the dicts those two functions consume** — no new
config validation, no second naming scheme. The dict-key table below is the
load-bearing contract; it is the same vocabulary P1 documented.

## Confirmed decisions (do NOT re-litigate — baked into this plan)

1. **Loader maps `profile.yaml` → the two P1 dicts → `from_dict`.** Reuses every
   default + the Phase-5 stakeholder-channel validation. No new config logic.
2. **`token_env` stores the NAME of an env var**, not the token. The loader resolves
   `os.environ[name]` into the server-env dict keys (`atlassian_api_token`,
   `slack_xoxc_token`, `slack_xoxd_token`). **Resolution failure does NOT fail load**
   — a profile with an unset token must still LOAD so non-spawning flows (audit,
   approvals, prompt-only tests) work. Missing token surfaces lazily at server spawn
   via the existing `McpServerSpec.validate()` (`reporting_config.py:35-50`,
   `required_env_keys`). This matches v1.
3. **`MEMORY.md` read whole-file verbatim** into compose context. No top-K ranking,
   no embedding — KISS for M1 (A1 Memory-injection lands here as a verbatim read;
   ranking + agent-writes are M2-P8, out of scope).
4. **`profiles/` gitignored except `profiles/default/`.** profile.yaml holds only
   `token_env` NAMES (no secrets), so the `default` template is safe to commit. Exact
   lines in [Slice 1](#slices).
5. **Persona/project/memory injection = new string params on `build_*_messages`**
   (default `""`). Empty ⇒ prompt byte-identical to v1. Graph factories thread them
   down. Matches P1's explicit-param injection pattern.
   - **CRITICAL guardrail (Phase-5 lesson):** persona/project text is PREPENDED to
     context but does NOT replace the external PII-sanitization system prompts
     (`REPORT_EXTERNAL_SYSTEM` / `DETAIL_EXTERNAL_SYSTEM`, used at
     `report_prompt.py:84,136`). Those keep sanitization authority. Tested: an
     external report WITH a persona+project naming people/keys still emits zero key/PII.
6. **Entrypoints take `--profile <id>`** (default `"default"` = v1-equivalent).
   `cli.py` + `cron.py` load `profiles/<id>/` and build config from the profile
   instead of calling `build_*_from_env`. Registry / worker / per-agent isolation is
   P3 (out of scope). The `default` profile path produces output identical to v1.
7. **Mode = auto, commit per slice. BREAKING allowed** (entrypoint + prompt
   signatures change). No backward-compat shim required.
8. **New dep: PyYAML** (no yaml dep today — verified `pyproject.toml:6-14`). Added in
   Slice 1 via `uv add pyyaml`.

## The `profile.yaml → dict` mapping (P2's load-bearing contract)

> The loader builds TWO dicts (settings + reporting) whose keys are exactly P1's
> `from_dict` keys (`config_builders.py:47-61`, `config_builders_reporting.py:75-107`),
> then calls `build_settings_from_dict` / `build_reporting_config_from_dict`. Every
> key is optional; an absent profile field ⇒ the loader applies the env-fallback rule
> below (env value, else omit ⇒ P1 from_dict default). The committed `default`
> profile.yaml ships the v1 THRESHOLD/SAFETY/BUDGET values from `config.example.env`
> and ships the per-deployment fields EMPTY (template) — env-fallback fills those for
> an existing v1 user. See [the env-fallback rule](#the-env-fallback-rule-default--v1-for-an-existing-user).

### Verified v1 defaults (from_dict ≡ config.example.env, re-checked at plan time)

`build_settings_from_dict` (`config_builders.py:50-60`) and
`build_reporting_config_from_dict` (`config_builders_reporting.py:99-104`) hard-code
these defaults, IDENTICAL to `config.example.env`:
`model=minimax/minimax-m2.7` (`DEFAULT_MODEL`), `referer=https://github.com/local/my-project-manager`,
`title=my-project-manager`, `dry_run=true`, `write_disabled=false`, `monthly_usd=50`,
`warn_ratio=0.8`, `pr_stale_days=7`, `blocker_label_substring=block`,
`okr_behind_threshold=0.5`, `resource_overload_ratio=1.5`, `labor_cost_per_issue=0`.
The committed `profiles/default/profile.yaml` writes these EXPLICITLY (so the template
is self-documenting and survives a future from_dict default change), even though they
equal the from_dict default today.

### `profile.yaml` → **settings dict** (`build_settings_from_dict`)

| profile.yaml path | settings dict key | notes |
|---|---|---|
| `model` | `openrouter_model` | per-agent model override |
| `budget.monthly_usd` | `monthly_budget_usd` | |
| `budget.warn_ratio` | `budget_warn_ratio` | |
| `safety.dry_run` | `dry_run` | |
| `safety.write_disabled` | `write_disabled` | NOTE: P1's non-1:1 name (`config_builders.py:79`) |
| — (not in profile) | `openrouter_api_key` | resolved from env (`OPENROUTER_API_KEY`) at load (see token note) |
| — (not in profile) | `openrouter_referer`/`openrouter_title` | NOT per-agent in M1. Loader applies env-fallback: env (`OPENROUTER_REFERER`/`OPENROUTER_TITLE`) else from_dict default — which already equals `config.example.env` (`https://github.com/local/my-project-manager` / `my-project-manager`). `default` profile.yaml omits them; v1 parity holds either way. |
| — (P3 concern) | `data_dir` | M1 leaves at P1 default (`DATA_DIR`); P3 sets `.data/agents/<id>/` |

### `profile.yaml` → **reporting dict** (`build_reporting_config_from_dict`)

| profile.yaml path | reporting dict key | notes |
|---|---|---|
| `bindings.jira.project_key` | `jira_project_key` | |
| `bindings.jira.mcp_dist` | `jira_mcp_dist` | optional; P1 default if absent |
| `bindings.github.repo` | `github_repo` | `owner/repo` |
| `bindings.slack.report_channel` | `slack_report_channel` | |
| `bindings.slack.stakeholder_channel` | `slack_stakeholder_channel` | MUST be in external set (P1 guardrail) |
| `bindings.slack.external_channels` | `slack_external_channels` | list → P1 coerces to frozenset |
| `bindings.slack.mcp_dist` | `slack_mcp_dist` | optional |
| `bindings.confluence.space_key` | `confluence_space_key` | |
| `bindings.confluence.space_id` | `confluence_space_id` | |
| `bindings.confluence.mcp_dist` | `confluence_mcp_dist` | optional |
| `bindings.confluence.okr_page_id` | `okr_confluence_page_id` | |
| `thresholds.pr_stale_days` | `pr_stale_days` | |
| `thresholds.blocker_label_substring` | `blocker_label_substring` | |
| `thresholds.okr_behind_threshold` | `okr_behind_threshold` | |
| `thresholds.resource_overload_ratio` | `resource_overload_ratio` | |
| `thresholds.labor_cost_per_issue` | `labor_cost_per_issue` | |
| (server env — see token note) | `atlassian_site_name` | also a top reporting field |
| (server env) | `atlassian_user_email` | from env, not profile |
| (server env, resolved from token_env) | `atlassian_api_token` | from `os.environ[bindings.jira.token_env]` |
| (server env, resolved from token_env) | `slack_xoxc_token` | from `os.environ[bindings.slack.token_env]` (see token note) |
| (server env, resolved from token_env) | `slack_xoxd_token` | see token-resolution note |
| (server env) | `slack_team_domain` | from env |

### token_env resolution (the one non-obvious rule)

`bindings.*.token_env` is the **name** of an env var. The loader does
`os.environ.get(name, "")` and writes the value into the server-env dict keys above,
then `from_dict` builds the `McpServerSpec.env` (`config_builders_reporting.py:26-63`).

- **Atlassian = ONE shared token for jira + confluence (RESOLVED — v1 parity).**
  `_build_servers` builds the Confluence env (`CONFLUENCE_*`) from the SAME `token`,
  `site`, `email` it built the Jira env from (`config_builders_reporting.py:28-30,52-58`
  — "Confluence reuses the same Atlassian credential"). For P2 the `default` profile
  sets `bindings.jira.token_env: ATLASSIAN_API_TOKEN` and
  `bindings.confluence.token_env: ATLASSIAN_API_TOKEN` (same name) — both resolve to the
  ONE `atlassian_api_token` dict key. The loader reads jira's `token_env` as the
  authoritative source for `atlassian_api_token`. If a NON-default profile ever sets
  jira's and confluence's `token_env` to DIFFERENT names, prefer jira's and emit a
  one-line warning — but that is effectively a P3 multi-agent concern; P2 = single
  shared Atlassian token, exactly v1.
- **Slack = read the two v1 env vars directly for `default` (RESOLVED — P3 defers the
  per-agent dual-token convention).** Slack needs TWO tokens (`SLACK_XOXC_TOKEN` +
  `SLACK_XOXD_TOKEN`, `config_builders_reporting.py:46-47`). For P2 the loader's Slack
  server-env mapping reuses the v1 env-var read for the `default` profile: it reads
  `os.environ["SLACK_XOXC_TOKEN"]` → `slack_xoxc_token` and
  `os.environ["SLACK_XOXD_TOKEN"]` → `slack_xoxd_token` by the FIXED env names, exactly
  as `build_reporting_config_from_env` does (`config_builders_reporting.py:138-139`).
  Do NOT introduce `token_env_xoxc` / `token_env_xoxd` in P2. A per-agent single
  `bindings.slack.token_env` name MAY be parsed onto the profile object, but the
  dual-token RESOLUTION for non-default agents is a **P3** concern (deferred). The
  committed `default` profile.yaml documents both names under `bindings.slack` for
  template clarity, but the loader resolves Slack tokens from the fixed v1 env names.
- A `token_env` whose env var is unset ⇒ empty string in `env` ⇒ `validate()` raises
  at spawn (`reporting_config.py:45-50`), NOT at load. This is the v1 behavior.
- `openrouter_api_key`: resolved from `os.environ["OPENROUTER_API_KEY"]` at load
  (it is not in profile.yaml; same as v1).

## The env-fallback rule (`default` == v1 for an existing user)

The committed `profiles/default/profile.yaml` ships the per-deployment fields EMPTY
(template — `project_key`, `repo`, `report_channel`, `external_channels`,
`stakeholder_channel`, `space_key`, `space_id`, `okr_page_id`, plus the server-env
`atlassian_site_name`/`atlassian_user_email`/`atlassian_api_token`,
`slack_team_domain`), mirroring `config.example.env` which ships them empty. But the
existing v1 user's real values live in their `.env`. To keep "**`default` profile ==
v1**" TRUE for that user, the loader resolves each mapped field by a **three-tier
precedence**:

> **profile.yaml value (if set & non-empty) → else env var → else P1 from_dict default.**

- "set & non-empty" means the YAML key is present AND its scalar is a non-blank string
  (or a non-empty list, for `external_channels`). A **missing key OR an empty/blank
  scalar (`""`, `~`, null) is treated as UNSET** and falls through to env. This is the
  load-bearing detail: the committed template's empty deployment fields must NOT clobber
  the user's `.env` values — an explicit empty scalar means "defer to env", not "force
  empty".
- For each reporting field, the loader reads the SAME env var `from_env` reads (table
  above maps profile path → dict key; the env var is the v1 name from
  `build_reporting_config_from_env`, `config_builders_reporting.py:120-140`). For
  settings likewise (`config_builders.py:73-83`).
- The server-env values (`atlassian_*`, `slack_team_domain`, and the two slack tokens)
  are NOT per-agent in M1 — the loader reads them from the fixed v1 env names directly
  (they are not profile.yaml deployment fields the user is expected to fill in P2). This
  keeps `default` == v1 byte-for-byte and is what the golden test pins.

**Net effect for the existing user:** `default` profile.yaml (thresholds explicit,
deployment fields empty) + their unchanged `.env` ⇒ a `LoadedProfile` whose `settings`
and `config` are field-equal to `build_*_from_env()`. The golden test (acceptance a)
pins this. For a NEW per-agent profile (P3), the user fills the deployment fields IN the
profile.yaml and they win over env — the same rule, no special case.

**Implementation note:** the cleanest expression is — loader builds each dict entry as
`yaml_value or os.environ.get(ENV_NAME) or <omit>`; omitting the key lets P1's from_dict
apply the hard-coded v1 default. Because Python truthiness treats `""`/`None`/`[]` as
falsy, a single `or` chain implements the three-tier rule directly. (Guard the
`labor_cost_per_issue=0` / `okr_behind_threshold` NUMERIC fields: `0` is falsy — for
those, the `default` profile.yaml writes the value EXPLICITLY so the yaml tier wins
before truthiness matters; the env/default tiers only matter for the empty-template
deployment STRINGS. See [phase-01](phase-01-loader-default-profile.md) for the per-field
resolution.)

## Slices (ordered, each independently testable + committable)

All 3 slices DONE + committed (2026-06-24). Phase COMPLETE — 317 tests pass, ruff clean,
`default` profile golden-equal to v1, external-PII guardrail strengthened, E2E verified.

| # | Slice | Phase file | Status | Commit | Depends on |
|---|-------|-----------|--------|--------|-----------|
| 1 | **Loader + `default` profile + .gitignore + PyYAML.** New `src/profile/loader.py` (+ `loader_mapping.py`): parse `profiles/<id>/`, build the two dicts via the env-fallback rule, resolve `token_env`/`OPENROUTER_API_KEY` from env, call P1 `from_dict`; read SOUL/PROJECT/MEMORY.md verbatim. Ship `profiles/default/` reproducing v1 (3 md empty). `.gitignore` commits only `default`. **Golden test: `default` config field-equal to `build_*_from_env()`.** | [phase-01-loader-default-profile.md](phase-01-loader-default-profile.md) | DONE | `37433be` | P1 (done) |
| 2 | **Context injection.** Persona/project/memory params on every `build_*_messages` (default `""` ⇒ byte-identical), threaded through the 3 graph factories via a new `ProfileContext`. New `src/profile/context.py`. External path takes NOTHING from the profile (persona dropped from system, project/memory from user — strengthened after review). | [phase-02-context-injection.md](phase-02-context-injection.md) | DONE | `0b4f3a2` | 1 |
| 3 | **Entrypoints take `--profile`.** `cli.py`/`cron.py` load `profiles/<id>/` (default `default`) instead of `build_*_from_env`; pass config + `ProfileContext` to the graphs. Bad id / misconfigured profile ⇒ clean error, non-zero exit (no traceback) — preserves the Slice-D audit-tolerance. Loader `load_dotenv`s `.env` (bug fix found via smoke). **Anchor: `cli report --daily` via `default` == v1.** | [phase-03-entrypoints-profile-flag.md](phase-03-entrypoints-profile-flag.md) | DONE | `dd04271` | 1, 2 |

### Accepted deviations (whole phase)

- **External-PII rule TIGHTENED vs the original plan** (Slice 2 review): the external path now takes NOTHING from the profile (persona AND project/memory dropped), not "persona prepends both audiences". A hostile SOUL.md cannot reach a stakeholder report. See phase-02.
- **Pre-existing >200-LOC files** (`cli.py` 278, `resource_report_prompt.py` 250, `resource_report_graph.py`) — P2 added only a few param lines; not introduced by P2 (P1 precedent), modularization deferred.

**Dependency graph: 1 → 2 → 3.** Slice 1 is self-contained (loader + template +
test) and commits alone. Slice 2 changes prompt + graph signatures (file-disjoint
from Slice 1's `src/profile/loader.py`, but adds `src/profile/context.py`). Slice 3
wires the entrypoints to call both. Slice 1 and 2 share the `src/profile/` package
dir but own different files inside it — no file collision.

## File ownership (no two slices touch the same source file)

| Slice | Creates | Modifies |
|-------|---------|----------|
| 1 | `src/profile/__init__.py`, `src/profile/loader.py`, `src/profile/loader_mapping.py` (if loader >200 LOC), `profiles/default/profile.yaml`, `profiles/default/SOUL.md`, `profiles/default/PROJECT.md`, `profiles/default/MEMORY.md`, `tests/test_profile_loader.py` | `.gitignore` (add profiles rules), `pyproject.toml` (add pyyaml dep) |
| 2 | `src/profile/context.py`, `tests/test_profile_context.py` | `src/llm/report_prompt.py`, `src/llm/okr_report_prompt.py`, `src/llm/resource_report_prompt.py`, `src/agent/report_graph.py`, `src/agent/okr_report_graph.py`, `src/agent/resource_report_graph.py`, `tests/test_audience_prompts.py` (add persona+project guardrail case) |
| 3 | `tests/test_profile_entrypoints.py` | `src/entrypoints/cli.py`, `src/entrypoints/cron.py`, `tests/test_graph_and_cli.py` (align CLI tests with `--profile`) |

No source file appears in two "Modifies" rows. `src/profile/` is created across slices
1 and 2 but each owns distinct files. `audience_external_prompts.py` is **NOT modified**
— the external system prompts stay authoritative (the guardrail). `config_builders*.py`
are **NOT modified** — P2 consumes them unchanged.

## Acceptance criteria (whole phase)

1. **(a) default = byte-identical v1 config (golden, like P1 Slice A).** Load
   `profiles/default/` with empty `.md` files under a fixed env ⇒ every `Settings`
   and `ReportingConfig` field equals `build_settings_from_env()` /
   `build_reporting_config_from_env()` under the same env. (Slice 1.)
2. **(b) SOUL.md changes the prompt.** A `default`-like profile with a non-empty
   `SOUL.md` carrying a custom rule ⇒ the composed system prompt CONTAINS that rule
   string (assert presence). Empty `SOUL.md` ⇒ system prompt byte-identical to v1.
   (Slice 2.)
3. **(c) PROJECT.md enters analyze/compose context.** A `PROJECT.md` convention
   string ⇒ appears in the user-message context of the compose call. (Slice 2.)
4. **(d) external report with persona+project ⇒ zero key/PII.** Build the external
   report messages WITH a persona + project that name people/issue-keys ⇒ the blob
   contains no issue key, PR number, or person name; `stakeholder` register intact.
   (Slice 2 — extends `test_audience_prompts.py:56-79`.)
5. **(e) token_env resolves from env; missing token errors at spawn not load.**
   `bindings.jira.token_env: SOME_NAME` with `SOME_NAME` set ⇒ value lands in
   `config.jira_server.env["ATLASSIAN_API_TOKEN"]`. With `SOME_NAME` unset ⇒ load
   SUCCEEDS (config built), and `config.jira_server.validate()` raises (spawn-time).
   (Slice 1.)
6. **(f) full suite green + ruff clean.** `uv run pytest` passes (existing ~282 +
   the new profile tests); `uv run ruff check src tests` clean (line-length 100).
7. **(g) all source <200 LOC.** Every new/modified `src/` file ≤ 200 LOC (split
   loader into `loader.py` + `loader_mapping.py` if needed). Pre-existing over-gate
   files (`report_graph.py` 259, `resource_report_prompt.py` 237,
   `resource_report_graph.py` 206) are NOT introduced by P2; the persona/project/
   memory params add a handful of lines each — keep them under or note the deviation
   per P1's precedent.
8. **A1 Memory-injection lands here.** Loader reads `MEMORY.md` verbatim → injected
   into compose context as a string (no ranking). Tested: a `MEMORY.md` line appears
   in the compose user-message blob; empty `MEMORY.md` ⇒ no change.

## Risks (phase-level; per-slice detail in phase files)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Persona/project text defeats external PII sanitization → key/PII leak to stakeholder | M×H | External system prompts (`audience_external_prompts.py`) are NOT modified and stay the system message; persona prepends to the USER message only, never replaces the system prompt. Guardrail test (acceptance d) asserts zero leak with a hostile persona. Slice 2 owns this. |
| Loader drifts from v1 config (a missed field, a wrong default) → silent behavior change | L×H | Golden test (acceptance a) pins every field of the `default` build to `from_env` under one env. Loader builds dicts whose keys are P1's documented keys; no second default scheme. `config.example.env` READ + cross-checked at plan time (every `default` value matches); re-verify the field list before commit. |
| token_env resolved at load → a profile with an unset token can't even load, breaking audit/approvals | L×M | Loader resolves to `""` on miss and NEVER raises; validation deferred to `McpServerSpec.validate()` at spawn (acceptance e). Mirrors v1's lazy validation (`reporting_config.py` module docstring). |
| Slack dual-token (xoxc+xoxd) can't be named by one `token_env` | M×M | RESOLVED: `default` reads the two FIXED v1 env vars directly (`SLACK_XOXC_TOKEN`/`SLACK_XOXD_TOKEN`); per-agent dual-token convention deferred to P3. Does not block the default path or acceptance. |
| Empty deployment field in committed `default` profile.yaml clobbers the user's `.env` value → `default` ≠ v1 | M×H | Env-fallback rule: an empty/blank YAML scalar is treated as UNSET and falls through to the env var (then the from_dict default). The committed template's empty deployment fields therefore DEFER to `.env`, not overwrite it. Golden test (acceptance a) pins `default` == `from_env` under a fixed env, catching any field where the fallback drops a value. NEW concern introduced by the fallback — see [phase-01](phase-01-loader-default-profile.md) per-field resolution + the `0`-is-falsy guard for numeric thresholds. |
| Prompt-signature change misses a `build_*_messages` caller → `TypeError` at runtime | M×M | New params default `""`, so unthreaded callers keep working (no TypeError). Slice 2 enumerates all 3 graph factory call sites (`report_graph.py:109`, `okr_report_graph.py:99`, `resource_report_graph.py:102`) + the 2 narrative/fallback paths; full suite green confirms. |
| `profiles/default/` accidentally gitignored, or real profiles committed | L×M | Exact `.gitignore` lines specified (`profiles/*` + `!profiles/default/` + `!profiles/default/**`); Slice 1 verifies with `git check-ignore profiles/default/profile.yaml` (must NOT be ignored) and `git check-ignore profiles/acme/profile.yaml` (must be ignored). |
| `schedule`/`reports`/`enabled` fields parsed but unused in P2 → dead config or false expectation | L×L | RESOLVED: P2 PARSES + shape-validates only; M1 entrypoints IGNORE them. Consumption is P3 (schedule→P3 scheduler, enabled→P3 registry, reports→P3 gate). The CLI report flags are NOT gated on `profile.reports` in P2. Fields stay on `LoadedProfile` as parsed-but-unused with a one-line "consumed in P3" comment. Stated in Out-of-scope. |

## Rollback

Each slice reverts by reverting its diffs + deleting its created files. Slice 1 is
purely additive (new package + template + test + 2 config-file edits) — reverting it
removes `src/profile/` and `profiles/default/` with zero impact on v1 (entrypoints
still call `build_*_from_env`). Slice 2's prompt params default `""`, so reverting it
restores byte-identical prompts. Slice 3 is the only slice that re-points the
entrypoints; reverting it restores `build_*_from_env()` in `cli.py`/`cron.py`. No
migrations, no schema, no data changes — profile parsing is build-time only. A partial
state (1+2 without 3) is fully functional: the loader + context exist but the
entrypoints still use `from_env`, so v1 behavior is unchanged.

## Out of scope (P2)

- Registry, worker, per-agent data dirs (`.data/agents/<id>/`), per-agent gateway/
  budget/audit isolation — that is M1-P3. P2 leaves `data_dir` at the P1 default.
- Multi-agent CLI (`mpm agent list/register/run`) — M1-P4.
- Agent-WRITTEN memory (MEMORY.md append via Store) + top-K memory ranking — M2-P8.
  P2 reads MEMORY.md verbatim, read-only.
- Consumption of `schedule` / `reports` / `enabled` — parsed + shape-validated in P2,
  consumed in P3 (schedule→scheduler, enabled→registry, reports→kind gate). M1
  entrypoints ignore them; the CLI report flags are NOT gated on `profile.reports`.
- Per-agent secret store — tokens stay in env (`token_env` names only in profile).
- Any change to risk analysis, the gateway guardrail chain, or `config_builders*.py`.

## Open questions

**None.** The 4 prior open questions are RESOLVED and baked into this plan:

1. **Slack dual-token** → `default` reads the two FIXED v1 env vars
   (`SLACK_XOXC_TOKEN` + `SLACK_XOXD_TOKEN`) directly; no `token_env_xoxc/_xoxd` in P2;
   per-agent dual-token resolution deferred to P3. (token note + Slice 1.)
2. **`schedule`/`reports`/`enabled`** → parsed + shape-validated only; M1 entrypoints
   ignore them; CLI flags NOT gated on `profile.reports`; consumed in P3. (risk row +
   Out-of-scope.)
3. **Atlassian token mismatch** → `default` uses ONE Atlassian token
   (`ATLASSIAN_API_TOKEN`) for both jira + confluence, exactly v1; per-service
   different-token handling (prefer jira + warn) is a P3 concern. (token note.)
4. **`config.example.env` defaults** → read (user-approved), verified against the
   from_dict defaults, and baked into the `profiles/default/profile.yaml` spec in
   [phase-01](phase-01-loader-default-profile.md). The env-fallback rule (above) makes
   `default` == v1 for an existing user whose deployment values are in `.env`.
</content>
</invoke>
