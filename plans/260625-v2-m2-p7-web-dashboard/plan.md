---
title: "v2 M2-P7 — Localhost Web Dashboard (HTMX + Jinja2 on the P6 FastAPI app)"
description: "Server-rendered ops dashboard adding 6 surfaces to the existing P6 app: agent list/status/budget, audit, on-UI Lớp B approve/reject, config view+edit, trigger+live SSE."
status: pending
priority: P1
effort: 11h
branch: main
tags: [v2, m2, dashboard, htmx, fastapi]
created: 2026-06-25
---

# M2-P7 — Web Dashboard

A **localhost** ops dashboard, server-rendered HTML (Jinja2 + HTMX) served by the
**existing P6 FastAPI app** (`src/server/app.py`). Purely **additive**: it adds routers +
templates + static + a shared dispatch module. It does **not** change the 4 P6 JSON routes,
`agent_views`, `run_manager`, or the guardrail. One process, not a separate Streamlit.

## Locked decisions (design to these — do not re-litigate)

1. **UI stack = HTMX + Jinja2 on the P6 FastAPI.** `Jinja2Templates` for HTML, HTMX
   **vendored** as `src/server/static/htmx.min.js` (not a CDN — localhost may be offline) for
   partial swaps/POSTs, the existing SSE route for live runs. Add the `jinja2` dep. One process.
2. **All 6 surfaces this round:** (a) agent list + status + cost-vs-budget, (b) recent per-agent
   audit, (c) pending Lớp B approve/reject **on the UI**, (d) config view + **edit**
   (`profile.yaml` + `SOUL.md`/`PROJECT.md` editable; `MEMORY.md` **read-only**),
   (e) trigger on-demand + live SSE view, (f) the dashboard index tying them together.
3. **Approve = the same REAL-post path as the CLI.** A web POST builds the per-agent gateway
   `ActionGateway(loaded.settings, external_channels=loaded.config.slack_external_channels)` and
   calls `gw.approve(id, handler=lambda action: dispatch_approved_action(action, loaded.config))`
   — the **same handler** the CLI uses. Lớp A hard-deny + audit + dedup still apply.
   `reject = gw.reject(id)`. **Reuse** the dispatcher; do not reimplement.
4. **Approve UX = show action detail + confirm before the real post.** The pending row shows
   **what** will be posted (tool + channel + the message text from `action['args']`). Approve is
   a **two-step** HTMX flow: click → confirm partial → confirm POST. Reject is one-click (safe).
5. **Config save = atomic write-temp → validate → commit-or-rollback.** Validate by running the
   **same builders** `load_profile` uses (`build_settings_dict` + `build_reporting_dict` →
   `build_*_from_dict`, which **raise** on bad config incl. the stakeholder-channel
   cross-validation) on the new text **in memory**, without touching the real file; only on a
   clean build `os.replace` the new yaml over `profiles/<id>/profile.yaml`; a raise → reject with
   the error message, original **untouched**. `SOUL.md`/`PROJECT.md` are free-text (atomic direct
   write). `MEMORY.md` is **read-only** (agent self-writes via the P8 `remember` node) — shown, no edit.
6. **Security = unchanged from P6:** localhost-only (`127.0.0.1`), **no auth** (single-operator
   sandbox), DRY_RUN default honored, per-agent guardrail intact. Exposing beyond localhost needs
   auth (deferred) — documented in the app docstring (already present) and the dashboard index.
7. **Offline-testable:** all routes via `fastapi.testclient.TestClient` + monkeypatching
   `agent_views`/`load_profile` + **stubbing** `make_slack_post_handler` so approve tests assert
   the handler **ran** but no real post happens. **No real network** in any test.

## Verified facts (re-grepped at commit ef898a6; file:line)

- `src/server/app.py:23` `create_app()` — `app.include_router(...)`; `app.state.run_manager`
  (shared `RunManager`); `app.py:43` `main()` binds `127.0.0.1`. **Module-level `app = create_app()`.**
- `src/server/agent_views.py:29` `list_agents()` → `[{id,name,enabled,last_run}]`;
  `agent_views.py:56` `agent_status(id)` → `{id,name,enabled,last_run,budget:{spent,cap,ratio},pending_approvals}`;
  `UnknownAgentError` (`agent_views.py:21`). `_pending_count` opens+**closes** the store (no leak).
- `src/server/routes_runs.py:27` `POST /api/agents/{id}/trigger` → `{run_id,thread_id}`;
  `routes_runs.py:58` `GET /api/runs/{run_id}/stream` (`EventSourceResponse`). **Reuse as-is.**
- `src/actions/action_gateway.py:272` `pending_approvals()`; `:276` `approve(id, *, handler)` →
  `GatewayResult` (atomic `transition_if_pending` then `_execute(approved=True)`; Lớp A still
  applies, `HardBlockedError` at `:45`/`:220`); `:303` `reject(id)` → `None` (marks rejected + audits).
  `approve` raises **`ValueError`** for an unknown/already-consumed id.
- `src/actions/approval_store.py:22` `PendingApproval(id, action:dict, reason, status, created_at)`;
  `:80` `list_pending()`. **Action stored redacted** (`enqueue` runs `redact`) — the UI shows the
  redacted action (safe to render).
- `src/audit/audit_log.py` `query(*, tool, verdict, since, limit)` → newest-first redacted dicts
  (fields `timestamp/verdict/tool/reason/...`). Audit path = `agent_data_dir(id)/"audit"/"audit.jsonl"`.
- `src/profile/loader.py:66` `load_profile(id, *, profiles_dir=None, data_dir=None)` → `LoadedProfile`
  (`name,enabled,settings,config,soul,project,memory,...`); `:34` `profile_memory_path(id)`;
  `_PROFILES_DIR = REPO_ROOT/"profiles"`. 4-file dir = `profiles/<id>/{profile.yaml,SOUL.md,PROJECT.md,MEMORY.md}`.
- `src/profile/loader_mapping.py:69` `build_settings_dict(yaml_doc, data_dir)`; `:97`
  `build_reporting_dict(yaml_doc)`. `src/config/config_builders.py` `build_settings_from_dict` /
  `build_reporting_config_from_dict`. **The stakeholder-channel cross-validation RAISES `RuntimeError`**
  at `src/config/config_builders_reporting.py:81-83` (stakeholder channel must be in the external set).
- `src/runtime/agent_paths.py:25` `_validate_agent_id` (regex `^[a-z0-9][a-z0-9_-]*$`); `:35`
  `agent_data_dir(id)` validates before building the path. **Per-agent routes must validate the id.**
- **DRY finding (beyond scout):** `_dispatch_approved_action` is **duplicated** — `cli.py:220` AND
  `mpm_manage_cmds.py:37`, functionally identical (both `make_slack_post_handler(config.slack_server)`).
  Extracting to `src/actions/approved_dispatch.py` removes **two** copies + the entrypoint-import smell.
- **Test patterns:** `tests/test_server_agents.py` (`_client()=TestClient(create_app())`, monkeypatch
  `agent_views.{load_registry,load_profile,read_last_run_event}`); `tests/test_mpm_manage_cmds.py`
  (seed `ApprovalStore` in tmp, **monkeypatch `src.actions.slack_write.make_slack_post_handler`** →
  assert the stub ran, no real post). The extracted dispatch must keep the **lazy** `make_slack_post_handler`
  import so that same monkeypatch target still works.
- **Env / API smoke (verified offline):** `jinja2` is **NOT installed** (`ModuleNotFoundError`) — dep
  add required. `fastapi 0.138.0` / `starlette 1.3.1`. Confirmed working APIs (offline TestClient smoke):
  `from fastapi.templating import Jinja2Templates`, `from fastapi.staticfiles import StaticFiles`,
  `app.mount("/static", StaticFiles(directory=...), name="static")`,
  `templates.TemplateResponse(request, "name.html", {ctx})` → `text/html` 200, static file served 200.

## Slices (each independently runnable, committable, suite-green)

| # | Slice | Effort | Files (owns) | Depends |
|---|-------|--------|--------------|---------|
| S1 | Jinja2 + StaticFiles wiring; dashboard index + agent list/status/budget (read-only); vendored htmx; `jinja2` dep; offline TestClient tests | 4h | `app.py` (edit), `routes_dashboard.py` (new), `templates/*` (new), `static/htmx.min.js` (new vendored), `pyproject.toml` (edit) | — |
| S2 | Extract `dispatch_approved_action` to `src/actions/`; web approve/reject routes; two-step confirm HTMX flow; pending-approvals partial; offline stubbed tests | 4h | `approved_dispatch.py` (new), `cli.py` (edit), `mpm_manage_cmds.py` (edit), `routes_approvals.py` (new), `templates/approvals/*` (new), `routes_dashboard.py` (edit: link) | S1 |
| S3 | Audit view; config view + **edit** (`profile_editor.py` save-validate-rollback); trigger + live SSE view | 3h | `routes_audit.py` (new), `routes_profile.py` (new), `profile_editor.py` (new), `templates/{audit,config,run}/*` (new), `routes_dashboard.py` (edit: links) | S1 |

Phase files: `phase-01-wiring-and-readonly-dashboard.md`, `phase-02-approve-reject-web.md`,
`phase-03-audit-config-edit-trigger.md`.

Chosen UI pattern (decided): **HTML-partial / htmx-native** — `hx-post`/`hx-get` return an HTML
**fragment** that swaps in (`hx-target`/`hx-swap`), never JSON the client must parse. So the approve
POST returns the **refreshed pending-list partial**; the audit/config GETs return HTML rows/forms.
No client-side JSON, no custom JS beyond vendored htmx.

## Dependency graph

```
S1 (wiring + read-only dashboard + deps + htmx)
 ├── S2 (extract dispatch → approve/reject web + confirm flow)   [needs S1 router + index]
 └── S3 (audit + config-edit + trigger view)                     [needs S1 router + index]
S2 ⟂ S3: independent file ownership (different routers/templates), BUT both edit
   routes_dashboard.py to add nav links → run sequentially OR merge the link edits last.
   Recommend S2 then S3 (single operator), so no parallel edit of routes_dashboard.py.
```

## Acceptance (observable)

- `uv sync` installs `jinja2`; `python -m src.server.app` serves `GET /` (HTML 200) and
  `GET /static/htmx.min.js` (200) when run from the repo root. Paths resolve via
  `Path(__file__).parent`, not cwd.
- `GET /` lists agents with name/enabled badge + budget bar; `GET /dashboard/agents/{id}` shows
  status + budget + pending count. Unknown id → 404. All 6 surfaces reachable from the index.
- **Approve**: clicking Approve shows a confirm partial rendering tool + channel + message text;
  the confirm POST builds the gateway and calls `gw.approve(id, handler=dispatch_approved_action)`
  — tests assert the **stubbed** `make_slack_post_handler` **ran** (no network), the approval is
  consumed, and the refreshed pending partial returns. `ValueError`→400, `HardBlockedError`→403.
- **Reject**: one-click POST marks rejected + audits; refreshed pending partial returns.
- **Config save**: a valid `profile.yaml` edit `os.replace`s the file (load re-reads it); a broken
  yaml (e.g. stakeholder channel NOT in external set) → 400 with the `RuntimeError` message AND the
  **original file is byte-unchanged**. `SOUL.md`/`PROJECT.md` save directly. `MEMORY.md` has no save route.
- **Trigger**: the run page `hx-post`s the existing `/api/agents/{id}/trigger`, gets `{run_id}`, and
  opens an SSE connection to the existing `/api/runs/{run_id}/stream` (reused as-is).
- The 4 P6 JSON routes are **byte-stable**: `tests/test_server_agents.py` + the P6 run tests stay
  green. Full suite ≥ 518 + new tests, all pass. `ruff` clean, every `.py` route file < 200 LOC.

## Risks (likelihood × impact → mitigation)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Template/static paths resolve off cwd → 500 when run from elsewhere | M×H | Use `Path(__file__).parent / "templates"` and `.../"static"`; offline smoke + a test that `create_app()` mounts static and `GET /static/htmx.min.js` is 200 |
| Extracting `dispatch_approved_action` breaks the monkeypatch target in existing mpm/cli tests | M×H | Keep the **lazy** `from src.actions.slack_write import make_slack_post_handler` **inside** the function; re-export/import in both entrypoints so `cli._dispatch_approved_action` and `mpm_manage_cmds._dispatch_approved_action` still resolve (thin aliases). Run `test_mpm_manage_cmds.py` + `test_audience_delivery.py` first |
| Config validate-path accidentally mutates the real file before validation | L×H | Validate **in memory** (parse new text → builders) BEFORE any write; only `os.replace` on success; test asserts original byte-identical after a rejected save |
| Approve route leaks gateway SQLite connections per request (long-lived server) | M×M | Mirror `_pending_count`: build the gateway, use it, and ensure stores close (the gateway opens approval+dedup conns) — add a `close()`/context use or build per-request + close in a `finally`; assert no fd growth is out of scope, but close explicitly |
| HTMX not vendored (offline) → broken UI | L×M | S1 step vendors `htmx.min.js`; tests assert the HTML **references** `/static/htmx.min.js` (string check), do not fetch a CDN |
| Rendering a pending action's message text could surface a secret | L×M | Action is **already redacted** at `enqueue` (verified `approval_store.py:60`); render the stored (redacted) action — no extra leak path |
| A route .py exceeds 200 LOC | M×M | Split per surface (`routes_approvals`/`routes_audit`/`routes_profile`/`routes_dashboard`); templates are `.html` (no LOC cap); `profile_editor.py` holds the save/validate logic out of the router |

## Rollback (per slice)

- **S1:** revert `app.py` router include + the new files; remove the `jinja2` dep line; the 4 P6
  routes are untouched, suite returns to baseline.
- **S2:** revert the two entrypoint edits back to their inline copies + delete `approved_dispatch.py`
  + the approvals router/templates. CLI/mpm approve paths unchanged in behavior.
- **S3:** delete the audit/profile routers + `profile_editor.py` + their templates; index nav loses
  three links. No data migration, no schema change anywhere — pure file deletion reverts cleanly.

## Out of scope (YAGNI)

Auth, multi-operator, websockets (SSE suffices), client-side framework, a build step, editing
`MEMORY.md`, editing the registry from the UI, pagination beyond the audit `limit`, dark mode.

## Status

Pending. Start S1.
