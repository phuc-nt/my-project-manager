# Phase 02 — READ tools + Risk Analyzer

## Goal
Đọc Jira + GitHub, chuẩn hóa data, phát hiện rủi ro cơ bản. Pure + testable.

## Files
- TẠO `src/tools/jira_read.py`:
  - `get_open_issues(project_key) -> list[Issue]` qua `mcp_adapter.call_tool_sync("jira", "enhancedSearchIssues", {...})`.
  - `get_active_sprint(board_id) -> Sprint|None` qua `listSprints`/`getSprintIssues` (nếu có board; optional slice 1).
  - Chuẩn hóa: `Issue` dataclass `{key, summary, status, assignee, due_date, labels, flagged}` — map từ raw `fields.*`. KHÔNG trả raw JSON.
- TẠO `src/tools/github_read.py`:
  - `get_open_prs(repo) -> list[PullRequest]` qua `cli_adapter.run_gh(["pr","list","--repo",repo,"--state","open","--json","number,title,createdAt,updatedAt,reviewDecision,statusCheckRollup","--limit","100"])`.
  - `get_recent_ci(repo) -> list[CiRun]` qua `gh run list --json status,conclusion,workflowName,createdAt`.
  - Chuẩn hóa: `PullRequest {number, title, created_at, updated_at, review_decision, checks_state, age_days, stale}`; staleness = now - updated_at > PR_STALE_DAYS.
- TẠO `src/agent/risk_analyzer.py` (PURE — không I/O):
  - `analyze(issues, prs, ci, *, today, pr_stale_days) -> list[Risk]`.
  - `Risk {kind, severity, subject, detail, suggested_action}`.
  - Rules slice 1: (a) task quá hạn — `due_date < today` và status ∉ {Done, Closed}; (b) PR treo — `stale`; (c) blocker — issue có label chứa "block" hoặc flagged; (d) CI fail gần đây — conclusion=failure.
  - Ngưỡng từ tham số/config, không hardcode rải rác.

## Constraints
- tools/ gọi adapter, trả dataclass chuẩn hóa. Lỗi tường minh nếu field thiếu (không nuốt).
- risk_analyzer thuần hàm → test không cần network. now/today truyền vào (không gọi datetime.now bên trong → test deterministic).
- 1 tool = 1 công cụ (không trộn Jira+GitHub).

## Validation
- Unit `jira_read`: feed raw JSON mẫu (fixture) → đúng Issue chuẩn hóa; thiếu field → lỗi rõ.
- Unit `github_read`: feed `gh` JSON mẫu → PR chuẩn hóa + staleness đúng (mock cli_adapter).
- Unit `risk_analyzer`: bảng case → mỗi loại risk phát hiện đúng; không có rủi ro → list rỗng; ngưỡng biên (due == today, age == stale_days).

## Risks
- Field Jira khác site (custom field due/flagged) → tham số hóa tên field, default chuẩn, lỗi rõ nếu thiếu.
- `statusCheckRollup` rỗng/None khi chưa có CI → xử lý None an toàn.
