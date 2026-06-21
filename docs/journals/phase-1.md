# Phase 1 — MVP Reporting (Slice 1)

2026-06-21 · 🟡 Slice 1 code done, E2E pending

## Làm gì
- Slice mỏng end-to-end: `cli report` → đọc Jira (MCP) + GitHub (`gh` CLI) → `risk_analyzer` → LLM compose report → **post Slack qua Action Gateway**.
- Adapters: `mcp_adapter.py` (spawn stdio MCP server, `langchain-mcp-adapters` 0.3.0, sync wrap qua `asyncio.run`), `cli_adapter.py` (`run_gh` subprocess + parse JSON).
- Tools READ chuẩn hóa: `jira_read.py`, `github_read.py` (+ staleness PR), `models.py` (Issue/PR/CiRun/Risk).
- `risk_analyzer.py` pure: overdue / blocker / stale_pr / ci_failure (ngưỡng qua config).
- `slack_write.py` deliver_report qua gateway; `report_graph.py` (perceive→analyze→compose→deliver, deps injectable).
- 114 UT pass, ruff clean, không regress Phase 0.

## Quyết định & vì sao
| Quyết định | Vì sao | Đánh đổi |
|---|---|---|
| Agent **spawn MCP server làm subprocess** (không "connect server chạy sẵn") | 3 server stdio-only, KHÔNG có HTTP → giả định Phase 0 sai | Cần Node + build dist/ trước; phụ thuộc lib tắt subprocess sạch |
| Gateway honor `dedup_hint` | Report text đổi mỗi lần LLM → dedup theo text vô dụng; key theo (channel, ngày) mới chống post trùng | Thêm 1 nhánh ở dedup key (backward-compat) |
| Deps injectable trong `report_graph` (ReportDeps) | Test trọn graph không cần network/key/subprocess | Thêm 1 lớp gián tiếp |

## Vấp & học được
- Code review (2 vòng quen thuộc) tìm: `dedup_hint` có thể va chéo tool, `classify` chỉ quét `args` (bỏ sót sibling field), `parse_pr` int() crash input xấu. Đã vá (M1 namespace hint theo tool, M2 quét cả sibling field cho credential, L1 `_safe_int`) + test.
- Bài học: mỗi field MỚI thêm vào action dict phải nằm trong credential-surface của Lớp A, không chỉ `args`.

## Mở / sang slice sau
- **E2E pending**: build dist/ (jira+slack server) + token (`ATLASSIAN_*`, `SLACK_XOXC/XOXD`, `SLACK_TEAM_DOMAIN`) + `gh auth login` + `DRY_RUN=false` → `cli report`. Checklist: `pgrep -f index.js` sau run để chắc không leak node (M3 chưa verify được từ code).
- Gateway dedup in-memory → re-arm sau restart (L3) — xử lý khi có cron/retry (Phase 2).
- Slice 2+: Confluence write, template daily/weekly, cron.
