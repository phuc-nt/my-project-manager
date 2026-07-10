# v15 "@PIC + màn Văn phòng hợp nhất + demo v2" — cook + live E2E (2026-07-10)

Implement trọn plan `plans/260710-2147-v15-pic-assignment-unified-office/` (3 phase).
Yêu cầu CEO: gộp 3D + activity chữ thành 1 màn; giao việc `@agent` (PIC chịu trách nhiệm
chính, chủ động làm + nhờ/kết hợp đồng nghiệp), `@all`/không @ → một agent tự nhận PIC;
tái cấu trúc màn hình; demo mode đủ data để TỰ TEST sau implement.
4 quyết định chốt qua AskUserQuestion: setting auto-confirm (default off) / PIC ôm bước
chính + tổng hợp cuối / LLM đề xuất PIC + code validate / hợp nhất 1 màn.

## Đã làm

- **P1 BE**: `parse_pic_prefix` 3 kiểu; decompose `pic_id` + `validate_pic_terminal`
  (MỘT terminal thuộc PIC); @id = code-override (không tin LLM); cột `team_tasks.pic_id`
  (ALTER-except, NGOÀI canonical hash — pin test hash-neutrality); amend PIC-aware trên
  SLICE bước mới; `team_task_auto_confirm` (company.yaml) — preview tự confirm CÙNG đường
  hash-bind, ops_chat không park draft ma, fail → cancel draft; routes
  `/api/office/assign/*` (thin wrapper, protected, brief ≤4000); projection assignment
  +pic+task_id; fix bug sẵn có POST /api/company clobber concurrency/cap.
- **P2 FE**: màn `office` hợp nhất — 1 `useOfficeStream` nuôi OfficeCanvas (extract,
  XÓA office-scene.tsx) + ActivityFeed (share `office-message-line` với OfficeRoom) +
  AssignComposer (@ dropdown, preview/confirm/cancel, card ĐÃ TỰ XÁC NHẬN); reducer
  `picTasks` (clear bằng field cứng `milestone==='done'`+task_id); ⭐ + PIC tag;
  `office/timeline` giữ OfficeRoom ("Nhật ký văn phòng"), `office/3d` redirect;
  Settings toggle.
- **P3**: demo v2 (default disabled, telegram stub cho truong-phong qua escalation-gate,
  seed pic) + E2E Playwright.

## Red-team plan TRƯỚC khi code (đúng quy trình v13) — 2 CRITICAL + 5 MAJOR

F1 demo bị escalation-gate chặn → fixture stub; **F2 amend PIC-blind** (đúng lớp "tính
năng mới va bất biến cũ" của v13) → amend vào scope; F3 draft ma sau auto-confirm;
F4 LLM swap PIC; F5 "bước cuối" mơ hồ; F6 badge không bao giờ tắt; F7 save_company
clobber. Tất cả áp vào plan trước cook + pin test.

## Review code hostile (0 CRITICAL, 2 MAJOR) → tự sửa

Report `plans/reports/from-code-reviewer-to-main-260710-2330-v15-pic-unified-office-code-review.md`:
- **M1**: LLM trả `pic_id=""` khi không @ → PIC rule skip im lặng → ép non-empty trong
  retry loop (amend task cũ vẫn skip đúng).
- **M2**: F7 residual — `team_task_cap_usd Body(2.0)` vẫn clobber khi wizard không gửi
  cap → `Body(None)` preserve-when-omitted.
- minor: auto-confirm catch Exception (không chỉ ValueError); test pin F3 skip-draft;
  composer chặn resubmit đè preview + double-click confirm; 12 comment mồ côi
  office-scene; brief cap route.

## E2E thật (demo mode + LLM decompose thật + soi DB): 13/13 PASS

1. Màn hợp nhất: canvas + feed cùng hiện, ⭐ PIC từ seed, feed có dòng "PIC: noi-dung".
2. `@noi-dung <việc>` → preview "PIC: noi-dung" → Xác nhận → **DB**: task `open`,
   `pic_id='noi-dung'`; feed nhận assignment realtime.
3. Không @ → LLM đề xuất PIC ∈ roster (lần đầu FAIL vì chọn `default` — agent vô nghĩa
   nhưng CÓ trong roster demo → fix gốc: disable `default` trong registry demo; chạy lại
   PASS deterministic) → Huỷ → DB `cancelled` (không orphan).
4. Bật auto-confirm QUA API (không cần restart — load_company đọc file mỗi call) →
   `@phan-tich <việc>` → card "ĐÃ TỰ XÁC NHẬN", DB `open|phan-tich` không bấm gì.
5. `/office/3d` redirect `/office`.
Screenshots → docs/images (màn hợp nhất / preview PIC / tự xác nhận). Demo off →
data thật nguyên vẹn (contract checksum v1 giữ).

## Bài học

- **Red-team plan trước khi code trả giá cực rẻ**: F2 (amend PIC-blind) nếu để tới prod
  là đúng lớp Critical v13; bắt ở plan chỉ tốn 1 mục scope.
- **Terminal rule phải tính trên SLICE pending**: combined DAG làm mọi amend fail vì
  frozen rows không bao giờ có dependent mới — reviewer xác nhận deviation này đúng.
- **E2E bắt bug fixture thật**: LLM chọn `default` làm PIC — hợp lệ về code, vô nghĩa về
  demo; fix data (disable) chứ không nới assert.
- Cùng route POST config: field nào request không mang PHẢI preserve (F7 lặp lại ở cap
  ngay trong chính PR fix F7 — pattern `Body(default)` là bẫy).

## Verified

- BE 1685 + FE 173 test xanh; ruff/tsc/build sạch; registry.yaml baseline trước commit.
- THE INVARIANT + các điều khoản v13/v14 nguyên vẹn: pic ngoài hash (pin test),
  `_verify_plan_hash` untouched, 3 đường confirm đi 1 cửa `confirm_plan(hash)`,
  external write vẫn Lớp B, projection closed-set.
- Chi phí E2E: ~5 decompose call LLM thật (2 lần chạy full + 1 lần re-run).

## Unresolved

- Cancel draft từ composer không phân biệt "ai" (single-CEO chấp nhận — F10 reviewer).
- Composer chưa có lịch sử việc đã giao trong phiên (xem ở feed/tab Việc).

Status: DONE
Summary: v15 ship 3 phase cùng ngày — giao việc @PIC 3 kiểu (code-validated, PIC ôm bước
chốt cuối), auto-confirm setting giữ nguyên hash-bind, màn Văn phòng hợp nhất 1 stream,
demo v2; red-team plan bắt 2 CRITICAL trước code, review bắt 2 MAJOR trước commit,
E2E 13/13 trên đường thật có soi DB.
