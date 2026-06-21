# Plan — Slice 3: Daily/Weekly report types + Cron (launchd)

> Status: **DONE (2026-06-22) — E2E daily+weekly thật. 136 UT, ruff clean.** Nối tiếp Slice 2. Mode auto. Exit Phase 1 đạt.
>
> Outcome: Sprint model + jira_read sprint (get_active_sprint/get_sprint_issues, JSON shape). Prompt daily (standup ngắn) vs weekly (sprint review + sprint data). report_graph report_kind; cli `report --daily|--weekly`. cron.py thật + launchd (2 plist + wrapper, doc ở deployment-guide §5). E2E: daily page id 131315 + weekly page id 131336 (LLM dùng sprint data thật) + Slack post cả 2. Sửa: bỏ test_cron_stub cũ (gọi network thật trong UT).

## Goal
`cli report --daily|--weekly` sinh 2 loại report (Confluence detail + Slack short+link, như Slice 2) khác phạm vi data + độ chi tiết. Weekly thêm **Jira sprint data**. Cron (launchd) chạy tự động: daily 9:00, weekly thứ 6.

## Locked decisions (user)
- Daily + Weekly **đều Confluence+Slack** (cùng luồng Slice 2), khác: tiêu đề + prompt + phạm vi data.
- **Weekly thêm Jira sprint** (listBoards→listSprints active→getSprintIssues). Daily giữ issue list hiện tại.
- **Cron qua launchd** (macOS): daily 9:00, weekly thứ 6 17:00.

## Scout facts (verified)
- Jira sprint tools: `listBoards(projectKeyOrId)`, `listSprints(boardId, state=active)`, `getSprintIssues(sprintId)`, `getSprint(sprintId)`. Schema đã rõ.
- `cli` hiện: `hello` + `report` (1 loại). `cron.py` = stub. report_graph deliver = Confluence+Slack (Slice 2).
- Confluence/Slack/gateway/dedup đã hoạt động thật (Slice 1+2).

## Acceptance
1. `cli report --daily`: report hôm nay (issues+PR+CI) → Confluence page "Daily Standup <ngày>" + Slack short. (mặc định nếu không flag = daily.)
2. `cli report --weekly`: thêm sprint data (active sprint của project) → Confluence page "Sprint Review <ngày>" đầy đủ hơn + Slack short. Dedup riêng theo loại+ngày.
3. `tools/jira_read.py`: + get_active_sprint(project) + get_sprint_issues — chuẩn hóa, parse shape thật (verify khi code).
4. Prompt: daily (ngắn, hôm nay) vs weekly (tổng kết sprint) — 2 hàm build.
5. `cron.py`: nhận `--daily|--weekly`, gọi đúng loại. launchd plist + script + hướng dẫn load.
6. UT (mock) pass, ruff clean, no regression (130). E2E thật: cả 2 loại tạo page + post Slack.

## Out of scope
- Burndown chart, velocity tính toán. Multi-board. updatePage (vẫn createPage mới).

## Touchpoints
| File | Action |
|---|---|
| `src/tools/jira_read.py` | + get_active_sprint + get_sprint_issues + parse sprint shape |
| `src/tools/models.py` | + Sprint dataclass (id, name, state, start/end) |
| `src/agent/risk_analyzer.py` | (tùy) risk theo sprint (issue chưa done gần hết sprint) — tối thiểu |
| `src/llm/report_prompt.py` | + build_detail_messages(period) daily/weekly variant + title |
| `src/agent/report_graph.py` | + report_kind param (daily/weekly); perceive weekly kéo sprint |
| `src/actions/confluence_write.py` | title theo loại; dedup_hint theo loại+ngày |
| `src/entrypoints/cli.py` | parse --daily/--weekly → report_kind |
| `src/entrypoints/cron.py` | thật: gọi report theo loại |
| `deploy/launchd/*.plist` + script | TẠO — lịch daily/weekly (ngoài src/, hỏi user nơi đặt) |
| `config.example.env` | (nếu cần board id override) |
| tests/ | + sprint parse, daily/weekly prompt, graph kind, cron dispatch |

Contract giữ: gateway, allowlist (sprint/board READ không qua gateway; createPage đã allowlisted), Slice 2 deliver.

## Risks
- Sprint shape lạ (text-block như getSpaces) → verify raw khi code, parse linh hoạt.
- Project có thể không có active sprint → weekly fallback (báo "không có sprint active" thay vì lỗi).
- launchd cần path tuyệt đối + env (.env load): script wrapper set cwd + uv run. Cần máy bật lúc chạy.
- dedup: daily+weekly cùng ngày (thứ 6) → 2 page khác title + dedup_hint khác loại → không va.

## Phases
1. Sprint read (jira_read + Sprint model) + verify shape thật.
2. Daily/weekly prompt + report_graph report_kind + cli flag.
3. cron.py thật + launchd plist/script.
4. UT + ruff + E2E (daily + weekly thật).

## Unresolved
1. launchd plist đặt ở đâu trong repo? đề xuất `deploy/launchd/` (ngoài src/). Hỏi user khi tới phase 3.
2. Có cần weekly chỉ chạy nếu có active sprint, hay luôn chạy (fallback)? đề xuất luôn chạy + fallback.
