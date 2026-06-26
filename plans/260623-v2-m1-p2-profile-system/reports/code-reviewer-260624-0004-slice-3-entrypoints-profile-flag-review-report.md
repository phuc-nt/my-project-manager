# Code Review — Slice 3: Entrypoints take `--profile` (v2 M1-P2)

Date: 2026-06-24
Reviewer: code-reviewer
Scope: uncommitted working-tree changes (Slice 3, closing slice)

## Scope

- Files (modified): `src/entrypoints/cli.py`, `src/entrypoints/cron.py`, `src/profile/loader.py`,
  `tests/test_graph_and_cli.py`, `tests/test_okr_report.py`, `tests/test_profile_loader.py`,
  `tests/test_resource_report.py`, `tests/test_sprint_and_report_kind.py`
- Files (new): `tests/test_profile_entrypoints.py`
- Diff size: ~126 insertions / 46 deletions across 8 tracked files
- Focus: recent/specific (the Slice 3 diff)

## Overall Assessment

Clean, scoped, and correct. The rewire to a single profile-based config source is faithful to the
phase plan; the `FileNotFoundError`-only catch is appropriately narrow; the `load_dotenv` bug fix is
correct (`override=False`, all no-key tests block it). Full suite 315 passed in 0.50s, ruff clean.

One real but **untested** behavior regression (Slice-D audit-tolerance) is surfaced below as a
judgment call (acceptance #5). It is the only substantive finding; everything else is verified-pass.

## Acceptance Verification

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | v1-equivalence wiring anchor | PASS | `test_no_profile_flag_loads_default_and_config_reaches_graph` asserts `profile_id=="default"`, `seen["config"] is loaded.config` (identity, not equality — strong), and `context.persona/project/memory` == loaded values. Golden test `test_default_profile_equals_from_env` NOT weakened (still `dc.asdict(...)==from_env` + `config==from_env`); `clean_env` now also blocks loader `load_dotenv`, which strengthens determinism rather than relaxing the assertion. |
| 2 | bad `--profile` ⇒ clean error, no traceback | PASS | Both entrypoints catch `except FileNotFoundError` only (`cli.py:39`, `cron.py:87`) → `print("error: ...", file=sys.stderr)` → return None/1. `RuntimeError` (real config error) is NOT in the catch, so it propagates. `test_cli_bad_profile_returns_error` + `test_cron_bad_profile_returns_one` cover it. |
| 3 | grep gate | PASS | `grep -rn "build_settings_from_env\|build_reporting_config_from_env" src/entrypoints/` → 0 hits (exit 1). Imports also removed from `cli.py`. |
| 4a | `load_dotenv` no-override | PASS | `dotenv.load_dotenv` signature default `override=False` (confirmed via `inspect.signature`). Caller-set env wins. |
| 4b | 3 no-key tests block loader `load_dotenv` | PASS | `test_graph_and_cli.py::test_cli_no_key_returns_one`, `test_sprint_and_report_kind.py::test_cron_no_key_returns_one`, `test_profile_entrypoints.py::test_cli_real_default_profile_loads` all `monkeypatch.setattr("src.profile.loader.load_dotenv", ...)`. |
| 4c | golden test blocks `load_dotenv` in all 3 spots | PASS | `clean_env` fixture patches `src.profile.loader.load_dotenv` + `src.config.config_builders.load_dotenv` + `src.config.config_builders_reporting.load_dotenv`. |
| 5 | audit-tolerance regression | **REGRESSION (judgment call)** | See below. |
| 6 | suite green / ruff / LOC | PASS (LOC note) | 315 passed, 0.50s, no network. ruff clean. `cli.py` = 278 LOC — pre-existing over-gate per P1, NOTE not block. |

## Special Scrutiny

- **`_run_hello` no-context**: CORRECT. Hello uses `build_graph` (Phase-0 echo), which has no
  `context` param and no report prompt. Passing context would be meaningless. `main():274` comment
  updated to "hello: no profile context". Intentional and right.
- **thread-id / dispatch unchanged**: CONFIRMED. `_parse_report_kind`, `_parse_audience`,
  `_flag_value`, and the `report-{kind}-{audience}` thread id are byte-identical to pre-slice. The
  only change is the config SOURCE (`build_*_from_env` → `loaded.config`) plus the added `context=`.
- **None-slip trace**: SAFE. `main()` calls `_load_or_exit` once; `if loaded is None: return 1`
  guards before any use of `settings`/`config`/`loaded`. ALL command paths (audit/approvals/approve/
  reject/report/hello) sit after that guard. No NoneType attribute path. Additionally every
  `build_*_graph` wrapper defaults `context: ProfileContext = EMPTY` (Slice 2), so even an unexpected
  None context could not crash the graph builders.

## Critical Issues

None.

## High Priority

None.

## Medium Priority — Judgment Call (acceptance #5): Slice-D audit-tolerance regression

**This is a real, silent behavior regression. Surfacing per the task's explicit instruction.**

Pre-slice `main()` documented the design intent (now-deleted comment):

> "Settings is needed by every path; build it once. Reporting config is built lazily (only on paths
> that touch Slack/Confluence) so a diagnostic command like `audit` keeps working even when reporting
> config is misconfigured."

Post-slice, `main()` calls `loaded = _load_or_exit(args)` which runs `load_profile(...)`, and
`load_profile` builds BOTH settings AND reporting config eagerly (`loader.py:88-89`) BEFORE the
`audit`/`approvals`/`approve`/`reject` dispatch. `build_reporting_config_from_dict` enforces the
stakeholder-channel guardrail at `config_builders_reporting.py:81-83`, which raises **`RuntimeError`**
when `SLACK_STAKEHOLDER_CHANNEL` is set but not in the external set.

Consequence: a profile with a stakeholder-channel misconfig now makes `cli audit` (and
`approvals`/`approve`/`reject`) crash with an **uncaught `RuntimeError` + full traceback**, because
the catch is narrowly `FileNotFoundError`. Previously `audit` ran fine because reporting config was
never built on that path. This is a strict loss of the Slice-D diagnostic-tolerance property.

**The regression is untested.** The two "audit stays keyless" tests
(`test_okr_report.py:199`, `test_resource_report.py:219`) monkeypatch `load_profile` to return a fake
with `config=object()` — they never run the real config builder, so they pass without exercising the
misconfig path. No test asserts audit survives a broken reporting config.

**Assessment (my recommendation):** This is **acceptable to ship as-is**, with a caveat.

- The profile is now legitimately the single source of truth; a profile that fails to build is a
  real error the operator must fix, and failing loudly on every command (including `audit`) is a
  defensible, even desirable, posture for a config-integrity error.
- BUT the regression currently surfaces as an **uncaught traceback**, which contradicts acceptance
  #2's spirit ("clear CLI error, no traceback dump") for the misconfig case. `audit`/`approvals` are
  exactly the diagnostic commands an operator reaches for WHEN something is misconfigured — making
  them traceback is the worst-timed failure mode.

Recommended (pick one, operator/lead decision — do not silently revert the user's single-source design):
1. **Keep eager load, improve the error**: broaden the entrypoint catch to also handle the config
   `RuntimeError` → print `error: <msg>` + non-zero exit (no traceback). Preserves single-source;
   restores the "no traceback" contract for diagnostics. (Lowest-risk, my preference.)
2. **Restore tolerance for diagnostics only**: let `audit`/`approvals` tolerate a config-build
   failure (settings still load; config lazily/optionally). More faithful to Slice-D but reintroduces
   the lazy-build split the slice intentionally removed.
3. **Accept as-is**: document that a broken profile fails all commands by design. If chosen, add a
   test that asserts the misconfig path produces a clean non-zero exit (not a raw traceback) so the
   contract is pinned.

Whichever path: add a regression test that builds a REAL misconfigured profile and asserts the
`audit` exit behavior, since the current fakes can't catch this.

## Low Priority

- `cli.py:29-31` `_parse_profile` reuses `_flag_value`; `cron.py:23-29` `_profile_id` re-inlines the
  same scan (cron has no `_flag_value`). Minor DRY divergence between the two entrypoints, consistent
  with cron's pre-existing inline-parse style — not worth a shared util for one flag.
- `tests/test_okr_report.py` and `tests/test_resource_report.py` each define an identical local
  `_fake_loaded`, and `test_profile_entrypoints.py` a third near-identical one. Acceptable test-local
  duplication (KISS over a shared fixture for a 6-line helper); flag only if it spreads further.

## Edge Cases Found by Scout

- **`--profile` as the last arg with no value**: `_flag_value`/`_profile_id` both guard
  `i + 1 < len(args)` and fall back to `"default"`. So `cli report --profile` (dangling) silently
  loads `default` rather than erroring. Benign, matches existing `_flag_value` semantics for all
  other flags; noting for completeness, not a defect.
- **`load_dotenv` runs on EVERY `load_profile` call** including `audit`. Harmless (idempotent,
  no-override), but it does touch the filesystem on the keyless diagnostic path. The no-key tests
  correctly block it. No action.
- **`config=object()` in fakes**: the dispatch fakes pass `config=object()`; real `build_*_graph`
  receive `loaded.config`. Fakes never validate config shape — acceptable for dispatch-wiring tests,
  but it is precisely why the audit-tolerance regression (above) is invisible to the suite.

## Positive Observations (risk-calibration only)

- Identity assertion `seen["config"] is loaded.config` (not `==`) in the anchor test genuinely proves
  the loaded object reaches the graph, not a coincidentally-equal rebuild. Strong wiring proof.
- Narrow `except FileNotFoundError` (not bare `Exception`) correctly lets the real `RuntimeError`
  config error propagate instead of masquerading as a "profile not found" exit-1. This is the right
  call and directly satisfies acceptance #2's "no other exception swallowed".

## Metrics

- Type coverage: type hints present on all new helpers (`_parse_profile`, `_load_or_exit`,
  `_context_of`, `_profile_id`); `_load_or_exit`/`_context_of` use loose `loaded` param (untyped) —
  acceptable, mirrors existing entrypoint style.
- Test coverage: 315 passed, 0.50s, no network/MCP. New `test_profile_entrypoints.py` covers parse
  defaults (cli+cron), v1 wiring anchor, explicit profile, bad-profile error (cli+cron), real default
  load. Gap: no test for the config-build `RuntimeError` reaching `audit` (the regression).
- Linting: 0 issues (ruff clean on `src/entrypoints src/profile tests`).
- `cli.py`: 278 LOC (pre-existing over-200 gate, P1-acknowledged; note, not block).

## Recommended Actions

1. Decide the acceptance-#5 audit-tolerance disposition (options 1/2/3 above). Recommendation:
   option 1 — broaden the entrypoint catch to convert the config `RuntimeError` into a clean
   non-zero exit, restoring the "no traceback for diagnostics" contract while keeping single-source.
2. Whichever option is chosen, add a regression test using a REAL misconfigured profile (current
   fakes can't catch it).
3. (Optional) Leave `cli.py` LOC as-is; the over-gate is pre-existing per P1.

## Unresolved Questions

- Is the Slice-D audit-tolerance property a hard requirement going into P3, or was it an
  implementation convenience superseded by the single-source profile model? This determines whether
  option 1/2 (preserve) or option 3 (accept) is correct. Needs lead/operator input — do not resolve
  by silently reverting the single-source design.

---
Status: DONE_WITH_CONCERNS
Summary: Slice 3 is correct, scoped, and green (315 passed, ruff clean, grep gate 0); all acceptance
items pass except #5, where the eager profile load reintroduces a real but untested Slice-D
audit-tolerance regression (a misconfigured profile now crashes `audit`/`approvals` with an uncaught
RuntimeError traceback).
Concerns/Blockers: `src/entrypoints/cli.py:248` + `src/profile/loader.py:88-89` vs
`src/config/config_builders_reporting.py:81-83` — config built eagerly before the audit dispatch;
`except FileNotFoundError` (cli.py:39 / cron.py:87) does not cover the config RuntimeError, so the
diagnostic commands traceback on a broken profile. Judgment call: acceptable by single-source design,
but recommend broadening the catch to a clean non-zero exit + adding a real-misconfig regression test.
Not a blocker; lead/operator decision.
