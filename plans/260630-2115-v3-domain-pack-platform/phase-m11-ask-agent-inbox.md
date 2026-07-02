# Phase M11 — Ask-agent Slack inbox (hỏi-đáp ad-hoc)

> [← plan.md](plan.md) · trước: [phase-m7](phase-m7-low-tech-ui.md) (+ v4 M9 khuyến nghị xong trước) · Thêm 2026-07-02 sau đánh giá gap "thay thế human hành chính".

## Context Links
- Đánh giá gap: `../reports/plan-assessment-260702-0617-v3-v4-multi-purpose-gap-report.md`
- Scheduler/worker: `src/runtime/` (service dispatch, per-agent run) — inbox = 1 run kind mới theo lịch poll.
- Slack read: slack MCP server (browser-token đọc được mention/history) — tool sẵn.
- Dedup: idempotency store sẵn (`src/actions/`) — dedup theo message `ts`.
- Pack ToolProvider + prompts (M5/M6) — nguồn dữ liệu + giọng trả lời theo domain.

## Overview
- **Priority:** P1 — năng lực định nghĩa "coworker": human PM/HR bị hỏi ad-hoc hằng ngày; agent chỉ báo cáo 1 chiều thì chưa "thay người".
- **Status:** ⬜ Planned. Cook SAU M7 (khuyến nghị sau cả v4 M9 — trả lời sai giờ vì provider chết là hỏng trải nghiệm).
- **Mục tiêu:** Mention agent trong Slack channel nó phụ trách → agent đọc dữ liệu thật (qua pack tools) → trả lời trong thread. **Read-only Q&A** ở milestone này.

## Key Insights
- **Poll, không webhook** — local-first, không expose port công khai. Scheduler sẵn có chạy run kind `inbox` mỗi N phút (mặc định 2–5'); browser-token đọc mention được.
- Tái dùng tối đa: perceive = pack ToolProvider read; compose = LLM với pack prompt + câu hỏi; deliver = slack post (reply thread) qua **Action Gateway như mọi write**.
- Số liệu trong câu trả lời phải deterministic như report (đếm/tổng từ analyzer, LLM chỉ viết prose) — không để LLM bịa số trả lời sếp.
- Câu hỏi ngoài dữ liệu agent có → trả lời "không đủ dữ liệu" rõ ràng, không đoán.

## Requirements
**Functional:**
1. Profile khai báo `inbox: {channel: <id>, poll_minutes: N}` (opt-in; không khai báo → không poll, backward-compat).
2. Run kind `inbox`: đọc message mới mention bot-user/agent-name trong channel từ lần poll trước; mỗi mention chưa xử lý → 1 Q&A run.
3. Q&A graph: parse câu hỏi → perceive (pack tools read) → analyze (deterministic số liệu) → compose trả lời → deliver reply vào thread gốc qua gateway.
4. Dedup theo message ts (idempotency store) — restart/re-poll không double-reply.
5. Yêu cầu WRITE từ chat ("tạo ticket…") → trả lời lịch sự rằng chưa hỗ trợ qua chat + chỉ cách làm (defer thực thi; xem Unresolved).

**Non-functional:**
- THE INVARIANT giữ: reply = write qua gateway (slack post tool đã allowlisted; internal channel không cần Lớp B — như report internal; external channel → Lớp B như thường).
- Không khai báo `inbox:` → byte-identical hành vi cũ.
- Chi phí: Q&A dùng model rẻ trong chain (M9) nếu có; budget cap áp như mọi LLM call.

## Related Code Files (dự kiến — chốt lúc cook)
**Create:**
- `src/runtime/inbox_poller.py` — đọc mention mới + dedup state (generic, không domain).
- `src/agent/qa_graph.py` — Q&A graph generic dùng pack ToolProvider/prompt.
- Pack optional: `prompts/qa-system.md` per pack (fallback: prompt generic + persona).

**Modify:**
- `src/profile/loader.py` + config — `inbox:` block.
- `src/runtime/worker.py`/service dispatch — run kind `inbox`.
- Scheduler — lịch poll từ `poll_minutes`.

## Implementation Steps
1. **S1 — Config `inbox:`** (loader + validate; opt-in).
2. **S2 — Poller** đọc mention mới qua slack MCP + dedup ts (idempotency store).
3. **S3 — Q&A graph** perceive→analyze→compose→deliver (reply thread, qua gateway).
4. **S4 — Wire scheduler** run kind inbox theo poll_minutes.
5. **S5 — Write-request refusal** (nhận diện yêu cầu mutation → trả lời hướng dẫn, không thực thi).
6. **S6 — E2E live:** mention agent hr/pm trong channel test → nhận reply đúng số liệu thật, dedup verified.

## Todo List
- [ ] S1 config `inbox:` opt-in
- [ ] S2 inbox poller + dedup ts
- [ ] S3 Q&A graph (reply qua gateway)
- [ ] S4 scheduler wire
- [ ] S5 write-request refusal
- [ ] S6 E2E live + pytest xanh

## Success Criteria
- Mention agent trong Slack → nhận reply đúng dữ liệu thật trong ≤ poll interval + runtime.
- Số liệu trong reply deterministic (khớp analyzer, không bịa).
- Không double-reply sau restart/re-poll.
- Không khai báo inbox → hành vi cũ nguyên vẹn. THE INVARIANT giữ.

## Risk Assessment
- **R1 Vòng lặp tự trả lời** (agent reply chính nó chứa mention) → filter message của chính bot-user; chỉ xử lý mention từ người.
- **R2 Chi phí LLM tăng** (poll + Q&A) → poll rẻ (read, không LLM); LLM chỉ chạy khi có mention; budget cap giữ.
- **R3 Prompt injection qua nội dung Slack** → câu hỏi là untrusted input: chỉ đưa vào user-message, KHÔNG system; gateway chặn mọi write ngoài reply; red line Lớp A giữ.
- **R4 Trả lời sai/bịa** → số liệu deterministic + "không đủ dữ liệu" khi ngoài phạm vi.

## Security Considerations
- Nội dung mention = untrusted → không nhét vào system prompt; audit log ghi Q&A run như mọi run; secret redaction sẵn áp dụng.
- Reply external channel → Lớp B (giữ nguyên ngữ nghĩa audience).
- PII: HR Q&A trả lời aggregate như headcount report; không trả lời chi tiết cá nhân (pack prompt quy định).

## Unresolved
1. Thực thi WRITE từ chat (tạo ticket qua approval Lớp B) — hỏi chủ dự án sau khi M11 chạy; KHÔNG tự thêm.
2. Bot-user identity trong Slack browser-token (mention theo tên nào) — xác định lúc cook S2 bằng dữ liệu thật.
