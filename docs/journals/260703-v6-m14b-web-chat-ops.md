# v6 M14b — Web chat box cho CEO chat-ops

2026-07-03 · ✅ Done

Mặt web của chat-ops: CEO quản đội bằng tiếng Việt ngay trên dashboard, không cần mở Telegram. Chỉ thêm 1 endpoint + 1 view — TÁI DÙNG nguyên engine M14a (không sửa ops_chat).

## Làm gì
- **1 endpoint** `POST /api/ops/chat` (+ `GET /api/ops/chat/available`) trong `routes_ops_chat.py`: drive ĐÚNG `handle_ops_message` engine + ĐÚNG conversation store của agent admin. **conversation_key = admin agent's `ops_operator_id`** (không phải transport) → web + Telegram DÙNG CHUNG 1 draft: CEO bắt đầu hội thoại ở web, xác nhận qua Telegram (hoặc ngược lại) đều được.
- **1 view** `web/src/views/Chat.tsx` (route `/chat`, nav "Trợ lý"): khung chat request/response (không SSE — ops reply là 1 lượt ngắn, không phải streamed run). Loading/error/unavailable xử lý gọn; disable ô nhập khi chưa có agent admin.
- **Phạm vi (chủ dự án chốt)**: KHÔNG Việt hóa toàn UI — chỉ trang chat tiếng Việt. Dùng chung conversation Telegram thay vì conversation web riêng.

## Posture bảo mật
- Localhost no-auth (giữ tới M16). Web request không có operator identity per-request (browser không có) → **"web IS operator by construction"**: cùng trust level các route admin write no-auth sẵn có (create/enable/delete). Không mở thêm quyền gì — endpoint chỉ gọi engine chung, mọi write vẫn preview + confirm 2 bước. M16 thêm auth phủ lên như mọi route.

## Verified
1003 pytest (5 mới: available true/false, engine driven với đúng operator key, empty→400, empty-reply→hint) + 33 vitest (3 mới: gửi+render reply, unavailable, empty guard) + ruff + oxlint + build OK. **Live E2E**: server thật → `GET /available` → `{available:true, agent_id:admin}`; `POST /chat "đội mình mấy agent"` → "Đội hiện có 4 agent: default/hr/admin/sales-pm" (đọc registry thật, engine chung).

## Bài học
- **Tái dùng engine đúng cách = milestone nhỏ**: M14a làm engine transport-agnostic (handle_ops_message nhận message + conversation_key + store, không biết Telegram/web) nên M14b chỉ là adapter mỏng. conversation_key = operator_id (không phải transport) cho phép cross-surface dialogue gần như miễn phí.
- Ops reply là request/response 1 lượt → KHÔNG cần SSE (khác Trigger view streamed run). Chọn đúng độ phức tạp theo bản chất tương tác.

## Unresolved / defer
1. M14b dùng chung conversation Telegram: nếu sau này web có auth riêng (M16), operator_id có thể tách per-surface — hiện KISS dùng chung.
2. Dashboard "Đội của bạn" Việt hóa: chủ dự án chốt KHÔNG cần — bỏ khỏi scope.
