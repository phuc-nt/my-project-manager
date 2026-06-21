# Plan — Phase 1 Slice 1: Reporting (Jira+GitHub → Slack)

> Status: **IMPLEMENTED — code done, 114 UT pass, ruff clean, reviewed. E2E deferred (prereq: dist builds + tokens).** (2026-06-21)
> Mode: `/cook` auto. First thin end-to-end slice of Phase 1 (MVP Reporting).

## Outcome (2026-06-21)

Built all 4 phases; 114 UT pass (74 P0 + 40 P1), ruff clean, no P0 regression. Code review (DONE_WITH_CONCERNS) → 3 cheap fixes applied + tested:
- **M1**: `dedup_hint` namespaced by tool identity (no cross-tool collision).
- **L1**: `parse_pr` number coercion tolerant.
- **M2**: `classify` now credential-scans sibling action fields (e.g. `dedup_hint`), not just `args`.

**Architecture correction:** 3 MCP servers are stdio-only → agent **spawns each as subprocess** (not "connect to running server"). `langchain-mcp-adapters==0.3.0`, async API bridged to sync CLI via `asyncio.run`. Docs §4 updated.

**Gateway change (shared):** `_action_dedup_key` honors explicit `dedup_hint` so a daily report dedups per (channel, date) instead of per volatile LLM text. Backward-compatible (no hint → hash as before).

**Residual risks (documented, not blocking):**
- M3: MCP child-process cleanup on error is library-trust — E2E checklist: `pgrep -f index.js` after a timed-out run.
- L3: gateway dedup is in-memory → re-arms after restart (relevant when cron/retry lands, Phase 2).

**Deferred — E2E (real Slack post):** needs user prereq — build `dist/` for jira + slack servers, tokens in `.env` (`ATLASSIAN_*`, `SLACK_XOXC/XOXD_TOKEN`, `SLACK_TEAM_DOMAIN`), `gh auth login`, set `JIRA_PROJECT_KEY`/`GITHUB_REPO`/`SLACK_REPORT_CHANNEL`, `DRY_RUN=false`. Then `cli report`.

## Goal (one line)

`cli` đọc Jira (MCP) + GitHub (`gh` CLI) → phân tích rủi ro cơ bản → LLM compose report → **post Slack thật** qua Action Gateway. Chứng minh trọn vòng reporting với data thật.

## Locked requirements (user, 2026-06-21)

- **MCP transport:** agent **spawn từng server làm subprocess stdio** (3 server stdio-only, KHÔNG có HTTP). Dùng `langchain-mcp-adapters` 0.3.0.
- **Data source slice 1:** Jira (MCP) **+** GitHub (`gh` CLI).
- **Write:** **post Slack thật** (`DRY_RUN=false`) qua gateway. Confluence hoãn.
- **Test:** build `dist/` server + token thật **ngay**, test trực tiếp (không mock cho integration).
- **Hoãn sang slice sau:** Confluence write, cron, template phong phú, burndown, multi-project.

## Prerequisites (user chuẩn bị TRƯỚC khi chạy E2E)

1. Node trên máy + build `dist/` cho **jira-cloud-mcp-server** + **slack-browser-mcp-server** (`npm install && npm run build` mỗi repo).
2. Token vào `.env` (agent đọc, truyền xuống env subprocess MCP):
   - Jira: `ATLASSIAN_SITE_NAME`, `ATLASSIAN_USER_EMAIL`, `ATLASSIAN_API_TOKEN`
   - Slack: `SLACK_XOXC_TOKEN`, `SLACK_XOXD_TOKEN`, `SLACK_TEAM_DOMAIN`
   - GitHub: `gh auth login` (không qua .env)
3. Cấu hình: `JIRA_PROJECT_KEY`, `GITHUB_REPO` (owner/repo), `SLACK_REPORT_CHANNEL` (whitelist), path tới `dist/index.js` mỗi server.

UT chạy được KHÔNG cần prerequisites (mock MCP client + gh).

## Acceptance criteria (slice 1)

1. `cli report` (lệnh mới) chạy: perceive(Jira+GitHub) → analyze → compose_report → deliver(Slack) → in kết quả + audit ref.
2. **MCP adapter** spawn jira server stdio, gọi `enhancedSearchIssues`/`listSprints`, trả data chuẩn hóa; tự cleanup subprocess (không leak node).
3. **gh CLI adapter** chạy `gh pr list --json ...` + `gh run list --json ...`, parse, tính staleness (PR treo > N ngày).
4. **analyze**: phát hiện ≥3 loại rủi ro cơ bản — task Jira quá hạn (due < hôm nay, chưa Done), PR treo (updatedAt cũ), blocker (issue flagged/label blocked). Có thể chỉnh ngưỡng qua config.
5. **compose_report**: LLM sinh report tiếng Việt, lead-with-signal (rủi ro trước), actionable. Qua `llm.complete`, budget-gated.
6. **deliver**: post Slack thật qua `ActionGateway.execute({type:mcp_tool, server:slack, tool:post_message,...}, handler=slack_post)`. Gateway: allowlist cho `slack:post_message` (đã có), hard-deny vẫn áp, idempotency chống post trùng, audit ghi.
7. UT pass (mock MCP + mock gh + fake LLM): adapter parse, analyze rules, gateway path cho slack_post. Không cần network.
8. E2E (prereq sẵn): chạy thật → report lên Slack channel whitelist, số liệu khớp Jira/GitHub.
9. ruff clean; không regress 74 test Phase 0.

## Out of scope (slice 1)

- Confluence write, cron entrypoint, template daily/weekly riêng, burndown chart, multi-project, Lớp B interrupt (đóng/merge PR…). Slack chỉ `post_message` (chưa Block Kit phong phú — text/markdown đủ).

## Non-negotiable constraints

- Mọi mutation (post Slack) **qua Action Gateway** — không gọi MCP write trực tiếp ngoài handler.
- READ (Jira/GitHub) KHÔNG qua gateway (đúng thiết kế).
- MCP/gh adapter ở `src/adapters/`; tool READ ở `src/tools/<tool>_read.py` trả **data chuẩn hóa** (không raw JSON cho LLM).
- Secrets chỉ qua env; token MCP truyền xuống subprocess env, KHÔNG log. Audit redaction đã có.
- Bounded I/O: timeout cho subprocess MCP + gh; lỗi tường minh.
- snake_case, type hint, ruff, file > 200 dòng cân nhắc tách.

## Touchpoints

| File | Hành động |
|---|---|
| `src/adapters/mcp_adapter.py` | TẠO — MultiServerMCPClient spawn stdio, session, invoke-by-name, sync wrapper |
| `src/adapters/cli_adapter.py` | TẠO — chạy `gh` subprocess, trả JSON parsed, bounded |
| `src/tools/jira_read.py` | TẠO — gọi mcp_adapter, chuẩn hóa issues/sprint |
| `src/tools/github_read.py` | TẠO — gọi cli_adapter (gh), chuẩn hóa PR/CI + staleness |
| `src/agent/risk_analyzer.py` | TẠO — rules phát hiện rủi ro (pure, testable) |
| `src/actions/slack_write.py` | TẠO — `slack_post` Handler (gọi mcp_adapter post_message) |
| `src/agent/state.py` | SỬA — thêm field: raw_signals, risks, report_draft, delivered, audit_refs |
| `src/agent/graph.py` | SỬA — graph mới: perceive→analyze→compose_report→deliver (giữ build_graph cũ cho hello?) |
| `src/config/settings.py` | SỬA — thêm config: project key, repo, channel, server paths, ngưỡng risk, MCP env mapping |
| `src/entrypoints/cli.py` | SỬA — thêm lệnh `report` (giữ hello) |
| `config.example.env` | SỬA — thêm biến mới (placeholder) |
| `pyproject.toml` | SỬA — add `langchain-mcp-adapters==0.3.0` |
| `tests/` | TẠO — test cho adapter(mock)/tools/analyzer/slack_write |

**Contract giữ ổn định:** `ActionGateway.execute` signature, hard_block allowlist (chỉ THÊM nếu cần tool mới — slack:post_message đã có), audit schema, budget tracker.

## Phases

| # | Phase | File | Depends |
|---|---|---|---|
| 1 | Deps + config + MCP/CLI adapter (spawn stdio, gh subprocess) | phase-01-adapters.md | — |
| 2 | tools/jira_read + github_read (chuẩn hóa) + risk_analyzer | phase-02-read-analyze.md | 1 |
| 3 | slack_write handler + graph (perceive→analyze→compose→deliver) + cli report cmd | phase-03-graph-deliver.md | 2 |
| 4 | UT (mock MCP/gh/LLM) + ruff + E2E thật (prereq) | phase-04-verify.md | 1-3 |

## Key technical decisions (research-verified 2026-06-21)

- `langchain-mcp-adapters==0.3.0`; `MultiServerMCPClient({name:{transport:"stdio",command,args,env}})`; `await get_tools()`; invoke `tool.ainvoke(args)`.
- **Async→sync bridge:** CLI sync → `asyncio.run()` quanh các call MCP. Dùng `async with client.session(...)` để giữ subprocess sống trong 1 lần chạy + auto-cleanup (chống leak node).
- Tool name có thể KHÔNG namespaced per-server (0.3.0) → mình bind từng server riêng (1 client/loại) để tránh va tên, hoặc tra theo (server,tool).
- gh: `gh pr list --json number,title,createdAt,updatedAt,reviewDecision,statusCheckRollup`; `gh run list --json status,conclusion,workflowName,createdAt`; staleness tính ở Python.
- Slack post qua gateway action `{type:"mcp_tool",server:"slack",tool:"post_message",args:{channel,text}}` → allowlist đã cho phép.

## Risks

- **Browser-token Slack hết hạn** → post lỗi rõ ràng, không nuốt; E2E có thể cần refresh token.
- **MCP subprocess leak / treo** → bắt buộc `async with session` + timeout; test cleanup.
- **dist/ chưa build** → prereq; adapter check path tồn tại, lỗi tường minh nếu thiếu.
- **Jira raw JSON đổi field** → chuẩn hóa ở tools/, tham số hóa field path, lỗi rõ nếu thiếu.
- **Async trong LangGraph node sync** → bridge bằng asyncio.run ở tool layer, không rải async khắp graph.
- **Đổi env var Phase 0** (config.example.env cũ có ATLASSIAN_* khác tên) → cập nhật cho khớp tên server thật.

## Unresolved questions

1. Ngưỡng cụ thể: PR treo bao nhiêu ngày? task quá hạn tính từ field nào (duedate)? blocker nhận diện qua label gì (`blocked`/flagged)? → đề xuất default (PR>7 ngày, due<today chưa Done, label chứa "block"), chỉnh qua config; xác nhận khi chạy E2E.
2. Slack report: text/markdown thường đủ slice 1 hay cần Block Kit ngay? (đề xuất: text markdown trước.)
3. Giữ `build_graph` hello cũ song song hay thay bằng graph report? (đề xuất: giữ cả hai, cli có `hello` + `report`.)
