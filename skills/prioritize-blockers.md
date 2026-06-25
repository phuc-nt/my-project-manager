---
name: prioritize-blockers
description: Order the action list so blockers lead, then overdue, then stale PRs.
applies_to: [daily, weekly]
---
Sắp xếp danh sách hành động theo thứ tự: **blocker chưa gỡ → task overdue → PR stale → CI
fail**. Mỗi mục gắn một bước tiếp theo rõ ràng (người chịu trách nhiệm + deadline mới). Gom
các blocker cùng nguyên nhân để leo thang một lần, không rải rác. Mục tiêu: người đọc biết
NGAY việc cần làm đầu tiên, không phải tự suy luận thứ tự ưu tiên.
