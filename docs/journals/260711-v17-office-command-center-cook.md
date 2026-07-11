# v17 "Command center 3 cột + artifact viewer + IA" — cook + live E2E (2026-07-11)

Plan `plans/260711-0711-v17-office-command-center/` (3 phase), từ test thật v16 của CEO:
bubble treo task cũ, bàn giao không xem full + markdown thô, thiếu lịch sử artifact,
IA trùng vai. 4 quyết định AskUserQuestion: 3D trên + 3 cột dưới / mọi bước done + full
MD + copy/tải / Văn phòng = trang chủ + Việc→Duyệt / bubble CHỈ việc đang chạy.

## Đã làm

- **P1 BE**: `routes_office_artifacts.py` — 2 GET read-only (catalog room + full step);
  path-safe: task_id gate `store.get`, seq int-coerce 422, đường dẫn server ghép qua
  `read_step_artifact`, mọi lỗi → 404 (không 500). M2: ticker timeout append
  `step_status failed` — desk hết kẹt bubble vĩnh viễn (nhánh Q4 bị hụt).
- **P2 FE**: 3 cột (Phòng việc | Tiến độ | Kết quả); `artifact-viewer` react-markdown +
  remark-gfm (LAZY chunk office — 0 byte vào main, kiểm grep bundle); M4 override
  components.img → link (LLM output không thể ping remote từ browser); copy + tải .md;
  feed handoff = notice ngắn ("xem cột Kết quả"); `shouldShowBubble` Q4;
  IA: `/` → office, nav Duyệt (badge), Work giữ đủ 2 section (board per-agent nguyên).
- **P3**: seed ghi artifact THẬT (seq đọc từ store — M3, seq GLOBAL autoincrement);
  demo off dọn `demo-*` artifacts.

## Red-team plan trước code: 0 CRITICAL, 4 MAJOR — đã áp

M1 review-step không có artifact file → lọc step_type; M2 timeout không emit step event
→ desk kẹt; M3 seed seq global; M4 markdown img egress. PASS đáng giá: path-safety đã
có sẵn ở tầng artifact module (`_TASK_ID_RE`+`_confine`), react-markdown 10 strip
javascript:/data: TRƯỚC khi components nhận props.

## Review code hostile: 0 CRITICAL, 0 MAJOR, 6 minor (2 đã vá: typo comment, ghi chú
script; 4 chấp nhận: 'assigned' unreachable vô hại, error message generic, focus-trap,
"(xem cột Kết quả)" hiện cả ở Nhật ký).

## E2E thật: 16/16 PASS (LLM + ticker + file thật)

Redirect `/`→office; hint toàn cảnh; Q4 kiem-dinh(done) im + 💬 consult giữ; room seed
2 task → list ≥3 bước; **markdown render THẬT (h2/table element, không text thô)**;
tải .md; Esc; giao `@noi-dung` thật → bàn giao → cột Kết quả room mới mở được full;
Duyệt đủ 2 section. 2 vòng chạy đầu lộ bài học: (1) assert 'Soát chéo' match nhầm
bubble noi-dung "Sửa theo soát chéo" (hasText case-insensitive) → nhắm chuỗi unique;
(2) E2E KHÔNG idempotent trong 1 phiên demo (task thật lần 1 đổi thứ tự rooms + clear
consult) → chọn room theo TÊN + recycle demo trước run.

## Verified

- BE 1701 + FE 177 test; ruff/tsc/build sạch; demo off data thật nguyên vẹn;
  registry.yaml baseline. Bất biến giữ: PII-firewall room events không đổi (artifact
  đọc FILE gốc, không nhét full vào room), routes protected, THE INVARIANT nguyên.

## Unresolved

- Artifact viewer: focus-trap + hiển thị detail 404 (minor UX, để sau).
- Task thật giao trong demo để lại thư mục artifact hex mồ côi sau off (vô hại, đã ghi
  chú trong script header).

Status: DONE
Summary: v17 ship — Văn phòng thành màn chính 3 cột với cột Kết quả xem/copy/tải full
markdown từ artifact thật, bubble hết treo task cũ, IA gọn vai trò; red-team+review
0 Critical/Major, E2E 16/16 đường thật.
