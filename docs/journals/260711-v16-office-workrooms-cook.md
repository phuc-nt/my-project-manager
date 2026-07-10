# v16 "Phòng việc + chat-in-room + coordinator health" — cook + live E2E (2026-07-11)

Plan `plans/260711-0001-v16-office-workrooms/` (3 phase), từ feedback DÙNG THẬT v15:
task kẹt im lặng, desk ma, feed không theo task, font lệch, feed nghèo thông tin,
tab chồng chéo. Brainstorm 4 quyết định CEO + chẩn đoán gốc bằng DB/process thật
(task `open`+step `pending` nhưng KHÔNG có service ticker chạy; desk dựng từ event
history không đối chiếu registry).

## Đã làm

- **P1 BE**: `team_tasks.room_id` (metadata NGOÀI hash, ALTER-except; cấm 'office');
  `room_for_task()` = MỘT chỗ route room cho 9 module writer (grep đủ theo red-team M1);
  `list_workrooms`/`tasks_in_room` (loại planning/cancelled); chat endpoint 3 intent —
  tier-1 REGEX (`chỉnh [id]:`/`giao`/`@`) mới được auto-confirm, tier-2 LLM classify
  LUÔN preview (M3), default question; QA read-only (`office_room_qa`, artifact bọc
  internal, reply ephemeral); heartbeat từ VÒNG LẶP service.py (M2 — không phải worker
  tick) + `/api/health/coordinator` {alive, reason}.
- **P2 FE**: màn Văn phòng theo phòng việc — rooms list (●/⚠/✓, ?room= URL), ≤2
  EventSource (3D luôn 'office', feed theo room — C1), feed icon+màu token + agent chip,
  composer 2 chế độ (giao việc / chat-in-room với confirm-adjust), canvas `visibleDesks`
  lọc roster thật (HẾT desk ma) + dimmed ngoài room, banner health poll 30s, font tokens.
- **P3**: demo v3 chạy KÈM service thật (pid-file; REFUSE nếu service khác đang chạy —
  guard này bắt ngay chính service test mồ côi của tôi lúc E2E; off kill + xoá heartbeat);
  seed task rows TERMINAL-only (C2 — ticker thật sẽ ăn task open seed).

## Red-team plan trước code: 2 CRITICAL + 7 MAJOR — đã áp

C1 (3D toàn cảnh vs single-stream mâu thuẫn → 2 stream), C2 (seed bị ticker ăn →
terminal-only), M1-M7 (writer đủ, heartbeat đúng ngữ nghĩa + no_coordinator, auto-confirm
chỉ regex-tier, classifier có test, pid-file + refuse, workrooms loại draft, E2E chờ
heartbeat + touch -t).

## E2E thật: 13/13 PASS (LLM thật + ticker THẬT + DB soi)

Heartbeat lên → banner tắt; desk demo đủ + KHÔNG desk `default`; giao `@noi-dung` →
tự vào room mới → **ticker thật dispatch "started"** (fix gốc kẹt im lặng, chứng minh
sống); hỏi tiến độ → reply, DB không thêm task; `giao @thiet-ke` → task con CÙNG room;
`chỉnh <id>:` → DIFF → confirm (hash-bind); quay lại room đủ lịch sử; touch -t heartbeat
→ banner đỏ. macOS không có `setsid` → nohup+PID (bắt tại chỗ khi demo on).

## Verified

- BE 1695 + FE 175 test; ruff/tsc/build sạch; demo off trả data thật (fingerprint
  contract giữ); registry.yaml baseline. THE INVARIANT + hash-bind + projection
  closed-set + adjust single-draft/TOCTOU nguyên vẹn (red-team xác nhận file:line).

## Unresolved

- QA reply không persist (chấp nhận, ghi trong hướng dẫn) — cân nhắc kind 'assistant'
  nếu CEO muốn lưu.
- Chi phí classify/QA chỉ ghi log, chưa vào cost-cap (m-cost, KISS).

Status: DONE
Summary: v16 ship 3 phase — phòng việc (room≠task) + chat 3 intent + health banner fix
gốc "kẹt im lặng" + desk ma; red-team chặn 2 CRITICAL từ plan; E2E 13/13 với ticker thật.
