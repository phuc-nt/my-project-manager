# v3 M8 — admin-pack: agent giám sát đội (chiều ngang v5)
2026-07-02 · ✅ Done

Domain thứ 3 — và là domain đầu tiên nhìn VÀO TRONG: agent admin đọc trạng thái cả đội (chi phí, guardrail, audit, approval treo) và báo cáo như một trưởng phòng vận hành. Đây cũng là bài test cuối của abstraction v3: **GATE PASS** — src/ chỉ nhận đúng 2 bổ sung generic đã dự liệu trong plan (accessor read-only + API alerts), 0 domain logic.

## Làm gì
- **`src/runtime/agent_state_reader.py`** (generic, dự liệu từ plan M8): snapshot mỗi agent — budget json, approvals sqlite **mở `mode=ro`** (không DDL vào dir agent khác — red line cross-agent read-only), audit.jsonl tail-2000 đếm verdict 7 ngày, last run; degrade MỌI lỗi per-agent (1 profile hỏng không làm mù cả đội). `team_alerts()` ngưỡng deterministic: budget ≥80% 🟡 / ≥100% 🔴, approval treo ≥24h, ≥3 deny/7 ngày.
- **`domain-packs/admin-pack/`** (tự chứa 100%): 3 kind `cost-rollup` / `guardrail-health` / `audit-digest` — MỘT builder parametrized (clone shape hr-pack), analyzer thuần (số từ file thật, LLM chỉ nhận xét, fallback deterministic khi LLM vắng), Slack-only delivery (digest ngắn, bỏ Confluence — deviation ghi ở phase), allowlist chỉ slack post.
- **Team view alerts**: `GET /api/team/alerts` (cache 30s) + banner 🔴/🟡 trên /team — low-tech thấy ngay agent nào cháy budget/kẹt duyệt.

## Review (DONE_WITH_CONCERNS → vá hết)
- **H1 đắt giá — systemic**: graph builder của pack KHÔNG wire `pack.allowlist` vào ActionGateway → gateway chạy bằng allowlist default (rộng hơn: có jira/confluence) — docstring "slack-only là source of truth" thành lời hứa suông; **gap tồn tại sẵn ở hr-pack từ M6** mà 2 vòng review trước không thấy. Vá cả admin lẫn hr + test khẳng định RUNTIME path (không chỉ classifier). Bài học: test red-line phải đi qua đúng con đường runtime, test classifier riêng lẻ = phantom guarantee.
- **H2**: "degrade, don't raise" có lỗ — sqlite corrupt/locked và profile ValueError/YAMLError xuyên qua → 1 agent hỏng 500 cả `/api/team/alerts` + mọi run admin. Vá: catch rộng có log + sqlite `mode=ro` + fixtures corrupt-db/bad-yaml.
- **M1** ApprovalStore constructor chạy DDL = write vào dir sibling → thay bằng SELECT read-only thuần. **M2** cache endpoint.

## Verified
922 pytest (14 mới) + 30 vitest + tsc + build xanh; ruff clean. **E2E live khép vòng đẹp**: agent admin được TẠO QUA CHÍNH WIZARD API M7 (domain=admin, chọn từ pack discovery) → chạy `cost-rollup` → **Slack post thật** số liệu đội thật ("Tổng chi phí LLM tháng này: $0.0018 / trần đội $100.00, 2 agent" + narrative LLM) → xóa qua DELETE API, registry sạch.

## Ý nghĩa kiến trúc
Pack thứ 3 xác nhận lời hứa M5-M6: hạ tầng đủ, thêm domain = thêm folder. Và admin-pack chứng minh ToolProvider thật sự transport-agnostic — "transport" lần này là chính platform (đọc .data/), lõi vẫn không biết gì.
