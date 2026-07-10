# v14 "Văn phòng sống + bước kẹt tự cứu" — cook + live E2E (2026-07-10)

Implement trọn plan `plans/260710-1955-v14-living-office-langgraph/` (2 phase) + E2E thật.
Yêu cầu CEO: (A) 3D sống — camera xoay 360, avatar nhiều thành phần, đi lại gần nhau khi
giao tiếp, thêm nội thất; (B) khai thác LangGraph thêm, đội tự phối hợp chủ động hơn.
Scope B chốt bounded (AskUserQuestion fail 2 lần → dùng defaults khuyến nghị, ghi rõ trong
plan): blocked-step tự cứu + consult targeting theo vai trò. KHÔNG free-form negotiation
(loại v12), KHÔNG cross-process graph (LOCKED).

## Đã làm

- **Phase 1 — 3D văn phòng sống** (FE-only): OrbitControls `autoRotate` 0.5 (drei tự dừng
  khi user kéo; reduced-motion/mobile vẫn 2D fallback, không đụng). `office-props.tsx` mới:
  2 chậu cây, bảng viết (có nét chữ), sofa, đèn cây — wireframe cùng ngôn ngữ Edges, đặt
  ngoài vòng bàn, thuần tĩnh. Avatar thêm tay + chân + breathing bob (~1.5cm, cosmetic có
  chủ đích — không mang nghĩa state, ghi chú tại chỗ). Consult → 2 avatar rời bàn đi tới
  `consultMeetPoint(own, other)` (điểm 40% về phía nhau, pure helper testable) + quay mặt
  vào nhau; event kế tiếp của MỘT trong hai bên thả cả hai về bàn.
- **Phase 2 — recover node**: `perceive → work → (self_check | recover→work)`. `work` LLM
  raise lần 1 → `recover`: phase `nho-tro-giup` + 1 consult best-effort về blocker (reuse
  seam propose/ask M33, brief "— ĐANG BỊ KẸT, lỗi hệ thống: <err 1 dòng ≤200c>", budget
  chung MAX_CONSULTS=2) → retry với hint; fail lần 2 → raise Y HỆT pre-v14 (runner
  mark_failed/escalate không đổi). `MAX_RECOVER=1`, counter-in-state primitives. Consult
  off → retry trơn (transient error vẫn được cứu). Phase enum mới đồng bộ 3 nơi (graph /
  `_STEP_PHASES` projection / FE `PHASE_LABEL`) — đúng bài học v13.
- **Consult targeting theo vai trò**: `roster_with_role_hints` — dòng đầu SOUL.md đồng
  nghiệp (RO, ≤80c, fail-degrade giữ domain trơn, không bao giờ làm roster ngắn đi) vào
  propose prompt; roster block bọc `format_internal_content` (SOUL = agent-authored);
  prompt thêm "chọn theo vai trò khớp nhất, chỉ hỏi khi thật cần".

## Review hostile (0 CRITICAL, 1 MAJOR) → tự sửa

Report: `plans/reports/from-code-reviewer-to-main-260710-2010-v14-living-office-recover-review.md`.
- **M1 (MAJOR, đã sửa + pin test)**: consult answers pass-1 fold vào biến LOCAL `handoff`
  → retry đọc `handoff_context` gốc, MẤT context đã trả tiền khi recover không còn budget.
  Fix: `consult_context` persist trong state, fold mỗi pass.
- **m1 (đã sửa)**: `str(exc)` nhiều dòng vào brief consult → squash 1 dòng trước khi cắt 200c.
- **m3 (đã sửa + pin test)**: đồng nghiệp được hỏi có thể idle không bao giờ có event riêng
  → avatar kẹt ở meet point vô hạn (pre-v14 chỉ là bubble treo). Fix reducer `endConsult`
  đối xứng: event của MỘT bên thả CẢ HAI (chỉ thả partner còn đang consult đúng desk này).
- **m5/m8/m6 (đã sửa)**: rotation wrap ±π (không quay vòng dài); bob tách inner group khỏi
  lerp; comment overclaim "~1.6 units" sửa thành gap tỷ lệ.
- **m4 (chấp nhận v1)**: bubble/label neo ở bàn khi avatar đi consult — "bubble của bàn".
- **m2 (pre-existing, ghi nhận)**: cost failure-path không vào store + propose cost bỏ qua
  — từ M33, cost-cap $2 under-count nhẹ; để milestone sau nếu cần.
- Test bắt thêm 1 hành vi thật khi pin m1: retry với hint RỖNG vẫn re-propose pre-work
  consult (đốt propose lần 3) → đổi điều kiện skip từ `recover_hint` sang `recover_count`.

## E2E thật (server thật + Playwright + SSE wire thật)

Server `PORT=8799` serve dist build thật; browser Chromium; room `office` dùng data v13
thật (5 nhân sự). Event mới append qua ĐÚNG writer production `append_office_event`
(đi trọn projection allowlist → store → SSE → reducer → 3D):
1. **Auto-rotate**: 2 frame cách 5s khác pixel (không tương tác) — PASS.
2. **Consult đi lại gần**: append `consult` noi-dung↔kiem-dinh → 2 avatar rời bàn gặp nhau
   giữa phòng, bubble 💬 hai phía — PASS (screenshot).
3. **Phase nhờ trợ giúp**: append dispatch rồi phase event `nho-tro-giup` (đúng trình tự
   ticker→graph thật) → bubble "nhờ trợ giúp" hiện; 2 avatar consult tự VỀ BÀN (chứng minh
   fix m3 trên wire thật) — PASS (screenshot).
   Lần chạy đầu FAIL vì thiếu dispatch event đi trước → zombie-attempt guard drop đúng
   thiết kế; sửa script theo trình tự production. Guard được chứng minh sống.
- Recover node với LLM provider fail THẬT không dựng được trên đường sống (không có cách
  ép provider lỗi có kiểm soát) — cover bằng 9 test graph-level (fail 1 lần/2 lần/consult
  off/budget/squash/phase-allowlist), khai báo trung thực ở đây.
- Screenshot → `docs/images/van-phong-3d-{toan-canh,tham-van-di-lai-gan,nho-tro-giup}.png`
  + cập nhật `docs/huong-dan-su-dung.md`; xoá ảnh mồ côi `van-phong-3d-dang-lam-viec.png`.

## Verified

- BE 1657 (1644 + 13 mới: 9 recover + 4 roster-hints) + FE 162 (158 + 4) test xanh;
  ruff/tsc sạch; build dist commit.
- THE INVARIANT + 3 điều khoản v13 nguyên vẹn: không row mới, `_verify_plan_hash` untouched
  (reviewer xác nhận có bằng chứng); consult vẫn RO internal-only; exception contract
  runner/worker không đổi.
- 3 event E2E còn lại trong `.data/office_room.sqlite3` (user data, gitignored — như v13).

## Unresolved

- m2: failure-path cost + propose-call cost chưa vào cost-cap (pre-existing M33).
- m4: bubble neo bàn khi avatar đi consult — nâng cấp nếu CEO muốn bubble theo người.

Status: DONE
Summary: v14 ship 2 track cùng ngày — 3D văn phòng sống (rotate/props/avatar/walk-consult)
+ recover node bounded trong LangGraph; review bắt 1 MAJOR consult-context-loss trước khi
ship; E2E wire thật 3/3 PASS kèm screenshot, zombie-guard được chứng minh sống.
