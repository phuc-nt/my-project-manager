# v6 M13 — Danh tính riêng cho agent (Telegram bot per agent)

2026-07-03 · ✅ Done

Mở v6 ("công ty 1 CEO, nhân sự ảo"). Bậc nền: mỗi agent một **Telegram bot riêng** (tên/avatar riêng qua BotFather) — hiện diện như nhân viên thật, không còn dùng chung 1 account. Chủ dự án chốt **Telegram trước, Slack bot defer** (Bot API mở, không cần quyền admin workspace).

## Làm gì
- **Kênh danh tính mới, transport-agnostic**: `telegram:` block trong profile (`bot_token_env` + `chat_ids` allowlist + `poll_minutes`). Qua bot đó agent (1) trả lời Q&A data thật (đường M11), (2) nhận lệnh → Lớp B (đường M12), (3) nhận report như kênh phụ (channel registry P11). Không khai telegram → byte-identical.
- **Action type mới `telegram_send`** (native gateway, như `email_send` P11): mọi tin gửi qua `ActionGateway.execute` — Lớp A secret-scan + structural check, dry-run/kill-switch/dedup/audit. Khác email (all-Lớp-B): telegram tới chat trong `chat_ids` (operator khai) thực thi TRỰC TIẾP — cùng trust như Slack internal channel.
- **chat_ids allowlist 2 tầng**: đọc (poller bỏ qua chat lạ, vẫn ack) + ghi (handler closure refuse chat lạ TẠI execution path). Bot bị kéo vào group lạ không đọc cũng không nói được.
- **Transport thuần HTTP** (`urllib`, không MCP mới, không SDK): `getUpdates` offset = watermark tự nhiên (mirror M11); `sendMessage` handler. `telegram_read`/`telegram_write`/`telegram_inbox` + `inbox_dispatch` fan-out một tick ra mọi transport (Slack và/hoặc Telegram), merge run-event.

## Review (DONE_WITH_CONCERNS, 0 CRITICAL — reviewer xác nhận "THE INVARIANT holds end-to-end, backward-compat byte-identical") → vá 5
- **H1**: bot mới mặc định bật *privacy mode* → group không thấy tin thường → docs thêm bước BotFather `/setprivacy` Disable + remove/re-add.
- **M1**: thêm regex token Telegram (`\d{8,10}:[A-Za-z0-9_-]{35}`) vào `secret_patterns` — chính credential class M13 sinh ra, giờ Lớp A + audit redaction thấy được; word-bounded để issue key/timestamp không false-match.
- **M2**: bootstrap dùng `offset=-1` (Telegram trả đúng update mới nhất) → ack toàn bộ backlog kể cả >100 tin, không rò tin cũ thành "mới".
- **M4**: mỗi chat 1 try riêng khi push report — 1 chat fail/rate-limit không nuốt report chat khác.
- **M5/LOW**: docs nói đúng phạm vi (report telegram = pm-pack kinds); label per-chat trong summary; comment giải thích self-loop bất khả thi.
- Ghi nhận không vá (accepted, parity M11): send-fail bị ack vĩnh viễn — cùng semantics Slack inbox, sửa cặp nếu cần sau.

## E2E LIVE — 3 bot, mô phỏng công ty ACME
3 agent (PM/HR/Admin), mỗi bot danh tính riêng, DM với CEO. 7 `telegram_send` executed qua audit, không mutation nào lọt guardrail:
- **Q&A data thật**: PM đọc Jira (23 issue, 5 blocker, điểm nghẽn 1 người) · HR đọc Google Sheet (12 nhân sự, 5 phòng ban — sheet tạo mới cho test) · Admin đọc audit fleet (chi phí đội).
- **Giao lệnh → Lớp B**: "tạo ticket…" (tiếng Việt tự nhiên) → approval #24 (Jira CHƯA đụng) → duyệt → **SCRUM-24 tạo thật**.
- **Chặn lệnh nguy hiểm**: PM "xóa hết ticket" → từ chối (không có trong catalog) · HR "sửa lương" → từ chối (read-only) + sửa tên từ data thật. 0 approval, 0 mutation.
- **Report tự push**: daily → Confluence page thật + PM bot tự gửi báo cáo vào Telegram (`telegram:...=executed`).

## Verified
969 pytest (29 mới: config seam, classify+handler allowlist 2 tầng, watermark/bootstrap/infra/poison/chatter, transport-agnostic reply, dedup, dispatch merge, channel registry) + ruff clean.

## Bài học
- **Bot API không trả về tin do bot tự gửi** — không thể tự "giả lập CEO nhắn"; tin vào inbox PHẢI từ người thật. Chính tính chất này khiến self-loop (rủi ro R1 của M11) bất khả thi trên transport này — cái M11 phải defuse bằng sanitize thì Telegram cho miễn phí.
- **Bot trả lời không tức thì**: cần coordinating service (`poll_minutes`) chạy nền poll theo nhịp — không phải webhook realtime. Production cài launchd (M16). Đây là điểm UX cần nói rõ với người dùng.
- Action type native mới rẻ khi seam đã đúng: `telegram_send` chỉ thêm 1 nhánh classify + 1 entry `_MUTATING_TYPES` + `_label`, tái dùng nguyên guard chain — giống hệt cách `email_send` thêm ở P11.

## Unresolved
1. Slack bot-token dời sang milestone nào (sau M14, trước go-live nếu công ty vẫn dùng Slack chính).
2. Group Telegram nhiều người: operator-gate cho lệnh (đợi M14) — hiện lệnh từ mọi chat_id đã khai đều vào Lớp B (duyệt là chốt chặn).
