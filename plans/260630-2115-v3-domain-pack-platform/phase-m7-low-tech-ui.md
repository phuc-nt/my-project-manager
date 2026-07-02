# Phase M7 — UI low-tech (create + onboard)

> [← plan.md](plan.md) · trước: [phase-m6](phase-m6-hr-pack-proof.md) · sau: [phase-m8](phase-m8-admin-pack-team-view.md)

## Context Links
- React SPA M4 hiện có: `web/src/` (views: Overview/Timeline/Cost/Guardrail/MemoryAuto/Approvals/Config/Trigger).
- API hiện có: `src/server/routes_*.py` (12 endpoint, localhost-only, no-auth).
- Profile scaffold CLI: `src/entrypoints/mpm_registry_cmds.py:run_register()`.

## Overview
- **Priority:** P1 — giá trị nhìn thấy cho người dùng cuối; làm SAU khi có ≥2 pack (M6).
- **Status:** ✅ **DONE (2026-07-02).** 9/9 slice; pytest 863 + vitest 30 + tsc + build xanh; E2E live: create→list→pause→delete round-trip qua API thật, registry.yaml byte-identical sau round-trip. Code-review DONE_WITH_CONCERNS → fix hết H1 (append validate-before-replace) + M1/M2/M3/L1/L2/L3/L5.
- **Mục tiêu:** Người **không rành kỹ thuật** tự tạo + cấu hình + chạy + **quản lý vòng đời** agent qua web — KHÔNG sửa YAML/CLI/.env tay.
- **Định vị 2 vai (chốt 2026-07-02):** *setup* (cài uv/MCP server/.env token) = việc **kỹ thuật, 1 lần**; *vận hành hằng ngày* (tạo/chạy/duyệt/tạm dừng agent, đọc report) = **low-tech, 100% qua web**. M7 phục vụ vai thứ 2; installer trọn gói cho vai 1 = defer (YAGNI local-first). Để low-tech không bó tay khi hạ tầng hỏng ngầm → S9 health panel chỉ rõ "cái gì đứt, gọi ai".

## Key Insights
- Web UI đã 100% generic + có sẵn config-edit + trigger + approve. **Gap = onboarding/creation**, không phải observability.
- Tái dùng tối đa: API ops routes, gateway-routed approve, SSE streaming — không xây lại.
- AICoworker pattern "paste token qua UI thay vì .env" thuộc về đây (low-tech onboarding), nhưng **chạm vào secret** → cần quyết định lưu token an toàn (xem Security).
- Mở rộng React SPA, **KHÔNG Electron** (đã chốt).

## Requirements
**Functional:**
1. **Create-agent wizard** — form nhiều bước: chọn domain (pm/hr/...) → đặt id+name → chọn report kinds → bindings (project/repo/channel) → schedule → review → tạo.
2. **Domain selector** — đọc danh sách pack có sẵn (cần API liệt kê pack từ PackRegistry).
3. **Schedule builder** — picker ngày+giờ → sinh cron string (không gõ cron tay).
4. **Persona helper** — form role/goals → sinh SOUL.md gợi ý. *(As-built: template deterministic client-side, KHÔNG gọi LLM — rẻ, offline, người sửa được; LLM-assisted defer.)*
5. **Token setup** — nhập token qua UI (xem Security cho cách lưu) hoặc tối thiểu sinh "dòng .env để copy".
6. **All-agents overview** — tóm tắt mọi agent (status/cost/last-run/next-scheduled) — chuyển từ per-agent picker sang team view.
7. **Agent lifecycle** — pause/resume (toggle `enabled` trong registry) + delete (gỡ registry entry, giữ profile dir làm archive) qua UI, có confirm. Low-tech "quản lý" = phải dừng được agent hỏng mà không cần terminal.
8. **Integration health panel** — trạng thái từng kết nối: token env đặt chưa (KHÔNG lộ giá trị), MCP dist tồn tại, `gh`/`gws` auth OK — 🟢/🔴 + gợi ý khắc phục (dành cho người kỹ thuật khi được gọi).

**Non-functional:**
- THE INVARIANT giữ: tạo agent qua UI vẫn ghi profile + registry như CLI; mọi write vẫn qua gateway.
- Backward-compat: CLI `mpm agent register` vẫn chạy song song.

## Architecture
**Backend (API mới — lõi generic, không domain):**
- `GET /api/packs` — liệt kê domain pack + report_kinds + required bindings (từ PackRegistry).
- `POST /api/agents/create` — nhận {id, name, domain, bindings, schedule, reports} → validate → scaffold `profiles/<id>/` → append registry.yaml → trả kết quả. Reuse logic `run_register()`.
- `POST /api/agents/{id}/secrets` (nếu làm token-via-UI) — xem Security.

**Frontend (React SPA mở rộng):**
- `web/src/views/CreateAgent.tsx` — wizard multi-step (dùng state machine đơn giản).
- `web/src/components/ScheduleBuilder.tsx` — day/time → cron.
- `web/src/components/DomainPicker.tsx` — chọn pack từ `/api/packs`.
- `web/src/views/Team.tsx` — all-agents overview.
- Reuse: ConfigEditor, ConfirmDialog, api/client.ts.

## Related Code Files (as-built 2026-07-02)
**Create:**
- `src/runtime/registry_edit.py` — mutations registry.yaml dùng chung CLI+API (scaffold/append/toggle/remove, validate-before-replace + lock).
- `src/server/agent_create.py` — list_packs (đọc pack.yaml) + create_agent (build profile từ template, validate bằng builders thật).
- `src/server/integration_health.py` — health checks (env presence/dist/gh/gws, cache 30s, không lộ secret).
- `src/server/routes_agents_admin.py` — GET /api/packs, POST /api/agents/create, PATCH /api/agents/{id}/enabled (trả effective_enabled), DELETE /api/agents/{id}, GET /api/health/integrations.
- `web/src/views/CreateAgent.tsx` + `web/src/wizard/*` (step components + use-create-agent-wizard + persona/env templates), `web/src/views/Team.tsx`.
- `web/src/components/{ScheduleBuilder,DomainPicker,IntegrationHealthPanel}.tsx`.
- `tests/test_agents_admin_api.py`.

**Modify:**
- `src/server/app.py` — đăng ký router admin.
- `web/src/App.tsx` + `Layout.tsx` — route/nav /create, /team.
- `web/src/api/client.ts` + `types.ts` — getPacks/createAgent/setAgentEnabled/deleteAgent/getIntegrationHealth.
- `src/entrypoints/mpm_registry_cmds.py` — scaffold/append chuyển sang `registry_edit` (DRY CLI+API).

## Implementation Steps
1. **S1 — Pack list API** `GET /api/packs` + scaffold logic extract (DRY giữa CLI/API).
2. **S2 — Create endpoint** `POST /api/agents/create` (validate + scaffold + register, atomic; collision → 409).
3. **S3 — Create wizard UI** (domain → id → bindings → review). Dùng dry-run preview trước khi tạo.
4. **S4 — Schedule builder** component (cron sinh từ picker; hiện cron string để minh bạch).
5. **S5 — Persona helper** (optional, LLM sinh SOUL.md gợi ý; người sửa được).
6. **S6 — Team overview** view (all agents summary, reuse status API).
7. **S7 — Token setup** (xem Security — quyết định lưu trước; nếu rủi ro cao thì chỉ làm "copy .env lines" ở v3).
8. **S8 — Agent lifecycle** — `PATCH /api/agents/{id}/enabled` (pause/resume) + `DELETE /api/agents/{id}` (gỡ registry, giữ profile dir) + nút trong Team view, confirm dialog. Registry write phải atomic (không corrupt YAML).
9. **S9 — Integration health** — `GET /api/health/integrations`: env token đặt chưa (bool, không giá trị), MCP dist path exists, `gh auth status` / `command -v gws` (subprocess, timeout ngắn, cache kết quả). UI panel 🟢/🔴 + hint.

## Todo List
- [x] S1 `GET /api/packs` + scaffold logic DRY (`registry_edit.py` dùng chung CLI+API)
- [x] S2 `POST /api/agents/create` (validate bằng builders thật trước khi ghi; 400/409; rollback)
- [x] S3 Create-agent wizard UI (5 bước, web/src/wizard/*)
- [x] S4 Schedule builder (day+time → cron 5-field, hiện cron string)
- [x] S5 Persona helper (template deterministic, không LLM — as-built)
- [x] S6 Team overview view (status/budget/pending per agent)
- [x] S7 Token setup = hiển thị .env template copy-paste (env NAMES only, đúng quyết định Security)
- [x] S8 Agent lifecycle (PATCH enabled trả effective_enabled; DELETE giữ profile dir; 'default' không xóa được)
- [x] S9 Integration health panel (env presence/MCP dist/gh/gws, cache 30s, không lộ secret)
- [x] pytest 863 + vitest 30 xanh; E2E: create qua API thật → registry → pause/delete round-trip, registry byte-identical

## Success Criteria
- Người không rành kỹ thuật tạo 1 agent mới (pm hoặc hr) hoàn toàn qua web, không chạm terminal/YAML.
- Agent tạo qua UI = agent tạo qua CLI (cùng scaffold path, DRY).
- Team view hiện mọi agent + trạng thái; pause/resume/delete được agent qua UI (không terminal).
- Health panel chỉ đúng kết nối đứt khi tắt 1 integration thử.
- THE INVARIANT giữ; CLI vẫn chạy song song.

## Risk Assessment
- **R1 Token-via-UI = chạm secret** → mặc định an toàn: v3 chỉ "sinh dòng .env để copy"; lưu token qua UI chỉ làm khi có secret store (defer, xem Security).
- **R2 Wizard sinh profile sai** → dry-run preview + backend validate (bad → 400, không tạo file rác).
- **R3 No-auth UI** → vẫn localhost-only như M2; expose ra ngoài cần auth (defer, không ở v3).

## Security Considerations
- **Token qua UI:** hiện `.env` là nguồn secret (chốt v2 risks #1). Nhập token qua web rồi ghi .env = ghi secret từ tiến trình web → cân nhắc kỹ. **Đề xuất v3:** UI chỉ *hiển thị template .env* để người dùng tự dán vào file (không để web ghi secret). Lưu token thật qua UI = cần secret store (SOPS/Vault) → defer.
- Create endpoint validate id (chống path traversal — `[a-z0-9-]` như `run_register`).
- No-auth giữ localhost-only; KHÔNG bind 0.0.0.0.

## Next Steps
- M8 admin-pack + team view nâng cao (nếu làm).
