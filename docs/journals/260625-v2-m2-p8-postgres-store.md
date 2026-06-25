# v2 M2-P8 — Postgres checkpointer + Store + agent memory

2026-06-25 · ✅ Done (3 slice, `304fc72`→`9106073`, 518 test)

> Hai nửa, đều **opt-in**: (A) Postgres checkpointer (state bền multi-process) — SQLite vẫn DEFAULT; (B) LangGraph Store + **cross-thread agent memory** (agent trích fact, ghi Store + MEMORY.md, run sau đọc lại). Postgres wired + selection-test, **chưa chạy PG thật** (offline-only round này). P7 (web dashboard) bị BỎ QUA — P8 là infra độc lập, không phụ thuộc.

## Làm gì

- **S1 Checkpointer selection:** `get_checkpointer(settings)` chọn `sqlite` (default, file per-agent byte-identical) hay `postgres` (opt-in qua block `runtime:` trong profile.yaml + env `CHECKPOINTER_TYPE`/`POSTGRES_DSN`). 3 field mới vào `Settings` qua 3-tier (yaml→env→default). Widen 4 builder hint sang `BaseCheckpointSaver`. Dep: `langgraph-checkpoint-postgres` + `psycopg[binary]`.
- **S2 Store:** `get_store(settings)` → `InMemoryStore` (default) / `PostgresStore` (opt-in). Thread `store=` vào `compile(store=...)` ở 4 builder; wire ở worker/cron/cli.
- **S3 Agent memory:** node `remember` sau `deliver` (chỉ internal + delivered + not-dry-run) → extractor LLM (inject được) trích fact → `store.put((agent_id,"memory"), content-hash-key, ...)` (dedup) + mirror vào section agent của MEMORY.md (giữa marker, KHÔNG đụng phần human). Run sau `load_profile` đọc lại qua inject P2 internal-only. Wire worker/cron/cli (parity).
- **Guardrail (verify):** memory là state NỘI BỘ — KHÔNG qua Action Gateway (gateway chỉ quản external mutation), KHÔNG bao giờ tới external (MEMORY.md inject internal-only). External: không có node remember.

## Quyết định & vì sao

| Quyết định | Vì sao | Đánh đổi |
|---|---|---|
| SQLite default, Postgres opt-in | Common case (1 process/agent) không cần infra; Postgres chỉ khi multi-machine / memory bền | 2 path checkpointer |
| Memory NỘI BỘ, không qua gateway | Gateway = external mutation (allowlist). Store/MEMORY.md như checkpointer — internal state | — |
| Mirror vào MEMORY.md section riêng (marker) | Human thấy + sửa được cái agent nhớ; đọc lại reuse inject P2 (zero wiring mới) | Phải rewrite-in-place an toàn |
| Store key = content-hash | Fact giống nhau xuyên run gộp 1 entry (dedup) | — |
| LLM-extracted fact (inject extractor) | Richer hơn fact deterministic; non-determinism cô lập sau client inject → test offline bằng fake | Cần fake extractor |
| psycopg[binary] | macOS không có libpq → plain psycopg import fail; binary wheel gói sẵn libpq | Wheel lớn hơn |

## Vấp & học được

- **Review bắt 2 bug CRITICAL test happy-path che mất:**
  1. **S1 Postgres conn-leak:** `from_conn_string(dsn).__enter__()` để generator của context-manager không ai giữ → GC gọi `__exit__` → **đóng connection** dưới chân saver. Plan R3 đã dặn "mở raw connection trực tiếp" — code làm NGƯỢC. Fix: `Connection.connect(...)` + `PostgresSaver(conn)` (như sqlite branch). Selection-test không bắt được vì không connect PG thật.
  2. **S3 MEMORY.md marker-doubling:** `_split` để `before` chứa START + `after` chứa END, rồi `block` thêm START/END lần nữa → **marker nhân đôi mỗi lần ghi** (3 lần ghi → 3 cặp marker, rồi marker lọt vào vùng fact). Test chỉ ghi 1 lần nên xanh giả. Fix: `before`/`after` loại marker + normalize state malformed → **luôn đúng 1 cặp**; thêm test ghi 5 lần assert count==1. → **test write-once không đủ cho code rewrite-in-place; phải test repeated-write + assert invariant (count).**
- **Entry-path parity:** reviewer (ở S2) bắt cli report path thiếu `store=` → divergence. S3 wire remember ở cả worker/cron/cli ngay từ đầu để tránh "cli memory-less".
- **Residual risk ghi nhận:** fact là LLM output chưa lọc; prompt cấm secret nhưng không enforce; memory persist + re-inject (rộng hơn report 1 lần). Internal-only giới hạn blast; scrub hoãn (như Atlassian-token posture).

## Mở / sang sau

- **Postgres runtime CHƯA verify** (selection-test only): cần 1 live-PG smoke (gated env) + quyết connection-pool cho concurrency trước khi nói "Postgres supported".
- File >200 LOC: cli.py 318 (pre-existing, +9). Modularize hoãn.
- **P7 web dashboard** (HTMX/Streamlit trên 4 route P6 + approve/config/trigger) — nửa UI còn lại của M2, BỎ QUA round này. Backend v2 (M1 core + M2 interrupt/streaming/Postgres+memory) đã đủ; chỉ thiếu UI.
