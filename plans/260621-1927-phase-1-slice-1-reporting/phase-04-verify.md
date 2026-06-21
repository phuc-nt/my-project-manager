# Phase 04 — Verify (UT + ruff + E2E thật)

## Goal
UT đầy đủ (không network) + E2E thật với MCP/gh/Slack (prereq sẵn).

## UT (tests/, mock hết external)
- `test_cli_adapter.py` — run_gh parse JSON, raise khi exit≠0 / gh thiếu (monkeypatch subprocess).
- `test_mcp_adapter.py` — call_tool tìm tool by name, ainvoke (fake client/tool), raise khi tool/server thiếu; sync wrapper hoạt động.
- `test_jira_read.py` — fixture raw Jira JSON → Issue chuẩn hóa; field thiếu → lỗi rõ.
- `test_github_read.py` — fixture gh JSON → PR chuẩn hóa + staleness biên.
- `test_risk_analyzer.py` — bảng case mỗi loại risk (quá hạn/PR treo/blocker/CI fail) + rỗng + biên ngưỡng. Deterministic (truyền today).
- `test_slack_write.py` — action build đúng; handler gọi adapter (mock); deliver qua gateway dry-run không post; audit ghi; idempotency dedup key ổn định.
- `test_report_graph.py` — build_report_graph compile (no network); run với mọi external inject (fake) → state chảy 4 node, delivered set.
- Regression: 74 test Phase 0 vẫn pass.

## Steps
1. `uv run pytest -q` → all green (UT không cần network/token).
2. `uv run ruff check src tests` → clean.
3. Import/compile check.
4. **E2E (prereq: dist/ built + token + gh auth + DRY_RUN=false):**
   - `uv run python -m src.entrypoints.cli report`
   - Xác nhận: spawn jira server OK, đọc issue thật; gh đọc PR thật; LLM compose; **post lên SLACK_REPORT_CHANNEL thật**; audit ghi 1 entry post; budget cập nhật; subprocess MCP tắt (không leak node).
   - Nếu token Slack hết hạn / dist chưa build → lỗi tường minh, ghi lại, KHÔNG fake pass.

## Acceptance (map plan.md)
- UT green; ruff clean; no regress P0.
- E2E: report thật lên Slack, số liệu khớp Jira/GitHub, gateway audit + budget hoạt động, không leak process.

## Deliverable
- Report ở `plans/260621-1927-phase-1-slice-1-reporting/reports/`.
- Cập nhật `docs/codebase-summary.md` (map tools/adapters mới), `docs/system-architecture.md` (§4 sửa: stdio spawn, KHÔNG phải "agent connect"), `docs/project-roadmap.md` (tick slice 1), `docs/journals/phase-1.md` (cuối phase).

## Risks
- E2E phụ thuộc token/build của user → nếu chưa sẵn, UT vẫn phải xanh; E2E đánh dấu PENDING rõ ràng (như P0).
- Leak node process nếu session không đóng → test cleanup + kiểm thủ công ở E2E.
