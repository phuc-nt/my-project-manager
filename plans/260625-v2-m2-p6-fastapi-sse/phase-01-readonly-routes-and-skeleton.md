# Phase 1 — Read-only routes + app skeleton + deps

**Goal**: Prove the FastAPI wiring at zero graph risk. App skeleton, dependency adds, the two
read-only routes (`GET /api/agents`, `GET /api/agents/{id}/status`), and a shared run-event
reader. NO graph run, NO SSE. Ends green.

## Context links

- `plan.md` (this dir) — locked decisions, verified facts, routes table.
- `src/runtime/registry.py:30` `load_registry`; `src/profile/loader.py:60` `load_profile`.
- `src/runtime/service.py:72` `_last_run_event` (to be lifted); `src/runtime/run_event.py:17`.
- `src/llm/budget_tracker.py:34`; `src/actions/action_gateway.py:272`.
- `src/runtime/agent_paths.py:35` `agent_data_dir`.
- Gateway build idiom: `src/entrypoints/mpm_manage_cmds.py:30-34`.

## Requirements

1. Add deps to `pyproject.toml` `dependencies`:
   - `fastapi>=0.136,<1` (latest stable line 0.13x as of 2026-06; floor 0.136).
   - `uvicorn>=0.34` (ASGI server for the `__main__` entrypoint).
   - `sse-starlette>=2.1` (the `EventSourceResponse` used in Slice 3; add now so one `uv sync`
     covers all slices).
   Run `uv sync`. Confirm `uv run python -c "import fastapi, uvicorn, sse_starlette"` clean.
2. Lift `_last_run_event` into `run_event.py` as a public `read_last_run_event(agent_id)` so the
   new service does not import a `service.py`-private. Refactor `service.py:72` to delegate
   (behavior-preserving — same return contract `dict | None`). Keep `service.py`'s private name
   as a thin alias OR update its one caller at `service.py:69`; prefer updating the caller.
3. Create the `src/server/` package with the app + the two read-only routes.
4. Read-only route contracts (exact):
   - `GET /api/agents` → `[{id, name, enabled, last_run}]`. `enabled` = registry enabled AND
     profile enabled (mirror `service.py` gating: an agent is "enabled" only when both true).
     `last_run` = `read_last_run_event(id)` (the dict, or `null`). Order = registry order.
   - `GET /api/agents/{id}/status` → `{id, name, enabled, last_run, budget, pending_approvals}`.
     - `budget` = `{spent, cap, ratio}` from `BudgetTracker(loaded.settings).spent_this_month()`
       and `loaded.settings.monthly_budget_usd` (`ratio = spent/cap if cap>0 else 0.0`).
     - `pending_approvals` = `len(ActionGateway(loaded.settings, external_channels=loaded.config.slack_external_channels).pending_approvals())`,
       built with `loaded = load_profile(id, data_dir=agent_data_dir(id))`.
     - `404` (`HTTPException`) if `id` not in `load_registry()` ids.
5. The app loads profiles at the per-agent data dir (`agent_data_dir(id)`) — exactly like the
   worker / mpm_manage path — so budget + approvals point at the migrated per-agent store.

## Files to create

| File | LOC est | Purpose |
|---|---|---|
| `src/server/__init__.py` | ~3 | package marker + docstring |
| `src/server/app.py` | ~45 | `create_app()` builds `FastAPI`, mounts routers; module docstring states the localhost-only + no-auth assumption and that external exposure needs auth (deferred). `app = create_app()` at module level for TestClient. (No `__main__` yet — added in Slice 3.) |
| `src/server/agent_views.py` | ~70 | pure assembly helpers: `list_agents() -> list[dict]`, `agent_status(agent_id) -> dict`, `_load_for(agent_id)`. These import the primitives; the routers stay thin. Raises `KeyError`/`LookupError` for unknown id (router maps to 404). |
| `src/server/routes_agents.py` | ~45 | `APIRouter` with the two GET routes; calls `agent_views`; maps unknown-id → `HTTPException(404)`. |
| `tests/test_server_agents.py` | ~90 | offline TestClient tests (see below). |

## Files to modify

- `pyproject.toml` — add the 3 deps.
- `src/runtime/run_event.py` — add `read_last_run_event(agent_id) -> dict | None` (move the
  body of `service._last_run_event`). Keep it dependency-light (uses `agent_data_dir`, `json`).
- `src/runtime/service.py` — replace the private `_last_run_event` body with a call to
  `read_last_run_event` (or import + alias); update the caller at `:69`. No behavior change.

## Step-by-step

1. `pyproject.toml`: add deps → `uv sync` → import smoke.
2. `run_event.py`: add `read_last_run_event`. `service.py`: delegate + adjust caller. Run
   `uv run pytest tests/test_service.py tests/test_worker.py -q` (must stay green — proves the
   extract is behavior-preserving).
3. `agent_views.py`: implement `list_agents`, `agent_status`, `_load_for`. Keep PII out of the
   list view (only `name/enabled/last_run`; `last_run` is the run-event dict which is already
   non-PII: `agent_id, kind, audience, status, cost_usd, delivered, ts`).
4. `routes_agents.py`: wire the router; unknown id → 404.
5. `app.py`: `create_app()` + module-level `app`. Docstring: localhost-only, no auth, external
   exposure deferred.
6. `tests/test_server_agents.py`: write tests, run, then `ruff check`.

## Tests / validation (offline)

Use a `tmp_path` registry + profiles fixture (mirror `tests/test_service.py` setup) OR
monkeypatch `load_registry` / `load_profile` to return fakes — pick whichever the existing
service tests use, for consistency. All offline (no network, no real LLM).

- `test_list_agents_one_entry_per_registry_agent` — 2 agents in registry → 2 entries, correct
  `name/enabled`, `last_run` is the last run-event or `null`.
- `test_status_includes_budget_and_pending` — seed a `runs.jsonl` + a budget file + a pending
  approval; assert `budget.spent/cap/ratio` and `pending_approvals` count.
- `test_status_unknown_id_404`.
- `test_enabled_is_registry_and_profile_and` — registry-enabled but profile-disabled ⇒
  `enabled: false`.
- `test_list_and_status_no_network` — assert no `OPENROUTER_API_KEY` needed (graph never built).

Validation gate: `uv run pytest tests/test_server_agents.py tests/test_service.py
tests/test_worker.py -q` green + `uv run ruff check src/server tests/test_server_agents.py`.

## Risks + rollback

- **R-extract**: lifting `_last_run_event` could change behavior. Mitigation: it is a verbatim
  move; the existing `test_service.py` exercising the caller must stay green (the gate). If a
  test fails, the extract was not verbatim — fix before proceeding.
- **R-deps**: a FastAPI/Starlette version that breaks import. Mitigation: floors are
  conservative (`>=0.136`); `uv sync` + import smoke before building routers.
- **Rollback**: revert the commit. `server/` is additive; `run_event.py` + `service.py` revert
  to the private helper. `pyproject.toml` + lockfile revert with the commit.

## File-size guard

All new files < 200 LOC by design (largest is the test at ~90). If `agent_views.py` grows past
~120, split the status assembly (`_budget_view`, `_pending_count`) into `agent_status_view.py`.
