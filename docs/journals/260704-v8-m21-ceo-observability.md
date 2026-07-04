# v8 M21 — CEO-observability: báo khi agent "chết ngầm"

2026-07-04 · ✅ Done

Gap bị bỏ sót (chưa từng có plan): agent chạy cron/poll ngầm, khi chết im lặng (key hết hạn/MCP chết/token revoke) CEO low-tech KHÔNG biết. M21 phát hiện CODE-only + chủ động nhắn Telegram CEO.

## Làm gì
- **2 alert kind mới trong `team_alerts`** (deterministic, 0 LLM — bài học M15a):
  - `missed_schedule`: agent effective-enabled, có `schedule:` cho kind K, mà run gần nhất cũ hơn max(2× chu kỳ cron, 6h). Agent disabled → im (paused ≠ chết). Poller (inbox/tasks) không bao giờ "quá hạn".
  - `failing`: ≥3 run event cuối liên tiếp `error`/`load_error` cùng kind; 1 success phá streak.
- **`ops_alert_runner.run_ops_alerts`**: run-kind `ops-alerts` trên agent admin (synthetic cron 6h trong `_effective_schedule`, chỉ admin + có telegram) → tính team_alerts → giữ alert push-worthy (missed/failing) chưa-gửi-hôm-nay → nhắn **1 tin gộp** tới `ops_operator_id` qua gateway (`send_telegram_message` — không đường send mới). Dedup per (agent, kind, LOCAL-date) qua `DedupStore.claim` (bền qua restart).
- **UI**: badge health đỏ trên nav "Đội" khi có alert severity high (`use-team-health.ts` đọc `/api/team/alerts` sẵn có — không route mới); panel Đội tự hưởng 2 kind mới.

## Review 1 HIGH + 1 MEDIUM → vá
- **H1 (HIGH) poll-flood evict**: đọc `read_run_events(limit=10)` GLOBAL → agent vừa report vừa poll (inbox/tasks fire mỗi vài phút) làm runs.jsonl ngập event poll → clamp toàn cục evict HẾT event report → cả 2 alert BẤT HOẠT cho cấu hình agent PHỔ BIẾN. E2E đầu tiên pass chỉ vì sales-pm không có poller. Vá: `_recent_events_per_kind` — quét tail 5000 dòng, giữ 10 event mới nhất PER KIND → poller không evict được report. Test H2: 3 daily error + 300 inbox flood → daily vẫn sống + failing vẫn bắn.
- **M1 (MEDIUM) local vs UTC cron**: scheduler fire cron naive-LOCAL, detection dùng UTC `now` → lệch múi giờ ở reference point (UTC+7 lệch 7h). Vá: `_prev_fire` convert `now.astimezone()` trước croniter → `'0 8 * * *'` = 08:00 LOCAL khớp scheduler.
- M2 (dedup key growth) giữ nguyên — pattern pre-existing mọi gateway dedup.

## Verified
1153 pytest (+13 ops-alerts: missed/failing detection, disabled-im, poller-không-overdue, streak-broken, backward-compat state cũ, per-kind-window-chống-flood, push-gộp-1-tin, dedup-2-lần, no-operator, writes-disabled) + 57 vitest (+1 health badge) + ruff+tsc+oxlint+build. **E2E LIVE data thật** (agent admin, token thật, non-destructive restore): sales-pm 5 ngày stale → team_alerts phát hiện → run_ops_alerts nhắn Telegram → **CEO xác nhận NHẬN ĐƯỢC tin** → chạy lại dedup không nhắn đôi. **E2E H1-fix**: sales-pm 400 inbox flood + 3 daily error → per-kind window giữ daily → failing+missed vẫn bắn ✓.

## Residual (ghi rõ — red-team M6)
M21 phát hiện agent THƯỜNG chết khi service + admin còn sống. Nếu chính admin chết / service daemon down / máy sleep → KHÔNG alert (watchdog không tự canh mình). Dead-man's-switch (heartbeat CEO nhận đều, vắng = có chuyện) = follow-up ngoài v8. Worker treo giữa chừng + `_supervise` kill-timeout không sinh run event → chỉ hiện qua missed_schedule (không qua failing) — đúng mong muốn.

## Bài học
- **Test single-kind stream = phantom coverage cho hệ multi-kind**: mọi test failing/missed dùng run_events chỉ 1 kind → không lộ H1 (evict khi trộn poller). Reviewer bắt vì nghĩ tới cấu hình THẬT (agent vừa report vừa poll). E2E đầu cũng pass vì agent test không có poller. Bài: test + E2E phải mô phỏng cấu hình phổ biến nhất, không phải cấu hình sạch nhất.
- **Window toàn cục vs per-entity**: clamp "N event mới nhất" trên log trộn nhiều nguồn evict nguồn thưa. Down-sample PER KIND trước khi phân tích.
- **Detection phải cùng đồng hồ với scheduler**: cron naive-local ở service, detection UTC → lệch múi. Hai nửa 1 tính năng phải nhất quán clock.
- **Watchdog không tự canh mình** — ghi rõ residual, acceptance trung thực ("phát hiện agent THƯỜNG chết khi service+admin sống").

## Unresolved / next
1. M22: worker ghi report_summary bounded vào runs.jsonl + report kind project-rollup trên admin-pack (multi-project cái nhìn tổng).
