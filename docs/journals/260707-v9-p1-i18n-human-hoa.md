# v9 P1 — i18n + human-hoá (điểm chạm CEO)

**Ngày:** 2026-07-07 · **Scope:** frontend-only, backend py KHÔNG đổi (verify: 0 file `.py` trong diff)

## Mục tiêu

Nâng 4 điểm chạm chính của CEO low-tech từ "dùng được nhưng thô" → tiếng Việt + human-hoá: duyệt việc hiểu được hành động (không JSON/tiếng Anh), Team/wizard tiếng Việt, lỗi HTTP tiếng Việt, status/cron/timestamp người-đọc-được.

## Đã làm

- **`labels.ts` (mới)** — nguồn i18n dùng chung (DRY): `RUN_STATUS_LABEL`/`KIND_LABEL`/`VERDICT_LABEL`, `labelFor()` (thiếu key → "—", không rỗng), `formatDateTime` (VN "HH:mm dd/MM", input xấu → ""), `formatCron` (cron → "09:00 Thứ 2, Thứ 4" / "chạy thủ công").
- **`action-summary.ts` (mới) — TRUST SURFACE**: tóm tắt tiếng Việt theo action-type, đọc ĐÚNG field-shape thật: `mcp_tool` → `action.args` camelCase (projectKey/summary/channel/title/issueKey), `email_send` → top-level `to`/`subject` (to là LIST → join), `gh_cli` → parse `argv`. Phủ đủ Lớp B universe (jira create/close/transition/assign, slack post internal/external, confluence createPage, linear comment, gh pr merge/close/ready). Map thiếu → fallback 1 dòng người-đọc-được (không rỗng). Đích external → flag hiện ngoài `<details>`.
- **ConfirmDialog** rewrite: tiêu đề/nút tiếng Việt, dòng tóm tắt (class external nổi bật đỏ/đậm), cảnh báo "gửi RA NGOÀI công ty", JSON gốc trong `<details>`, modal a11y (aria-modal, focus, Esc, scroll-into-view).
- **Work.tsx**: reject = `window.confirm` tối thiểu (an toàn + reversible, không full dialog).
- **Team / CreateAgent+wizard / DomainPicker / IntegrationHealthPanel / ReportsStep / ScheduleBuilder** Việt hoá; delete-note KHÔNG lộ path filesystem; report-kind & cron qua labels; ngày DAYS → CN/T2..T7.
- **api/client.ts**: lỗi HTTP → câu tiếng Việt (`friendlyError`: 500/404/403/khác), giữ `detail` backend nếu có.
- **Approvals.tsx**: cột Action dùng chung `action-summary` (hết "undefined:undefined").
- Cross-ref: CompanyDocs "tab Kiến thức", AgentKnowledgeTab "mục Tài liệu công ty (trong Đội)".
- Nâng cao view (Overview/Cost/Timeline/Config/Guardrail/MemoryAuto/Trigger): chỉ loading/error → tiếng Việt (persona kỹ thuật, giữ nội dung).

## Sự kiện chính — adversarial review trust-surface

Review đối kháng (verify với backend builder thật, không đoán) xác nhận summary đọc ĐÚNG mọi field-shape (không lỗi casing/nesting — nỗi lo lớn nhất), JSON luôn auditable, không XSS. Bắt 3 lỗi thật, đã vá:

- **M1 (CONFIRMED)**: class `.confirm-external`/`.confirm-external-note` có hook nhưng KHÔNG có CSS → cảnh báo external render như text thường (mất "prominent"). Vá: thêm CSS đỏ/đậm/viền.
- **M2**: `email.to` là LIST nhưng type `string`. Vá: type `string | string[]` + `.join(', ')` tường minh.
- **L1**: Linear comment mất issue id. Vá: đọc `args.issueId`/`issueKey`.
- **H1 (latent)**: external-flag suy ra từ regex trên `reason` string — an toàn hôm nay (chỉ path `hard_block.py:112` queue external, reason luôn có "external"; chưa pack nào emit external chat-command) nhưng mong manh. Fix đúng = structured `is_external` flag từ backend (ngoài scope frontend-only) → ghi rõ LIMITATION trong comment, defer.

## Kết quả

- **79 vitest xanh** (58 cũ cập nhật string + 21 mới: `labels.test.ts`, `action-summary.test.tsx`, `ConfirmDialog.test.tsx`) · **tsc sạch** · **build sạch**.
- Test cập nhật: fixture `Work.test.tsx` → shape action THẬT (red-team M1); `ops.test.tsx` reject → confirm-rồi-reject; nút/label tiếng Việt across Team/CreateAgent/ScheduleBuilder.
- Backend py: 0 đổi (ràng buộc giữ).

## Bài học

- **Trust surface phải verify field-shape với NGUỒN backend, không đoán** — casing camel/snake + nested `args` vs top-level là chỗ dễ render tóm tắt rỗng "trông hợp lệ" → CEO duyệt mù. Review đối kháng đọc `email_write.py`/`chat_command.py`/`hard_block.py` xác nhận từng family.
- **Style hook không có CSS = cảnh báo chết**: `external: boolean` vô nghĩa nếu class không có rule. Emphasis là một phần của contract, không chỉ text.
- Suy ra dữ liệu-an-toàn-quan-trọng từ free-text (`reason` regex) là nợ kỹ thuật — đúng hôm nay nhưng vỡ khi catalog lớn. Ghi LIMITATION cạnh code, không giấu.
