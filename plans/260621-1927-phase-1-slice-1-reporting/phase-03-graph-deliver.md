# Phase 03 — Slack Write + Report Graph + CLI

## Goal
Nối toàn slice: graph perceive→analyze→compose_report→deliver, post Slack thật qua gateway.

## Files
- TẠO `src/actions/slack_write.py`:
  - `slack_post_handler(action: dict) -> str`: nhận action `{type:mcp_tool, server:slack, tool:post_message, args:{channel,text}}`, gọi `mcp_adapter.call_tool_sync("slack","post_message",args)`, trả summary (ts/channel). Đây là `Handler` cho gateway.
  - Hàm tiện ích `deliver_report(channel, text, *, gateway, rationale) -> GatewayResult`: build action, gọi `gateway.execute(action, handler=slack_post_handler, rationale=...)`.
- SỬA `src/agent/state.py`:
  - Thêm field cho report flow: `raw_issues`, `raw_prs`, `raw_ci`, `risks`, `report_draft`, `delivered`, `audit_ref`. Giữ field hello cũ (hoặc tách `ReportState` riêng nếu gọn hơn).
- SỬA `src/agent/graph.py`:
  - `build_report_graph(checkpointer, *, client=None)`:
    - `perceive`: gọi `jira_read` + `github_read` → raw_issues/raw_prs/raw_ci.
    - `analyze`: `risk_analyzer.analyze(...)` → risks.
    - `compose_report`: `llm.complete(prompt với risks)` → report_draft (tiếng Việt, lead-with-signal). Prompt ở `src/llm/` (mới: `report_prompt.py` hoặc trong llm/prompts).
    - `deliver`: `deliver_report(channel, report_draft, gateway=...)` → delivered + audit_ref.
    - edges tuyến tính; compile(checkpointer).
  - Giữ `build_graph` (hello) cũ nguyên vẹn.
- TẠO `src/llm/report_prompt.py`: prompt compose report (system + format). Provider-agnostic.
- SỬA `src/entrypoints/cli.py`:
  - Thêm subcommand: `python -m src.entrypoints.cli report` → build_report_graph, invoke, in report + audit ref + cost. Giữ `hello` (default/arg cũ).
  - Parse: arg đầu `report` → flow report; còn lại → hello (backward compat).

## Constraints
- Post Slack CHỈ qua gateway. slack_write KHÔNG gọi MCP write ngoài handler.
- DRY_RUN=false để post thật (user chốt); nhưng code phải chạy đúng cả khi DRY_RUN=true (gateway log intent).
- Idempotency: gateway dedup theo action hash → re-run cùng report không post trùng (lưu ý: report text đổi mỗi lần LLM → cân nhắc dedup key theo ngày+channel thay vì text; ghi rõ trong code).
- Budget-gated qua llm.complete (đã có).

## Validation
- Unit `slack_write`: action build đúng; handler gọi adapter (mock) → summary; deliver_report qua gateway (fake settings dry-run) → audit ghi, handler không gọi khi dry-run.
- Unit graph: `build_report_graph` compile không cần network; run với fake jira_read/github_read/LLM/gateway (inject) → state chảy qua 4 node, delivered set.
- cli: `report` parse đúng, no-key → exit 1 rõ.

## Risks
- Dedup report theo text sẽ không chặn trùng (text khác mỗi lần) → dùng dedup key ổn định (ngày+channel+loại report). Ghi rõ.
- LLM trả rỗng/quá dài → cắt/he kiểm trước khi post; lỗi rõ nếu rỗng.
- Async MCP trong node sync → gọi qua call_tool_sync (asyncio.run ở adapter), không async hóa graph.
