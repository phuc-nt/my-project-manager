---
name: flag-risk
description: Rank risks and name the single highest-impact one with a concrete action.
applies_to: [daily, weekly]
# allowed-tools: []   # forward-compat only — PARSED-AND-IGNORED this round (C1)
---
Khi tổng hợp rủi ro, xếp hạng theo mức tác động: **blocker > overdue > stale-PR > CI fail**.
Nêu RÕ một hạng mục ảnh hưởng lớn nhất (không liệt kê dàn trải) kèm hành động cụ thể: ai
cần làm gì, trước khi nào. Nếu một issue vừa overdue vừa blocked → ưu tiên hàng đầu (nguy
cơ slip kép). Tránh chung chung như "có vài rủi ro"; phải chỉ đích danh.
