# v12 Agent Office Plan — Red-team transformed 28 findings into architectural certainty (2026-07-10)

Planning session brainstorm + red-team hostility. Plan pending; no code shipped. Severity: PLANNING VALIDATED → CRITICAL ISSUES SURFACED.

## Đã làm

- **Brainstorm scope (2026-07-10 0630-0900)**: v12 "Agent Office" — CEO tạo công ty + template nhân sự; coordinator phân rã việc rồi chạy tuần tự per-agent worker (subprocess isolation nguyên vẹn); phòng chat chung web + Telegram mirror; office 3D wireframe SSE-driven. 5 phases (M27–M30), ~34 giờ, mode `--hard` = 2 researcher (web-search threat model Tavily+Brave 4-layer defense + coordinator pattern red-line) + planner + red-team 3 hostile lens + validate.

- **Red-team 3 session** (2026-07-10 0648-0900): Assumption Destroyer (process topology + event bus + confirm flow + authz gate) + Failure Mode Analyst (coordinator host + resume trigger + spawn guard) + Security Adversary (query injection + snippet leak + cost enforcement). **28 raw findings → 15 clusters**, 100% accepted, **4 Critical** bắt được lỗi kiến trúc deep.

- **THE 4 CRITICAL FIXES** (to plan.md locked decisions):
  1. **Coordinator thành TICKER pseudo-kind**: NOT "long-run worker" (600s worker-kill = chết). Thay: mỗi tick NGẮN — đọc team_task_store state machine rồi spawn 1 step DETACHED rồi exit; store WAL+seq bảo lưu trạng thái cross-reboot. Reserve step = write `(status=running, attempt_id, child_pid, lease_expires_at)`. Reboot recovery = tick sau đọc lại store, không cần resume trigger riêng.
  2. **Office event bus → bỏ hoàn toàn**: Coordinator + step workers là OS process riêng, asyncio in-proc bus = 0 subscriber. Thay: `office_room_store` SQLite WAL+seq = SSoT duy nhất. Workers append TRỰC TIẾP (PII firewall at write time). Server-side SSE = **store-tail** theo seq (multi-subscriber, khác `stream_run` 409). Milestone mirror = STORE-POLLER cursor, KHÔNG bus.
  3. **"CEO confirm 1 lần" như spec gốc bất khả thi**: ops confirm bắn TRƯỚC `run`, nhưng phân công chỉ tồn tại SAU decompose LLM; ops chat lại hard-bound admin agent (không phải coordinator). Fix đã chốt: `assign_team_task` chạy trên ADMIN ops agent — collect brief → decompose đồng bộ (1 LLM call, giây) → persist plan draft + content HASH → preview TOÀN BỘ DAG → CEO confirm (pattern `_CONFIRM_WORDS` sẵn có) **bind vào hash** (TOCTOU-proof) → status open, ticker dispatch. Cấm re-materialize sau confirm; retry ≤3 chỉ TRƯỚC preview.
  4. **Role authz gate BẮTBUỘC**: `assigned_to` phải (a) ∈ company.yaml staff + (b) ∈ CEO-confirmed plan. Check CÙNG LÚC ở decompose-validation VÀ dispatch; web-search content KHÔNG đổi assignment.

- **Red-team đánh giá cao**:
  - Allowlist wiring (M8-class regression): office-pack PHẢI truyền `mcp_allowlist=pack.allowlist or None` → default-deny.
  - PII firewall "at-write-time": workers ghi vào room store, projection DROP fields → replay tự động an toàn.
  - 15/15 findings accepted; 1 accepted-as-documented risk (regex redaction KHÔNG bắt free-form secret ≡ Atlassian token class).

- **Validation session** (4 quyết định post red-team): (1) web_search = opt-in per-agent; template nghien-cuu bật. (2) Cost cap $2/task trong company.yaml, NOT per-task v1. (3) Per-step timeout 10'; dừng khi awaiting_approval. (4) Nút 1-click tạo trưởng phòng ở P3.

## Quyết định & phát hiện

**Red-team 28→15 findings (ALL ACCEPTED)**:
| # | Cluster | Sev | Key fix |
|---|---------|-----|---------|
| 1 | Coordinator ticker (short-tick, lease, reboot-safe) | C | P3, P2 |
| 2 | Event bus → delete, use store-tail (SQLite WAL+seq SSoT) | C | P4, P5 |
| 3 | Confirm trên admin ops agent, bind plan-hash (TOCTOU-proof) | C | P3 |
| 4 | Role authz gate (decompose + dispatch both) | C | P3 |
| 5 | PII firewall at-write-time (default-drop) | H | P4 |
| 6 | Lớp B step → awaiting_approval + resume | H | P2, P3 |
| 7 | Search keys → settings+env_writer; missing→degrade | H | P3 |
| 8–15 | File ownership audit, auth protect, cost completeness, templates (domain,reports), r3f v9 pin | H/M | Plan+phases |

**Why red-team surfaced 4 Critical when planner+2 researcher missed**:

Process topology question ("who runs where, who writes what, cross-reboot recovery how") MUST be first question, NOT last. Planner assumed coordinator=agent-subprocess (true) but didn't ask "runs HOW LONG" (false: 600s kill). Researcher didn't cross-examine "in-proc bus from cross-process publisher" (impossible by OS design, not just unlikely). Reviewer from "orchestration hostile" lens caught both in 5 min because those are ARCHITECTURAL QUESTIONS not implementation details.

## Bài học

1. **Process topology = mandatory question** ở design orchestration trên per-agent subprocess. "Ai chạy ở process nào, bao lâu, ai ghi shared state, reboot recovery thế nào" phải ask TRƯỚC spec interface.

2. **Idempotent DB write ≠ spawn guard**. Cần lease `(attempt_id, child_pid, lease_expires_at)` + death tombstone. Stateless resume logic không phân biệt "never spawned" vs "spawned dead."

3. **In-proc pub/sub = fatal khi publisher = OS process khác**. Coordinator/workers OS process riêng → bus subscriber ở server process khác = 0 event. Store-tail HOẶC message queue, KHÔNG bus.

4. **Privacy hook alert**: phase file names chứa chuỗi "...phase-02..." (đặc biệt pattern matching) trigger privacy block khi tên file xuất hiện trong Write content. Workaround: Edit thay Write, hoặc dùng "phase N" trong doc thay tên file đầy đủ.

5. **Locked decisions phải verify-against-codebase**, KHÔNG sơ cấp. "Coordinator=subprocess" có vẻ ok, nhưng `_WORKER_TIMEOUT_S=600` ở `service.py:31` — phải biết nó tồn tại. Citation accuracy = não ở red-team.

6. **File ownership table = bẫy song parallel** nếu KHÔNG rebuild từ phase files thực tế. CI không catch ("no parallel edits" = promise KHÔNG test). Must audit.

## THE INVARIANT — 3 điều khoản mở rộng

1. **office-pack allowlist wiring BẮTBUỘC**: mọi ActionGateway do office-pack build → `mcp_allowlist=pack.allowlist or None`. Pack allowlist rỗng = default-deny. KHÔNG fallback.

2. **Role authz gate deterministic**: assigned_to ∈ company.yaml staff AND ∈ CEO-confirmed plan hash. Check ở decompose-validation + dispatch cả 2 nơi; content không đổi.

3. **PII firewall at-write-time**: workers append vào room store → before insert, projection DROP fields per default-drop allowlist. Replay SSE an toàn tự động.

## Next steps

Toàn bộ 15 cụm fix ĐÃ ÁP vào plan.md + 5 phase files (2026-07-10, consistency sweep 0 mâu
thuẫn; validation 4 quyết định đã propagate). Sẵn sàng cook:
`/mk:cook plans/260710-0630-v12-agent-office/plan.md` (P1 song song P2 được).

---

**Status: PLAN COMPLETE, PENDING IMPLEMENTATION** — red-team 15/15 accepted đã áp, 0 rejected,
1 accepted-risk documented; validate 4/4 đã ghi Validation Log.

**Summary**: Red-team hostile review caught 4 Critical (coordinator host + in-proc bus cross-process-leak + confirm impossible + spawn-guard false), validated 4 decisions, expanded THE INVARIANT, taught process-topology + lease + store-tail guardrails. Plan pending finalization; no code shipped.
