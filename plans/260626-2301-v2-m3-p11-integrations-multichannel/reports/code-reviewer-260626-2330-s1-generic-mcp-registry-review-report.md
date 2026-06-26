# Code Review — v2 M3-P11 Slice S1: generic config-driven MCP registry + read-only Linear

Date: 2026-06-26
Reviewer: code-reviewer
Branch: main (uncommitted working tree)
Verdict: **DONE_WITH_CONCERNS** — invariant confirmed safe; concerns are structural/cosmetic, no blockers.

## Scope

Files reviewed (diff + surrounding):
- `src/config/reporting_config.py` — `extra_servers` field added to frozen `ReportingConfig`
- `src/config/config_builders_reporting.py` — `_build_extra_servers`, `_extra_servers_from_env`, wiring
- `src/profile/loader_mapping.py` — `_build_integrations` (profile `integrations:` → list)
- `src/actions/linear_read.py` (NEW) — `get_issues`/`search_issues`/`get_epics`
- `profiles/default/profile.yaml`, `config.example.env` — commented examples
- `tests/test_extra_servers_config.py` (8), `tests/test_linear_read.py` (4)

Verification run:
- `uv run ruff check src tests` → **All checks passed!**
- `uv run pytest -q` → **640 passed** (matches expected count)
- Targeted: `test_linear_read.py` + `test_extra_servers_config.py` → 12 passed
- Linear tool names verified verbatim against `tacticlaunch/mcp-linear` `TOOLS.md`: `linear_getIssues`, `linear_searchIssues`, `linear_getProjects` all exist with exact casing (and `linear_createComment`, the S2 write, exists too).

## INVARIANT CONFIRMED — S1 adds NO write authority

Verified directly, not assumed:
- `src/actions/hard_block.py` is **byte-unchanged** (`git diff --stat HEAD` empty; `git status` clean for that file). No `linear` token anywhere in it.
- `_MCP_ALLOWLIST` still has only `slack`/`confluence`/`jira` keys — **no `linear` entry**. Any MCP action with `server="linear"` hits `_allowlisted_mcp` → `frozenset()` → `NOT_ALLOWLISTED` default deny. Confirmed by reading `classify()` Layer 2 (hard_block.py:387-436).
- `linear_read.py` calls `mcp_adapter.call_tool(spec, ...)` directly — this is the **same READ pattern** as the existing `src/tools/jira_read.py`, `confluence_read.py`, `okr_read.py`, all of which bypass the gateway by design (reads never mutate). The three tool names called are all read tools (`getIssues`/`searchIssues`/`getProjects`); none carry a data-loss/security substring, so even if routed through `classify()` they would not trip Lớp A.
- No write code, no `linear_write.py`, no allowlist widening. **Invariant intact.**

## Acceptance Criteria

| AC | Result |
|----|--------|
| (a) declared linear ⇒ correct spec; missing dist/env ⇒ clear lazy error | PASS — `test_declared_linear_reaches_right_spec`, `test_missing_dist_validate_raises` (FileNotFoundError), `test_missing_env_validate_raises` (RuntimeError) |
| (b) no `integrations:` ⇒ `extra_servers=={}` ⇒ byte-identical | PASS — default `profile.yaml` (`integrations: {}`) → loader returns `None` → key omitted → from_dict `{}`. Verified via roundtrip smoke. Only one construct site (config_builders_reporting.py:116). |
| (c) no write authority added | PASS — see invariant section above |
| (d) token NAMES in yaml, VALUES from os.environ only | PASS — `_build_extra_servers` reads `os.environ.get(k)` by declared names (config_builders_reporting.py:87); `_build_integrations` stores only `required_env` name list (loader_mapping.py:189-190). `test_token_value_never_in_parsed_yaml_dict` guards it. |
| (e) no new lint/type errors; LOC reasonable | PASS — ruff clean; `linear_read.py` 60 LOC, builders 185, reporting_config 94. loader_mapping.py 234 (was already >200; S1 added ~22 lines for `_build_integrations` — not a substantial worsening) |

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M1 — `linear_read.py` placed in `src/actions/`, breaking the read/write directory convention.**
`src/actions/linear_read.py:1`
Every other READ module lives in `src/tools/` (`jira_read.py`, `confluence_read.py`, `okr_read.py`, `github_read.py`) and shares the exact docstring line "READ does not go through the Action Gateway (only mutations do)." `src/actions/` otherwise holds **only** the gateway and WRITE/queue modules (`action_gateway.py`, `hard_block.py`, `approval_store.py`, `confluence_write.py`, `slack_write.py`). Putting a read helper in `src/actions/` inverts the directory's meaning ("actions" = gated mutations) and will mislead the next maintainer into thinking Linear reads are gateway-routed. The new file even imports `from src.tools.models`-style siblings would normally apply.
Impact: maintainability / future mis-classification risk, not a runtime bug.
Fix: move to `src/tools/linear_read.py` to match the established read-module home; update the two test imports (`from src.actions import linear_read` → `from src.tools import linear_read`). If the author deliberately reserved `src/actions/linear_*` so S2's `linear_write.py` sits next to it, document that intent — but the current split (read in actions/, future write also in actions/) still diverges from jira/confluence where reads are in tools/ and writes in actions/.

**M2 — `linear_read.py` docstring claims `linear_write.py` exists; it does not.**
`src/actions/linear_read.py:8-9`
> "The gated Linear WRITE (`linear_createComment`) lives in `linear_write.py` and is gateway-routed."
`src/actions/linear_write.py` does not exist yet (S2 scope). Stating a non-existent module as present fact is exactly the kind of confident-but-wrong comment that erodes trust in the codebase. A reader grepping for `linear_write.py` finds nothing.
Fix: reword to future tense, e.g. "The gated Linear WRITE (`linear_createComment`) will land in S2 (`linear_write.py`), gateway-routed." Keeps the design intent without asserting a present untruth.

### LOW

**L1 — Malformed `integrations.<name>` (non-dict value) is silently dropped.**
`src/profile/loader_mapping.py:185-186`
If a user writes `integrations: { linear: "dist/index.js" }` (string instead of a `{mcp_dist, required_env}` mapping), the `if not isinstance(cfg, dict): continue` silently skips it. The server is never declared, so the failure only surfaces later as "linear MCP server not declared" at read time — with no hint that the YAML shape was wrong. This is consistent with the lazy-validate philosophy and is low-severity, but a one-line debug log ("skipping integrations entry %r: expected a mapping") would shorten a future debugging session. No fix required if the team prefers strict YAGNI.

**L2 — `_build_extra_servers` and `_build_integrations` duplicate the name-normalize + skip logic.**
`config_builders_reporting.py:78-82` and `loader_mapping.py:184-187` both do "skip non-dict, lowercase/strip name". This is acceptable (two different input shapes: profile-block dict vs normalized list), and DRY-ing it would couple the loader to the builder. Noting only so a future reader doesn't "fix" one and miss the other. No action.

## Specific Checks (requested)

1. **Frozen field add breaks positional construct?** No. `extra_servers` has no default, but the **only** construct site is `config_builders_reporting.py:116`, all-keyword-args, and it always passes `extra_servers=_build_extra_servers(d)`. `grep -rn "ReportingConfig("` confirms a single site. No positional caller anywhere.
2. **`_build_extra_servers` robustness.** Verified empirically: non-dict entries skipped, empty-name skipped, empty `required_env` ⇒ `env={}`, name lowercased (`"LINEAR"` → `"linear"`). Malformed block degrades cleanly, never crashes load.
3. **Lazy validate doesn't break load.** Confirmed. `McpServerSpec.validate()` is called only inside `call_tool` (mcp_adapter.py:108), i.e. on real read use. Build/load never calls it. A declared-but-unbuilt server loads fine.
4. **`_extra_servers_from_env` when `LINEAR_MCP_DIST` unset.** Returns `[]` (verified). No behavior change vs pre-P11.
5. **Can READ reach a mutation / bypass gateway?** No. The three called tools are read-only (`getIssues`/`searchIssues`/`getProjects`). Pattern matches `src/tools/jira_read.py` precedent. No write surface introduced.
6. **Suite + lint.** 640 passed, ruff clean (run above).

## Positive Observations (risk-relevant)

- The "no secret in yaml" boundary is enforced at **both** layers (loader stores names only; builder pulls values from `os.environ`) and guarded by `test_token_value_never_in_parsed_yaml_dict` — this is the correct defense-in-depth for the token trust boundary.
- Backward-compat is real, not asserted: `integrations: {}` → `None` → omitted key → `{}`, verified end-to-end through the actual default `profile.yaml`. The "byte-identical" claim holds.
- Tool names were checked against the upstream package, not trusted from the plan — all four verbatim-correct.

## Recommended Actions (priority order)

1. (M2) Fix the `linear_read.py` docstring to stop asserting `linear_write.py` exists. Trivial, do before commit.
2. (M1) Decide and document the read-module location: either move `linear_read.py` to `src/tools/` to match every other read module, or add a one-line note in the file explaining the deliberate `src/actions/linear_*` grouping for S2. Recommend moving to `src/tools/`.
3. (L1, optional) Add a debug log when an `integrations.<name>` entry is skipped for being non-dict.

None of these block landing S1. The safety invariant (no write authority added) is confirmed.

## Unresolved Questions

1. Is `src/actions/linear_read.py` a deliberate choice to colocate with the future S2 `linear_write.py`, or an oversight? Every existing read lives in `src/tools/`. (Drives M1.)
2. S2 plan intent: when `linear_createComment` is added, will a `linear` entry be added to `_MCP_ALLOWLIST` AND will Lớp B markers cover Linear comment writes? (Out of S1 scope; flagging so the allowlist widening is reviewed deliberately in S2, not assumed safe by analogy to jira `addcomment`.)

---
Status: DONE_WITH_CONCERNS
Summary: S1 is functionally correct, lint/test green (640 pass), tool names verified verbatim, and the core safety invariant is confirmed — hard_block.py unchanged, no linear allowlist entry, reads bypass the gateway by the same pattern as existing read modules. Concerns are structural (read module in actions/ not tools/) and one factually-wrong docstring; neither blocks landing.
Concerns: (M1) read module placed in src/actions/ against convention; (M2) docstring asserts non-existent linear_write.py.
