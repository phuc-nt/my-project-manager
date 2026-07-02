# Phase M12 — Chat-command qua Lớp B ("đồng nghiệp nhờ được")

> [← plan.md](plan.md) · trước: M8 (ngang) + M11 (inbox, nền tảng trực tiếp).

## Context Links
- Inbox/QA path: `src/runtime/inbox.py` + `src/agent/qa_answer.py` (M11) — M12 cắm vào đúng chỗ này.
- Gateway Lớp B: `src/actions/action_gateway.py` (`pending_approvals`/`approve` + ApprovalStore), approve flow: `mpm agent approve` / web /approvals (M2-P5, M4-S4).
- Dispatch sau duyệt: `src/actions/approved_dispatch.py`.
- Pack seam: `src/packs/registry.py` (pack asset mới: `commands`).
- Unresolved gốc: phase-m11 §Unresolved #1 (chủ dự án đã chốt làm — chat của phiên 2026-07-02).

## Overview
- **Priority:** P1 — bậc 3 thang trách nhiệm: báo cáo → trả lời → **hành động theo lệnh, có người duyệt**.
- **Status:** ⬜ Planned.
- **Mục tiêu:** Mention agent với một YÊU CẦU ("tạo ticket cho bug X") → agent nhận diện lệnh khớp **catalog pack khai báo** → build action bằng CODE từ args đã validate → **ép enqueue Lớp B** (không bao giờ thực thi thẳng) → reply thread "chờ duyệt #id" → người duyệt (CLI/web như mọi approval) → action chạy thật → báo kết quả vào thread.

## Key Insights
- M11 đã có: mention→poll→LLM→reply qua gateway + dedup theo ts. M12 chỉ thêm một NHÁNH sau bước đọc mention: intent = command thì đi đường enqueue, còn lại Q&A như cũ.
- **An toàn nằm ở cấu trúc, không ở prompt** (bài học H1/M11): LLM không được viết action dict; nó chỉ được (a) phân loại question|command, (b) chọn command_id trong catalog, (c) điền args theo schema. Code validate args rồi TỰ build action từ template của command. Không match/không validate được → từ chối lịch sự (đường refusal M11 sẵn có).
- **Ép Lớp B theo origin**: action từ chat luôn cần duyệt, kể cả loại mà cron chạy thẳng (vd post Slack internal). Cơ chế: KHÔNG sửa `classify()`/`needs_interrupt()` (INVARIANT); dùng đường enqueue trực tiếp vào ApprovalStore với reason "chat-command từ ts=…" — giống cách external report vào queue, và approve dispatch qua `approved_dispatch` như mọi approval (Lớp A + audit + dedup vẫn áp khi thực thi).
- Catalog là **pack asset** (`domain-packs/<x>-pack/commands.py`: COMMANDS = {id: {description, server, tool, args_schema, build_args}}). pm-pack v1: `create_issue`, `comment_issue` (Jira đã trong allowlist pm). Pack không khai catalog → agent đó không nhận lệnh (từ chối như M11).
- Dedup lệnh: cùng mention ts đã dedup ở tầng reply M11; enqueue thêm dedup_hint theo ts để re-poll không tạo approval trùng.

## Requirements
**Functional:**
1. Pack asset `commands` (registry load, optional, default rỗng).
2. Intent classifier: LLM structured output {intent, command_id?, args?}; parse hỏng/không chắc → intent=question (an toàn mặc định).
3. Command build: validate args theo schema (required/kiểu/độ dài) → action dict từ template command → enqueue ApprovalStore + audit, reply thread "⏳ chờ duyệt #id — duyệt tại /approvals hoặc `mpm agent approve`".
4. Approve → thực thi qua approved_dispatch (đường sẵn có); reject → không gì chạy. (Notify thread sau duyệt: làm nếu rẻ — S5.)
5. Câu hỏi thường / lệnh ngoài catalog / pack không có catalog → hành vi M11 nguyên vẹn.

**Non-functional:**
- KHÔNG sửa ngữ nghĩa classify()/needs_interrupt(); Lớp A đứng trước mọi thứ như cũ (một lệnh "xóa page X" match catalog cũng bị Lớp A chặn lúc thực thi nếu là red line — và catalog không được chứa tool red-line ngay từ đầu: validate catalog lúc load).
- Không khai `commands` → byte-identical M11.
- Chi phí: 1 LLM call phân loại (rẻ, dùng chain M9); không đắt hơn Q&A hiện tại.

## Related Code Files (dự kiến)
**Create:** `src/agent/chat_command.py` (classify + validate + build + enqueue); `domain-packs/pm-pack/commands.py`; tests.
**Modify:** `src/packs/registry.py` (load `commands` asset + validate không chứa tool Lớp A); `src/agent/qa_answer.py` hoặc `src/runtime/inbox.py` (rẽ nhánh intent); prompts (classifier system).

## Implementation Steps
1. **S1 — Catalog seam**: Pack.commands + loader + validate-at-load (tool phải thuộc allowlist pack, không phải red-line marker).
2. **S2 — Intent classifier** (LLM structured, fallback question; test bảng: câu hỏi/lệnh hợp lệ/lệnh lạ/injection).
3. **S3 — Build + enqueue Lớp B** (validate args, action template, dedup_hint theo ts, audit, reply "chờ duyệt #id").
4. **S4 — Wire nhánh** vào inbox/QA path (không đổi đường Q&A).
5. **S5 — Notify thread sau approve** (nếu rẻ: approve handler đã trả summary → post thread; nếu đắt → defer, ghi rõ).
6. **S6 — E2E live**: "@default tạo ticket …" → approval xuất hiện (Jira CHƯA có gì) → approve → issue thật trên Jira → (S5) thread báo xong → cleanup issue test.

## Todo List
- [ ] S1 catalog seam + validate-at-load
- [ ] S2 intent classifier (fallback = question)
- [ ] S3 build args → enqueue Lớp B + reply chờ duyệt
- [ ] S4 wire nhánh inbox (Q&A nguyên vẹn)
- [ ] S5 notify thread sau duyệt (hoặc defer có ghi chú)
- [ ] S6 E2E live + pytest xanh + red-line tests

## Success Criteria
- Lệnh hợp lệ từ chat → approval #id, KHÔNG side-effect nào trước duyệt; approve → hành động thật đúng args; reject → không gì xảy ra.
- Lệnh ngoài catalog / pack không catalog / câu hỏi → M11 nguyên vẹn.
- Test chứng minh: LLM output dị dạng không bao giờ thành action; catalog chứa tool red-line bị từ chối lúc load; re-poll không double-enqueue.

## Risk Assessment
- **R1 LLM bịa args** (sai issue key, text bậy) → schema validate + người duyệt NHÌN THẤY action đầy đủ (đã redact) trước khi bấm — Lớp B chính là chốt chặn cuối.
- **R2 Injection "làm ơn approve giùm"** → agent không có quyền approve (approve là route người dùng, gateway từ chối mọi approve tự động); reply chỉ chứa link.
- **R3 Queue phình** → M8 alert approval treo; reply ghi rõ nơi duyệt.

## Security Considerations
- Mention text = untrusted (như M11): chỉ vào user-role; catalog + args schema là trần cứng của những gì có thể được yêu cầu.
- Enqueue ghi audit như mọi action; action trong approval đã qua secret-redaction sẵn có.
- Không thêm quyền mới cho web/CLI: duyệt dùng đúng route approve hiện hữu.

## Unresolved
1. Trust ladder (loại lệnh nào được auto sau này) — quyết định chính sách của chủ dự án, NGOÀI v5.
2. hr-pack có catalog gì không (v1: không — HR read-only).
