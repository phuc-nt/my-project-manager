# v18 "Registry = user-data + team recovery UX" — cook + UAT thật (2026-07-11)

Plan `plans/260711-0924-v18-registry-userdata-team-ux/` (3 phase), từ UAT findings v17
+ 3 quyết định CEO: đội office = mọi agent enabled; gỡ `default` (disabled); gom v18.

## Chẩn đoán gốc

"Profiles tồn tại mà registry trống" (finding #2) = **registry.yaml tracked trong git +
quy trình dev `git checkout registry.yaml` trước mỗi commit** → đội thật của user bị
revert liên tục. Bằng chứng sống: chính tôi quen tay chạy lệnh đó giữa lúc cook v18,
mất đội vừa tạo, phải khôi phục — lớp bug quy trình, không phải code.

## Đã làm

- **P1**: registry.yaml → user-data (gitignored `/registry.yaml`, `git rm --cached`);
  `registry.example.yaml` committed; `load_registry()` bootstrap atomic từ example
  (CHỈ path-mặc-định — M1; `_EXAMPLE_PATH` test được); installer copy idempotent;
  test `committed` → `example_template` (M4: test cũ ĐANG đỏ trên máy dev, đổi cùng
  commit); docstring drift 4 file.
- **P2**: `GET /api/agents/unregistered` (M2: catch Exception per-profile, degrade
  valid=false) + `POST /api/agents/{id}/register` (M3: validate id, map race → 409);
  Team.tsx section "Hồ sơ chưa trong đội"; **C1**: scheduler seed-at-discovery
  (`run_tick` setdefault) — agent đăng ký runtime có LỊCH nổ ngay, hết chết-im-lặng
  tới restart.
- **P3**: 3D canvas/floor theme-aware (MutationObserver `data-theme`; 2 palette cứng);
  label text-shadow dark; rooms-list mobile `overflow-x: auto`; health check
  `websearch_key` (ok khi không agent bật flag; profile hỏng bị bỏ qua).

## Red-team plan trước code: 1 CRITICAL + 4 MAJOR — đã áp

C1 là phát hiện đắt nhất: câu hỏi scout của tôi ("service đọc registry lúc start hay
mỗi tick?") là khung NHỊ PHÂN SAI — đáp án thật "đọc mỗi tick NHƯNG seed lịch một lần"
→ nếu cook theo câu hỏi cũ sẽ kết luận "không cần gì" và ship bug vô hình.

## Bug tự bắt khi UAT: route dùng `loaded.config.name` (ReportingConfig không có .name)
→ mọi hồ sơ hợp lệ báo "hỏng". Fix `loaded.name`. App phải restart mới nhận code — nhớ
cho các vòng sau.

## UAT browser (data thật): 7/7 PASS

Section mồ côi hiện 3 hồ sơ thật (hr, sales-pm, thiet-ke) → bấm thêm `thiet-ke` → vào
bảng đội + **roster giao việc nhận NGAY không restart**; health cảnh báo web_search
đúng (nghien-cuu bật flag, máy thiếu key); 3D dark nền tối thật (đọc pixel); mobile
480px rooms-list cuộn ngang. Trước đó: 1706 BE + 177 FE test, ruff/tsc/build sạch.

## Quy trình dev ĐỔI

**BỎ vĩnh viễn** bước `git checkout registry.yaml` trước commit (file đã gitignored —
lệnh đó giờ vô nghĩa nhưng thói quen cũ nguy hiểm nếu registry còn tracked ở checkout
khác). Memory đã cập nhật.

## Unresolved

- hr/sales-pm mồ côi là agent cũ của user — ĐỂ NGUYÊN chưa đăng ký (CEO tự quyết bấm
  thêm hay xoá thư mục).
- default profile vẫn tồn tại (disabled) — registry.example vẫn ship default enabled
  cho fresh install (hợp lý: máy mới cần 1 agent chạy được ngay).

Status: DONE
Summary: v18 ship — registry thành user-data (fix gốc mất-đội), recovery UI 1 click +
scheduler seed-at-discovery (C1), 3D dark/mobile/websearch-warn; red-team bắt C1 từ
khung câu hỏi sai, UAT 7/7 data thật.
