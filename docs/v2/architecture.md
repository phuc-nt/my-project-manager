# v2 — Architecture (target) + What's preserved from v1

> Quay lại [README](README.md) · liên quan: [profile-design](profile-design.md) · [roadmap-m1](roadmap-m1.md) · [roadmap-m2](roadmap-m2.md).

## 4. Architecture (target)

```
                         profiles/                          registry.yaml
              ┌─ acme-web/  {profile.yaml, SOUL.md,  ─┐   ┌─ agents:
              │             PROJECT.md, MEMORY.md}     │◀──│   - id: acme-web  enabled: true
              ├─ beta-app/  {…4 file…}                 ┤   │   - id: beta-app  enabled: true ┘
              └─ ...                                   ┘
                                                              │ đọc
                                            ┌─────────────────▼──────────────────┐
                                            │  Coordinating service               │
                                            │  - đọc registry, load mỗi profile   │
                                            │  - spawn 1 worker / agent enabled    │
                                            │  - scheduler (đọc schedule/profile.yaml)│
                                            │  - on-demand trigger (từ CLI/web)    │
                                            └───────┬───────────────┬─────────────┘
                                  spawn worker      │               │
              ┌──────────────────────────────────▼─┐   ┌──────────▼─────────────────────┐
              │  Worker(acme-web)                   │   │  Worker(beta-app)               │
              │  - load profile → config object     │   │  - load profile → config        │
              │  - build_*_graph(config, settings,  │   │  - build_*_graph(...)           │
              │     gateway, checkpointer)          │   │                                 │
              │  - thread_id = "acme-web:<kind>:<d>" │   │  thread_id = "beta-app:..."     │
              │                                     │   │                                 │
              │  per-agent ActionGateway            │   │  per-agent ActionGateway        │
              │   (Lớp A/B + audit + budget + dedup)│   │   (same guardrail, own stores)  │
              └───────┬─────────────────────────────┘   └──────────┬──────────────────────┘
                      │ read/write isolated                        │
        ┌─────────────▼──────────────┐              ┌──────────────▼──────────────┐
        │ .data/agents/acme-web/      │              │ .data/agents/beta-app/       │
        │   checkpoints.db (→Postgres)│              │   ... (own everything)       │
        │   audit/  budget/  dedup.db │              └──────────────────────────────┘
        │   approvals.db              │
        └─────────────────────────────┘
                      │                                            │
              ┌───────▼────────────────────────────────────────────▼───────┐
              │  Postgres (M2-P8): checkpointer (multi-process state)        │
              │                  + Store (cross-thread memory per-agent)     │
              └─────────────────────────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────────────┐
   │  Web dashboard (FastAPI + HTMX+Jinja2, M2-P7)                           │
   │  Server-rendered HTML; reads registry + per-agent .data/{audit,budget} │
   │  - agent list + status   - cost vs budget   - recent audit            │
   │  - pending Lớp B approvals (approve/reject on-UI, same real-post path) │
   │  - config view/edit (validate-before-write, atomic replace, MEMORY RO) │
   │  - trigger report on-demand  - streaming live run (SSE, M2-P6)         │
   └──────────────────────────────────────────────────────────────────────┘
```

## 5. Persistence: Checkpointer + Store (M2-P8)

**Checkpointer** (LangGraph state durability):
- **Default**: `SqliteSaver` per-agent (1 `.db` file / agent — simple, no infra, works within-process).
- **Opt-in via profile**: `PostgresCheckpointer` via `profile.yaml` `runtime: { checkpointer_type: postgres, postgres_dsn: "..." }` or env `CHECKPOINTER_TYPE=postgres` + `POSTGRES_DSN`. Opens raw psycopg connection at process start (lifetime-scoped).
- **Selection**: `get_checkpointer(settings)` → right class chosen based on config; no-dsn → `ValueError`.
- **Deps for Postgres path**: `langgraph-checkpoint-postgres` + `psycopg[binary]`.

**Store** (cross-thread memory):
- **Default**: `InMemoryStore` (per-run, not persisted).
- **Opt-in via profile**: `PostgresStore` via same `postgres_dsn`.
- **Namespace**: per `agent_id`, so memory is isolated between agents.
- **Selection**: `get_store(settings)` → wired into all 4 builders' `compile(store=...)`.

**Agent Memory (M2-P8, internal-only)**:
- After an `INTERNAL` delivery (audience="internal"), LLM extractor pulls salient facts.
- Facts written to Store (deduped by content-hash) AND mirrored to `MEMORY.md`'s agent-managed section (`<!-- AGENT-MEMORY:START/END -->`; human edits preserved).
- Reads back via P2 internal-only `MEMORY.md` injection on next run.
- **Guardrail**: NOT gated by Action Gateway (memory is internal state, not an external mutation); NOT in external reports.

Vị trí Postgres/Store: **M1 vẫn dùng SqliteSaver per-agent** (1 file / agent — đủ vì mỗi worker 1 process, không tranh chấp). **M2-P8** giới thiệu Postgres khi cần multi-machine hoặc cross-thread memory thật sự dùng. Store sống cạnh checkpointer, namespace theo `agent_id`. Agent memory là internal state: mỗi agent tự ghi vào Store + MEMORY.md, không qua gateway.

**FastAPI service (M2-P6)** — thêm một localhost-only backend (`src/server/app.py`) phục vụ on-demand trigger + SSE streaming cho dashboard. Service này chạy graph in-process (không qua worker subprocess), stream live node events, và enforce PII firewall. Scheduled runs vẫn qua worker/scheduler (M1) — service là *augment*, không thay thế.


## 6. Integrations + multi-channel delivery (M3-P11)

**Config-driven extra MCP servers (C3)**:
- `ReportingConfig.extra_servers: dict[str, McpServerSpec]` lets `profile.yaml` `integrations:` block declare optional stdio MCP servers (name + mcp_dist + required_env NAMES; values from `os.environ`, never in YAML). **Concrete example**: Linear via community stdio MCP (`@tacticlaunch/mcp-linear`, `node dist/index.js`; note: official Linear MCP is HTTP/SSE remote-only, incompatible with stdio-spawn).
- Linear READ tools (`src/tools/linear_read.py`: `linear_getIssues`, `linear_searchIssues`, `linear_getProjects`) bypass Action Gateway like `jira_read`.
- Linear gated WRITE: only `linear_createComment` allowlisted in `hard_block._MCP_ALLOWLIST["linear"]`, classified Lớp B (queued for approval) + destructive tools (`linear_delete*`/`linear_archive*`) hit Lớp A red line via `_DATA_LOSS_TOOL_MARKERS`. Dispatch via `linear_write.py` + `linear` branch in `approved_dispatch.dispatch_approved_action`.

**Multi-channel delivery: Email/SMTP (D2)**:
- New `ActionGateway` mutation type `email_send` (added to `_MUTATING_TYPES`) routes all outbound email through gateway (dry-run/kill-switch/dedup/audit + Lớp A/B apply). Never a side path.
- ALL email = **Lớp B** (locked policy): `needs_interrupt` returns True; real send only via approved dispatch. `_hard_deny_email` (Lớp A) scans recipient/subject/body for secrets, rejects empty recipient or body.
- `SmtpConfig` (`src/config/smtp_config.py`): host/user/from_addr/port=587/use_tls/recipients. Password is ENV-ONLY (`SMTP_PASSWORD` at send-time), never a config field. `src/actions/email_write.py` + `email_send` branch in `approved_dispatch`.
- **Channel registry** (`src/agent/channel_registry.py`): `resolve_channels(config)` returns extra channels (email when SMTP configured; `()` otherwise). `deliver_extra_channels` is gateway-routed; channel failure logged+skipped, never breaks core Slack+Confluence. Misconfigured SMTP (host set, no recipients) **FAILS LOUD** at config-build.
- Wired into all 3 report graphs uniformly via `audience_delivery.deliver_extra_channels_and_summarize`. **Internal-only red line**: email skipped when `audience="external"` (email body is full report detail incl. per-assignee names/costs; external reports withhold that — same red line as resource graph's external link-stripping).

**Unchanged invariant (restate)**: Every new write (Linear comment, email) stays behind Action Gateway — Lớp A hard-deny + default-DENY allowlist + Lớp B approve. New write tools deny by default until explicitly allowlisted. Config flows through all 3 entry points (worker/cron/cli) automatically. Backward-compat: no `integrations:` + no `smtp:` ⇒ byte-identical pre-P11 behavior (Slack+Confluence only). `classify()` / `needs_interrupt()` unchanged.


## 7. What's PRESERVED from v1

- **Action Gateway guardrail** — Lớp A hard-deny (red line, trước LLM), allowlist-default-deny, Lớp B approve, audit immutable + secret redaction, budget cap, dedup reserve-before-execute. **Giữ nguyên logic, chỉ per-agent hóa** (path + config từ profile). `classify()` / `needs_interrupt()` không đổi.
- **Report graphs + analyzers** — `perceive→analyze→compose→deliver`; `risk_analyzer / okr_analyzer / resource_analyzer` (pure functions); audience-split internal/external + business-tone prompts. **Chỉ config-injected** (P1), logic không rewrite.
- **State primitive-only** — kỷ luật checkpointer-safe giữ nguyên (model nặng trong closure).
- **Test + journal discipline** — 269 test giữ + mở rộng; mỗi phase có exit criteria đo được; journal "Vấp & học được" tiếp tục.

## 9. Cross-cutting principles (giữ từ v1)

- Mỗi phase **chạy được + giá trị thật** trước phase sau (không big-bang).
- Không mở write authority mới khi guardrail chưa vững — v2 **không thêm** Lớp A/B action nào, chỉ per-agent hóa.
- Đo cost management cắt được (North Star PDR §3) — giờ per-agent.
- `default` profile = đường migrate an toàn từ v1.
