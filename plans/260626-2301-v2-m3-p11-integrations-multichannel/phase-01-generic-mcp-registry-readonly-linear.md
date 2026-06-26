# Phase S1 — Generic MCP registry/config + read-only Linear (C3, part 1)

**Goal:** make MCP servers config-driven. A `profile.yaml` block DECLARES an extra stdio
MCP server (name + dist_path + env keys); the agent can READ from it without code change.
Concrete proof: read Linear epics/issues. NO write yet (S2). Independently shippable +
suite-green (no behavior change when no extra server declared).

## RESOLVED (research report, verified)

- **Server = `@tacticlaunch/mcp-linear`** (community), stdio, spawned `node <dist>/index.js` —
  matches the jira/slack/confluence spawn model. **BLOCKER NOTE:** Linear's OFFICIAL MCP
  (`https://mcp.linear.app/sse`) is HTTP/SSE remote-only ⇒ incompatible with our `transport="stdio"`
  spawn model. We deliberately use the tacticlaunch stdio server. `dist_path` is
  profile-configurable (no hardcode).
- **Read tool names (verbatim, camelCase):** `linear_getIssues`, `linear_searchIssues`,
  `linear_getIssueById`, `linear_getProjects` (also `linear_getMilestones`/`linear_getCycles`).
  All safe (no destructive substring). `linear_read` helper calls these by name.
- **Auth env:** `LINEAR_API_TOKEN` (Linear personal API key, scope Read + Create comments).
  `required_env_keys=("LINEAR_API_TOKEN",)`. Env-only; never a committed profile value.

## Context links (verified file:line)

- `src/config/reporting_config.py:26-50` — `McpServerSpec` (name/dist_path/env/required_env_keys
  + lazy `validate()`); `:53-89` `ReportingConfig` frozen dataclass; fixed
  `jira_server`/`slack_server`/`confluence_server` at `:86-88`.
- `src/config/config_builders_reporting.py:26-66` — `_build_servers(d)` builds the 3 specs;
  `:78-117` `build_reporting_config_from_dict(d)` (the ONLY validation); `:120-156`
  `build_reporting_config_from_env()`.
- `src/profile/loader_mapping.py:97+` — `build_reporting_dict(yaml_doc)` maps profile blocks
  → from_dict kwargs; `_fallback(yaml, ENV)` at `:37`, `_put` at `:53`, `_section` at `:59`.
- `src/adapters/mcp_adapter.py:101` — `call_tool(spec, tool_name, args)` (integration-agnostic;
  `spec.validate()` first, timeout-bounded). Reused AS-IS.
- `src/actions/jira_read.py` (read-helper template — mirror its shape for `linear_read.py`).
- `profiles/default/profile.yaml:33-52` — `bindings:` blocks (jira/confluence/github/slack).

## Requirements

1. `ReportingConfig` gains an `extra_servers: dict[str, McpServerSpec]` field (frozen — use a
   plain `dict` built once at construction; default empty `{}`). Keyed by lowercase server name.
2. `profile.yaml` gains an optional `integrations:` block listing extra servers:
   ```yaml
   integrations:
     linear:                     # @tacticlaunch/mcp-linear (stdio)
       mcp_dist: ""              # path to linear MCP server dist; empty ⇒ LINEAR_MCP_DIST env
       required_env: [LINEAR_API_TOKEN]   # env var NAMES the server reads (never values)
   ```
   Token VALUES come from `os.environ` by the named keys (mirrors jira/slack pattern — names in
   yaml, values from env). NEVER store tokens in yaml.
3. Loader maps `integrations:` → a dict the from_dict consumes; from_dict builds one
   `McpServerSpec` per declared server with `required_env_keys` from `required_env`, `env` filled
   from `os.environ`. Lazy `validate()` only fires on actual use (read), so a declared-but-unbuilt
   server never breaks load.
4. A `linear_read.py` helper: `get_issues(config, ...)` / `get_epics(config, ...)` that resolves
   `config.extra_servers["linear"]` and calls `call_tool(spec, "linear_getIssues", args)` /
   `call_tool(spec, "linear_searchIssues", args)` (verbatim read tool names; epics = projects via
   `linear_getProjects`). READ actions bypass the gateway (`action_gateway.py:184` — mutations only).
5. **Backward-compat:** no `integrations:` block ⇒ `extra_servers={}` ⇒ zero behavior change.

## Files to create / modify / delete

**Modify:**
- `src/config/reporting_config.py` — add `extra_servers: dict[str, McpServerSpec]` field to
  `ReportingConfig` (after `confluence_server`, default-less frozen field; builder always passes
  `{}` when none). Keep file < 200 LOC.
- `src/config/config_builders_reporting.py` — add `_build_extra_servers(d) -> dict[str, McpServerSpec]`
  (reads `d["extra_servers"]` = list of `{name, mcp_dist, required_env}`; builds a spec each, env
  pulled from `os.environ` by required_env names). Pass result into `ReportingConfig(...)`. Update
  both `from_dict` and `from_env` (env reads `LINEAR_MCP_DIST` + the declared key names). If file
  crosses 200 LOC, extract the extra-server builder to `config_builders_extra_servers.py`.
- `src/profile/loader_mapping.py` — in `build_reporting_dict`: read `_section(yaml_doc, "integrations")`,
  emit `out["extra_servers"]` as the normalized list. Use `_fallback(integrations.get("linear",{}).get("mcp_dist"), "LINEAR_MCP_DIST")`.
- `profiles/default/profile.yaml` — add commented-out `integrations:` example (empty default ⇒
  backward-compat).
- `config.example.env` — add `LINEAR_MCP_DIST` + `LINEAR_API_TOKEN` (commented, optional).

**Create:**
- `src/actions/linear_read.py` — read helpers (`get_issues`, `get_epics`) over
  `config.extra_servers["linear"]`. Raise a clear error if the server is not declared
  (`"linear MCP server not declared in profile integrations:"`).

**Delete:** none.

## Implementation steps

1. Add `extra_servers` field to `ReportingConfig`. Because the dataclass is frozen, pass it
   positionally/by-keyword in the builder — confirm no other constructor call sites break
   (grep `ReportingConfig(` — only `config_builders_reporting.py:96` constructs it; all tests
   build via `from_dict`/`from_env`, so adding a defaulted-by-builder field is safe).
2. Implement `_build_extra_servers`. Input shape (from loader): list of dicts. For each: resolve
   `dist_path` (yaml mcp_dist → env `<NAME>_MCP_DIST` → required), `required_env_keys = tuple(required_env)`,
   `env = {k: os.environ.get(k, "") for k in required_env}`. Return `{name.lower(): spec}`.
3. Wire into `from_dict` + `from_env`.
4. Loader mapping: normalize `integrations:` to the list shape. Omit when absent (`_put` skips None).
5. `linear_read.py`: resolve spec, `spec.validate()` (clear error on missing dist/env), `call_tool`.
6. Run focused tests, then broaden.

## Tests / validation

Create `tests/test_extra_servers_config.py` + `tests/test_linear_read.py`:
- Profile declares `linear` ⇒ `config.extra_servers["linear"]` is the right `McpServerSpec`
  (name, dist_path, required_env_keys). (P8-style selection test.)
- Missing dist ⇒ `spec.validate()` raises clear error naming the server + path.
- Missing `LINEAR_API_TOKEN` in env ⇒ `validate()` raises naming the missing key.
- No `integrations:` block ⇒ `config.extra_servers == {}` (backward-compat).
- `linear_read.get_issues` with a FAKE spec (monkeypatch `call_tool`) returns coerced issues;
  no live key needed.
- Byte-identical: a config built without `integrations:` equals (field-by-field) the pre-S1
  config except the new empty `extra_servers`.

Commands:
```
uv run pytest -q tests/test_extra_servers_config.py tests/test_linear_read.py tests/test_config_builders.py tests/test_profile_loader.py
uv run pytest -q            # full suite stays green (628 + new)
uv run ruff check src tests # line-length 100
```

## Risks + rollback

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Frozen-dataclass field add breaks a positional `ReportingConfig(...)` caller | L×H | Only one construct site (`config_builders_reporting.py:96`), keyword-only; grep-verified. |
| `config_builders_reporting.py` crosses 200-LOC gate | M×L | Extract extra-server builder to its own file. |
| Token leak via yaml | L×H | Yaml holds env NAMES only; values from `os.environ`. Mirror jira/slack. Add a test asserting no token value in the parsed yaml dict. |
| A declared server with bad dist breaks every load | M×M | `validate()` is LAZY (only on read/use), so a declared-but-unused server never breaks load — matches `McpServerSpec` design (`reporting_config.py:35`). |

**Rollback:** revert the 5 modified files + delete `linear_read.py`. `extra_servers` defaulting to
`{}` means removal restores exact pre-P11 behavior.

## INVARIANT (restated)

S1 is READ-ONLY. No new write authority. The extra-server registry must NOT add any write path:
READ tools bypass the gateway by design (`action_gateway.py:184`), and the linear server has NO
allowlist entry yet (`_MCP_ALLOWLIST` unchanged), so any accidental write attempt is DENIED by
default. Write authority is gated entirely in S2.

## Unresolved questions

1. DEFERRED: live Linear-key E2E (real `linear_getIssues` against a real workspace) — out of scope
   this round; offline fake-spec tests cover the path. Run once a key is provisioned.
2. DEFERRED: Linear key SCOPE adequacy — research confirms "Read + Create comments" should suffice,
   but tacticlaunch's internal GraphQL for `linear_searchIssues` may need wider read scope. Test with
   a Read+Create-comments key first; widen to Read+Write (not Admin) only if a read tool 403s.
