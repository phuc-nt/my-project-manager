# 🏁 v2 Milestone 1 COMPLETE — Multi-agent core

2026-06-24 · ✅ Done (P1→P2→P3→P4, 17 commit, 414 test xanh)

> Tổng kết milestone. Chi tiết từng phase ở 4 journal P1–P4. Đây là cái nhìn toàn cảnh + retrospective.

## Đạt được

Từ **1 agent / 1 project** (v1) → **N agent / N project, cô lập hoàn toàn**, chạy qua CLI/worker + scheduler, guardrail per-agent. Verify cả unit (414 test) lẫn E2E thật (post Slack/Confluence thật, 2 agent đồng thời).

| Phase | Giao | Commit |
|---|---|---|
| **P1** Config-injection | Giết 2 `@lru_cache` singleton; `from_dict`(thuần)+`from_env`(wrapper); config inject qua tham số (grep src/ = 0 hit) | `031a543`…`e1a39b8` |
| **P2** Profile system | Agent = thư mục `profiles/<id>/` (4 file: profile.yaml + SOUL/PROJECT/MEMORY.md); env-fallback 3 tầng → `default`==v1; inject persona/project/memory; external KHÔNG lấy gì từ profile (guardrail PII) | `37433be`…`dd04271` |
| **P3** Registry + worker + service | `registry.yaml` + worker subprocess (1 process/agent, `.data/agents/<id>/`) + service daemon (croniter scheduler, cap 4, timeout 600s); auto-migrate `.data/` v1; thread_id `<id>:<kind>:<audience>` | `e046f25`…`05b5ef1` |
| **P4** Multi-agent CLI | `mpm agent list/register/run/approvals/approve/reject/audit`; gap-closer đọc store per-agent; additive (cli/cron giữ legacy) | `94604b7`…`8be3e71` |

## Đặc tính cô lập (cốt lõi M1)

Cô lập **rơi ra từ 1 giá trị `settings.data_dir`** (P1 làm injectable). Mỗi agent trỏ `.data/agents/<id>/` → audit / budget / dedup / approvals / checkpoints / runs.jsonl đều riêng. Bằng chứng E2E mạnh nhất: 2 approval store độc lập (default `max_id=20` vs agent mới `max_id=1`, AUTOINCREMENT riêng). Guardrail (Lớp A/B + audit + budget + dedup) KHÔNG rewrite — chỉ per-agent hóa qua data_dir.

## Bài học xuyên milestone

- **Smoke E2E bắt lỗi mà mock không thấy:** P2 loader quên `load_dotenv` (key trong .env vô hình); P3 timezone `now(UTC)` vs cron local (lệch 7h). Cả 2 unit test che mất, chỉ smoke thật bắt. → luôn smoke thật trước khi đóng phase.
- **Guardrail PII là red-line non-negotiable:** P2 review bắt persona độc hại prepend lên external system prompt → chốt "external lấy KHÔNG GÌ từ profile". Bài học Phase 5 (v1) tiếp tục áp dụng.
- **Validate ở 1 biên:** agent_id validate ở registry (P3) → mọi downstream (data path, Popen argv, thread_id) tin tưởng. YAML 1.1 boolean trap (`on`/`yes`→bool) bắt 2 lần — id luôn lowercase + reject non-str.
- **Slice-per-commit giữ suite xanh:** mỗi slice chạy được + commit riêng, code review bắt buộc. BREAKING (P1 singleton, P3 thread_id/data-dir) chấp nhận; `default` profile + auto-migrate = lưới migrate v1 an toàn.
- **Review-driven fix mỗi slice:** không hoãn finding non-blocking — vá luôn (audit-tolerance P1-D, cli-stale-note P3-S2, local-copy-vs-import P4).

## Mở / sang M2

- **2 parity gap kế thừa từ cli** (ghi P4 journal, chưa sửa): `reject <id-không-tồn-tại>` báo success; `_approve` chỉ catch ValueError. Sửa ở gateway cho cả cli + mpm nếu muốn.
- **Đề xuất khử trùng lặp:** extract `dispatch_approved_action` sang `src/actions/` (cli + mpm cùng import, bỏ coupling).
- File >200 LOC tồn từ trước (hard_block 436, action_gateway 331, report_graph 259, cli 309) — M1 không đẻ ra, modularize hoãn.
- **M2** ([roadmap-m2](../v2/roadmap-m2.md)): P5 LangGraph interrupt + streaming → P6 SSE live run → P7 web dashboard (FastAPI + HTMX/Streamlit) → P8 Postgres checkpointer/Store + agent tự ghi MEMORY.md. **Chưa có UI, chưa Postgres** ở M1 — đó là M2.
