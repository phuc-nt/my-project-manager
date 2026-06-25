# Phase 03 — Audit view + config view/edit + trigger live-stream (S3)

## Context

- Plan: `./plan.md`; depends on S1 (router + index). Independent of S2 except both edit
  `agent_detail.html` nav — run after S2 to avoid a parallel edit of that template.
- Audit: `src/audit/audit_log.py` `query(*, tool, verdict, since, limit)` → newest-first redacted
  dicts (`timestamp/verdict/tool/reason/...`); path `agent_data_dir(id)/"audit"/"audit.jsonl"`
  (same as `mpm_manage_cmds._audit` `:106`).
- Profile: `src/profile/loader.py:66` `load_profile`; the 4 files at `profiles/<id>/...`;
  `:34` `profile_memory_path(id)`; `_PROFILES_DIR = REPO_ROOT/"profiles"`.
- Validation builders (RAISE on bad config): `src/profile/loader_mapping.py:69`
  `build_settings_dict(yaml_doc, data_dir)`, `:97` `build_reporting_dict(yaml_doc)`;
  `src/config/config_builders.py` `build_settings_from_dict` / `build_reporting_config_from_dict`.
  **Stakeholder cross-validation raises `RuntimeError`** at
  `src/config/config_builders_reporting.py:81-83`.
- Trigger + SSE (reuse as-is): `routes_runs.py:27` `POST /api/agents/{id}/trigger` → `{run_id,thread_id}`;
  `:58` `GET /api/runs/{run_id}/stream`.
- id validation: same registry-membership gate as S2.

## Goal

Surfaces **(b)** recent audit, **(d)** config view + EDIT (yaml validated-atomic; SOUL/PROJECT
free-text; MEMORY read-only), **(e)** trigger + live SSE view.

## Requirements

### Audit (`routes_audit.py`, < 120 LOC)
- `GET /dashboard/agents/{id}/audit` → `audit/rows.html` partial: validate id (404), build path
  `agent_data_dir(id)/"audit"/"audit.jsonl"`, `AuditLog(path).query(tool=?, verdict=?, since=?,
  limit=20)` (filters from query params, default limit 20), render rows
  (timestamp/verdict/tool/reason). Empty → an "(no audit entries)" row.

### Config view + edit
- `profile_editor.py` (< 150 LOC) — the save/validate logic, OUT of the router:
  - `read_profile_files(agent_id) -> dict` — returns the 4 files' text (yaml, soul, project, memory)
    by reading `profiles/<id>/...` (validate id first). Memory is read-only context.
  - `save_profile_yaml(agent_id, new_text) -> None` — **validate in memory, then atomic commit**:
    1. `yaml.safe_load(new_text)`; non-dict → raise `ValueError` (mirror `load_profile`'s mapping check).
    2. `build_settings_from_dict(build_settings_dict(doc, agent_data_dir(id)))` and
       `build_reporting_config_from_dict(build_reporting_dict(doc))` — these RAISE
       (`RuntimeError`/`ValueError`) on bad config incl. the stakeholder-channel rule. **No file
       touched yet.**
    3. On clean build: write to `profiles/<id>/profile.yaml.tmp`, then
       `os.replace(tmp, profiles/<id>/profile.yaml)` (atomic). On any raise: do NOT write; propagate.
    - This reuses the REAL validation (the same builders `load_profile` calls) without the temp-dir
      copy dance, and the original file is byte-unchanged on failure.
  - `save_markdown(agent_id, filename, new_text)` — for `SOUL.md`/`PROJECT.md` only (reject any other
    name, esp. `MEMORY.md`): atomic write-temp → `os.replace`. Free-text, no validation.
- `routes_profile.py` (< 180 LOC), HTML-partial pattern:
  - `GET /dashboard/agents/{id}/config` → `config/view.html`: the 4 files in editable `<textarea>`s
    for yaml/soul/project (each its own `hx-post` form), and `memory` in a **read-only**
    `<pre>`/`<textarea readonly>` with a note "agent self-writes via the remember node — read-only".
  - `POST /dashboard/agents/{id}/config/profile` → `save_profile_yaml`; on success return a
    `config/saved.html` "saved" partial; on `RuntimeError`/`ValueError` → **400** returning a
    `config/error.html` partial with the **exact** error message (htmx swaps it next to the form).
  - `POST /dashboard/agents/{id}/config/soul` and `.../project` → `save_markdown`; success/empty
    partials. **No** route for memory (read-only).

### Trigger + live stream (`run` view)
- `GET /dashboard/agents/{id}/run` → `run/view.html`: a form (kind/audience/dry_run) that
  `hx-post`s the **existing** `/api/agents/{id}/trigger`, reads `{run_id}` from the JSON, and opens
  an SSE connection to the **existing** `/api/runs/{run_id}/stream`. Because htmx does not natively
  consume SSE-into-DOM here without the SSE extension, use a tiny inline `<script>` (EventSource) OR
  the htmx SSE extension if vendored. KISS: a ~15-line inline `EventSource` that appends events to a
  `<pre>` is sufficient and needs no extra vendoring. The trigger + stream routes are **reused
  as-is** — this view only calls them.

### app.py
- Include `routes_audit.router` + `routes_profile.router`. Wire the three nav buttons in
  `agent_detail.html` (Audit / Config / Run).

## Files to create / modify

**Create:** `src/server/routes_audit.py`, `src/server/routes_profile.py`,
`src/server/profile_editor.py`, `src/server/templates/audit/rows.html`,
`src/server/templates/config/{view,saved,error}.html`, `src/server/templates/run/view.html`.

**Modify:** `src/server/app.py` (two includes), `src/server/templates/agent_detail.html` (nav).

## Step-by-step

1. `profile_editor.py` — implement `read_profile_files`, `save_profile_yaml` (in-memory validate →
   atomic replace), `save_markdown` (whitelist soul/project only).
2. `routes_profile.py` + `config/` templates; wire `app.py`.
3. `routes_audit.py` + `audit/rows.html`; wire `app.py`.
4. `run/view.html` + the `routes_dashboard` (or a thin route in `routes_profile`/new) GET that serves
   it; the form targets the existing trigger/stream routes.
5. Wire the three nav buttons in `agent_detail.html`.
6. Tests; `ruff`; LOC check.

## Tests / validation (offline, TestClient)

New: `tests/test_server_config.py`
- `test_config_view_shows_four_files` — monkeypatch `read_profile_files` (or seed a tmp
  `profiles/<id>/`); `GET .../config` → 200 HTML with yaml/soul/project textareas + memory read-only
  + the read-only note.
- `test_save_valid_yaml_commits` — seed a tmp profile dir; POST a valid yaml → 200 saved partial;
  the file on disk now contains the new content (atomic replace happened).
- `test_save_broken_yaml_rejects_and_keeps_original` — capture the original bytes; POST a yaml whose
  stakeholder channel is NOT in the external set → **400**, the error partial contains the
  `SLACK_STAKEHOLDER_CHANNEL ... must also be listed` message, AND the file bytes are **unchanged**.
- `test_save_non_mapping_yaml_400` — POST `"- a\n- b"` (a list) → 400.
- `test_memory_has_no_save_route` — `POST .../config/memory` → 404/405 (route absent).
- `test_save_markdown_soul_only` — `.../config/soul` saves; an attempt to save `memory` via the
  markdown route is rejected.

New: `tests/test_server_audit.py`
- `test_audit_rows_render` — seed `agent_data_dir(id)/audit/audit.jsonl` (like `test_mpm_manage_cmds`
  audit test) with a few lines; `GET .../audit` → 200 HTML with the verdicts/tools; empty file →
  "(no audit entries)".
- `test_audit_unknown_agent_404`.

New: `tests/test_server_run_view.py`
- `test_run_view_renders_form` — `GET .../run` → 200 HTML, form posts to `/api/agents/{id}/trigger`
  and references `/api/runs/` for the stream (string checks; no run started).
- (The actual trigger/stream behavior is already covered by the P6 run tests — not re-tested here.)

Gates: full suite green; `ruff` clean; `routes_audit.py` < 120, `routes_profile.py` < 180,
`profile_editor.py` < 150 LOC.

## Risks + rollback

- **Validate path mutates the real file early** → validate fully in memory BEFORE any write;
  `os.replace` only on success; the keeps-original test guards it.
- **Markdown route used to clobber MEMORY.md** → `save_markdown` whitelists `SOUL.md`/`PROJECT.md`
  only; memory has no POST route; test asserts it.
- **id path-escape on audit/config** → registry-membership gate before any path build (same as S2).
- **Rollback:** delete `routes_audit.py`, `routes_profile.py`, `profile_editor.py`, the
  `audit/config/run` templates; remove the two `app.py` includes + the three nav buttons. No
  schema/data change — pure file deletion. `MEMORY.md` and all profiles untouched.

## Status

Pending.
