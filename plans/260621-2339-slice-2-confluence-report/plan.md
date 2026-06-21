# Plan — Slice 2: Confluence detail report + Slack short+link

> Status: **DONE (2026-06-22) — E2E thật (Confluence page + Slack short+link). 130 UT, ruff clean.** Nối tiếp Slice 1. Mode auto.
>
> Outcome: confluence_write + detail prompt (XHTML) + short builder + graph 2-step deliver. E2E: page MPM id 131294 + Slack #report có link. Fix thêm: state chỉ giữ primitive (risks=dict) để checkpointer không chặn deserialize dataclass. createPage trả text-block → parse + dựng URL. Journal đổi quy ước tiền tố ngày.

## Goal
`cli report` đổi luồng deliver: tạo **report detail trên Confluence** (page mới theo ngày, space MPM) → post **short report + link Confluence** lên Slack. Cả 2 write qua Action Gateway.

## Locked decisions (user)
- Confluence: **page mới mỗi lần** theo ngày, space **MPM** (id 65846, key MPM).
- Slack: **short 2-3 dòng + link** "Xem chi tiết trên Confluence".
- Compose: **1 LLM call sinh detail**, short dẫn xuất từ trạng thái + số risk (không LLM lần 2).
- Page URL: parse từ response createPage, **fallback tự dựng** `https://<site>/wiki/spaces/MPM/pages/<id>`.

## Scout facts (verified)
- Confluence MCP: 11 tools (`createPage`, `getPageContent`, `updatePage`...). Logger đã stderr.
- `getSpaces` trả **text-block người-đọc** (không JSON) → `createPage` shape phải verify khi code.
- Allowlist Phase 0 đã có `confluence:createpage` ✓. `slack:post_message` ✓.

## Acceptance
1. `cli report`: perceive→analyze→compose(detail)→deliver(Confluence createPage → Slack short+link).
2. Confluence: page mới title "Báo cáo tiến độ <ngày>" trong space MPM, body từ LLM (storage format). Trả page URL.
3. Slack: short report (trạng thái + N risk) + link Confluence, mrkdwn sạch, qua gateway.
4. Cả 2 write qua gateway (audit, dedup per ngày, budget). DRY_RUN=true → log cả 2, không thực thi.
5. UT (mock) pass, ruff clean, no regression (121 test). E2E thật: page MPM tạo + Slack có link.

## Out of scope
- updatePage (chỉ create). Template phong phú. Cron. Burndown.

## Touchpoints
| File | Action |
|---|---|
| `src/config/reporting_config.py` | + confluence_server spec + CONFLUENCE_SPACE_KEY/ID |
| `src/actions/confluence_write.py` | TẠO — create_report_page Handler qua gateway, trả URL |
| `src/llm/report_prompt.py` | + build_detail_messages (Confluence storage) ; giữ short logic |
| `src/agent/report_graph.py` | đổi deliver: Confluence trước → Slack short+link |
| `src/agent/state.py` | + confluence_url, short_text fields |
| `config.example.env` | + CONFLUENCE_SPACE_KEY=MPM, CONFLUENCE_SPACE_ID=65846 |
| `.env` | (user) thêm 2 biến trên |
| tests/ | + test confluence_write (mock), detail prompt, graph 2-step deliver |

Contract giữ: gateway signature, allowlist (đã đủ), audit, budget. dedup_hint riêng cho confluence (per ngày) + slack (per ngày) — 2 action khác tool nên không va (đã namespace theo tool).

## Risks
- createPage shape lạ (text-block) → verify raw khi code; parse URL/id linh hoạt + fallback dựng URL.
- Body storage format: Confluence cần XHTML storage, không phải markdown → prompt sinh HTML đơn giản (p, h2, ul/li, strong) hoặc plain; verify render.
- 2 mutation/lần chạy → rate-limit (10/min) dư; dedup mỗi tool theo ngày chống trùng.
- Atlassian token cho Confluence = cùng token Jira (đã verify hoạt động).

## Phases
1. Confluence adapter spec + confluence_write handler (+ allowlist check) + verify createPage shape thật.
2. Prompt detail + report_graph 2-step deliver + state.
3. UT + ruff + E2E thật.
