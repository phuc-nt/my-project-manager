# v13 "Đội ngũ tự vận hành" — cook + live E2E (2026-07-10)

Implement trọn plan `plans/260710-1347-v13-team-self-operation/` (4 milestone) + E2E thật.
Journal planning: [260710-v13-team-self-operation-plan.md](260710-v13-team-self-operation-plan.md).
Nâng cấp giao tiếp/giao việc/tự-kiểm-tra đội office, khai thác LangGraph sâu BÊN TRONG worker,
GIỮ ticker+store+lease v12. THE INVARIANT + 3 điều khoản mới (verdict no-steering, amend chỉ
qua CEO confirm-hash, consult RO internal-only).

## Đã làm

- **M31 step-graph sâu**: `team_task_graph` từ 3-node lên `perceive→work→self_check→(deliver|
  rework→self_check)` — conditional edge + rework loop ≤2 (counter-in-state, primitives).
  `CheckVerdict` structured (passed+failures+confidence). Hash tách đôi: `acceptance` = metadata
  KHÔNG vào `decomposition_content_hash` (task v12 byte-identical), lưu `team_steps.acceptance`
  col round-trip vào self_check. `_verify_plan_hash` chỉ băm row `system_inserted=0`. Phase events
  (dang-lam/tu-soat/dang-sua) qua `.stream(stream_mode=["updates","custom"])` + get_stream_writer
  → room + 3D bubble. Deps-aware handoff. 4 prompt artifact-consuming bọc `format_internal_content`.
  BỎ checkpointer (YAGNI — không caller resume giữa graph).
- **M32 peer review tự chèn**: ticker luật CỨNG (không LLM) chèn review-step sau content-step
  (needs_review) done; `pick_reviewer` = peer ≠ author (ưu tiên id chứa kiem/qa/review), không
  peer → bỏ review + ghi room (không stall). `review_graph` structured verdict binary + failures
  (rubric = acceptance criteria). Cần-sửa → rework-step (tác giả gốc, failures có cấu trúc bọc
  injection) ≤2 vòng (`review_round` col) → vẫn fail → EXPLICIT stall + escalate. Inserted rows
  `system_inserted=1` (loại khỏi hash). Anti-steering: verdict chỉ passed/failures, không đổi
  assignee.
- **M33 consult**: `ask_colleague` đọc SOUL.md + PROJECT.md của đồng nghiệp (file RO, KHÔNG
  sibling-memory/Store — tránh red line M3-P9 + Store rỗng trên worker detached); ≤2/step;
  fail-degrade; room kind `consult` summary ≤120 char; internal-only.
- **M34 parallel + full replan**: cap `team_task_concurrency` (default 2, đếm running trước
  dispatch — v12 vốn concurrent, đây THÊM cap). Cost cap DERIVED từ steps `running` (không ledger
  → không leak). Replan `adjust_team_task` trên admin agent: amend LLM → DIFF preview → CEO confirm
  bind `base_plan_hash` full-DAG trong 1 `BEGIN IMMEDIATE` txn → swap pending-only (done/running
  bất biến); single-draft, confirm-consumes, TOCTOU re-validate, skip-just-reserved.

## Quyết định & phát hiện

**Red-team --hard bắt 2 Critical cùng gốc** (26 finding→12 cụm): dynamic-step-insertion +
acceptance-field va vào `_verify_plan_hash` băm-mỗi-tick của v12 → giải bằng **hash tách đôi**
(Decision A). Kèm bỏ checkpointer (B), consult SOUL/PROJECT file (C), reviewer=peer≠author (D).

**E2E + review lần cook bắt 2 bug thật mà 1642 test xanh che:**
1. **Decompose prompt không bảo LLM đặt `needs_review`/`acceptance`** → mọi step ra
   `needs_review=0` → **peer review KHÔNG BAO GIỜ kích hoạt trong production**. Test P2 xanh vì
   test tự set flag. Bắt được vì chạy pipeline thật rồi soi DB: steps=2, inserted=0. Fix: thêm
   2 field vào `_DECOMPOSE_SYSTEM` prompt + hướng dẫn khi nào true.
2. **Amend frozen-prefix quên lọc `system_inserted`** (review P4 CRITICAL, reproduce empirically):
   `new_plan_hash` băm cả row review/rework (`status != pending`) trong khi `_verify_plan_hash`
   chỉ băm `system_inserted=0` → task đã có review-step mà bị amend sẽ **stalled ngay tick kế**.
   Test amend toàn dùng prefix pure-work nên lọt. Fix: frozen prefix `status != pending AND
   NOT system_inserted` (khớp đúng phạm vi hash) + pin test.

**E2E thật xác nhận toàn bộ đường sống:**
- Giao việc → LLM đặt needs_review=1 đúng cho step viết nội dung → ticker chèn review-step giao
  kiem-dinh → verdict "cần sửa (5 lỗi)" → rework noi-dung → review round 1 → cần sửa → rework
  round 1 → review round 2 → **stalled + escalate CEO** (đúng ≤2 vòng, không vô hạn).
- Phase "(đang làm)/(tự soát)" hiện trên room timeline.
- Full replan: DIFF preview (giữ step running / bỏ 4 pending / thêm 4 mới) → confirm → swap →
  task tiếp tục `open` (KHÔNG stalled — bằng chứng fix Critical) + 2 step running (cap 2).

## Bài học

- **"Suite xanh ≠ chạy được" — lần 2**: cả v12 lẫn v13 đều có bug tính-năng-chính KHÔNG kích
  hoạt trong prod dù test xanh, vì test tự set điều kiện mà prompt/đường thật không tạo ra.
  Peer review là trái tim v13 mà suýt ship dead. Chỉ E2E chạy pipeline thật + soi DB mới bắt.
- **Bất biến mới va bất biến cũ**: acceptance + inserted-step đều va vào `_verify_plan_hash`.
  Khi thêm thứ đổi step-rows, phải hỏi "nó va vào tamper-check cũ nào" — red-team bắt ở plan,
  review P4 bắt phần implement còn sót (amend prefix).
- **Reviewer hostile đọc code thật** bắt CRITICAL amend↔hash mà 1642 test + 3 implementer miss.

## Verified

- 1644 backend (1500 baseline +144) + 158 FE test; ruff/tsc sạch.
- 4 vòng review (P1, security P2+P3, P4) + red-team --hard; mọi finding áp hoặc ghi nhận.
- Live E2E: peer review + rework loop + stall/escalate + phase events + full replan + parallel
  cap 2 — screenshot room timeline. Registry E2E (7 agent) uncommitted (user data).

## Unresolved

- Confidence-gate self_check: v1 chỉ dùng passed+counter (KISS), giữ field quan sát.
- Estimate per-step cho headroom: v1 hằng số bảo thủ (cap/MAX_STEPS).

Status: DONE
Summary: v13 ship 4 milestone + E2E thật cùng ngày; red-team --hard giải 2 Critical hash-collision,
E2E+review cook bắt thêm 2 bug tính-năng-dead mà suite xanh che; tất cả vá + pin test.
