# Phase 01 — Jinja2 + StaticFiles wiring + read-only dashboard (S1)

## Context

- Plan: `./plan.md`
- App factory: `src/server/app.py:23` (`create_app()`), `:43` (`main()` binds 127.0.0.1)
- Views to reuse: `src/server/agent_views.py:29` `list_agents()`, `:56` `agent_status(id)`,
  `:21` `UnknownAgentError`
- Test pattern: `tests/test_server_agents.py` (`TestClient(create_app())`, monkeypatch `agent_views`)
- Verified API (offline smoke, fastapi 0.138 / starlette 1.3.1): `Jinja2Templates(directory=...)`,
  `StaticFiles(directory=...)`, `templates.TemplateResponse(request, "name.html", {ctx})`.

## Goal

Wire Jinja2 + StaticFiles into the existing app, add a **read-only** dashboard (index + agent list
with budget bars + an agent-detail page), vendor htmx, add the `jinja2` dep. No writes, no approve,
no edit yet — those are S2/S3. The 4 P6 JSON routes stay byte-stable.

## Requirements

- Add `jinja2` to `pyproject.toml` deps; `uv sync`.
- `create_app()` additionally: mounts `/static` and includes a new `routes_dashboard.router`.
  Templates + static dirs resolve from `Path(__file__).parent` (NOT cwd) so
  `python -m src.server.app` works from the repo root.
- Surfaces this slice: **(f)** dashboard index, **(a)** agent list + enabled badge + cost-vs-budget bar,
  the agent-detail page (status + budget + pending count, all from `agent_status`).
- HTML-partial pattern: the index is a full page; the agent rows can be a server-rendered include.
  No client JS beyond vendored htmx (referenced for S2/S3 interactions; harmless on a read-only page).

## Files to create / modify

**Create:**
- `src/server/routes_dashboard.py` (< 200 LOC) — HTML page routes:
  - `GET /` → `index.html` (the dashboard: agent list via `agent_views.list_agents()`).
  - `GET /dashboard/agents/{agent_id}` → `agent_detail.html` (via `agent_views.agent_status(id)`;
    `UnknownAgentError` → `HTTPException(404)`).
  - Holds the module-level `Jinja2Templates(directory=Path(__file__).parent / "templates")`.
- `src/server/templates/base.html` — shared layout: `<head>` references `/static/htmx.min.js`
  (`<script src="/static/htmx.min.js"></script>`) + minimal inline CSS for budget bars/badges
  (inline `<style>` is fine on localhost, no CSP). A `{% block content %}`.
- `src/server/templates/index.html` — extends base; lists agents (name, enabled badge, budget bar
  `spent/cap`, last-run summary); each row links to the detail page + nav placeholders (filled S2/S3).
- `src/server/templates/agent_detail.html` — extends base; status, budget, pending-approvals count,
  last run; placeholder buttons "Approvals / Audit / Config / Trigger" (wired in S2/S3).
- `src/server/static/htmx.min.js` — **vendored** (~50KB). Fetch once from the htmx release
  (e.g. `https://unpkg.com/htmx.org@2/dist/htmx.min.js`) and commit the file. If offline at
  build time, write a placeholder file with a clear `/* TODO vendor real htmx */` comment so the
  mount + tests pass, and flag it to the operator to drop the real file in before use.

**Modify:**
- `src/server/app.py` — in `create_app()`, after the existing includes add:
  `app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")), name="static")`
  and `app.include_router(routes_dashboard.router)`. Add the two imports
  (`from pathlib import Path`, `from fastapi.staticfiles import StaticFiles`,
  `from src.server import routes_dashboard`). **Do not** touch `main()` or the existing routers.
- `pyproject.toml` — add `"jinja2>=3.1"` to `dependencies`.

## Step-by-step

1. Add `jinja2` dep; `uv sync`; confirm `uv run python -c "import jinja2"` works.
2. Create `src/server/static/` and vendor `htmx.min.js` (see note above for the offline fallback).
3. Create `src/server/templates/{base,index,agent_detail}.html`.
4. Create `routes_dashboard.py` with the two GET routes + the `Jinja2Templates` instance.
5. Wire `app.py` (mount + include). Verify nothing else in `create_app()` changed.
6. Run the offline smoke: `TestClient(create_app()).get("/")` → 200 `text/html`;
   `.get("/static/htmx.min.js")` → 200.
7. Tests (below). Run `ruff check src/server tests` + the new test file + the P6 test files.

## Tests / validation (offline, TestClient)

New: `tests/test_server_dashboard.py`
- `test_index_renders_agent_list` — monkeypatch `agent_views.list_agents` (or its underlying
  `load_registry`/`load_profile`/`read_last_run_event` like `test_server_agents.py`) to two agents;
  `GET /` → 200, `content-type` startswith `text/html`, body contains both agent names + a budget bar
  marker + the string `/static/htmx.min.js`.
- `test_agent_detail_renders_status` — monkeypatch `agent_views.agent_status` to a fixed dict
  (spent/cap/ratio/pending); `GET /dashboard/agents/acme` → 200, body contains the budget numbers +
  pending count.
- `test_agent_detail_unknown_404` — `agent_status` raises `UnknownAgentError`; route → 404.
- `test_static_htmx_served` — `GET /static/htmx.min.js` → 200 (file exists, mount works).
- `test_p6_json_routes_unchanged` — sanity: `GET /api/agents` still 200 with the SAME JSON shape
  (reuses the `test_server_agents` monkeypatch helpers) — proves the dashboard is additive.

Validation gates: full `pytest` ≥ 518 + new tests green; `ruff check` clean; `routes_dashboard.py` < 200 LOC.

## Risks + rollback

- **Path resolves off cwd** → use `Path(__file__).parent`; the `test_static_htmx_served` test catches it.
- **htmx not vendored offline** → placeholder file + operator flag; tests only string-check the reference.
- **Rollback:** revert `app.py` (remove mount + include + imports), delete `routes_dashboard.py` +
  `templates/` + `static/`, drop the `jinja2` dep line. The 4 P6 routes + their tests are untouched.

## Status

Pending.
