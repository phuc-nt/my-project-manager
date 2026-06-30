# Phase M7 — UI low-tech (create + onboard)

> [← plan.md](plan.md) · trước: [phase-m6](phase-m6-hr-pack-proof.md) · sau: [phase-m8](phase-m8-admin-pack-team-view.md)

## Context Links
- React SPA M4 hiện có: `web/src/` (views: Overview/Timeline/Cost/Guardrail/MemoryAuto/Approvals/Config/Trigger).
- API hiện có: `src/server/routes_*.py` (12 endpoint, localhost-only, no-auth).
- Profile scaffold CLI: `src/entrypoints/mpm_registry_cmds.py:run_register()`.

## Overview
- **Priority:** P1 — giá trị nhìn thấy cho người dùng cuối; làm SAU khi có ≥2 pack (M6).
- **Status:** ⬜ Planned.
- **Mục tiêu:** Người **không rành kỹ thuật** tự tạo + cấu hình + chạy agent qua web — KHÔNG sửa YAML/CLI/.env tay.

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
4. **Persona helper** — form role/goals → sinh SOUL.md gợi ý (LLM-assisted, optional).
5. **Token setup** — nhập token qua UI (xem Security cho cách lưu) hoặc tối thiểu sinh "dòng .env để copy".
6. **All-agents overview** — tóm tắt mọi agent (status/cost/last-run/next-scheduled) — chuyển từ per-agent picker sang team view.

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

## Related Code Files
**Create:**
- `src/server/routes_agents_create.py` (create + packs list endpoints).
- `web/src/views/CreateAgent.tsx`, `web/src/views/Team.tsx`.
- `web/src/components/{ScheduleBuilder,DomainPicker}.tsx`.

**Modify:**
- `src/server/app.py` — đăng ký route mới.
- `web/src/App.tsx` — route /create, /team.
- `web/src/api/client.ts` — `getPacks()`, `createAgent()`.
- `src/entrypoints/mpm_registry_cmds.py` — extract scaffold logic thành hàm reuse được (CLI + API cùng gọi, DRY).

## Implementation Steps
1. **S1 — Pack list API** `GET /api/packs` + scaffold logic extract (DRY giữa CLI/API).
2. **S2 — Create endpoint** `POST /api/agents/create` (validate + scaffold + register, atomic; collision → 409).
3. **S3 — Create wizard UI** (domain → id → bindings → review). Dùng dry-run preview trước khi tạo.
4. **S4 — Schedule builder** component (cron sinh từ picker; hiện cron string để minh bạch).
5. **S5 — Persona helper** (optional, LLM sinh SOUL.md gợi ý; người sửa được).
6. **S6 — Team overview** view (all agents summary, reuse status API).
7. **S7 — Token setup** (xem Security — quyết định lưu trước; nếu rủi ro cao thì chỉ làm "copy .env lines" ở v3).

## Todo List
- [ ] S1 `GET /api/packs` + scaffold logic DRY
- [ ] S2 `POST /api/agents/create`
- [ ] S3 Create-agent wizard UI
- [ ] S4 Schedule builder (cron picker)
- [ ] S5 Persona helper (optional)
- [ ] S6 Team overview view
- [ ] S7 Token setup (theo quyết định Security)
- [ ] pytest + vitest xanh; E2E: tạo agent qua UI → xuất hiện registry → trigger chạy

## Success Criteria
- Người không rành kỹ thuật tạo 1 agent mới (pm hoặc hr) hoàn toàn qua web, không chạm terminal/YAML.
- Agent tạo qua UI = agent tạo qua CLI (cùng scaffold path, DRY).
- Team view hiện mọi agent + trạng thái.
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
