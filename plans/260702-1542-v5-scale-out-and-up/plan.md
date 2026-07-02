---
title: v5 — Scale đội agent theo chiều ngang (M8) và chiều dọc (M12)
status: completed
priority: P1
effort: large
branch: main
tags: [admin-pack, chat-command, lop-b, scale]
created: 2026-07-02
---

# v5 Plan — Scale ngang (M8 admin-pack) → dọc (M12 chat-command)

> Tiếp sau [v3](../260630-2115-v3-domain-pack-platform/plan.md) (M5/M6/M7/M11 ✅) + [v4](../260630-2125-v4-resilient-llm-local-first/plan.md) (M9 ✅).
> Nguồn quyết định: phân tích scale ngang/dọc 2026-07-02 (chat với chủ dự án) — chủ dự án chốt: *"Plan rồi cook lần lượt cho chiều ngang rồi tới chiều dọc"*.

## North Star v5

- **Ngang** = thêm "người" vào đội: **M8 admin-pack** (pack thứ 3, tự giám sát cả đội agent — cost rollup, guardrail health, audit digest). Đây cũng là bài test cuối của abstraction: pack thứ 3 phải `git diff src/` ≈ rỗng (chỉ được phép thêm 1 accessor generic đọc cross-agent, đã dự liệu trong phase file).
- **Dọc** = thăng chức agent lên bậc 3 của thang trách nhiệm: **M12 chat-command** — "@agent làm X" trong Slack → agent soạn action → **LUÔN vào Lớp B chờ người duyệt** → duyệt xong mới chạy thật. Biến "đồng nghiệp trả lời được" (M11) thành "đồng nghiệp nhờ được".

## Milestones

| MS | Chiều | Trạng thái | Mục tiêu | Phase file |
|----|-------|-----------|----------|------------|
| **M8** | Ngang | ✅ DONE (2026-07-02) | admin-pack: 3 kind giám sát đội + team alerts; gate src/ generic-only | [v3 phase-m8](../260630-2115-v3-domain-pack-platform/phase-m8-admin-pack-team-view.md) |
| **M12** | Dọc | ✅ DONE (2026-07-02) | Lệnh từ chat → catalog command → Lớp B queue → duyệt → thực thi; KHÔNG BAO GIỜ thực thi thẳng từ chat | [phase-m12](phase-m12-chat-command-lop-b.md) |

## Thứ tự + lý do

M8 trước (theo chỉ đạo ngang→dọc, và hợp lý: đội sắp đông + sắp có quyền hành động thì cần agent giám sát chi phí/guardrail TRƯỚC). M12 sau, đứng trên M11 (inbox/mention đã có) + M8 (admin nhìn thấy approval treo).

## Nguyên tắc xuyên suốt

- **THE INVARIANT giữ nguyên tuyệt đối.** M12 mở rộng *phạm vi yêu cầu* (từ chat), KHÔNG mở rộng *quyền thực thi*: mọi action sinh từ chat đi qua đúng gateway cũ, và bị **ép Lớp B vô điều kiện** (origin-based) — kể cả action mà cron/report được chạy thẳng. Nới dần (trust ladder) là quyết định của chủ dự án SAU này, không nằm trong v5.
- Backward-compat: không khai báo gì mới → hành vi cũ byte-identical (M8: không có agent admin thì thôi; M12: pack không khai `commands` → mention chỉ Q&A như M11).
- Số liệu deterministic (admin analyzer đếm/tổng từ file thật; LLM chỉ viết prose).
- Mỗi milestone: test xanh + code-review + E2E live + journal trước khi sang cái sau.

## Rủi ro lớn nhất

1. **M12 = LLM sinh action từ text người** → args bịa/injection. Mitigation: LLM chỉ được *chọn command trong catalog pack khai báo* + args validate theo schema từng command; không match → từ chối lịch sự (như M11); action build ở CODE từ args đã validate, không phải LLM viết action dict tự do; và tất cả vẫn sau Lớp A + allowlist + Lớp B người duyệt.
2. **M8 đọc cross-agent phá isolation** → accessor read-only duy nhất ở core, test chặn write, admin không approve/trigger agent khác (đã ghi trong phase M8).
3. Approval queue thành "hố đen" (lệnh chờ mãi) → M8 alert approval-treo chính là đối trọng; reply chat ghi rõ link duyệt.

## Acceptance (mức plan)

- M8: agent admin chạy ≥1 kind live tổng hợp mọi agent thật; 3 domain cùng lõi; `git diff src/` chỉ chứa accessor generic + (nếu cần) API team alerts.
- M12: "@agent tạo ticket …" → approval #id xuất hiện (KHÔNG có gì được ghi ra ngoài trước duyệt) → người duyệt → Jira issue thật xuất hiện → thread được báo; lệnh ngoài catalog → từ chối; câu hỏi thường → Q&A như cũ.
