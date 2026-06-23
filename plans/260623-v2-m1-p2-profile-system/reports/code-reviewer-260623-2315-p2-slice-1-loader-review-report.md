# Code Review — v2 M1-P2 Profile System, Slice 1 (loader + default profile)

Reviewer: code-reviewer | Date: 2026-06-23 | Verdict: DONE_WITH_CONCERNS

## Scope
- Files reviewed: `src/profile/__init__.py` (5 LOC), `src/profile/loader.py` (101), `src/profile/loader_mapping.py` (196), `tests/test_profile_loader.py` (140), `profiles/default/{profile.yaml,SOUL.md,PROJECT.md,MEMORY.md}`, `.gitignore`, `pyproject.toml`, `uv.lock`.
- Cross-checked against P1 builders: `src/config/config_builders.py`, `config_builders_reporting.py`, `config_builders_helpers.py`.
- Gates: ruff clean; full suite **292 passed** (0.60s); profile suite 10/10.
- LOC gate: all source <200 (`loader_mapping.py` = 196, confirmed ≤200, not borderline-miscounted).

## Overall Assessment
Solid, well-scoped slice. The env-fallback contract, the 0-is-falsy trap, lazy token resolution, and reuse of P1 `from_dict` validation are all implemented correctly and proven by tests. The golden test is genuinely complete (not partial) and its env is properly cleared. One real behavioral divergence from v1 exists (empty-string `DRY_RUN`), plus minor notes. No blockers.

## Verification of Key Design Claims (all PASS unless noted)

1. **env-fallback rule (`_fallback`/`_put`)** — Correct. Empty/blank YAML scalar (`""`, `~`, null, `[]`) is falsy → defers to env → omits key when both empty so P1 default applies. Proven: `test_empty_field_defers_to_env`, `test_yaml_value_wins_over_env`. Programmatically confirmed every key in BOTH `from_env` dicts is emittable by the loader and the loader emits no extra keys (no forgotten field, no stray key).

2. **0-is-falsy trap (`_explicit`/`_explicit_bool`)** — Correct. Every numeric/bool field (`labor_cost_per_issue`, `okr_behind_threshold`, `pr_stale_days`, `resource_overload_ratio`, `dry_run`, `write_disabled`, `monthly_budget_usd`, `budget_warn_ratio`) routes through key-presence checks, NOT `_fallback`. A real `0` survives: verified `labor=0` (yaml) beats env `99` → 0.0. `test_numeric_zero_threshold_survives` genuinely exercises the trap (env set to 99, yaml 0, asserts 0.0).

3. **Lazy token resolution** — Correct. Missing token loads without raising (returns `""`); `McpServerSpec.validate()` raises at spawn. Atlassian = one shared token (jira authoritative; confluence reuses; warns on differing `confluence.token_env` — verified the warning fires AND confluence still gets jira's token). Slack reads fixed env names. `yaml.safe_load` used (loader.py:76), not `load`.

4. **Reuses P1 from_dict unchanged** — Correct. Stakeholder-channel guardrail fires through the loader via `build_reporting_config_from_dict` with no duplication/weakening. Proven: `test_stakeholder_guardrail_fires_through_loader`.

5. **Security / secrets** — Clean. `profiles/default/` contains only token_env NAMES (`ATLASSIAN_API_TOKEN`), no token values; scanned all 4 default files + 3 `.md` for secret patterns — none. `.gitignore` re-confirmed via `git check-ignore`: `profiles/default/*` NOT ignored, `profiles/acme/` IS ignored. Correct.

## Acceptance Confirmation
- **(a) default == from_env**: PASS, and the comparison is COMPLETE. `dc.asdict(Settings)` covers all fields; `ReportingConfig.__eq__` (frozen, eq=True) compares all 17 fields including the 3 nested `McpServerSpec` objects, and `McpServerSpec.env` has `compare=True` — so server.env dicts ARE compared. The `clean_env` fixture clears all 31 builder-read env vars AND monkeypatches `load_dotenv` to no-op in both builder modules, so the live `.env` (present, dated Jun 22) cannot mask a forgotten field. Golden test is real.
- **(e) token_env**: PASS — resolves; missing loads, raises at `validate()`. Both tests present and pass.
- **(g) LOC <200**: PASS — loader_mapping 196.

---

## Findings

### High Priority

**H1 — `dry_run` diverges from v1 when `DRY_RUN` is set to an empty string.** `loader_mapping.py:170-174` (`_explicit_bool`).
- `_explicit_bool` does `os.environ.get(env_name) or None`. An env var set to `""` (e.g. a literal `DRY_RUN=` line in `.env`) becomes `None` → key omitted → P1 default `dry_run=True`.
- v1 `from_env` passes `os.getenv("DRY_RUN")` = `""` straight to `from_dict`, where `_d_bool("")` → **False**.
- Result: with `DRY_RUN=` in env, **loader yields `dry_run=True`, v1 yields `dry_run=False`**. Reproduced empirically.
- Direction is **safety-positive** (loader is more conservative: dry_run=True blocks writes), so this is not a guardrail breach — it is a contract divergence from the stated "default == v1" invariant for one input. `write_disabled=""` and numeric `""` cases happen to converge (their default equals the empty-string coercion), so `dry_run` is the only field affected.
- Not caught by the golden test because `clean_env` deletes the var rather than setting it to `""`.
- Recommendation: either (a) document that empty-string env is treated as unset by the loader (acceptable, even preferable for a safety bool), or (b) if exact v1 parity on empty-string is required, have `_explicit_bool`/`_explicit` distinguish "key present but empty" from "key absent" for env too. Given the safe direction, (a) + a one-line test asserting the conservative behavior is the pragmatic call. Flagging for an explicit decision, not a silent ship.

### Medium Priority

**M1 — `name`/`enabled` shape not validated; truthiness coercion is lossy.** `loader.py:92-93`.
- `name=str(yaml_doc.get("name") or profile_id)` — a YAML `name: 0` or `name: false` or `name: ""` silently falls back to `profile_id` rather than erroring or honoring the value. Minor; these are P3-consumed and unused in M1, but worth a note since the coercion hides malformed input.
- `enabled=bool(yaml_doc.get("enabled", True))` — `enabled: "false"` (string) coerces to `True` (non-empty string is truthy). If P3 reads this for a kill-switch, a stringly-typed `"false"` would silently enable. Consider reusing `_d_bool` semantics when `enabled` becomes load-bearing in P3.

**M2 — `schedule`/`reports` value coercion is silent on wrong types.** `loader.py:85-100`. A `reports:` that is a YAML mapping (not a list) silently becomes `()`; a `schedule:` list silently becomes `{}`. Fine for M1 (unused), but P3 should validate shape rather than swallow. Note only.

### Low Priority

**L1 — `import warnings` inside `_resolve_atlassian_token`** (`loader_mapping.py:187`). Function-local import is unusual for stdlib; move to module top for consistency. Cosmetic; ruff is clean either way.

**L2 — `profile.yaml` documents `token_env_xoxc`/`token_env_xoxd` keys that the loader ignores** (`profile.yaml:46-47`). Comments say "documentary in P2; consumed in P3", which is honest, but an unwary editor could believe changing them affects Slack auth now. The inline comment mitigates this. Note only.

## Edge Cases Scouted (all handled correctly)
- Non-dict binding subsection (`jira: just-a-string`) → `_section` returns `{}`, degrades to env/default, no crash.
- Top-level non-mapping YAML (list) → clear `RuntimeError` ("must be a mapping").
- Empty/whitespace YAML → `or {}` guard → all defaults.
- Numeric value arriving as string from env → coerced by `_d_int`/`_d_float` in from_dict (e.g. `LABOR_COST_PER_ISSUE=99` → 99.0).
- Differing confluence `token_env` → warns once, confluence still uses jira's token.
- `dry_run: false` present → False (present key wins); absent safety + no env → True (default); absent safety + `DRY_RUN=false` env → False. All correct.

## Recommended Actions
1. Decide H1: document loader's conservative empty-string handling for `dry_run` (recommended) OR restore exact v1 parity. Add a test pinning whichever behavior is chosen.
2. (P3 follow-up) Tighten `enabled`/`name`/`schedule`/`reports` coercion before they become load-bearing (M1/M2).
3. (Optional) L1 import placement.

## Metrics
- Type coverage: full (`from __future__ annotations`, typed signatures throughout).
- Test coverage: 10 new tests, all green; golden test proven complete.
- Linting: 0 issues (ruff clean).

## Unresolved Questions
- H1: Is exact v1 parity required for an empty-string `DRY_RUN=` env value, or is the loader's safer `dry_run=True` acceptable (and should it be documented as intentional)? Needs an owner decision.

Status: DONE_WITH_CONCERNS
Summary: Slice 1 loader is correct, secure, and well-tested (292 green, ruff clean, golden test genuinely complete); one safety-positive but real divergence from v1 on empty-string DRY_RUN env, plus minor P3-scoped coercion notes.
Concerns/Blockers: H1 dry_run vs v1 on empty-string env — `src/profile/loader_mapping.py:170` (_explicit_bool). Non-blocking, needs a documented decision.
