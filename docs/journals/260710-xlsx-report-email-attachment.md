# XLSX report export + email attachment (2026-07-10)

Quick-win: resource/cost + OKR reports → `.xlsx`, emailed as a Lớp B attachment (internal-only).
Plan `plans/260709-0805-xlsx-report-export-email-attachment/`. 3 phases, THE INVARIANT intact.

## Đã làm

- **P1 — builder**: `src/reporting/xlsx_export.py` (new, 126 LOC). `build_resource_xlsx` /
  `build_okr_xlsx` serialize the existing analyzer dataclasses (`ResourceReport`/`CostSummary`,
  `OkrRollup`) to `.xlsx` bytes — pure, no LLM/clock/gateway. `artifact_path` = the single source
  of truth for `data_dir/artifacts/<kind>-<date>.xlsx`. openpyxl (BSD) added to deps.
- **P2 — attachment + Lớp A confinement**: email action gains a sibling `attachment_path` (a PATH,
  never bytes → stays out of the audit/approval store). New Lớp A red line `confined_xlsx_path`:
  the file must resolve inside the artifact dir, be `.xlsx`, and exist — else SECURITY hard-deny.
  Handler re-checks at send time (defense-in-depth) through the SAME helper. Email stays LUÔN Lớp B.
- **P3 — wire graphs**: build the xlsx at `compose` (snapshot live in the box) and thread only the
  string path through `ReportState` (resume-safe S4); `deliver` passes it to the existing email sink
  via `channel_registry`/`audience_delivery`. Built only when an email channel is configured (no
  orphan files). No new egress, no allowlist change.

## Quyết định & phát hiện

- **openpyxl, không OfficeCLI**: điều tra OfficeCLI (repo `~/workspace/OfficeCLI`) cho thấy nó = ~70k
  dòng C# quanh DocumentFormat.OpenXml, và Python SDK của chính nó chỉ là thin shell gọi binary.
  Port sang Python = viết lại cả lib → phản YAGNI. Bảng số liệu → openpyxl thừa sức. OfficeCLI để
  dành nếu sau cần render→PNG (agent "nhìn" tài liệu).
- **Email = duy nhất khả thi**: verify cả 3 MCP — Slack (browser-token) không có upload tool,
  Confluence không có attach tool (cả hai cần sửa external server). Email `add_attachment` = stdlib.
- **Email vốn internal-only**: `deliver_extra_channels_and_summarize` đã hard-skip `audience !=
  "internal"` từ trước → xlsx chỉ đi internal, full-detail, KHÔNG mở đường external. Quyết định
  "full detail external" của chủ dự án hoá ra moot — 1 builder full-detail là đủ, không cần biến thể.

## Bài học

- **Contract đổi → cập nhật test double, không phải "regression"**: thêm `attachment_path` vào
  `deps.deliver` làm 10 test dùng fake lambda/spy fail vì thiếu tham số. Đây là fixture, sửa
  signature là đúng; đừng nhầm với lỗi thật.
- **`resolve()` + `is_relative_to` chặn cả symlink-escape**: symlink BÊN TRONG artifact dir trỏ RA
  NGOÀI bị chặn vì resolve() deref link → đích nằm ngoài root. Code-review (security) bắt: đây là
  điểm dễ vỡ nếu ai đó refactor sang `absolute()` (không deref) → thêm test symlink-escape vào CI để
  khoá lại. Cũng gộp Lớp A + handler về 1 helper `confined_xlsx_path` (hết drift, DRY).
- **Bytes không được vào action dict**: attachment truyền bằng path để audit log/approval store
  không phình + không chứa nội dung file — cùng nguyên tắc "password never on the action".

## Verified

- 1257 test pass (baseline 1233 + 25 mới), ruff sạch toàn repo.
- Symlink-escape + TOCTOU + traversal + absolute-elsewhere + fail-closed(no-root) đều DENY (test).
- Email attachment vẫn `pending_approval` (Lớp B); resume-safe S4 test pass; bytes không trên action.
- Code-review P2 (security): DONE_WITH_CONCERNS → 2 MINOR fixed (shared helper + symlink test).

## Unresolved

- OfficeCLI để lại như tuỳ chọn tương lai cho render→PNG (self-check tài liệu trước khi gửi) —
  ngoài scope quick-win này.
