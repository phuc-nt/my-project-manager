---
phase: 4
title: Migrate ops surfaces
status: completed
effort: M
---

# Phase 4: Migrate ops surfaces

## Overview

Move the 3 operator surfaces — **approve/reject**, **config view+edit**, **trigger + live SSE**
— from htmx partials to React, calling the EXISTING backend endpoints. The backend write paths
are NOT rewritten: React only replaces the UI. **RED LINE:** approve must reach
`gw.approve(id, handler=dispatch_approved_action)` exactly as the htmx UI does today — no
bypass, no new write path. The htmx ops routes stay live until S5; this slice builds the React
equivalents on top of the same (or thin JSON-ified) endpoints.

## Requirements

- **Approve/Reject (React):** two-step confirm flow (list → confirm showing exactly what posts →
  confirm POST), matching the htmx flow at `src/server/routes_approvals.py:61-113`. **The confirm
  step is CLIENT-SIDE — NO separate confirm endpoint** (decided): the "what will be posted"
  detail is the already-redacted pending action from `GET /api/agents/{id}/approvals` (or
  `GET /api/automation/{id}`), which React shows in a confirm dialog before the POST. The confirm
  POST hits the REAL approve endpoint, which runs `gw.approve(approval_id, handler=lambda a:
  dispatch_approved_action(a, loaded.config))` (`routes_approvals.py:90`). React must NOT
  construct or post the action itself — it only triggers the existing endpoint.
- **Backend shape for approvals:** the current approve/reject routes return **HTML partials**
  (`routes_approvals.py` imports `templates` from `routes_dashboard`). React needs JSON, not
  HTML. Add **JSON sibling endpoints** (e.g. `POST /api/agents/{id}/approvals/{aid}/approve`,
  `.../reject`, `GET /api/agents/{id}/approvals`) that call the SAME `gw.approve(...)` /
  `gw.reject(...)` / `gw.pending_approvals()` with the SAME per-request `_gateway(loaded)` build
  + `finally: gw.close()` discipline (`routes_approvals.py:41-58`, `84-101`). Keep the HTML
  routes untouched until S5 (parallel UIs). **No new write logic** — the JSON route is a thin
  re-presentation of the existing handler body.
- **Config view+edit (React):** read the 4 files via `profile_editor.read_profile_files(id)`
  (`src/server/profile_editor.py:31`); edit profile.yaml through
  `profile_editor.save_profile_yaml(id, text)` (validate-in-memory → atomic replace; bad edit →
  validation error preserved, original kept — `routes_profile.py:35-45`), SOUL.md/PROJECT.md via
  `save_markdown`, **MEMORY.md read-only** (agent self-writes it). Add JSON sibling endpoints
  mirroring the htmx config routes (`routes_profile.py:25-59`); React renders the editor + shows
  the EXACT validation message on a 400.
- **Trigger + SSE (React):** these endpoints are ALREADY JSON/SSE — `POST
  /api/agents/{id}/trigger` returns `{run_id, thread_id}` (`routes_runs.py:27-55`) and `GET
  /api/runs/{run_id}/stream` is SSE (`routes_runs.py:58-70`). **No backend change**; build the
  React trigger form (kind/audience/dry_run, with the strict-audience contract honored client-
  side too) + live viewer reusing the S3 `useSse` hook.
- All actions go through the S2 `api/client.ts`.

## Architecture

```
React ops views                       backend (write paths UNCHANGED)
  Approvals.tsx ──GET  /api/.../approvals──────▶ gw.pending_approvals()  (open→close)
              ──POST /api/.../approve ────────▶ gw.approve(id, handler=dispatch_approved_action)  ◀── RED LINE
              ──POST /api/.../reject  ────────▶ gw.reject(id)
  Config.tsx   ──GET  /api/.../config ─────────▶ profile_editor.read_profile_files
              ──POST /api/.../config/profile ─▶ profile_editor.save_profile_yaml (validate→atomic)
              ──POST /api/.../config/{soul|project} ─▶ save_markdown   (memory = read-only, no route)
  Trigger.tsx  ──POST /api/agents/{id}/trigger ─▶ run_manager.start  (EXISTING, unchanged)
              ──SSE  /api/runs/{run_id}/stream ─▶ stream_run         (EXISTING, firewall-projected)
```

**Why JSON siblings, not reuse the htmx routes:** the htmx approve/config routes return Jinja2
partials and depend on `routes_dashboard.templates`. React needs JSON. The cleanest, lowest-risk
move: add thin JSON routes that call the **identical** gateway/editor functions, and delete the
HTML routes in S5. This avoids a content-negotiation hack on one route and keeps the htmx UI
fully working in parallel. The new JSON approve route's body is a near-copy of
`routes_approvals.py:84-101` (same try/except mapping: `ValueError`→400, `HardBlockedError`→403,
`RuntimeError`→502, `finally: gw.close()`).

**RED LINE (approve):** the new JSON approve handler MUST call
`gw.approve(approval_id, handler=lambda a: dispatch_approved_action(a, loaded.config))` and
nothing else for the post. It must NOT: build the action client-side, call any MCP/Slack/Linear/
email adapter directly, or skip the gateway. Lớp A hard-deny + audit + dedup apply via the
gateway exactly as today. A dedicated red-line test asserts the real gateway path is hit.

## Related Code Files

### Create
- `src/server/ops_helpers.py` (or similar shared module) — EXTRACT `_require_agent` + `_gateway`
  out of `routes_approvals.py:27-47` into a module both the htmx routes and the new JSON routes
  import (DRY). The extracted helper SURVIVES S5's htmx deletion; the duplicate would not, so
  extraction is the right call even for a short parallel window. Update `routes_approvals.py` to
  import from the new module (the htmx route bodies otherwise unchanged this slice).
- `src/server/routes_ops_json.py` — JSON siblings for approvals + config (thin; call existing
  `ActionGateway` + `profile_editor` fns, reusing the extracted `ops_helpers`).
- `web/src/views/Approvals.tsx`, `web/src/views/Config.tsx`, `web/src/views/Trigger.tsx`.
- `web/src/components/ConfirmDialog.tsx` (two-step approve confirm), `web/src/components/ConfigEditor.tsx`.
- `tests/test_server_ops_json.py` — JSON approve hits the REAL gateway path (offline, stubbed
  post handler — follow `tests/test_server_approvals.py`'s monkeypatch + stubbed-Slack pattern);
  config-edit validation path intact (bad yaml → 400 with exact message, original kept).
- `web/src/views/*.test.tsx` — vitest: approve calls the right endpoint; confirm step required.

### Modify
- `src/server/routes_approvals.py` — import `_require_agent`/`_gateway` from the new
  `ops_helpers` module instead of defining them locally (extraction only; route behavior
  unchanged). This file is DELETED in S5, so this edit is throwaway — but the extracted helper it
  now imports is what both UIs share.
- `src/server/app.py` — `include_router(routes_ops_json.router)` (one line). (The htmx routers
  stay registered until S5.)
- `web/src/routes.tsx` — wire the 3 ops routes.
- `web/src/api/client.ts` — add `getApprovals/approve/reject`, `getConfig/saveProfile/saveMarkdown`,
  `triggerRun` (already stubbed in S2) bindings.

### Delete
- None (htmx ops routes + templates deleted in S5).

## Implementation Steps

1. Extract `_require_agent`/`_gateway` into `ops_helpers.py`; point `routes_approvals.py` at it
   (run the existing `test_server_approvals.py` to confirm the htmx routes still pass after the
   import swap). Then add `routes_ops_json.py`: JSON `GET approvals`, `POST approve`, `POST reject`
   reusing `ops_helpers`, same error mapping + `finally: gw.close()`; JSON `GET config`,
   `POST config/profile`, `POST config/{soul|project}` calling `profile_editor` (MEMORY.md has no
   write route). Register in `app.py`.
2. Write `tests/test_server_ops_json.py` FIRST for the approve red line: seed a real
   `ApprovalStore`, stub the post handler, assert the JSON approve runs the gateway path
   (audit row written, dedup respected) and that a Lớp A item → 403, unknown id → 400.
3. Config tests: valid edit → atomic replace; invalid yaml → 400 with exact validation message,
   original file unchanged (assert on disk).
4. Build `Approvals.tsx` with the two-step `ConfirmDialog` (list → confirm-what-posts → POST).
5. Build `Config.tsx` + `ConfigEditor` (4 files; MEMORY.md rendered read-only/disabled; show the
   exact 400 message on save failure).
6. Build `Trigger.tsx` (form + `useSse` live viewer) against the unchanged trigger/stream routes.
7. vitest: approve requires the confirm step + calls the approve endpoint; config save surfaces
   the validation error.
8. `vite build`; manual e2e against seeded data (offline; no live external post).

## Success Criteria

- [ ] React approve runs the REAL endpoint → `gw.approve(handler=dispatch_approved_action)`
      (red-line test green); no client-side action construction, no adapter bypass.
- [ ] Two-step confirm enforced (operator sees exactly what posts before the real POST).
- [ ] Reject runs `gw.reject` (audit, no post).
- [ ] Config edit: valid → atomic replace; invalid → 400 with the exact validation message,
      original preserved; MEMORY.md read-only (no write route).
- [ ] Trigger + SSE work via React against the UNCHANGED `/api/agents/{id}/trigger` +
      `/api/runs/{run_id}/stream`.
- [ ] No change to `action_gateway.py`, `classify()`, `needs_interrupt()`, `dispatch_approved_action`,
      `profile_editor` validation, or the trigger/stream handlers.
- [ ] New backend pytest tests + the existing suite green (776 baseline + new ops-json tests);
      frontend vitest green locally (`npm test` in `web/`, separate from the pytest gate).

## Risk Assessment

| Risk | Likelihood × Impact | Mitigation |
|---|---|---|
| **RED LINE — approve bypasses the gateway** (React posts directly / skips Lớp A/audit/dedup) | Low × Critical | JSON approve route is a near-copy of `routes_approvals.py:84-101`, calls only `gw.approve(handler=dispatch_approved_action)`. Dedicated red-line test asserts the gateway path + audit write. Code review red-line on this slice (per brainstorm). |
| **Logic divergence** between htmx + JSON approve routes during the parallel window | Medium × Medium | `_require_agent`/`_gateway` are EXTRACTED to `ops_helpers` and shared (decided — DRY); both routes call the identical gateway fn. S5 deletes the htmx route, collapsing to one; the helper survives. |
| **Config edit weakens validation** (atomic-replace / validate-first lost in the JSON port) | Low × High | JSON route calls `profile_editor.save_profile_yaml` unchanged; test asserts bad yaml → original-on-disk preserved. |
| **MEMORY.md becomes writable** via the new route | Low × High | No write route for memory; editor renders it disabled; `save_markdown` whitelist (`soul`/`project`) only (`routes_profile.py:52`). |
| **Audience downgrade** (typo'd external silently → internal, bypassing Lớp B) | Low × High | Trigger route already validates strictly (`routes_runs.py:44`); React mirrors the valid set but the server is the authority. |

**Invariant restatement:** Ops UI moves to React; the WRITE PATHS DO NOT MOVE. Approve →
`gw.approve(handler=dispatch_approved_action)` unchanged; Lớp A/B + audit + dedup intact; config
validate→atomic-replace intact; MEMORY.md read-only; trigger audience strict. React triggers the
existing gateway-routed endpoints only.

## Unresolved Questions

None — all resolved. (No separate confirm endpoint: the two-step confirm renders the
already-redacted pending action from `GET /api/agents/{id}/approvals` client-side, then POSTs to
the real approve route.)
