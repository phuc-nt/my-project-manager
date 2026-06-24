# v2 M1-P3 — Registry + worker + per-agent isolation + coordinating service

2026-06-24 · ✅ Done (3 slice 1→2→3, commit e046f25 / 932c537 / 05b5ef1)

## Làm gì

- **Chạy được N agent / N project, cô lập hoàn toàn**, qua `registry.yaml` + worker subprocess + service daemon. Build trên P1 (data_dir injectable) + P2 (profile loader).
- **Cô lập = 1 giá trị `settings.data_dir`.** Mọi store (audit/dedup/budget/approvals/checkpoints) đã key theo `data_dir` (P1). Trỏ mỗi agent vào `.data/agents/<id>/` → cô lập tự rơi ra, KHÔNG sửa gateway/budget/checkpoint. Cách làm: thêm kwarg `data_dir` vào `load_profile` (None ⇒ DATA_DIR, P2 byte-identical).
- **`src/runtime/`** (7 file): `agent_paths` (data_dir + thread_id, validate id), `legacy_migration` (move v1 `.data/` → `.data/agents/default/` 1 lần, idempotent, allowlist 5 store), `registry` (`agents:[{id,enabled}]`, validate id ở biên), `run_event` (B1 `runs.jsonl`/agent), `worker` (`python -m src.runtime.worker --agent-id` — 1 OS process/agent, exit 0/1/2), `scheduler` (croniter due-check thuần), `service` (daemon: đọc registry + cron `schedule:`, spawn/giám sát worker, timeout 600s, cap 4).
- **thread_id = `<agent_id>:<kind>:<audience>`** (bỏ flat v1). `com.mpm.service.plist` (KeepAlive) chạy daemon; 3 plist per-report cũ đánh dấu legacy (operator tự unload).
- Guardrail (Lớp A/B/audit/budget/dedup) KHÔNG đổi — chỉ per-agent hóa. Scheduler chạy internal-only. Thêm dep `croniter`.
- **383 test xanh, ruff sạch.** Matrix cô lập (2 agent → 2 dir, không lẫn audit/budget/dedup/approval; budget-A-100% không chặn B) chứng minh qua unit.
- **E2E thật:** service `--once` đọc registry → tính cron due → **spawn worker thật** → worker load `profiles/e2etest/` ở `.data/agents/e2etest/`, chạy report thật (Jira/LLM, dry-run), ghi run-event `delivered`, thu exit 0 + detail. Cả chuỗi service→scheduler→spawn→worker→isolation→run-event verify live.

## Quyết định & vì sao

| Quyết định | Vì sao | Đánh đổi |
|---|---|---|
| Cô lập qua `data_dir` kwarg (không mutate Settings) | Settings frozen; mọi store đã key theo data_dir → 1 thay đổi đủ, blast radius nhỏ nhất | load_profile thêm 1 param |
| Worker = subprocess thật (1 process/agent) | crash 1 agent không đổ cái khác; isolation mạnh nhất (user chọn full architecture) | service phải spawn/giám sát/timeout |
| Auto-migrate v1 `.data/` 1 lần (move) | giữ lịch sử dedup/budget/audit thật từ P1/P2 E2E; idempotent | cli single-agent cũ "mất view" sau migrate (P4 hợp nhất) |
| Schedule = cron 5-field + `croniter` | chuẩn cron, khớp launchd, linh hoạt (thứ/ngày) hơn HH:MM | thêm 1 dep nhỏ |
| Due-check = hàm THUẦN (inject now + last_fire) | test deterministic, không phụ thuộc wall-clock | service tách logic ra scheduler |
| Cap 4 + defer (không drop) | risk #5: 5 OK; overflow chờ tick sau, last_fire không advance → không mất | round-robin qua last_fire advance |
| Validate agent_id ở registry (1 biên) | id từ registry vào Popen argv + data path → chặn path-escape 1 chỗ, downstream tin tưởng | — |

## Vấp & học được

- **Bug timezone (review bắt):** `run_forever`/`--once` dùng `datetime.now(UTC)` nhưng cron `schedule:` hiểu theo giờ LOCAL (launchd + test dùng naive-local) → lệch 7h ở production. Test dùng naive-local nên không lộ; review trace `run_forever` (untested) bắt được. Fix: `datetime.now()` local nhất quán.
- **YAML 1.1 boolean id:** `id: on/off/yes/true` parse thành bool → `str(True)` = `"True"` **âm thầm nhận làm id sai** (route tới `.data/agents/True/`). Review bắt nửa tệ hơn brief (silent accept, không chỉ reject khó hiểu). Fix: reject non-str id + hint "quote reserved word".
- **cli stale sau migrate:** worker move store xuống per-agent dir, cli single-agent vẫn đọc global `.data/` → `audit`/`approvals` rỗng, dễ tưởng mất data. Vá: cli in note "stores migrated". Hợp nhất thật ở P4.
- **Comment noqa sai sự thật:** `# noqa: S603 — argv built from validated ids` nhưng service chưa validate. Review bắt. Fix: validate ở registry → claim thành đúng + sửa comment.
- **Test daemon không flaky:** chỉ unit-test `run_tick` (inject fake spawn + fixed clock); `run_forever`/`_real_spawn` = `pragma: no cover`, chứng minh qua E2E thật. Đúng ranh giới unit/integration.

## Mở / sang sau

- **P4** (multi-agent CLI): `mpm agent list/register/run/approvals` — hợp nhất cli single-agent + per-agent store (đóng gap "cli stale"). cron.py xóa ở P4.
- **M2-P8**: Postgres checkpointer/Store (multi-machine) + agent tự ghi MEMORY.md. M1 giữ SqliteSaver/agent.
- Limitation ghi nhận (chấp nhận M1): schedule thêm vào profile khi daemon đang chạy → chưa seed → chỉ fire sau restart; >5 agent luôn-due cần pool (risk #5, cap 4 đủ M1).
