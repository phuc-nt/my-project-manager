# Phase 02 — Web approve/reject + extract shared dispatch (S2)

## Context

- Plan: `./plan.md`; depends on S1 (router + index exist).
- Gateway: `src/actions/action_gateway.py:272` `pending_approvals()`, `:276`
  `approve(id, *, handler)` → `GatewayResult` (raises **`ValueError`** for unknown/consumed id;
  Lớp A still applies → **`HardBlockedError`** at `:45`/`:220`), `:303` `reject(id)`.
- Store: `src/actions/approval_store.py:22` `PendingApproval(id, action, reason, status, created_at)`;
  action is **already redacted** at `enqueue` (`:60`) — safe to render.
- **DRY target (duplicated, verified):** `_dispatch_approved_action` exists in
  `src/entrypoints/cli.py:220` AND `src/entrypoints/mpm_manage_cmds.py:37`, functionally identical
  (both `make_slack_post_handler(config.slack_server)(action)`; else raise).
- CLI usage: `cli.py:211` and `mpm_manage_cmds.py:84` call
  `gw.approve(id, handler=lambda a: _dispatch_approved_action(a, config))`.
- Test stub pattern: `tests/test_mpm_manage_cmds.py:67` monkeypatches
  `src.actions.slack_write.make_slack_post_handler` → asserts the stub ran; `gw.execute`/`approve`
  with `dry_run=False` to hit the real-post path. `tests/test_audience_delivery.py:253` imports
  `cli._dispatch_approved_action` directly.

## Goal

(1) Extract the duplicated dispatcher to `src/actions/approved_dispatch.py` (DRY; removes the
web→entrypoint import smell). (2) Add web approve/reject routes that reuse the gateway + the
extracted dispatcher — the SAME real-post path as the CLI. (3) Two-step confirm HTMX flow for
approve; one-click reject. Surface **(c)**.

## Requirements

- **Extract:** `src/actions/approved_dispatch.py` with
  `dispatch_approved_action(action: dict, config) -> str` — body identical to the current copies,
  keeping the `make_slack_post_handler` import **lazy inside the function** (so the existing
  monkeypatch target `src.actions.slack_write.make_slack_post_handler` still works).
  Update `cli.py` and `mpm_manage_cmds.py` to import + delegate: keep a thin
  `_dispatch_approved_action = dispatch_approved_action` alias (module-level) so
  `cli._dispatch_approved_action` / `mpm_manage_cmds._dispatch_approved_action` still resolve for
  the existing tests, OR re-point those tests — **prefer the alias** (zero test churn, smaller diff).
- **Web routes** (`routes_approvals.py`, < 200 LOC), HTML-partial pattern:
  - `GET /dashboard/agents/{id}/approvals` → `approvals/list.html` partial: pending rows (id,
    created_at, reason, the redacted action's tool + channel + message text), each with a
    "Reject" button (`hx-post .../reject`) and an "Approve" button (`hx-get .../approve/{aid}/confirm`).
  - `GET /dashboard/agents/{id}/approvals/{aid}/confirm` → `approvals/confirm.html` partial: shows
    **what will be posted** (tool + channel + message text) + a "Confirm post" button
    (`hx-post .../approve/{aid}`) + a "Cancel" (`hx-get` back to the list).
  - `POST /dashboard/agents/{id}/approvals/{aid}/approve` → build the gateway
    `ActionGateway(loaded.settings, external_channels=loaded.config.slack_external_channels)`, call
    `gw.approve(aid, handler=lambda a: dispatch_approved_action(a, loaded.config))`; on success return
    the **refreshed** `approvals/list.html` partial. Error mapping:
    `ValueError` (bad/consumed id) → **400**; `HardBlockedError` (Lớp A) → **403**;
    other handler failure (`RuntimeError`) → **500** with the message.
  - `POST /dashboard/agents/{id}/approvals/{aid}/reject` → `gw.reject(aid)`; return the refreshed list.
- **id validation:** every route validates `agent_id` BEFORE building a path. Reuse the existing
  gate: `agent_id not in {e.id for e in load_registry()}` → 404 (same check `agent_status` /
  `routes_runs` use), which also covers the path-escape case (a malformed id is never registered).
  `load_profile(id, data_dir=agent_data_dir(id))` then builds the gateway at the agent's own store.
- **Connection hygiene:** the gateway opens approval + dedup SQLite connections. Build it per request
  and **close** in a `finally` (mirror `agent_views._pending_count` which opens+closes the store) so
  the long-lived server does not leak fds. If the gateway has no `close()`, close the underlying
  stores it exposes, or add a minimal close — confirm the gateway's store-ownership before deciding.

## Files to create / modify

**Create:**
- `src/actions/approved_dispatch.py` (< 60 LOC) — the shared `dispatch_approved_action`.
- `src/server/routes_approvals.py` (< 200 LOC) — the 4 routes above.
- `src/server/templates/approvals/list.html` — pending-rows partial.
- `src/server/templates/approvals/confirm.html` — the confirm partial (action detail).

**Modify:**
- `src/entrypoints/cli.py` — replace the inline `_dispatch_approved_action` body with
  `from src.actions.approved_dispatch import dispatch_approved_action` + alias; keep call sites.
- `src/entrypoints/mpm_manage_cmds.py` — same: import + alias `_dispatch_approved_action`.
- `src/server/app.py` — `app.include_router(routes_approvals.router)`.
- `src/server/templates/agent_detail.html` — wire the "Approvals" button to `hx-get` the list partial.

## Step-by-step

1. Create `approved_dispatch.py`; move the body; keep the lazy `make_slack_post_handler` import.
2. Repoint `cli.py` + `mpm_manage_cmds.py` (import + module-level alias). Run
   `pytest tests/test_mpm_manage_cmds.py tests/test_audience_delivery.py` — must stay green (the
   alias + lazy import preserve both the call sites and the monkeypatch target).
3. Create `routes_approvals.py` + the two partials. Wire into `app.py` + the detail template.
4. Tests (below). Run the new file + the two entrypoint test files + `test_server_*`.

## Tests / validation (offline, stubbed handler — NO network)

New: `tests/test_server_approvals.py` (seed a real `ApprovalStore` under tmp like
`test_mpm_manage_cmds.py`; monkeypatch `agent_views`/`load_profile` to point at tmp `data_dir`;
monkeypatch `src.actions.slack_write.make_slack_post_handler` to a stub recording the action):
- `test_approvals_list_shows_action_detail` — `GET .../approvals` → 200 HTML containing the channel
  + message text from the seeded action.
- `test_confirm_partial_shows_what_posts` — `GET .../approve/{aid}/confirm` → 200 HTML with tool +
  channel + message + a Confirm button posting to the approve route.
- `test_approve_runs_real_handler_no_network` — `POST .../approve/{aid}` → 200; the **stub ran**
  (recorded `args.channel`), the approval is consumed (`list_pending()==[]`), response is the
  refreshed list partial (no pending row).
- `test_approve_bad_id_400` — approve a non-pending/unknown id → `ValueError` → 400.
- `test_approve_lop_a_hard_block_403` — seed an action that trips Lớp A (or monkeypatch the gateway's
  hard-block path) so `gw.approve` raises `HardBlockedError` → 403.
- `test_reject_one_click` — `POST .../reject/{aid}` → 200 refreshed list; approval marked rejected
  (`list_pending()==[]`); no handler stub invoked.
- `test_unknown_agent_404` — a non-registered id on any approvals route → 404.
- Entrypoint regression: `tests/test_mpm_manage_cmds.py` + `tests/test_audience_delivery.py` green
  (proves the extraction preserved behavior).

Gates: full suite green; `ruff` clean; both new `.py` files < 200 LOC.

## Risks + rollback

- **Extraction breaks the monkeypatch target** → keep `make_slack_post_handler` import lazy inside
  the function; the alias preserves `cli._dispatch_approved_action`. Step 2 runs those tests first.
- **Approve route renders an unredacted secret** → action is redacted at `enqueue`; render the stored
  action as-is.
- **Gateway connection leak** → build per request, close in `finally`.
- **Rollback:** restore the two inline dispatch copies, delete `approved_dispatch.py` +
  `routes_approvals.py` + the approvals templates, remove the `app.py` include + the detail-template
  button. CLI/mpm behavior unchanged.

## Status

Pending.
