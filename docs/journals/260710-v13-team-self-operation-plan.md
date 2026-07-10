# v13 "Đội ngũ tự vận hành" — plan (2026-07-10)

Planning session (brainstorm → research → plan → red-team --hard). Plan
`plans/260710-1347-v13-team-self-operation/` (4 milestone, ~28-32h). CHƯA implement. Nâng
cấp giao tiếp / giao việc / tự kiểm tra của đội nhân sự văn phòng, khai thác LangGraph sâu
hơn NHƯNG giữ nguyên xương sống ticker+store+lease của v12 (không kéo orchestration
cross-process vào 1 graph dài).

## Đã làm

- **Brainstorm**: chốt 4 hướng với chủ dự án — review 2 tầng (tự-soát trong graph + peer
  review bước riêng), consult đồng nghiệp đồng bộ RO, parallel cap 2, FULL replan có CEO
  re-confirm. 4 milestone: M31 step-graph sâu / M32 peer review / M33 consult / M34 parallel+replan.
- **2 researcher** (LangGraph 1.2.6 deep: loop counter-in-state, checkpoint, stream custom
  writer, judge structured; peer-review + replan safety: rubric neo tiêu chí, failure-list có
  cấu trúc, TOCTOU hash re-validate, artifact versioning, cost pre-flight).
- **Red-team --hard 3 lens** → 26 finding → 12 cụm, 2 Critical + 7 High + 3 Medium, 0 reject.

## Quyết định & phát hiện

**Red-team bắt 1 xung đột kiến trúc gốc (cả 3 reviewer cùng chỉ)**: v13 muốn chèn step động
(review/rework) + thêm field `acceptance`, nhưng v12 có `_verify_plan_hash` băm lại TOÀN BỘ
step-rows MỖI TICK và stalled nếu lệch (red line chống tamper). → mọi task có review/acceptance
sẽ tự chết ngay tick kế. Đây là design gap, không phải lỗi đọc code (16/16 citation của reviewer
đúng).

**4 quyết định user chốt (giải gốc):**
- **A — Hash tách đôi**: `confirmed_plan_hash` chỉ khóa step CEO duyệt (bất biến); step ticker
  chèn mang cờ `system_inserted=1` → LOẠI khỏi recompute; `acceptance` = metadata ngoài hash,
  lưu `team_steps.acceptance` col. Giữ red line "hash = thứ CEO duyệt" mà vẫn chèn được review.
- **B — Bỏ LangGraph checkpointer**: reviewer chứng minh KHÔNG có caller nào resume giữa graph
  (mọi retry = attempt mới = thread mới). Bỏ SqliteSaver/migrate_state/GC/test-phantom; giữ
  rework loop counter-in-state ≤2 (giá trị chính). YAGNI thắng.
- **C — Consult = SOUL.md + PROJECT.md file**: bỏ sibling-memory vì (a) InMemoryStore rỗng trên
  worker detached, (b) nới red line M3-P9 (gate gốc scope theo project_group). File-read RO đủ
  cho "nhập vai tư vấn", không đụng hệ memory.
- **D — Reviewer = peer bất kỳ ≠ tác giả**: roster chỉ có (id, domain), agent `kiem-dinh` KHÔNG
  tồn tại trong code, mọi staff cùng domain → "khác role" vô nghĩa. Chọn peer (ưu tiên id chứa
  kiem/qa/review), không có peer → bỏ review + ghi room, không stall.

**High/Medium khác đã áp**: 4 prompt mới (self_check/review/rework/consult) bọc
`format_internal_content` chống second-order injection (failures-list là đường relay); amend
single-draft + bind full-DAG hash + confirm-consumes + `BEGIN IMMEDIATE` txn + TTL (chống 2
draft đè nhau + TOCTOU); cost DERIVE từ step `running` thay ledger → không có gì để leak;
round-cap vào store column (survive reboot+amend); sửa các claim sai về v12 (parallel đã có
sẵn, `.stream` đã dùng).

## Bài học

- **Red-team đọc code thật > logic trừu tượng**: cả 3 reviewer đều grep `_verify_plan_hash` và
  thấy nó chạy mỗi tick — planner + 2 researcher đều miss vì không đối chiếu tính năng mới với
  cơ chế phòng thủ CÓ SẴN. Khi thêm bất biến mới, phải hỏi "nó va vào bất biến cũ nào".
- **"Tái dùng X" phải verify X chạy được trong context đó**: sibling-memory (M3-P9) đúng là có,
  nhưng rỗng trên backend mặc định + có red line riêng — "reuse" thành nới lỏng an ninh ngầm.
- **YAGNI cho LangGraph**: checkpointer nghe hay nhưng không có đường resume → chỉ đẻ orphan +
  test phantom. Loop counter-in-state đủ, đơn giản hơn.
- **Plan mô tả sai hiện trạng = nợ**: nhiều "tính năng mới" thật ra v12 đã làm (parallel,
  `.stream`) — reviewer bắt hết; nếu không, implement sẽ lặp việc / mâu thuẫn.

## Unresolved

- Confidence-gate cho self_check: v1 nghiêng KHÔNG route theo confidence (chỉ passed+counter),
  giữ field để quan sát.
- Estimate per-step cho headroom-derived cost cap (dùng cost trung bình lịch sử hay hằng số v1).

Status: DONE
Summary: Plan v13 hoàn tất qua brainstorm→research→red-team --hard; 26 finding→12 cụm resolved,
2 Critical (dynamic-step vs per-tick hash) giải bằng hash tách đôi; CHƯA implement.
