# v8 M23 — Trust ladder: auto-approve Lớp B có kiểm soát

2026-07-04 · ✅ Done · (kết thúc v8)

Lần NỚI QUYỀN THỰC THI ĐẦU TIÊN từ v1. CEO không còn là bottleneck: agent tin cậy tự chạy hành động Lớp B (external) rủi ro thấp trong hạn mức. **Lớp A/kill-switch/dry-run KHÔNG đường nào tới auto — THE INVARIANT nguyên vẹn**, verify bằng adversarial review.

## Dual-surface (red-team B1: Lớp B có 2 cơ chế khác nhau)
- **Bề mặt 1 — graph-interrupt**: scheduled EXTERNAL report pause bằng `interrupt()` trong `approval_gate` (TRƯỚC deliver). Auto: kind ∈ `scheduled_reports` → gate set `approve` + cờ `auto_approved` → deliver chạy (không interrupt). Trần tự nhiên = schedule (1 lần/tick).
- **Bề mặt 2 — gateway-enqueue**: chat-command/email/ad-hoc post qua `needs_interrupt`/`enqueue_for_approval`. Auto: policy cho phép + claim slot → **re-enter `_execute(approved=True)`** (đệ quy re-check Lớp A/kill/dry-run/dedup — red-team B2, CẤM inline handler).

## Làm gì
- **`auto_approve_policy.py`** (thuần): `evaluate(action, config, origin, sender, transport, chat)` → cho/không + rationale; `claim_daily_slot` reservation `DedupStore.claim` key `auto-slot:<type>:<local-date>:<seq>` (atomic, bền, LOCAL date — red-team M1/M2).
- **Config `auto_approve:`** profile.yaml (validate fail-loud: unknown type/negative/non-dict reject; vắng ⇒ OFF byte-identical). `scheduled_reports` + `actions:{type:{enabled,max_per_day,channels}}` destination-bound (red-team M5) + `trusted_senders:{telegram:[id]}`.
- **Gateway**: `_try_auto_approve` (evaluate→claim→rationale|None); interrupt-block gọi origin=scheduled; `enqueue_for_approval` +sender/transport/chat/auto_handler gọi origin=chat. Chat-origin CHỈ trusted Telegram-DM (red-team M4: transport=telegram + chat_id==sender + sender∈trusted).
- **chat_command** thread `mention[user/channel]` + `auto_handler=dispatch_approved_action`. **qa_answer/inbox/telegram_inbox** gateway +`auto_approve`.
- **UI**: khối "Đã tự duyệt hôm nay" (Work) đọc run-event `auto_approved` flag; audit rationale `auto_approve:*` (KHÔNG lộ qua audit API — giữ quyết định privacy verified).
- **Thu hồi**: tắt toggle → profile ghi → worker process mới đọc config mới; kill-switch chặn tức thì.

## ADVERSARIAL REVIEW: THE INVARIANT HELD, 3 defect vá
- **HELD mọi probe (CONFIRMED)**: Lớp A secret/destructive hard-block với auto ON → handler không chạy; kill-switch/dry-run re-apply trên auto path (đệ quy); `approved=True` bypass CHỈ cho NOT_ALLOWLISTED không cho Lớp A category; cap atomic (2 concurrent → 1 winner); vắng config byte-identical; config fail-loud; mọi auto action được audit.
- **HIGH (vá)**: chat auto-approve CHẾT trong inbox thật — `telegram_inbox`/`inbox` build gateway KHÔNG `auto_approve` rồi inject vào `answer_mention` → wiring qua qa_answer không bao giờ chạy. Fail-SAFE (queue) nhưng tính năng headline chết + CI xanh (test dựng gateway trực tiếp, không qua inbox). Vá: thread `auto_approve` vào 2 inbox gateway + `test_inbox_auto_approve_wiring` (spy ActionGateway qua run_telegram_inbox + run_inbox — non-phantom cả 2 path). **E2E đầu của tôi hit gateway trực tiếp → bỏ sót HIGH này**.
- **MEDIUM (vá)**: automation ProposeStep `execute(handler=None)` — với auto ON, nhánh auto → `handler is None` → skipped + tiêu slot + DROP proposal (pre-M23 queue cho người). Vá: nhánh auto chỉ chạy khi `handler is not None`; None → enqueue.
- **LOW (vá)**: `evaluate` DM check short-circuit khi chat_id/sender_id rỗng → có thể auto không-binding. Vá: đòi cả 2 non-empty AND bằng nhau.

## Verified
1205 pytest (+34 M23: policy matrix origin×type×đích×sender×trần, gateway Lớp A/kill/dry-run nghịch + cap + chat sender + propose-no-handler-queue, approval_gate surface1, inbox wiring cả 2 path, config validate) + 58 vitest (+1 "Đã tự duyệt") + ruff+tsc+oxlint+build. **E2E LIVE config profile thật** (sales-pm auto_approve): surface1 daily auto-deliver, surface2 scheduled post + chat trusted DM executed, chat stranger→queue, **kill-switch + Lớp A hard-deny vẫn DENY với auto ON**.

## Bài học
- **"Lớp B" là 2 cơ chế khác nhau** (graph-interrupt vs gateway-enqueue) mà mọi doc gọi chung 1 tên → red-team plan bắt B1, phải phủ CẢ HAI. Với security: trace flow THẬT end-to-end, đừng tin tên gọi.
- **Nới quyền = re-enter đường guard đầy đủ, KHÔNG inline**: auto path `_execute(approved=True)` đệ quy re-check tất cả → Lớp A/kill-switch tự động áp dụng. Inline handler = bỏ guard = thảm họa.
- **E2E "sạch" (gateway trực tiếp) bỏ sót wiring runtime thật**: tính năng chết trong inbox mà test+E2E xanh vì cả hai dựng gateway trực tiếp, không qua đường production (inbox→qa_answer). Test/E2E phải đi đúng ĐƯỜNG THẬT, không đường tắt. Adversarial reviewer bắt vì trace runtime path.
- **Trần chống TOCTOU = reservation không phải count**: claim-slot atomic (INSERT-OR-IGNORE) an toàn đa process; đếm-rồi-chạy vượt trần trong burst. Handler fail tiêu slot = hướng an toàn.
- **Trusted-sender check trên user-id BẤT BIẾN** (Telegram from.id, forward không giả) + DM-only + destination-bound → grant hẹp đúng bằng cái người từng duyệt.

## v8 hoàn tất
M21 (observability) → M22 (multi-project rollup) → M23 (trust ladder). 3 gap "vận hành thật" đóng: CEO biết agent chết ngầm, nhìn tổng nhiều project, không còn là bottleneck duyệt. THE INVARIANT nguyên vẹn qua cả 3.

## Unresolved / next
1. Non-blocking: surface 1 scheduled-report uncapped (trần = schedule tick) — nếu kind chạy nhiều lần/ngày cần trần riêng.
2. `trusted_senders` mở rộng Slack namespace (v1 Telegram-DM only).
