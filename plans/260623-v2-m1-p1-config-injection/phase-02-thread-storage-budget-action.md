# Slice B — Thread config through storage + budget/llm + action layers

> Status: DONE (8bafe54) · Depends on: A · Owns the 9 source files + 4 test files in the
> ownership table for B. Does NOT touch the graph/section factories or tool fetchers
> (Slice C) or the entrypoints (Slice D).

## Goal

Remove the singleton fallbacks from the storage classes, the budget/LLM clients, and
the action writers/gateway. After this slice these layers REQUIRE config injected
(no `get_settings()` / `get_reporting_config()` fallback). Their direct callers in
slices C/D will supply it; the tests that construct them directly are migrated here.

## Context (verified 2026-06-23)

Each target ALREADY accepts the param — the change is to remove the singleton default,
not to add a parameter:

- **Storage (4):**
  - `src/agent/checkpoint.py:26` `get_checkpointer(db_path=None)`; `:32`
    `path = db_path or (get_settings().data_dir / "checkpoints.db")`.
  - `src/actions/dedup_store.py:24` `__init__(db_path=None)`; `:25`
    `self._path = db_path or (get_settings().data_dir / "dedup.db")`.
  - `src/audit/audit_log.py:51` `__init__(path=None)`; `:52`
    `self._path = path or (get_settings().data_dir / "audit" / "audit.jsonl")`.
  - `src/actions/approval_store.py:36` `__init__(db_path=None)`; `:37`
    `self._path = db_path or (get_settings().data_dir / "approvals.db")`.
- **Budget/LLM (2):**
  - `src/llm/budget_tracker.py:37` `__init__(settings=None)`; `:38`
    `self._settings = settings or get_settings()`.
  - `src/llm/client.py:49` `__init__(...)`; `:54`
    `self._settings = settings or get_settings()`.
- **Action writers (3):**
  - `src/actions/confluence_write.py`: `create_report_page` `:87` reads
    `cfg = get_reporting_config()` `:100`; `_create_page_handler` `:76` reads
    `cfg = get_reporting_config()` `:78`.
  - `src/actions/slack_write.py`: `_slack_post_handler` `:22` reads
    `get_reporting_config().slack_server` `:29`; `deliver_report` `:47` reads
    `channel or get_reporting_config().slack_report_channel` `:59`.
  - `src/actions/action_gateway.py`: `ActionGateway.__init__` `:116-129` —
    `self._settings = settings or get_settings()` `:124`; `external_channels` default
    via `_load_external_channels()` `:103-110` (which reads the singleton). Stores
    built from `self._settings.data_dir` `:135,:140`.

## Design decisions for this slice

### Storage: require the path (KISS)

Per the roadmap, storage takes a `path`/`db_path`, not a whole `Settings`. **Change:
make the param REQUIRED** (drop the `= None` default and the `or get_settings()...`
fallback). Callers (the gateway, the entrypoints) pass an explicit path derived from
`settings.data_dir`. This keeps the storage layer config-agnostic (it only needs a
path) and is what P3 needs to point each agent at `.data/agents/<id>/`.

- `get_checkpointer(db_path: Path)` — required.
- `DedupStore(db_path: Path)` / `ApprovalStore(db_path: Path)` / `AuditLog(path: Path)`
  — required.

> Caller impact: `get_checkpointer()` is called bare in `cli.py:32`, `cron.py:44`
> (Slice D) and in tests. `ActionGateway` builds `DedupStore`/`ApprovalStore`/
> `AuditLog` from `self._settings.data_dir` (`action_gateway.py:125,135,140`) — those
> stay internal to the gateway, which still has `settings`, so the gateway keeps
> deriving the paths. Direct test constructions of the stores already pass a tmp path
> (they use `tmp_path`) — verify and keep.

### Budget/LLM: require `settings`

- `BudgetTracker(settings: Settings)` — required (drop `or get_settings()`).
- `LlmClient(settings: Settings, ...)` — required (drop `or get_settings()`). Check
  `client.py:49-54` for the full signature; keep other params, make `settings` required.

> Caller impact: `LlmClient()` is constructed bare inside `default_report_deps`
> (`report_graph.py:98`) and the okr/resource deps — those are Slice C (C passes
> `settings`). `BudgetTracker` is constructed inside `LlmClient` — confirm and thread
> `settings` through.

### Action gateway: require `settings` + `external_channels`; delete the singleton fallback

- `ActionGateway.__init__`: make `settings` REQUIRED. Keep `audit_log` / `dedup_store`
  / `approval_store` / `external_channels` optional (the gateway derives store paths
  from `settings.data_dir` when not given — that's fine, `settings` is now always
  present).
- **`external_channels`:** the gateway should NOT read the singleton. Two options:
  (a) make `external_channels` required, or (b) keep the `_load_external_channels()`
  fallback until Slice C/D and delete it in D. **Decision: keep `_load_external_channels`
  alive through B (it still works via the wrapper), but every NEW gateway construction
  in Slice C passes `external_channels=config.slack_external_channels` explicitly, and
  Slice D deletes `_load_external_channels` once no caller relies on the fallback.**
  This avoids forcing the `external_channels` arg on test gateways that don't exercise
  channel classification. (Document this hand-off clearly so D removes it.)

### Action writers: add `config` param

- `confluence_write.create_report_page(title, body, *, gateway, report_date,
  rationale, config: ReportingConfig)` — add `config`, drop the internal
  `get_reporting_config()` read at `:100`. The `_create_page_handler` reads cfg at
  `:78` — the handler runs inside the gateway dispatch with only the action dict;
  it needs the cfg values (space_key/space_id/site_name) embedded in the action OR
  passed at handler-build time. **Verify how `_create_page_handler` is invoked**
  (it's the gateway handler for the create-page action) and thread config so it does
  not read the singleton. (Likely: `create_report_page` puts the needed config values
  into the action payload, so the handler reads them from `action` not from a
  singleton — confirm and follow that pattern; KISS.)
- `slack_write.deliver_report(short, *, gateway, channel, report_date, rationale,
  config: ReportingConfig)` — add `config`; `:59` `channel or
  config.slack_report_channel`. `_slack_post_handler` reads `slack_server` at `:29` —
  same handler-payload question: thread the server spec into the action or pass config
  at handler-build time so the singleton read is gone.

> **Trace to verify at implementation:** `_slack_post_handler` and
> `_create_page_handler` are registered as the gateway's live handlers (see
> `cli.py:148-150` routing `slack` → `_slack_post_handler`). Whatever the handler
> needs (server spec, space ids) must arrive via the action dict or a closure that
> captured config — NOT a singleton. Confirm the registration path before choosing.

## Files

- **Modify (source, 9):** `src/agent/checkpoint.py`, `src/actions/dedup_store.py`,
  `src/audit/audit_log.py`, `src/actions/approval_store.py`,
  `src/llm/budget_tracker.py`, `src/llm/client.py`, `src/actions/confluence_write.py`,
  `src/actions/slack_write.py`, `src/actions/action_gateway.py`.
- **Modify (tests, 4):** `tests/test_budget_tracker.py`, `tests/test_action_gateway.py`,
  `tests/test_confluence_write.py`, `tests/test_lop_b_and_audit_query.py`.

## Implementation steps

1. Storage: drop `= None` + the `or get_settings()...` fallback on all four; make the
   path required. Update their import lines (remove `get_settings` import).
2. Budget/LLM: make `settings` required; remove the `or get_settings()` + the
   `get_settings` import.
3. Action writers: add `config: ReportingConfig` to `create_report_page` +
   `deliver_report`; remove their internal singleton reads. Thread config into the
   two handlers per the verified registration path (payload or closure).
4. Gateway: make `settings` required; remove `or get_settings()` + `get_settings`
   import. Leave `_load_external_channels` for now (D deletes it). Add a NOTE comment
   pointing to Slice D for its removal — but keep it as behavior, not a plan-ID
   comment (per repo rules, describe the invariant: "external channels come from
   injected config; this fallback is the last singleton reader, removed once all
   gateways are constructed with explicit channels").
5. Update the 4 test files: construct stores/clients/gateway with explicit
   `tmp_path` + `settings_factory(...)` config (the conftest `settings_factory` still
   exists). For `test_confluence_write.py` which currently does
   `monkeypatch.setattr(rc, "get_reporting_config", lambda: _Cfg())` (`:52-53`):
   migrate to passing `config=_Cfg()` into `create_report_page`. Remove the
   `monkeypatch.setattr` of the singleton.

## Tests / validation

- `tests/test_budget_tracker.py`, `test_action_gateway.py` already use
  `settings_factory` — update construction to pass it (no fallback to remove from the
  test side beyond ensuring `settings=` is supplied).
- `tests/test_confluence_write.py:52-53` — replace the `setattr(rc, ...)` /
  `setattr(confluence_write, ...)` with a `config=` argument to `create_report_page`.
- `tests/test_lop_b_and_audit_query.py` — uses `settings_factory`; ensure the gateway
  it builds gets `settings=` (and `external_channels=` if it asserts channel
  behavior).
- Run focused: `uv run pytest tests/test_budget_tracker.py tests/test_action_gateway.py
  tests/test_confluence_write.py tests/test_lop_b_and_audit_query.py -q`.
- Then broaden: `uv run pytest -q` (slices C/D not done yet — the in-factory singleton
  reads in `report_graph` etc. still resolve via the wrappers, so the suite should
  stay green). `uv run ruff check src tests`.

## Acceptance

- Storage/budget/llm/gateway no longer import or call `get_settings`.
- Action writers no longer call `get_reporting_config`; their handlers get config via
  payload/closure, not a singleton.
- `grep -n "get_settings" src/agent/checkpoint.py src/actions/dedup_store.py
  src/audit/audit_log.py src/actions/approval_store.py src/llm/budget_tracker.py
  src/llm/client.py src/actions/action_gateway.py` → 0 hits.
- `grep -n "get_reporting_config" src/actions/confluence_write.py
  src/actions/slack_write.py` → 0 hits. (`action_gateway.py` still has
  `_load_external_channels` until D — that's expected; note it.)
- Focused + full suite green; ruff clean.

## Risks / rollback

- **Risk:** a store/client constructed bare somewhere not yet migrated → `TypeError`
  (missing required arg). *Mitigation:* the only bare constructions left after B are
  in the deps factories (Slice C) and entrypoints (Slice D), both of which run after
  B in order; the wrappers do NOT call these constructors, so nothing breaks
  mid-slice. Grep `get_checkpointer()\|ActionGateway()\|LlmClient()\|BudgetTracker()`
  before finishing B to enumerate remaining bare sites and confirm they're all in
  C/D scope.
- **Risk:** handler loses config (the trickiest part — `_slack_post_handler` /
  `_create_page_handler`). *Mitigation:* trace the registration + invocation path
  first (Step 3 note); add a unit test asserting the handler produces the right
  server/space WITHOUT any monkeypatched singleton.
- **Rollback:** revert the 9 source diffs + 4 test diffs. Slice A's wrappers remain,
  so reverting B restores the in-layer singleton fallbacks and the suite is green.
