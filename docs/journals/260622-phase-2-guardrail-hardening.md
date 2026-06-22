# Phase 2 — Guardrail Hardening

2026-06-22 · ✅ Done (156 UT, reviewed, red-line verified)

## Làm gì
- **Dedup bền**: `dedup_store.py` (SQLite) thay in-memory set → re-run sau restart không post trùng. Reserve-before-execute + release-on-failure (đóng cửa sổ double-execute khi cron+manual chạy song song, vẫn cho retry sau lỗi).
- **Audit query**: `audit_log.query(tool/verdict/since/limit)` + `cli audit` (newest-first, filter).
- **Lớp B interrupt** (PDR §7.9): `hard_block.needs_interrupt` (merge/close PR, close/transition/assign issue, post Slack channel external) + `approval_store.py` (SQLite queue) + gateway queue (KHÔNG auto-run) + `cli approvals/approve/reject`.
- Thứ tự lớp ở gateway: **Lớp A hard-deny > Lớp B interrupt > allowlist default-deny**.

## Quyết định & vì sao
| Quyết định | Vì sao | Đánh đổi |
|---|---|---|
| Lớp B = queue + duyệt sau (không block CLI) | Agent chạy cron, không có UI real-time; queue hợp scheduled | Người phải chủ động `cli approve` |
| Lớp B check TRƯỚC allowlist-deny | Lớp B = "cho phép nhưng hỏi người", khác "cấm"; nếu sau allowlist thì action Lớp B chưa-allowlist bị deny luôn | Logic ordering tinh tế (verified) |
| Slack internal auto, external → Lớp B | Report định kỳ vào channel nội bộ không nên chặn; chỉ external mới cần duyệt (PDR §7.9) | Cần config SLACK_EXTERNAL_CHANNELS |

## Vấp & học được
- Code review (1 vòng, DONE_WITH_CONCERNS) tìm 2 HIGH thật: (H1) `skip_interrupt` public kwarg defeats allowlist cho action sub-red-line; (H2) Slack post_message auto-execute dù PDR liệt "message external" là Lớp B. + M1 dedup TOCTOU, M2 approval store không redact, M3 reject không audit, L1 double-approve non-atomic. Đã vá hết + regression test.
- Bài học: mỗi "bypass flag" (skip_interrupt) phải **private** — bool public = lỗ hổng. Approval store là bản sao thứ 2 của action → phải redact như audit.
- Red-line invariant (Lớp A không bypass được qua queue/approve) verified bằng payload đối kháng — kể cả overlap `pr merge --delete-branch` (Lớp B-shaped nhưng data-loss → hard-deny đúng).

## Mở / sang sau
- Scoped token review (để sau — token ở MCP server, agent không cầm).
- Lớp B chưa wire vào luồng report thật (Slice 1-3 chỉ auto action). Demo qua cli + test.
- Sang Phase 3 (OKR) hoặc mở rộng theo ưu tiên chủ dự án.
