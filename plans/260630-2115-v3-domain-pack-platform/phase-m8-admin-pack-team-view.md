# Phase M8 — admin-pack + đa-agent team view (defer-able)

> [← plan.md](plan.md) · trước: [phase-m7](phase-m7-low-tech-ui.md)

## Context Links
- Phụ thuộc M5 (abstraction), M6 (đã chứng minh pack thứ 2), M7 (wizard + team view cơ bản).

## Overview
- **Priority:** P2 — defer-able, nhưng được kích hoạt 2026-07-02 làm bước "chiều ngang" của v5 (đội sắp đông + sắp có quyền hành động → cần giám sát trước).
- **Status:** ✅ **DONE (2026-07-02).** GATE PASS: src/ chỉ +`runtime/agent_state_reader.py` (accessor read-only dự liệu) + `GET /api/team/alerts` (generic, cache 30s) — 0 domain logic. admin-pack tự chứa 100% (3 kind, Slack-only delivery — bỏ Confluence page, digest ngắn). 922 test (14 mới); E2E live: agent admin tạo qua wizard API (domain=admin) → cost-rollup post Slack thật số liệu đội thật. Review DONE_WITH_CONCERNS → vá H1 (**pack allowlist chưa wire vào runtime gateway — gap có sẵn ở cả hr-pack, vá cả hai** + test runtime-path), H2 (state reader degrade mọi lỗi profile + sqlite read-only `mode=ro` — không DDL vào dir agent khác), M2 (cache endpoint).
- **Mục tiêu:** admin-pack (agent giám sát vận hành: cost tổng, guardrail health, audit toàn hệ) + dashboard đa-agent nâng cao.

## Key Insights
- Sau M5+M6, thêm admin-pack đáng lẽ **rẻ** (chỉ thêm `domain-packs/admin-pack/`). Nếu KHÔNG rẻ → tín hiệu abstraction còn nợ, xử ở M5.
- Admin agent **đặc biệt:** nó đọc *trạng thái các agent khác* (cost, audit, approval pending) — khác PM/HR đọc hệ thống ngoài. Đây là test thú vị cho ToolProvider (tool = đọc nội bộ platform).
- YAGNI: chỉ làm nếu chủ dự án thấy cần agent admin thật; không xây vì "cho đủ bộ".

## Requirements
**Functional:**
1. **admin-pack** — report kinds: `cost-rollup` (tổng cost mọi agent vs budget), `guardrail-health` (tỉ lệ deny/approve/pending), `audit-digest` (bất thường trong audit log).
2. **Admin ToolProvider** đọc nội bộ: budget tracker mọi agent, audit log mọi agent, approval store. (Read-only, không ghi vào agent khác.)
3. **Team dashboard nâng cao** — drill-down per-agent, cảnh báo (agent gần chạm budget, approval treo lâu, deny tăng đột biến).

**Non-functional:**
- `git diff src/` rỗng khi thêm admin-pack (gate cứng như M6) — TRỪ khi cần expose 1 read-only internal API cho admin ToolProvider (nếu vậy, đó là API generic, ghi rõ lý do).
- Admin đọc cross-agent **read-only**; KHÔNG ghi/sửa agent khác (red line).

## Architecture
```
domain-packs/admin-pack/
├── pack.yaml              # id: admin, report_kinds: [cost-rollup, guardrail-health, audit-digest]
├── graphs.py
├── analyzers.py          # tổng hợp cross-agent metrics (pure)
├── prompts/*.md
├── tools.py             # Admin ToolProvider: đọc .data/agents/*/ (budget, audit, approval)
└── skills/*.md
```
**Lưu ý cross-agent read:** admin tool đọc `.data/agents/<other>/` (budget/audit/approval). Cần 1 read-only accessor generic ở lõi (vd `src/runtime/agent_state_reader.py`) — đây là API generic hợp lệ, không phải domain logic.

## Related Code Files
**Create:**
- `domain-packs/admin-pack/` (cây trên).
- `src/runtime/agent_state_reader.py` (read-only cross-agent accessor — generic, dùng được cho team view M7 luôn).
- `profiles/admin/{...}` + registry entry.

**Modify (tối thiểu, generic-only):**
- Có thể thêm read-only API cho team dashboard nâng cao (`/api/team/summary`, `/api/team/alerts`).
- `web/src/views/Team.tsx` — drill-down + alerts.

## Implementation Steps
1. **S1 — agent_state_reader** (read-only cross-agent: budget/audit/approval). Test isolation: chỉ đọc, không ghi.
2. **S2 — admin-pack** với `cost-rollup` kind (đơn giản nhất).
3. **S3 — Admin ToolProvider** dùng state reader → Task/Event generic.
4. **S4 — guardrail-health + audit-digest** kinds.
5. **S5 — Team dashboard nâng cao** (alerts: budget≥80%, approval treo, deny spike).
6. **S6 — Gate:** `git diff src/` chỉ chứa generic additions (state reader + team API), 0 domain logic trong lõi.

## Todo List
- [x] S1 agent_state_reader (read-only cross-agent; sqlite mode=ro, degrade mọi lỗi)
- [x] S2 admin-pack cost-rollup
- [x] S3 Admin ToolProvider (đọc qua state reader, kèm team_alerts)
- [x] S4 guardrail-health + audit-digest (1 builder parametrized, 3 kind)
- [x] S5 Team dashboard alerts (GET /api/team/alerts cache 30s + banner Team view)
- [x] S6 Gate PASS: src/ chỉ accessor + alerts API generic
- [x] pytest 922 + vitest 30 xanh; E2E live: admin agent rollup 2 agent thật → Slack

## Success Criteria
- admin-pack chạy ≥1 kind (cost-rollup) tổng hợp mọi agent.
- 3 domain (pm/hr/admin) cùng chạy trên 1 lõi, cùng web UI.
- Admin read-only cross-agent verified (không ghi agent khác).
- Thêm admin-pack chỉ thêm pack + generic state reader; 0 domain logic vào lõi.

## Risk Assessment
- **R1 Admin cross-agent read phá isolation** → state reader read-only, test chặn write; namespace per-agent giữ.
- **R2 Làm M8 khi chưa cần** → defer mặc định; chỉ cook khi chủ dự án xác nhận cần admin agent thật.

## Security Considerations
- Admin đọc audit/cost mọi agent = tập trung dữ liệu nhạy cảm → admin report cũng qua PII firewall; external audience admin bỏ chi tiết per-agent nhạy cảm.
- Cross-agent **read-only** là red line: admin KHÔNG approve/reject/trigger agent khác (tránh privilege escalation).

## Next Steps
- v3 hoàn tất. Đánh giá: AICoworker patterns (local model/OAuth/fallback) có cần cho v4 không.
