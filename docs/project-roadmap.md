# Project Roadmap — my-project-manager

> Lộ trình + milestone. Status sống, cập nhật khi phase đổi trạng thái.
> Status hiện tại: **Phase 1 (MVP Reporting) HOÀN TẤT (2026-06-22) — daily/weekly + Confluence/Slack + cron. Sẵn sàng Phase 2.**

## Trạng thái tổng

| Phase | Tên | Trạng thái | Mục tiêu chính |
|---|---|---|---|
| 0 | Khởi tạo docs + scaffold | ✅ Done | Bộ docs + cấu trúc repo + setup LangGraph chạy được |
| 1 | MVP Reporting + Monitoring | ✅ Done | Đọc Jira/GitHub → report (daily/weekly) → đăng Slack/Confluence + cron |
| 2 | Guardrail hardening | ⬜ Chưa | Audit/dry-run/kill-switch/idempotency vững trước khi mở write rộng |
| 3 | OKR / objective | ⬜ Chưa | Đặt + track OKR, map xuống Jira epic |
| 4 | Resource + Cost | ⬜ Chưa | Capacity, allocation, budget alert |
| 5 | Stakeholder + scale | ⬜ Chưa | Report theo audience; lên service + Slack UI; multi-user |

## Phase 0 — Khởi tạo (gần xong — chỉ còn E2E thật)

- [x] Bộ docs ban đầu (`docs/*`).
- [x] Scaffold repo theo cây ở `system-architecture.md §8` (+ `adapters/`).
- [x] `pyproject.toml` + cài LangGraph (venv 3.12 qua uv). SDK công cụ là MCP/CLI → Phase 1.
- [x] `config.example.env` + cơ chế load env (`src/config/settings.py`).
- [x] "Hello agent": graph LangGraph tối thiểu (perceive→respond) + checkpointer SQLite, chạy CLI. Vòng đời graph đã chứng minh end-to-end (fake client trong test). Gọi LLM thật cần key.
- [x] Audit log skeleton (JSONL append-only + redaction) + `DRY_RUN` flag.
- [x] **Action Gateway allowlist + Lớp A hard-deny** (PDR §7.9) — đổi từ denylist sau 2 vòng review; chặn cứng mất-data/credential/security. Phủ MCP tool + gh command. 74 UT.
- [x] **Budget tracker** OpenRouter — cộng dồn cost, hard-stop $50/tháng, cảnh báo 80%.
- [x] **E2E thật**: `cli "hello"` gọi OpenRouter thật — OK (2026-06-21). minimax/minimax-m2.7 trả lời + cost thật $0.000429, budget tracker ghi nhận, checkpoint lưu.

**Exit Phase 0**: ✅ HOÀN TẤT. Guardrail (dry-run + audit + allowlist/Lớp A + budget) có sẵn trước mọi write thật; vòng đời graph→OpenRouter→output đã xác nhận với key thật. Sẵn sàng Phase 1.

> Ghi chú (2026-06-21): OpenRouter CÓ trả `cost` field cho minimax/minimax-m2.7 → giải tỏa câu hỏi mở về cost extraction; fallback manual token×price không cần dùng (nhưng vẫn giữ làm dự phòng cho model khác).

## Phase 1 — MVP Reporting + Monitoring

Trọng tâm: ROI rõ, rủi ro thấp. Đọc nhiều, write chỉ là *post report*.

**Slice 1 — Jira+GitHub → Slack (✅ DONE, E2E thật 2026-06-21):**
- [x] `tools/jira_read.py` — pull issues (via MCP spawn).
- [x] `tools/github_read.py` — pull PR/CI (via `gh` CLI).
- [x] `agent/report_graph.py` graph: perceive → analyze → compose → deliver (injectable deps).
- [x] Risk detect: overdue/blocker/stale_pr/ci_failure (risk_analyzer.py pure).
- [x] `actions/slack_write.py` + action_gateway write guardrail. E2E: post Slack thật.

**Slice 2 — Confluence detail + Slack short+link (✅ DONE, E2E thật 2026-06-22):**
- [x] `actions/confluence_write.py` — createPage qua gateway, parse page id/URL.
- [x] Report detail (XHTML storage) lên Confluence (page/ngày, space MPM) + short+link lên Slack.
- [x] Slack mrkdwn sạch; state chỉ primitive (checkpointer-safe). 130 UT.

**Slice 3 — Daily/Weekly + Cron (✅ DONE, E2E thật 2026-06-22):**
- [x] `cli report --daily|--weekly`: 2 loại report (daily standup ngắn / weekly sprint review).
- [x] Weekly kéo Jira sprint data (get_active_sprint + get_sprint_issues).
- [x] `cron.py` thật + launchd (`deploy/launchd/`: daily 9:00, weekly thứ 6 17:00). 136 UT.

**Còn lại (Phase 2 / sau):**
- [ ] Burndown / velocity metrics nâng cao.
- [ ] (Phase 2) Lớp B interrupt cho hành động nhạy cảm; dedup bền qua restart.

**Exit Phase 1**: ✅ ĐẠT. Agent tự sinh + đăng report tiến độ (Slack + Confluence), daily/weekly có sprint data, chạy tự động qua cron. Số liệu sát Jira/GitHub, không cần người viết tay.

## Phase 2 — Guardrail hardening

Trước khi mở autonomous write sang việc nhạy cảm hơn (Phase 3+):

- [ ] Audit log bất biến hoàn chỉnh, query được.
- [ ] Kill switch test thật (tắt write tức thì).
- [ ] Rate limit + idempotency có test case (re-run không tạo trùng).
- [ ] Scoped token review (mỗi công cụ quyền tối thiểu).
- [ ] Danh sách hành động "cần xác nhận dù autonomous" (interrupt node) — chốt với chủ dự án.

## Phase 3–5 — tóm tắt

- **P3 OKR**: agent hỗ trợ đặt OKR, map xuống Jira epic, track tiến độ OKR theo thời gian.
- **P4 Resource+Cost**: capacity/allocation; cost monitor + budget alert.
- **P5 Stakeholder+Scale**: report tách audience (nội bộ vs stakeholder external); lên service backend + Slack bot UI; multi-user/multi-project.

## Nguyên tắc xuyên suốt

- Mỗi phase phải **chạy được + có giá trị thật** trước khi sang phase sau (không big-bang).
- Không mở rộng write authority sang việc nhạy cảm khi guardrail (Phase 2) chưa vững.
- Đo `% cost management cắt được` (PDR §3) ở mỗi phase — đó là North Star.

## Unresolved (roadmap)

1. Có deadline thật cho MVP không? (ảnh hưởng cắt scope Phase 1).
2. Test trên dự án thật nào, hay dựng sandbox Jira/GitHub riêng?
3. Thứ tự P3/P4 có thể đảo nếu cost là đau hơn OKR — chờ chủ dự án xác nhận ưu tiên.
