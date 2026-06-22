# Plan — Phase 2: Guardrail Hardening

> Status: **DONE (2026-06-22) — 156 UT, ruff clean, code-reviewed (DONE_WITH_CONCERNS → 6 fix applied), red-line verified.** Mode auto.
>
> Outcome: (1) dedup_store SQLite persist (reserve-before-execute + release-on-failure, survives restart); (2) audit_log.query() + `cli audit`; (3) Lớp B interrupt — hard_block.needs_interrupt + approval_store + gateway queue (order: Lớp A > Lớp B > allowlist) + `cli approvals/approve/reject`.
>
> Review fixes: H1 skip_interrupt → private (chỉ approve); H2 external Slack channel → Lớp B (internal auto); M1 dedup reserve atomic; M2 approval store redact secret; M3 reject audited; L1 double-approve CAS atomic. Red line (Lớp A) verified không bypass được qua queue/approve.

## Goal
3 việc: (1) **dedup bền qua restart**, (2) **audit log query được**, (3) **Lớp B interrupt** (queue + duyệt sau).

## Locked decisions (user)
- Dedup: in-memory set → **persist** (SQLite, cùng `.data/`). Re-run sau restart không post trùng.
- Audit query: read/filter API + `cli audit` xem lại (hiện chỉ ghi, không đọc).
- Lớp B: **queue + duyệt sau** — action Lớp B → ghi `pending approvals` (SQLite) + thông báo, KHÔNG thực thi. `cli approve <id>` để duyệt → thực thi qua gateway. Cơ chế + phân loại Lớp B trong hard_block + 1 demo action. Chưa wire vào luồng thật (YAGNI).

## Scout facts (verified)
- `action_gateway.py`: `_seen_keys: set()` in-memory (L3 debt). dedup_hint đã có.
- `audit_log.py`: chỉ `record()` (write). Không query.
- hard_block: chỉ Lớp A (hard-deny) + allowlist. **Chưa có Lớp B** (chỉ comment TODO).
- Kill switch / rate-limit / idempotency: đã có test (Phase 0). Phase 2 không đụng.
- Slice 1-3 mutations (slack post, confluence createPage) = auto-OK (✅), không Lớp B.

## Acceptance
1. **Dedup persist**: gateway dedup dùng SQLite store (`.data/dedup.db` hoặc bảng trong checkpoints). Re-run cùng (kind+ngày) sau restart → `deduplicated`, không post lần 2. Test: 2 process giả lập (gateway mới) cùng key → lần 2 skip.
2. **Audit query**: `audit_log.query(filters)` → list entries (filter tool/verdict/từ-ngày). `cli audit [--tool X] [--verdict deny] [--limit N]` in ra. Đọc audit.jsonl, parse, filter.
3. **Lớp B**:
   - `hard_block.classify` trả thêm verdict **`INTERRUPT`** (Lớp B) cho action nhạy cảm (vd jira `closeIssue`/`deleteIssue`-no, gh `pr merge`/`pr close`, message external...). Danh sách §7.9 Lớp B.
   - Gateway: action Lớp B → ghi `pending_approval` (SQLite) + audit verdict `pending` + raise/return `InterruptResult`, KHÔNG thực thi.
   - `cli approve <id>`: đọc pending → thực thi action qua gateway (bypass Lớp B check 1 lần, vẫn qua Lớp A + audit) → đánh dấu approved. `cli approvals` list pending.
   - Demo: 1 action Lớp B (vd `{type:gh_cli, argv:[pr, merge, ...]}`) test trọn vòng: classify INTERRUPT → queue → approve → execute.
4. UT pass (mock), ruff clean, no regression (136). 

## Out of scope
- Wire Lớp B vào luồng report thật (chưa có action Lớp B trong report). Scoped-token review (để sau). Lớp B notify qua Slack (chỉ log/cli lần này).

## Touchpoints
| File | Action |
|---|---|
| `src/audit/audit_log.py` | + `query(tool, verdict, since, limit)` đọc + filter JSONL |
| `src/actions/hard_block.py` | + Lớp B classify (verdict INTERRUPT) + danh sách Lớp B (MCP tool + gh) |
| `src/actions/action_gateway.py` | dedup → persist store; Lớp B → queue pending thay vì execute |
| `src/actions/dedup_store.py` | TẠO — SQLite persistent dedup (seen keys) |
| `src/actions/approval_store.py` | TẠO — SQLite pending approvals (id, action, status, created) |
| `src/entrypoints/cli.py` | + `audit`, `approvals`, `approve <id>` commands |
| tests/ | + dedup persist, audit query, Lớp B classify + queue + approve flow |
| `docs/system-architecture.md §5.2` | cập nhật: Lớp B đã implement (queue model) |

Contract giữ: gateway.execute signature (thêm path Lớp B, backward-compat cho auto), Lớp A hard-deny, allowlist, budget.

## Risks
- Lớp B classify quá rộng → chặn nhầm auto action. Giữ danh sách Lớp B HẸP (chỉ đúng §7.9), test cả allow.
- approve bypass Lớp B nhưng PHẢI vẫn qua Lớp A + audit (không cho approve action mất-data). Test.
- dedup store + checkpoints cùng SQLite hay riêng? → riêng file `.data/dedup.db` cho gọn, tránh đụng langgraph schema.
- approval_store concurrency (cron + cli cùng lúc) → SQLite đủ cho local single-user.

## Phases
1. dedup_store (SQLite persist) + wire vào gateway + test restart.
2. audit query API + cli audit.
3. Lớp B: hard_block INTERRUPT + approval_store + gateway queue + cli approvals/approve + demo.
4. UT + ruff + verify (no regression).

## Unresolved
1. Danh sách Lớp B chính xác: đề xuất từ §7.9 (hủy/đóng ticket, đổi scope sprint, message external, đổi assignee, merge/close PR). Xác nhận khi build phase 3.
2. `cli approve` có cần re-check token/context không, hay tin pending đã lưu đủ? → đề xuất lưu đủ action dict, execute lại nguyên trạng.
