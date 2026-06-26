# Code Review — Slice D: Delete Config Singletons (config-injection refactor, closing slice)

Date: 2026-06-23
Reviewer: code-reviewer
Scope: uncommitted working-tree diff (15 files, +158/-169)
Verdict: DONE_WITH_CONCERNS — no blocking defects; 2 informational findings.

## Scope

- Source: `action_gateway.py`, `agent/graph.py`, `config/settings.py`, `config/reporting_config.py`,
  `config/config_builders.py`, `config/config_builders_reporting.py`, `entrypoints/cli.py`, `entrypoints/cron.py`
- Tests: `conftest.py`, `test_audience_delivery.py`, `test_audience_prompts.py`, `test_graph_and_cli.py`,
  `test_okr_report.py`, `test_resource_report.py`, `test_sprint_and_report_kind.py`
- Verification run: `uv run ruff check src/ tests/` → All checks passed; `uv run pytest -q` → 282 passed in 0.66s.

## Acceptance Criteria — all PASS

(a) Singleton refs gone. `grep -rn "get_settings|get_reporting_config" src/ tests/` → 0 functional hits.
    One residual `lru_cache` token is a docstring mention in `config_builders.py:3` (describes what it replaces). Non-functional.

(b) `_load_external_channels` fully deleted; `cache_clear` → 0 hits in src/ and tests/. Confirmed.

(c) GUARDRAIL (most important) — HOLDS, fail-closed across the full blast radius.
    Every ActionGateway construction on a real-mutation path passes `external_channels=config.slack_external_channels`:
      - cli `_gateway()` (cli.py:123) — passes it.
      - report/okr/resource graph factories (report_graph.py:78, okr_report_graph.py:80, resource_report_graph.py:82)
        — each builds `ActionGateway(settings, external_channels=config.slack_external_channels)`.
      - cron routes through the same 3 factories via `_build_graph(... settings, config)`.
    The public `build_*_graph` factories declare `config/settings` as `| None = None` but RAISE `ValueError`
    when `deps is None and (config is None or settings is None)` — so a real flow can never silently fall back to
    the new `frozenset()` default. The only paths that reach `ActionGateway()` with the empty default are tests that
    deliberately pass an explicit `external_channels` (verified in test files). No real Slack-posting path can build a
    gateway with a defaulted/empty external set. Guardrail invariant preserved.

(d) Management subcommands before key gate — CONFIRMED. cli.py:221-228 dispatch audit/approvals/approve/reject;
    `_require_key(settings)` is at cli.py:230, after them. None of those handlers reference `_require_key`.

(e) Hello path lazy client — CONFIRMED. `_make_respond(client, settings)` raises a clear `ValueError` if `settings`
    is None and no client injected (graph.py:45-46); cli hello passes `settings=settings` (cli.py:40). LlmClient(settings) wired.

(f) No new secret/token leak — CONFIRMED. `config` is passed as a call argument, never serialized onto the action dict.
    `make_slack_post_handler(config.slack_server)` captures the token-bearing `McpServerSpec.env` in a closure (documented
    intent in slack_write.py), so the audit log + persisted approval queue never see the token. `_dispatch_approved_action`
    receives `config` via a closure lambda in `_run_approve`; nothing token-bearing is persisted. No config/token in any print/log.

(g) `build_reporting_config_from_env()` on every invocation — CONFIRMED non-spurious for valid configs. The only raise in
    `build_reporting_config_from_dict` is the stakeholder-not-in-external guardrail (config_builders_reporting.py:81-84),
    which short-circuits when no stakeholder channel is set (`if stakeholder_channel and ...`). A normally-configured user
    (stakeholder in external set, OR no stakeholder set) does not hit a new crash.

## Findings

### INFO-1 — `audit`/`hello` now eagerly build + validate the reporting config they never consume
`main()` runs `config = build_reporting_config_from_env()` (cli.py:218) unconditionally before dispatch, but
`_run_audit(args, settings)` and `_run_hello(msg, settings)` do not take `config`. The eagerly-built config is discarded
on those paths. Consequence: `audit` (which has nothing to do with Slack/reporting) now FAILS with the guardrail
`RuntimeError` if a user has `SLACK_STAKEHOLDER_CHANNEL` set but not in `SLACK_EXTERNAL_CHANNELS` — a misconfig that
previously never blocked audit. This is a behavior broadening, not a defect (the misconfig is a real guardrail violation
the operator should fix). Not blocking. Note that `test_audit_command_still_works_without_key`
(test_okr_report.py:192) stubs `build_reporting_config_from_env` with `lambda: object()`, so it does NOT exercise the real
validation on the audit path — the new coupling is invisible to that test (phantom coverage of this specific risk).

### INFO-2 — Latent test fragility: `*_no_key` tests don't clear Slack env vars
`test_cli_no_key_returns_one` (test_graph_and_cli.py) and `test_cron_no_key_returns_one` (test_sprint_and_report_kind.py)
redirect `REPO_ROOT` to an empty tmp dir (so `.env` isn't loaded) and `delenv("OPENROUTER_API_KEY")`, but do NOT clear
`SLACK_STAKEHOLDER_CHANNEL` / `SLACK_EXTERNAL_CHANNELS` from the live process env. Because the new always-on
`build_reporting_config_from_env()` reads those via `os.getenv` (config_builders_reporting.py:14-15) BEFORE the key gate,
a CI runner or dev that `export`s `SLACK_STAKEHOLDER_CHANNEL` without a matching `SLACK_EXTERNAL_CHANNELS` would make
these tests ERROR (RuntimeError) instead of asserting return code 1. Suite is green locally only because those vars are
unset in this shell (verified). Suggested fix (non-blocking): add `monkeypatch.delenv("SLACK_STAKEHOLDER_CHANNEL", raising=False)`
and `delenv("SLACK_EXTERNAL_CHANNELS", raising=False)` to both tests, mirroring the existing `OPENROUTER_API_KEY` cleanup.

## Positive (risk-relevant)
- Test migrations strengthen, not weaken, coverage: `test_audience_prompts._build_config` now hits the real
  `build_reporting_config_from_dict` guardrail (pure, no env mutation/cache), and `conftest.settings_factory` routes through
  `build_settings_from_dict` so the fixture cannot drift from production coercion. `data_dir` override is honored
  (config_builders.py:`d.get("data_dir", DATA_DIR)`), so test isolation is intact.
- Graph factories fail-closed (ValueError) rather than defaulting config — the strongest possible posture for the guardrail.

## Unresolved Questions
- INFO-1: is broadening `audit`'s failure surface to include reporting-config validation intended? If `audit` should remain
  usable under a broken reporting config, build `config` lazily only on the paths that need it (report/approvals/approve/reject),
  not unconditionally in `main()`. Defer to lead — current behavior is defensible (fail-closed on a real guardrail misconfig).
