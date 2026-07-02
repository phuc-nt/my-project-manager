# Đánh giá plan v3+v4 vs mục tiêu "multi-purpose agent app cho low-tech"

> Ngày: 2026-07-02. Người đánh giá: cook session (sau khi M5+M6 DONE, live E2E).
> Mục tiêu chủ dự án: app đa mục đích, **người không rành kỹ thuật** tạo + quản lý **nhóm agent** thay human làm việc hành chính (PM, admin, HR…) trong công ty phát triển phần mềm.

## Verdict theo từng chiều

| Chiều mục tiêu | Plan hiện tại | Đánh giá |
|---|---|---|
| Multi-purpose (đa domain) | M5+M6 DONE (pack abstraction, pm+hr chạy thật), M8 pack thứ 3 | ✅ ĐẠT — thêm domain = thêm pack, đã chứng minh live |
| An toàn khi "thay người" | Action Gateway Lớp A/B, audit, budget, dedup (v1/v2) | ✅ ĐẠT — tài sản mạnh nhất, không đối thủ trong tầm so sánh |
| Low-tech TẠO agent | M7 wizard (domain → id → bindings → schedule) | ✅ đủ, sau khi vá gap 1 |
| Low-tech QUẢN LÝ nhóm agent | M7 chỉ có team view read-only | ⚠️ GAP 1 — thiếu pause/resume/delete qua UI; thiếu panel sức khỏe kết nối (token/MCP/gh/gws) → hỏng ngầm là low-tech bó tay |
| "Thay thế human hành chính" | Chỉ báo cáo 1 chiều theo lịch | ❌ GAP 2 — human PM/HR còn bị HỎI ad-hoc qua Slack hằng ngày. Không có kênh hỏi-đáp thì là "máy phát báo cáo", chưa phải "đồng nghiệp". Thiếu hẳn milestone |
| Bền bỉ (không chết im lặng) | v4 M9 fallback + M10 local | ✅ đúng hướng — M9 càng quan trọng khi agent thay người |
| Low-tech CÀI ĐẶT | Không có (uv, npm build 3 MCP server, .env tay) | ⚠️ GAP 3 — chấp nhận được NẾU tuyên bố rõ định vị: setup = việc kỹ thuật 1 lần; vận hành hằng ngày = low-tech. Installer trọn gói defer (đúng YAGNI local-first) |

## Kết luận

Plan v3+v4 đưa sản phẩm đi **~80% quãng đường**. Nền (đa domain + guardrail + resilience) đúng và đã chứng minh. Còn thiếu để thành "đội agent thay người":

1. **M7 phải rộng hơn**: thêm lifecycle (pause/resume/delete) + integration-health panel → low-tech thực sự "quản lý" chứ không chỉ "xem".
2. **Milestone MỚI M11 — ask-agent Slack inbox**: mention agent trong Slack → agent đọc dữ liệu thật → trả lời. Đây là năng lực định nghĩa "coworker". Tái dùng 100% hạ tầng sẵn (scheduler poll, slack MCP read, pack ToolProvider, gateway cho reply, dedup theo message ts). Read-only Q&A ở v3; yêu cầu write từ chat → defer.
3. **Định vị 2 vai** ghi vào plan: technical setup 1 lần / low-tech operate hằng ngày.

## Thay đổi plan đã thực hiện

- `phase-m7-low-tech-ui.md`: +S8 agent lifecycle API+UI, +S9 integration-health panel; success criteria mở rộng; định vị 2 vai.
- `phase-m11-ask-agent-inbox.md`: MỚI (v3, P1, sau M7/M9).
- `plan.md` v3: bảng milestone +M11, thứ tự cook cập nhật: M7 → (M9 v4) → M11 → M8/M10 defer-able.
- `plan.md` v4: chốt Unresolved #2 — M9 cook ngay sau M7.

## Unresolved

1. M11 reply có cần Lớp B khi channel internal không? Đề xuất: không (như report internal) — chốt lúc cook M11.
2. Yêu cầu WRITE từ chat ("tạo ticket X") — v3 trả lời hướng dẫn + từ chối lịch sự, hay tạo approval Lớp B? Đề xuất defer sang sau M11, hỏi chủ dự án.
