# v6 M15b — report-task + qa-task + web board "Việc đã giao"

2026-07-04 · ✅ Done (đóng M15: đủ 3 task type + board)

Hoàn thiện bậc 4: thêm 2 loại việc định kỳ (report-task, qa-task) bên cạnh watch-task (M15a) + web board cho CEO xem/hủy. Đóng milestone M15.

## Làm gì
- **report-task** (`recurring_task.run_report_task`): agent chạy 1 report kind theo nhịp riêng qua ĐƯỜNG GRAPH CŨ (`build_graph_for(...).invoke()`) — không đường write mới; delivery/dedup/Lớp-B-external/audit áp nguyên như report cron. Task chỉ thêm cadence.
- **qa-task** (`recurring_task.run_qa_task`): câu hỏi lặp định kỳ qua đường Q&A M11 (`_answer_question`), post qua gateway runner đã mở.
- **Recurring ≠ watch**: report/qa không có "done" tự nhiên → chạy tới **deadline** (CODE, dùng chung `_deadline_passed` của watch, mặc định 14 ngày) hoặc bị cancel. `task_runner._run_one` tách theo kind: `_run_watch` (M15a) vs `_run_recurring` (deadline check TRƯỚC → chạy graph/qa).
- **Giao qua ops chat M14**: thêm `report_task` (validate kind khớp `pack.report_kinds`) + `qa_task`, đều confirm 2 bước; `list_tasks` giờ hiển đủ 3 loại.
- **Web board** (`routes_tasks.py` + `Tasks.tsx`, route /tasks nav "Việc đã giao"): `GET /api/tasks` (mọi agent, mọi trạng thái) + `POST cancel` (idempotent cho terminal, 404 task lạ, validate agent_id path-escape). Board chỉ VIEW + CANCEL; giao việc vẫn qua chat (cần confirm dialogue). No-auth posture như route admin write khác, M16 phủ auth.

## INVARIANT giữ nguyên
Mọi mutation task qua gateway đúng phân loại cũ: report-task deliver trong graph (external→Lớp B); qa-task post qua gateway runner. Task không nới quyền.

## Review (DONE_WITH_CONCERNS, 0 CRITICAL/HIGH — INVARIANT verified) → vá 5 (1 tự bắt trước + 4 từ review)
- **hash stability (tự bắt trước review)**: qa-task dedup ts dùng `hash()` không ổn định giữa process (PYTHONHASHSEED randomize) → mỗi restart ts đổi → M11 reply dedup vỡ → double-post. Vá: `sha256(agent:question)[:12]` + suffix ngày → ổn định per (agent, question, day).
- **M1 (MEDIUM) report-task đốt token ~24×/ngày**: `tasks` cron hourly, `_run_recurring` không có per-tick gate → perceive+compose LLM chạy mỗi giờ, chỉ delivery dedup 1 lần/ngày → ~23 compose lãng phí/ngày/task. Vá: `_ran_today()` gate — nếu task đã có history entry hôm nay thì skip body đắt tiền. (watch-task không dính vì check là gh read CODE, 0 token — cost asymmetry mới ở M15b.)
- **M2 (MEDIUM) qa-task thread_ts giả**: synthetic mention không có ts Slack thật → `_post_reply` fallback `mention["ts"]` = `qa-task:{digest}:{day}` truyền vào Slack như thread_ts → Slack reject/misroute. Vá: mention synthetic → `_post_reply` post TOP-LEVEL (không set thread_ts). Test đường _post_reply thật.
- **L1/L2/L3**: board list_all per-agent try/except (1 store hỏng không 500 cả board); cancelTask encodeURIComponent; test 400 invalid-agent-id.

## Verified
1037 pytest (13 mới M15b) + 36 vitest + ruff + oxlint + build. E2E live: giao report-task 'daily' + qa-task qua ops chat (LLM thật, preview+confirm) → board API trả đúng 2 task → cancel qua API → status cancelled.

## Bài học
- **`hash()` KHÔNG BAO GIỜ dùng cho khóa bền qua process**: nó randomize theo PYTHONHASHSEED. Bất kỳ dedup/idempotency key nào cần ổn định qua restart phải dùng digest cố định (sha256/md5). Đây là bẫy im lặng — chạy 1 process thì "ổn định", chỉ vỡ khi restart (đúng lúc dedup cần hoạt động nhất).
- **Recurring vs terminal task chia rõ ở runner**: watch có stop tự nhiên (merged), report/qa không → tách `_run_watch`/`_run_recurring` giữ mỗi nhánh 1 nhiệm vụ; deadline là stop chung để không cái nào chạy mãi (R1).
- **report-task = cadence quanh graph cũ, không code mới**: tái dùng `build_graph_for.invoke` khiến report-task thừa hưởng toàn bộ guardrail/delivery của report cron — task chỉ là lịch, đúng triết lý "task không nới quyền".
- **Dedup-ở-deliver KHÔNG cứu được compute-ở-perceive/compose**: report graph là perceive→analyze→compose(LLM)→deliver; day-dedup chỉ chặn ở deliver, nên tick hourly vẫn chạy hết LLM compose rồi mới bỏ post. Cost bleed im lặng. Gate phải đặt TRƯỚC body đắt tiền (per-day check ở runner), không dựa vào dedup cuối đường. watch-task thoát vì check là CODE (0 token) — cost asymmetry giữa các task type là điều phải ý thức khi thêm loại mới.
- **Synthetic mention phải khai synthetic**: tái dùng đường M11 (_answer_question) cho qa-task tiện, nhưng đường đó giả định ts là ts Slack thật (để thread reply). Fabricate ts rồi truyền làm thread_ts = Slack reject. Bài học: khi bơm input tổng hợp vào đường có thật, đánh dấu rõ (flag `synthetic`) để nhánh nào giả định "input thật" biết mà rẽ.

## Đóng M15 / còn lại v6
- M15 HOÀN TẤT (watch + report + qa + board). Thang trách nhiệm đủ bậc 4.
- Còn: **M16** auth + deploy 1 lệnh + backup + go-live (đóng gói production).
- Defer nhỏ: giao task qua mention agent (chat_command M12, hiện chỉ qua ops chat CEO); watch target='issue' (Jira); per-task cron thật (hiện dedup per-day).
