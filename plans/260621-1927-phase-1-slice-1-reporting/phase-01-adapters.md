# Phase 01 — Deps + Config + MCP/CLI Adapters

## Goal
Spawn stdio MCP servers + run `gh`, từ Python sync CLI. Foundation cho tools/.

## Steps
1. `uv add langchain-mcp-adapters==0.3.0`. Verify import + compat langgraph 1.2.6.
2. `src/config/settings.py` — thêm:
   - MCP server specs: path `dist/index.js`, env-var mapping mỗi server (Jira/Slack). Đọc từ env: `JIRA_MCP_DIST`, `SLACK_MCP_DIST` (hoặc default `~/workspace/...`).
   - Atlassian/Slack token vars (đúng tên server thật: `ATLASSIAN_SITE_NAME`/`ATLASSIAN_USER_EMAIL`/`ATLASSIAN_API_TOKEN`, `SLACK_XOXC_TOKEN`/`SLACK_XOXD_TOKEN`/`SLACK_TEAM_DOMAIN`).
   - Reporting config: `JIRA_PROJECT_KEY`, `GITHUB_REPO`, `SLACK_REPORT_CHANNEL`, ngưỡng risk (`PR_STALE_DAYS=7`).
   - Lazy validation: thiếu token MCP chỉ raise khi thật sự spawn server đó.
3. `src/adapters/mcp_adapter.py`:
   - Build `MultiServerMCPClient` config từ settings (chỉ server cần). Truyền token xuống `env`.
   - `call_tool(server, tool_name, args) -> dict`: async core dùng `async with client.session(server)` → load tools → tìm theo name → `ainvoke(args)` → trả content (parse JSON nếu string).
   - **Sync wrapper** `call_tool_sync(...)` = `asyncio.run(...)` cho graph node sync.
   - Bounded: timeout quanh session; lỗi tường minh (server không spawn được, dist thiếu, tool không tồn tại). KHÔNG log token.
   - Cleanup: `async with` đảm bảo subprocess tắt; test bằng cách kiểm process không treo.
4. `src/adapters/cli_adapter.py`:
   - `run_gh(args: list[str], timeout=...) -> dict|list`: `subprocess.run(["gh", *args], capture, timeout, check)`, parse stdout JSON. Lỗi tường minh nếu gh thiếu/exit≠0.
   - KHÔNG cho phép arg tùy ý từ LLM ở đây (chỉ tool github_read gọi với args cố định) — adapter là cơ chế, không phải bề mặt LLM.
5. `config.example.env` — thêm biến mới (placeholder), ghi chú token Slack browser rủi ro.

## Files
- TẠO: `src/adapters/mcp_adapter.py`, `src/adapters/cli_adapter.py`
- SỬA: `src/config/settings.py`, `config.example.env`, `pyproject.toml`

## Validation
- Unit (mock): `cli_adapter.run_gh` parse JSON mẫu, raise khi exit≠0 (monkeypatch subprocess).
- Unit (mock): `mcp_adapter.call_tool` với fake client/tool (monkeypatch) → trả content đúng, tìm tool by name, raise khi tool thiếu.
- Import compile. KHÔNG cần Node/token cho UT.

## Risks
- `tool_name_prefix` không có ở 0.3.0 → bind 1 client/loại server, tra theo (server,tool). Không phụ thuộc prefix.
- asyncio.run lồng nhau (nếu graph đã trong loop) → slice 1 CLI sync nên an toàn; nếu sau này async, refactor.
