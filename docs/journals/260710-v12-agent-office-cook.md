# v12 Agent Office — cook + live E2E (2026-07-10)

Implement trọn plan `plans/260710-0630-v12-agent-office/` (5 phase) trong 1 ngày, kèm E2E
thật (browser Playwright + LLM OpenRouter + Telegram live). Journal planning riêng:
[260710-v12-agent-office-plan.md](260710-v12-agent-office-plan.md). THE INVARIANT nguyên
vẹn + 3 điều khoản mới (office-pack allowlist wiring, role authz gate, PII write-time
projection).

## Đã làm

- **P1** company (`company.yaml` name/coordinator/cap $2, gitignored per-install;
  `src/runtime/company.py` degrade-not-raise) + template nhân sự (`profiles/templates/`,
  wizard prefill-only, `create_agent` nhận `reports: []`).
- **P2** `team_task_store` (SQLite WAL cross-agent, lease attempt_id/pid/lease_expires_at)
  + `team_task_graph` perceive→work→deliver + worker run-kind `team-step` (verify lease,
  artifact atomic temp-rename path-confined, exit 0/1/3).
- **P3** coordinator = **ticker** pseudo-kind `team-tick` (tick ngắn → 1 action → exit;
  spawn DETACHED; kill-then-timeout có pid-identity guard; reboot recovery = tick sau đọc
  store) + `assign_team_task` trên admin ops agent (decompose 1 LLM call ≤7 bước →
  preview DAG → confirm bind content-hash, TOCTOU-proof, cấm re-materialize) + web search
  read-only (Tavily/Brave snippets-only, flag `web_search` opt-in per-agent, fail-closed
  redaction, 4-layer injection defense, audit redacted-only) + cost cap per-task gồm
  decompose+aggregate + office-pack allowlist default-deny.
- **P4** `office_room_store` (WAL + seq AUTOINCREMENT, SSoT; PII projection AT WRITE TIME)
  + SSE **store-tail** `/api/office/rooms/{id}/stream` (multi-subscriber, resume theo seq,
  KHÔNG in-proc bus — publisher là OS process khác) + `milestone-mirror` store-poller
  (cursor advance CHỈ sau khi send thành công) + `OfficeRoom.tsx` timeline.
- **P5** office 3D wireframe (r3f@9 + drei@10, route `/office/3d` lazy — chunk 930KB/249KB
  gzip tách hẳn bundle chính, main +0; reducer thuần event→desk-state key theo
  `assigned_to`; 2D fallback reduced-motion/mobile).

## Quyết định & phát hiện — review cadence bắt lỗi SAU khi suite xanh

1. **Review P1/P2**: hợp đồng lease không an toàn — không attempt-guard trên terminal
   write, TTL 300s (validation chốt 10') → double-spawn/double-cost cho step chậm; exit-3
   → `awaiting_approval` unreachable. Fix: TTL 600s, mọi terminal write `AND attempt_id`,
   đường resume sau approve có test E2E qua approval store thật.
2. **Security review P3**: ticker dispatch cả draft `planning` CHƯA được CEO confirm
   (chứng minh thực nghiệm — cơ chế confirm-bind-hash bị vòng bên hông) → loại `planning`
   khỏi tập dispatchable + cancel_draft terminal + pin test; title/source kết quả search
   chưa quarantine; audit search chưa wire ở call site thật; chưa re-check authz lúc
   dispatch; nguy cơ kill nhầm pid tái cấp → pid-identity guard (`ps -o command=` chứa
   attempt_id).
3. **Final review**: SSE office emit **named events** (`event: <kind>`) nhưng FE nghe bằng
   `es.onmessage` (chỉ bắt unnamed) → room + 3D **chết event trong production** dù toàn bộ
   suite xanh — mock che cả 2 đầu wire. Fix: bỏ `event:`, `kind` nằm trong JSON (đồng quy
   ước với run-stream cũ) + pin test wire KHÔNG mock cả 2 phía; reducer 3D key theo
   `assigned_to` (hết phantom desk "coordinator").

## E2E thật bắt thêm 6 lỗi mà 1500 test không thấy

Flow thật: tạo công ty "Công ty Một Người" → nút 1-click "Tạo trưởng phòng" (tạo agent từ
template + set coordinator_id) → 3 nhân sự từ template (persona VN, nghien-cuu có
`web_search: true`) → chat "giao việc: lập kế hoạch marketing..." → LLM decompose 6 bước
→ "xác nhận" bind hash → ticker 28 tick chạy 6 team-step worker thật trên 4 agent →
aggregate về room → Telegram milestone-mirror **delivered thật**. Cost $0.014/cap $2
(decompose $0.0009 + aggregate $0.002 + 6 step).

1. Validation escalation đòi coordinator có bot Telegram riêng — bootstrap không tạo →
   giao việc luôn fail. Redesign: escalate ghi room `milestone` TRƯỚC (mirror admin lo DM),
   `_escalation_routable` chấp nhận đường admin.
2. `ValueError` từ preview bị nuốt thành 500 "Máy chủ đang gặp lỗi" → catch trả reply
   tiếng Việt + clear draft.
3. Flag `web_search` có đường đọc (loader) nhưng không có đường ghi qua wizard/create →
   wire template→spec→profile.yaml (chỉ ghi literal `True`).
4. 3D không thấy nhân sự: room tổng chỉ nhận milestone, `step_status` chỉ vào room task →
   mirror `step_status`/`assignment` sang room tổng (`also_office=True`).
5. CLI `mpm agent run` thiếu kind `milestone-mirror` (P4 đăng ký scheduler+worker, sót CLI).
6. Playwright `networkidle` không bao giờ đạt vì SSE giữ kết nối mở — đổi
   `domcontentloaded`; chính timeout này là bằng chứng stream sống.

## Bài học

- **Mock che wire contract**: SSE named-event mismatch xanh toàn suite vì cả BE test (drain
  generator Python) lẫn FE test (mock hook) không đi qua bytes thật. Boundary nào có wire
  (SSE/HTTP) phải có ≥1 test không-mock cả hai đầu.
- **"Suite xanh" ≠ "chạy được"**: 6 lỗi runtime chỉ lộ khi bấm nút thật trên browser + gửi
  Telegram thật. E2E là gate, không phải trang trí.
- **Test-isolation phải fail-loud**: 4 file test ghi vào `.data` THẬT qua
  `append_office_event` (room rác t1/t2 lộ trên UI thật) → autouse fixture pin
  `team_task_paths.DATA_DIR` về tmp_path; chứng minh 26→26 messages sau khi chạy test.
- **Per-install user data tách khỏi commit**: registry agents E2E + `company.yaml` không
  vào git (test đọc file committed sẽ vỡ); `company.yaml` thêm vào .gitignore,
  load_company degrade khi thiếu.

## Verified

- 1500 backend test (baseline 1257 +243) + 146 FE test/31 file; ruff + tsc sạch; build
  code-split xác nhận (0 tham chiếu three trong main chunk).
- Live: screenshots Team/chat/room/3D; task `bc3e1017f836` done 6/6 step, 6 artifact
  handoff, hash bound; Telegram mirror run `delivered` (runs.jsonl admin).
- Red-line: fail-closed redaction (provider không được gọi khi còn match), snippets-only,
  audit redacted-only, allowlist office-pack NOT_ALLOWLISTED, draft `planning` invisible
  với ticker, double-spawn guard, awaiting_approval pause clock.

## Unresolved

- Chưa có `TAVILY_API_KEY`/`BRAVE_API_KEY` trong env → web search mới verify đường degrade
  (tool tự tắt sạch); search egress thật test khi có key.
- Live install đang giữ công ty + 4 nhân sự office (user data, uncommitted) — dùng tiếp
  được ngay; service scheduler sẽ tự chạy team-tick/milestone-mirror khi daemon bật.

Status: DONE
Summary: v12 ship trọn 5 phase + E2E thật cùng ngày; 4 vòng review + browser E2E bắt tổng
cộng 9 lỗi kiến trúc/runtime mà suite xanh che — tất cả đã vá và pin test.
