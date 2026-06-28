# v2 M4 — React visualization dashboard
2026-06-28 · ✅ Done

## Làm gì
- **S1 JSON API layer**: new `routes_visualize.py` (5 read-only endpoints: `/api/{runs,cost,memory,automation,audit}/{id}`) + helper functions (`run_event.read_run_events`, `budget_tracker.monthly_series`). Each projects to non-PII allowlist mirroring `summarize_node`. Memory internal-only via `?audience` gate (external → no facts). No guardrail change.
- **S2 React shell**: Vite + TypeScript SPA (`web/`, committed build to `src/server/static/app/`). Typed `api/client.ts`, react-router, agent-context. TS strict mode. Zero Node.js at serve time.
- **S3 Visual views**: Timeline, Cost (react-chartjs-2 line + budget cap), Guardrail (verdict doughnut + audit table), Memory (internal), Automation (internal). Chart.js only. Read-only.
- **S4 Ops surfaces**: `routes_ops_json.py` (approve/reject/config) calling identical `gw.approve(handler=dispatch_approved_action)` / `profile_editor` functions. Shared `ops_helpers.py` extracted. React UI with two-step confirm. No new write path; approve runs real gateway (audit, dedup, Lớp A→403).
- **S5 Wiring + cleanup**: App.py serves SPA at `/` via catch-all (index.html + client deep-links) with `/api/*` + `/static` precedence (mounted LAST). DELETED: `routes_dashboard.py`, `routes_approvals.py`, `routes_audit.py`, `routes_profile.py` (HTML routers), `src/server/templates/`, htmx static + 5 htmx tests. Coverage guard: every unique edge-case re-asserted in JSON test first. `tests/test_m4_e2e_offline.py` (e2e + grep guard: no Jinja2/TemplateResponse code remains).

## Lằn ranh đỏ (The Invariant)
M4 is a UI/observability layer only. Action Gateway, `classify()`, `needs_interrupt()`, Lớp A/B, audit, budget, dedup, and every write path **UNTOUCHED**. React only READS (JSON, allowlisted) + triggers actions through EXISTING gateway-routed endpoints (approve still `gw.approve(handler=dispatch_approved_action)`). Memory/automation internal-only. FastAPI stays localhost-only/no-auth (auth deferred; JSON API auth-middleware-ready). E2E verified: 785 pytest green, vitest 11, ruff clean.

## Quyết định & vì sao

| Quyết định | Vì sao | Đánh đổi |
|---|---|---|
| Commit Vite build to static/ | Zero Node.js at serve time; SPA fully cacheable; avoid build-at-deploy | Larger `.git` size; rebuild only when code changes |
| Chart.js only (no D3) | Lightweight, no force-direct deps, sufficient for budget/timeline/doughnut | No advanced custom visualizations (acceptable, can add later) |
| Ops JSON routes call same dispatcher fns | Eliminate dispatcher copy; one code path for CLI + UI approvals | Tighter coupling (acceptable, both are internal) |
| Delete htmx entirely, not coexist | Clean break; htmx latent bug (config yaml-500) dies; SPA is canonical | No gradual migration (acceptable, all surfaces ported) |
| Internal-only memory/automation views | Prevent external audience leaking per-agent secrets/internal analysis | Dashboard less useful for external reporting (acceptable, external has read-only JSON) |

## Vấp & học được
- **Live-key E2E deferred**: tested JSON endpoints + React surfaces + gateway path via offline/test data; real Linear/SMTP/LangSmith integration still manual. Plan S5 final commit once e2e manual smoke passes.
- **Htmx yaml-500 latent bug**: Config POST that sent YAML form-data triggered 500 on invalid YAML. Died with htmx route; no JSON API equivalent (JSON-only).
- **Coverage guard worked**: Mapped every unique htmx edge (approve/reject/config valid/invalid) to a JSON test before deletion. Zero coverage loss.

## Live E2E (2026-06-28, browser thật + post outward thật)

Chạy full live qua agent throwaway `e2e-m4` (dry_run=false, Postgres throwaway), target seeded
thật (.env): Jira SCRUM, Slack `<SLACK_CHANNEL_ID>`. Đường đi: server uvicorn THẬT
(`python -m src.server.app`, 127.0.0.1:8765) → browser headless THẬT (Playwright Chromium) →
React render → click trên UI.
- **Seed**: D3 `automate` đọc Jira thật + LLM summarize blocker → propose → enqueue Lớp B
  `approval_id=1` vào ApprovalStore (đúng nguồn dashboard đọc).
- **HTTP live** (uvicorn, không TestClient): `GET /` (SPA) + 5 JSON API + deep-link `/cost`
  (catch-all) đều 200; `/api/memory?audience=external` → `facts: []` (lằn ranh đỏ live).
- **Browser render**: React mount, agent picker, 8 nav; Approvals view hiện proposal #1;
  confirm dialog hiện ĐÚNG action JSON sẽ post (channel + text từ Jira read) trước khi duyệt.
- **Live approve trên UI**: click "Approve & post" → **post Slack THẬT** (audit:
  `slack:post_message verdict=allow result="posted to <SLACK_CHANNEL_ID> ts=1782650017.735719"`),
  proposal consumed (pending→0). Qua đúng `gw.approve(dispatch_approved_action)` — không bypass.

Dọn sạch sau: kill server + container, xóa profile (chứa DSN) + data dir, revert registry,
gỡ Playwright khỏi `web/`. `git grep` xác nhận DSN/secret/throwaway-id KHÔNG vào file tracked.

## Mở / sang sau
- **Auth + remote**: still deferred (localhost-only + no-auth). JSON API design ready; add auth middleware without rewrite.
- **Advanced visualizations**: Dashboard sufficient for MVP; D3/custom layouts deferred pending product feedback.
- **Per-run cost trend** (D3 `runs.jsonl` cost_usd): deferred — monthly-only this round.

## Kết quả
✅ 5 slices, all committed (S1 1c0bd75, S2 4c770fb, S3 39713fb, S4 4f025f0, S5 3630ae7). 785 pytest green, vitest 11, ruff clean. React SPA fully replaces htmx; guardrail + gateway path byte-stable. Memory/automation internal-only respected. **Live E2E xác nhận: browser thật render SPA + click Approve trên UI → post Slack thật qua gateway (ts 1782650017).** M4 closes the dashboard modernization; next = integrations or multi-user auth.