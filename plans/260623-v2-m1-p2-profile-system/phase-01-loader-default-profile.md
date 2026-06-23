# Phase 1 — Loader + `default` profile + .gitignore + PyYAML

> Status: DONE (37433be). Slice 1 of [plan.md](plan.md). Self-contained, commits alone. Delivers
> `src/profile/loader.py`, the committed `profiles/default/` template, the
> `.gitignore` rules, the PyYAML dep, and the byte-identical golden test.

## Context (verified file:line)

- **P1 input contract (consume unchanged):**
  - `build_settings_from_dict(d)` — `src/config/config_builders.py:47-61`. Keys:
    `openrouter_api_key, openrouter_model, openrouter_referer, openrouter_title,
    dry_run, write_disabled, monthly_budget_usd, budget_warn_ratio, data_dir`.
  - `build_reporting_config_from_dict(d)` — `src/config/config_builders_reporting.py:75-107`.
    Top keys + server-env keys built in `_build_servers` (`:26-63`).
  - `_build_servers` reads `atlassian_site_name/_user_email/_api_token`,
    `slack_xoxc_token/_xoxd_token/_team_domain`, and `*_mcp_dist`
    (`config_builders_reporting.py:28-62`). Confluence reuses the Atlassian token
    (`:52`). Slack needs TWO tokens (`:46-47`).
  - Stakeholder-channel guardrail lives in `from_dict` (`config_builders_reporting.py:81-86`)
    — the loader gets it for free.
- **Lazy token validation (the WHEN decision):** `McpServerSpec.validate()` raises
  on missing `required_env_keys` only when called — and it is called at spawn, not
  load (`reporting_config.py:35-50`; module docstring `:9-11` "Validation is lazy").
- **`from_env` shape to reproduce:** `build_settings_from_env`
  (`config_builders.py:64-84`) + `build_reporting_config_from_env`
  (`config_builders_reporting.py:110-144`) list every env var the `default` profile
  must cover. The env-var names there ARE the field list.
- **`.gitignore` today** has `*.env` + `!config.example.env` and `.data/`; NO
  `profiles/` rule (verified). `config.example.env` is the source-of-truth for the
  `default` values — READ + verified at plan time (user-approved): every default in the
  "profile.yaml spec" matches it. Re-confirm field-for-field at impl before commit.
- **PyYAML absent** — `pyproject.toml:6-14` has no yaml dep.
- **Golden-test precedent:** `tests/test_config_builders.py:33-41` (`clean_env`
  fixture monkeypatches both `load_dotenv` symbols) + `:48-62` (defaults asserts).
  Reuse this pattern for the field-equality golden.

## Requirements

1. Parse a `profiles/<id>/` directory: `profile.yaml` (required) + `SOUL.md`,
   `PROJECT.md`, `MEMORY.md` (each optional ⇒ `""` if absent).
2. Map `profile.yaml` → the two P1 dicts per the
   [mapping table in plan.md](plan.md#the-profileyaml--dict-mapping-p2s-load-bearing-contract),
   applying the **env-fallback rule** (req 3a). Call `build_settings_from_dict` /
   `build_reporting_config_from_dict`. No new config validation — P1 owns it.
3. Resolve `OPENROUTER_API_KEY` + the server-env values from `os.environ` at load.
   Missing ⇒ empty string, NEVER raise (lazy validation stays at spawn).
   - **Atlassian (RESOLVED — single shared token, v1 parity):** read
     `os.environ.get(bindings.jira.token_env)` for `atlassian_api_token` (jira is
     authoritative). `bindings.confluence.token_env` set to the SAME name is the
     `default` shape; if a non-default profile sets a DIFFERENT confluence token_env,
     prefer jira's and `warnings.warn(...)` once (P3 multi-agent concern). Read
     `ATLASSIAN_SITE_NAME` / `ATLASSIAN_USER_EMAIL` from env (server-env, not
     per-agent in M1).
   - **Slack (RESOLVED — fixed v1 env names, P3 defers per-agent dual-token):** read
     `os.environ.get("SLACK_XOXC_TOKEN")` → `slack_xoxc_token` and
     `os.environ.get("SLACK_XOXD_TOKEN")` → `slack_xoxd_token` by the FIXED v1 names,
     exactly as `build_reporting_config_from_env` (`config_builders_reporting.py:138-139`).
     Do NOT introduce `token_env_xoxc`/`token_env_xoxd`. A single
     `bindings.slack.token_env` MAY be parsed onto the object but is NOT used to resolve
     Slack tokens in P2 (its dual-token use is P3). `SLACK_TEAM_DOMAIN` from env.
3a. **Env-fallback rule (RESOLVED — keeps `default` == v1 for an existing user).** For
   every mapped field, resolve by **profile.yaml value (set & non-empty) → else env var
   → else omit (P1 from_dict default)**. A missing key OR an empty/blank YAML scalar
   (`""`, `~`, null) is UNSET ⇒ falls through to the env var (the v1 name `from_env`
   reads). An empty committed-template field therefore DEFERS to `.env`, never clobbers
   it. Numeric thresholds where `0` is a valid value (`labor_cost_per_issue`,
   `okr_behind_threshold`, `pr_stale_days`, ratios) are written EXPLICITLY in the
   `default` profile.yaml so the yaml tier wins before the falsy-`0` ambiguity arises —
   the env/omit tiers only matter for the empty-template deployment STRINGS. See the
   per-field table under "profiles/default/profile.yaml spec".
4. Return a single frozen `LoadedProfile` carrying: `settings`, `config`, `soul`,
   `project`, `memory`, `profile_id`, and the parsed-but-unused fields
   (`schedule`, `reports`, `enabled`, `name`) for P3 — annotate them `# consumed in P3`.
5. Ship `profiles/default/` reproducing `config.example.env` (thresholds/safety/budget
   explicit; per-deployment fields empty; 3 md empty).
6. `.gitignore`: commit only `profiles/default/`.

## Files to create

- `src/profile/__init__.py` — export `load_profile`, `LoadedProfile`.
- `src/profile/loader.py` — the loader. Public:
  ```
  @dataclass(frozen=True)
  class LoadedProfile:
      profile_id: str
      name: str
      enabled: bool
      settings: Settings
      config: ReportingConfig
      soul: str        # SOUL.md verbatim ("" if absent)
      project: str     # PROJECT.md verbatim
      memory: str      # MEMORY.md verbatim (A1 memory-injection, read-only)
      schedule: dict[str, str]   # parsed, unused in M1 (P3 worker reads)
      reports: tuple[str, ...]   # parsed, unused in M1

  def load_profile(profile_id: str, *, profiles_dir: Path | None = None) -> LoadedProfile
  ```
  - Default `profiles_dir = REPO_ROOT / "profiles"` (reuse `REPO_ROOT` from
    `src.config.settings`).
  - Raise `FileNotFoundError` if `profiles/<id>/profile.yaml` is missing (a real
    typo in `--profile` should fail loudly — distinct from a missing OPTIONAL `.md`).
  - Read md files with `path.read_text(encoding="utf-8")` if exists else `""`.
- `src/profile/loader_mapping.py` — ONLY IF `loader.py` would exceed 200 LOC: move
  the two `profile.yaml → dict` mapping functions here (`_settings_dict(y)` /
  `_reporting_dict(y, env)`). Keep `loader.py` as the orchestration + `LoadedProfile`.
- `profiles/default/profile.yaml` — see the full spec below ("profiles/default/profile.yaml
  spec"). Thresholds/safety/budget EXPLICIT (reproduce `config.example.env`); per-deployment
  fields EMPTY (template, deferred to `.env` by the env-fallback rule); `token_env` carries
  the v1 env-var NAMES.
- `profiles/default/SOUL.md`, `PROJECT.md`, `MEMORY.md` — empty (a one-line HTML
  comment header is fine; content must not change the prompt → keep them
  whitespace/comment-only so the byte-identical test holds).
- `tests/test_profile_loader.py` — the golden + token + memory + empty-defers-to-env tests.

## `profiles/default/profile.yaml` spec (concrete — verified vs `config.example.env`)

The committed template. Explicit values are the v1 defaults from `config.example.env`
(cross-checked vs from_dict at plan time — they match). Empty values are per-deployment
fields the existing user already has in `.env`; the env-fallback rule (req 3a) fills them.

```yaml
# profiles/default/profile.yaml — the v1-equivalent agent.
# Thresholds/safety/budget are the shipped v1 defaults. Per-deployment fields
# (project_key, repo, channels, space ids, okr_page_id, and the server-env site/email/
# domain) are EMPTY here: for an existing v1 user the loader falls back to .env; for a
# new agent, fill them here (profile value wins over env). token_env holds env-var NAMES.
name: default                 # parsed; consumed in P3 (registry)
enabled: true                 # parsed; consumed in P3 (registry)

model: minimax/minimax-m2.7   # OPENROUTER_MODEL

budget:
  monthly_usd: 50             # MONTHLY_BUDGET_USD
  warn_ratio: 0.8             # BUDGET_WARN_RATIO

safety:
  dry_run: true               # DRY_RUN  (v1 default true; config_builders.py:56)
  write_disabled: false       # AGENT_WRITE_DISABLED

thresholds:                   # all explicit (0/numeric: yaml tier must win)
  pr_stale_days: 7            # PR_STALE_DAYS
  blocker_label_substring: block      # BLOCKER_LABEL_SUBSTRING
  okr_behind_threshold: 0.5   # OKR_BEHIND_THRESHOLD
  resource_overload_ratio: 1.5        # RESOURCE_OVERLOAD_RATIO
  labor_cost_per_issue: 0     # LABOR_COST_PER_ISSUE (0 = labor estimate omitted)

bindings:
  jira:
    project_key: ""           # JIRA_PROJECT_KEY  (empty ⇒ from .env)
    token_env: ATLASSIAN_API_TOKEN
    # mcp_dist: ""            # optional; omit ⇒ JIRA_MCP_DIST env or P1 default
  confluence:
    space_key: ""             # CONFLUENCE_SPACE_KEY
    space_id: ""              # CONFLUENCE_SPACE_ID
    okr_page_id: ""           # OKR_CONFLUENCE_PAGE_ID
    token_env: ATLASSIAN_API_TOKEN   # SAME as jira (one shared Atlassian token)
  github:
    repo: ""                  # GITHUB_REPO  (github auth via `gh`; no token_env)
  slack:
    report_channel: ""        # SLACK_REPORT_CHANNEL
    stakeholder_channel: ""   # SLACK_STAKEHOLDER_CHANNEL (must be in external_channels)
    external_channels: []     # SLACK_EXTERNAL_CHANNELS (comma list → frozenset)
    # Slack dual-token: P2 reads SLACK_XOXC_TOKEN + SLACK_XOXD_TOKEN from the FIXED
    # env names (not from token_env). Listed for template clarity; resolution is P3.
    token_env_xoxc: SLACK_XOXC_TOKEN   # documentary in P2; consumed in P3
    token_env_xoxd: SLACK_XOXD_TOKEN   # documentary in P2; consumed in P3

# Server-env read from FIXED v1 env names by the loader (not per-agent in M1):
#   ATLASSIAN_SITE_NAME, ATLASSIAN_USER_EMAIL, SLACK_TEAM_DOMAIN.

schedule: {}                  # parsed; consumed in P3 (scheduler)
reports: []                   # parsed; consumed in P3 (kind gate)
```

**Per-field resolution (loader → settings/reporting dict):**

| profile.yaml field | tier 1 (yaml if set) | tier 2 (env name) | tier 3 (omit ⇒ from_dict default) |
|---|---|---|---|
| `model` | `minimax/minimax-m2.7` (explicit) | `OPENROUTER_MODEL` | `DEFAULT_MODEL` |
| `budget.monthly_usd` | `50` (explicit) | `MONTHLY_BUDGET_USD` | `50.0` |
| `budget.warn_ratio` | `0.8` (explicit) | `BUDGET_WARN_RATIO` | `0.8` |
| `safety.dry_run` | `true` (explicit) | `DRY_RUN` | `True` |
| `safety.write_disabled` | `false` (explicit) | `AGENT_WRITE_DISABLED` | `False` |
| `thresholds.*` | explicit (incl. `0`) | resp. env | resp. from_dict default |
| `bindings.jira.project_key` | empty ⇒ unset | `JIRA_PROJECT_KEY` | `None` |
| `bindings.github.repo` | empty ⇒ unset | `GITHUB_REPO` | `None` |
| `bindings.slack.report_channel` | empty ⇒ unset | `SLACK_REPORT_CHANNEL` | `None` |
| `bindings.slack.external_channels` | `[]` ⇒ unset | `SLACK_EXTERNAL_CHANNELS` | `frozenset()` |
| `bindings.slack.stakeholder_channel` | empty ⇒ unset | `SLACK_STAKEHOLDER_CHANNEL` | `None` |
| `bindings.confluence.space_key` | empty ⇒ unset | `CONFLUENCE_SPACE_KEY` | `None` |
| `bindings.confluence.space_id` | empty ⇒ unset | `CONFLUENCE_SPACE_ID` | `None` |
| `bindings.confluence.okr_page_id` | empty ⇒ unset | `OKR_CONFLUENCE_PAGE_ID` | `None` |
| `bindings.jira.token_env` → `atlassian_api_token` | name→`os.environ[name]` | — | `""` ⇒ validate() at spawn |
| `atlassian_site_name`/`_user_email` | (not in profile) | `ATLASSIAN_SITE_NAME`/`_USER_EMAIL` | `""` |
| `slack_xoxc_token`/`_xoxd_token` | (fixed env, not token_env in P2) | `SLACK_XOXC_TOKEN`/`SLACK_XOXD_TOKEN` | `""` |
| `slack_team_domain` | (not in profile) | `SLACK_TEAM_DOMAIN` | `""` |

> `0`-is-falsy guard: `labor_cost_per_issue`, `okr_behind_threshold`, `pr_stale_days`,
> and the ratios are written EXPLICITLY above, so the loader passes them as the yaml
> value directly (don't route a numeric `0` through an `or`-chain that would treat it as
> unset). The `or`-chain env-fallback applies only to the empty deployment STRINGS/lists.

## Files to modify

- `.gitignore` — append:
  ```
  # Per-agent profiles: only the `default` template is committed (holds no secrets,
  # only token_env NAMES). Real per-agent profiles stay local.
  profiles/*
  !profiles/default/
  !profiles/default/**
  ```
- `pyproject.toml` — add `"pyyaml>=6.0"` to `dependencies` (run `uv add pyyaml`).

## Implementation steps

1. `uv add pyyaml` → updates `pyproject.toml:6-14` + `uv.lock`.
2. Write `src/profile/loader.py`:
   - `import yaml`; `data = yaml.safe_load(profile_yaml_path.read_text()) or {}` (use
     `safe_load`, never `load`; guard `None` for an empty file).
   - Build the settings dict + reporting dict via the env-fallback rule (req 3a + the
     per-field table): for each mapped field, `yaml_value or os.environ.get(ENV_NAME)`;
     if both falsy, OMIT the key so P1's from_dict applies the v1 default. EXPLICIT
     numeric thresholds from `default` profile.yaml are passed as the yaml value
     directly (no `or`-chain — `0` must not be treated as unset).
   - Resolve env: `os.environ.get("OPENROUTER_API_KEY")` → settings dict
     `openrouter_api_key`. Atlassian token = `os.environ.get(jira_token_env, "")` →
     `atlassian_api_token` (jira authoritative; warn if confluence token_env differs —
     non-default only). Slack tokens = `os.environ.get("SLACK_XOXC_TOKEN","")` /
     `os.environ.get("SLACK_XOXD_TOKEN","")` by FIXED v1 names (NOT token_env in P2).
     `atlassian_site_name`/`atlassian_user_email`/`slack_team_domain` from their fixed
     env names. These mirror `build_reporting_config_from_env` exactly.
   - Call the two P1 builders. Read the 3 md files. Construct `LoadedProfile` (carry
     `name`/`enabled`/`schedule`/`reports` parsed-but-unused, `# consumed in P3`).
3. Write `profiles/default/profile.yaml` per the spec above (thresholds/safety/budget
   explicit; deployment fields empty; token_env NAMES). Already cross-checked vs
   `config.example.env` at plan time — re-verify field-for-field at impl.
4. Write the 3 empty md templates.
5. Edit `.gitignore` + `pyproject.toml`.
6. Write tests (below).

## Tests / validation

`tests/test_profile_loader.py`:

- **Golden (acceptance a):** under a fixed env (set OPENROUTER_API_KEY + the v1
  channel vars consistently, OR clear all like `clean_env`), build
  `load_profile("default")` and `build_settings_from_env()` /
  `build_reporting_config_from_env()`; assert every field equal. Compare
  `dataclasses.asdict` of both Settings; for ReportingConfig compare each field incl.
  `jira_server.env` / `slack_server.env` dicts. Mirror the `clean_env` monkeypatch of
  both `load_dotenv` symbols so the test is deterministic.
- **token_env resolves (acceptance e, happy):** a tmp profile dir with
  `bindings.jira.token_env: TEST_TOK` + `monkeypatch.setenv("TEST_TOK","secret")` ⇒
  `loaded.config.jira_server.env["ATLASSIAN_API_TOKEN"] == "secret"`.
- **missing token → load OK, spawn raises (acceptance e, sad):** same profile,
  `TEST_TOK` unset ⇒ `load_profile(...)` returns (no raise), and
  `loaded.config.jira_server.validate()` raises `RuntimeError` matching the missing
  key.
- **missing optional md ⇒ empty string:** a profile dir with no `SOUL.md` ⇒
  `loaded.soul == ""`.
- **MEMORY.md verbatim (acceptance A1):** a `MEMORY.md` with a known line ⇒ that line
  is `in loaded.memory`.
- **empty-template field DEFERS to env (env-fallback rule):** a tmp profile with
  `bindings.jira.project_key: ""` + `monkeypatch.setenv("JIRA_PROJECT_KEY","SCRUM")` ⇒
  `loaded.config.jira_project_key == "SCRUM"` (the empty yaml scalar did NOT clobber the
  env value). Conversely, `project_key: "FORCED"` + the same env ⇒ `"FORCED"` (yaml tier
  wins). This is the load-bearing test for `default` == v1.
- **numeric `0` threshold survives:** `thresholds.labor_cost_per_issue: 0` ⇒
  `loaded.config.labor_cost_per_issue == 0.0` (the `0` was NOT treated as unset and did
  NOT fall through to a non-zero env/default).
- **missing profile.yaml ⇒ FileNotFoundError:** `load_profile("nope")` raises.
- **stakeholder guardrail still fires via profile:** a profile with
  `stakeholder_channel` not in `external_channels` ⇒ `load_profile` raises
  `RuntimeError` (proves the loader routes through P1's `from_dict` validation).

Shell validation (run at end of slice):
```
uv run pytest tests/test_profile_loader.py -q
git check-ignore profiles/default/profile.yaml   # MUST print nothing (not ignored)
git check-ignore profiles/acme/profile.yaml      # MUST print the path (ignored)
uv run ruff check src/profile tests/test_profile_loader.py
uv run pytest -q   # full suite still green
```

## Acceptance (slice)

- `load_profile("default")` field-equal to `build_*_from_env()` under a fixed env.
- token_env resolves from env; missing token loads fine, raises at `validate()`.
- MEMORY.md read verbatim into `loaded.memory`.
- `profiles/default/` committed, `profiles/<other>/` ignored (git check-ignore).
- `src/profile/loader.py` ≤ 200 LOC (split to `loader_mapping.py` if not).
- ruff clean; full suite green.

## Risks / rollback

- **Risk: `default` template drifts from `config.example.env`** (a missed field). →
  Golden test pins it to `from_env`; field list cross-checked vs `config.example.env`
  at plan time (matches from_dict). The template holds only `token_env` NAMES, no
  secrets.
- **Risk (NEW, M×H): empty deployment field in the committed template clobbers the
  user's `.env`** → `default` ≠ v1. → Env-fallback rule treats an empty/blank yaml
  scalar as UNSET and falls through to env. The empty-template-DEFERS-to-env test pins
  this; the golden test pins `default` == `from_env`.
- **Risk: a numeric `0` threshold (`labor_cost_per_issue`) read via an `or`-chain is
  treated as unset** → wrong value. → `default` profile.yaml writes thresholds
  EXPLICITLY and the loader passes them directly (no `or`-chain for numerics). The
  `0`-survives test pins this.
- **Risk: `yaml.safe_load` returns `None` for an empty file** → guard `data or {}`.
- **Rollback:** delete `src/profile/`, `profiles/default/`, the test; revert the two
  `.gitignore` + `pyproject.toml` lines. Zero impact on v1 (entrypoints untouched
  until Slice 3).
</content>
