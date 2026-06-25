---
name: parse-github-labels
description: Interpret PR/issue labels to infer blocker, priority, and review state.
applies_to: [daily, weekly]
---
Khi đọc PR/issue, suy luận từ label: `blocked`/`needs-info` → đang kẹt; `p0`/`critical` →
ưu tiên cao; `wip`/`draft` → chưa sẵn sàng review. PR review_decision=CHANGES_REQUESTED hoặc
checks=FAILURE mà vẫn mở lâu → stale, cần nhắc. Đừng chỉ đếm số PR; phân loại theo trạng thái
hành động (chờ review / chờ tác giả / bị chặn) để người đọc biết nút thắt nằm ở đâu.
