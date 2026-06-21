# Phase 1 Slice 3 — Daily/Weekly report + Cron

2026-06-22 · ✅ E2E xong → Phase 1 (MVP Reporting) HOÀN TẤT

## Làm gì
- 2 loại report: `cli report --daily` (standup ngắn, hôm nay) vs `--weekly` (sprint review, kéo Jira sprint data).
- `jira_read`: + `get_active_sprint` (listBoards→listSprints active) + `get_sprint_issues`; `Sprint` model. Sprint API trả **JSON thuần** (khác Confluence text-block).
- `report_prompt`: `build_detail_messages(kind, sprint_context)` — daily/weekly framing + title khác; `REPORT_TITLES`.
- `report_graph`: `report_kind` param; weekly perceive kéo sprint issues + context. dedup_hint theo kind+date (2 page riêng).
- `cron.py` thật (--daily/--weekly) + launchd: `deploy/launchd/` (2 plist + wrapper), doc ở `deployment-guide §5`.
- E2E thật: daily page 131315 + weekly page 131336 (LLM dùng sprint data thật) + Slack post cả 2. 136 UT, ruff clean.

## Quyết định & vì sao
| Quyết định | Vì sao | Đánh đổi |
|---|---|---|
| Daily/weekly cùng luồng Confluence+Slack | Tái dùng Slice 2, chỉ khác data scope + prompt | Daily cũng đẻ page (chấp nhận) |
| Weekly kéo Jira sprint thật | Sprint review cần data sprint, không phải issue list chung | Thêm 3 tool call (board→sprint→issues) |
| Cron qua launchd + wrapper | macOS native; wrapper set PATH (node/gh/uv) vì launchd env tối thiểu | Hardcode path tuyệt đối; cần máy bật |
| dedup_hint = kind+date | daily+weekly cùng ngày (thứ 6) không va | — |

## Vấp & học được
- **Test debt ẩn**: `cron.py` từ stub → thật làm `test_cron_stub_runs` (gọi `cron_main()`) **chạy network thật trong UT** (4.8s/run, đốt tiền âm thầm). Bỏ test cũ, thay bằng test no-key. Bài học: khi 1 stub thành thật, soát lại test gọi nó.
- Sprint mới tạo → `get_sprint_issues` trả 0 (chưa add issue) — data thật, không phải bug; weekly fallback ổn.

## Mở / sang sau
- Phase 1 xong. Sang Phase 2 (guardrail hardening): Lớp B interrupt, dedup bền qua restart (hiện in-memory), audit query.
- Burndown/velocity metrics nâng cao (chưa làm).
- Page probe rác trên Confluence (131273/131294/131315/131336) — xóa tay nếu cần.
