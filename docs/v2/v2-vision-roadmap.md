---
title: "v2 Vision + Roadmap — Multi-agent PM platform"
description: "From a single-project PM agent to N profile-bound agents managed from a web dashboard, guardrail preserved per-agent."
status: draft
created: 2026-06-23
supersedes: extends ../v1/project-roadmap.md (picks up its deferred items: service backend, multi-user, Postgres scale-up)
priority: P2
tags: [v2, vision, roadmap, multi-agent, langgraph, web-ui]
---

# v2 Vision + Roadmap — my-project-manager

> Forward-looking design doc. Status: **draft** — đọc, duyệt, rồi `/cook` từng phase.
> Mở rộng `../v1/project-roadmap.md` (v1 Phase 0–5 đã xong). v1 = single-agent, single-project.
> v2 = **nhiều agent, mỗi agent một project, quản lý từ web dashboard, guardrail giữ nguyên per-agent.**
> Bilingual như các doc khác: prose tiếng Việt, code/identifier tiếng Anh.

## 1. Vision

v1 chứng minh được một luận điểm: một LLM agent có thể **full autonomous write** vào Jira/GitHub/Slack/Confluence mà vẫn an toàn, nhờ Action Gateway (Lớp A hard-deny + Lớp B approve + audit + budget + dedup). Nhưng v1 chỉ phục vụ **một project**, cấu hình qua **một file `.env` toàn cục**, kích hoạt qua **CLI/cron**. Muốn theo dõi project thứ hai phải clone repo hoặc đổi `.env` — không scale.

v2 biến nó thành một **multi-agent PM platform**. Mỗi agent = **một thư mục `profiles/<id>/`** (4 file: `profile.yaml` config + `SOUL.md` persona + `PROJECT.md` context + `MEMORY.md` agent tự ghi) bound vào **một project** (Jira/GitHub/Slack/Confluence bindings riêng). Một **registry** liệt kê tất cả agent; một **coordinating service** spawn mỗi agent thành một **worker process** chạy graph của nó (theo lịch + on-demand), với **data isolation hoàn toàn** per-agent (`checkpoints/audit/budget/approvals/dedup` riêng từng agent). Bạn chạy 5 agent cho 5 project, mỗi cái tone + threshold + schedule + budget riêng, không cái nào đụng cái nào.

Trên hết là một **web dashboard** (FastAPI + HTMX/Streamlit): thấy danh sách agent + trạng thái (running/idle/error), cost vs budget từng agent, audit gần đây, **các Lớp B approval đang chờ (approve/reject ngay trên UI)**, xem/sửa config từng agent, **trigger một report on-demand**. Đồng thời v2 khai thác sâu LangGraph mà v1 MVP chưa dùng: **graph-native interrupts** cho human-in-the-loop, **streaming** để UI xem agent chạy live, **Postgres checkpointer + Store** cho state đa-process + cross-thread memory. Điều bất biến: **Action Gateway guardrail được GIỮ NGUYÊN, chỉ trở thành per-agent** — red line Lớp A vẫn hard-coded trước LLM, mọi write vẫn qua một cổng, giờ một cổng *cho mỗi agent*.

## 2. What changes vs v1

| Khía cạnh | v1 (as-built) | v2 (target) |
|---|---|---|
| Số agent / project | 1 agent, 1 project | **N agent, mỗi agent 1 project** |
| Config | 2 `@lru_cache` singleton (`get_reporting_config`, `get_settings`) đọc `.env` toàn cục | **thư mục `profiles/<id>/` per-agent (4 file), inject làm parameter** vào graph/gateway/store/tool |
| Persona / prompt | system prompt hardcode trong `src/llm/*` | **Markdown body của profile override** lớp prompt |
| Kích hoạt | CLI + cron | CLI + **worker** + **web dashboard** (M2) |
| Runtime | 1 process, chạy tay/launchd | **registry → coordinating service → N worker process** |
| Data | shared `.data/` (1 checkpoints/audit/budget/approvals/dedup) | **`.data/agents/<id>/` riêng từng agent**; `thread_id` chứa `agent_id` |
| Checkpointer | `SqliteSaver` (1 file) | **Postgres checkpointer** (multi-process) + **Store** (cross-thread memory) |
| Lớp B approval | gateway-level queue (`pending_approval` + `approval_store` + `cli approve`) | **graph-native interrupt** (pause→UI hỏi→resume, checkpoint-serialized) — augment/replace queue |
| Quan sát | đọc JSONL audit + `cli audit` | **web dashboard**: status, cost, audit, pending approvals, streaming live run |
| **Guardrail** | Action Gateway (Lớp A/B + audit + budget + dedup) | **GIỮ NGUYÊN — chỉ trở thành per-agent** (mỗi agent một gateway + một bộ store) |

> Guardrail **không** bị viết lại. Lớp A red-line, allowlist-default-deny, audit, budget cap, dedup reserve-before-execute — tất cả giữ. Thay đổi duy nhất: chúng được khởi tạo *per-agent* (path + config từ profile) thay vì từ singleton toàn cục.

## 3. The agent PROFILE (centerpiece)

Mỗi agent = **một thư mục** `profiles/<agent-id>/` gồm **4 file tách concern** (theo đúng mô hình thật của OpenClaw + Hermes — cả hai dùng *thư mục nhiều file*, KHÔNG nhồi vào một file). Quyết định này thay cho ý "1 file `profile.md`" ở bản nháp đầu — tách concern đúng đắn hơn, dễ sửa từng phần.

| File | Vai trò | Ai viết | Load khi nào |
|---|---|---|---|
| `profile.yaml` | **Config có cấu trúc**: id, bindings (jira/github/slack/confluence), model, thresholds, budget, schedule, reports, safety flags | Người (sửa khi đổi project/threshold) | startup |
| `SOUL.md` | **Persona**: giọng điệu, hành vi, quy ước riêng team → override/prepend system prompt | Người | mỗi run (fresh) |
| `PROJECT.md` | **Context dự án**: team, milestone, quy ước nghiệp vụ ("label p0 = blocker"), nền cho phân tích — TÁCH khỏi persona | Người | mỗi run (đưa vào context) |
| `MEMORY.md` | **Bộ nhớ agent tự ghi**: "sprint trước trễ vì X", "reviewer Y hay nghẽn" → nhớ xuyên report | **Agent tự maintain** (gated qua Action Gateway, xem P8) | mỗi run (đọc); ghi qua Store (M2-P8) |

> Mô hình tham chiếu (verify từ máy): OpenClaw 1 agent = 9-10 file (`SOUL/USER/MEMORY/IDENTITY/AGENTS/TOOLS/HEARTBEAT/DREAMS/WORKFLOW_AUTO.md` + `openclaw.json` registry). Hermes = `SOUL.md` (persona, "loaded fresh each message") + `memories/{MEMORY,USER,IDENTITY}.md` + `config.yaml`. Ta **lấy 4 file cốt lõi, BỎ phần thừa cho PM agent hẹp** (xem §3.4 YAGNI).

Tokens **KHÔNG** nằm trong profile — `profile.yaml` chỉ *tham chiếu tên env var* (`token_env`); giá trị thật ở `.env` (giữ mô hình env như v1 — user chốt: chưa làm secret store riêng, xem §9).

### 3.1 `profile.yaml` ví dụ (copy-pasteable)

`profiles/acme-web/profile.yaml`:
```yaml
# --- Identity ---
id: acme-web                      # unique, [a-z0-9-], = thư mục .data/agents/<id>/ + thread_id prefix
name: "ACME Web Platform"
enabled: true                     # registry bỏ qua agent disabled
model: minimax/minimax-m2.7       # override OpenRouter model cho riêng agent này

# --- Project bindings (1 agent = 1 project) ---
bindings:
  jira:
    project_key: ACME
    token_env: ACME_JIRA_TOKEN    # TÊN env var (trong .env), không phải token; server đọc khi spawn
    mcp_dist: ~/workspace/jira-cloud-mcp-server/dist/index.js   # optional, default global
  github:
    repo: acme/web-platform       # owner/repo, dùng qua `gh`
  slack:
    report_channel: "#acme-standup"
    stakeholder_channel: "#acme-exec"      # external; route qua Lớp B
    external_channels: ["#acme-exec"]      # channel cần approval; stakeholder PHẢI nằm trong đây
    token_env: ACME_SLACK_BROWSER_TOKEN
  confluence:
    space_key: ACME
    space_id: "123456"
    token_env: ACME_CONFLUENCE_TOKEN
    okr_page_id: "557057"          # optional; OKR no-op nếu trống

# --- Thresholds (per-agent tuning; default = v1) ---
thresholds:
  pr_stale_days: 3
  blocker_label_substring: "blocker"
  okr_behind_threshold: 0.7
  resource_overload_ratio: 1.5
  labor_cost_per_issue: 0          # 0 ⇒ bỏ labor estimate

# --- Budget (per-agent hard-stop) ---
budget:
  monthly_usd: 50
  warn_ratio: 0.8

# --- Schedule (worker đọc; cron/scheduler nội bộ) ---
schedule:
  daily:    "0 9 * * *"            # 09:00 mỗi ngày
  weekly:   "0 17 * * 5"           # 17:00 thứ 6
  resource: "0 9 * * 1"            # 09:00 thứ 2

# --- Report kinds enabled ---
reports: [daily, weekly, okr, resource]

# --- Safety flags (per-agent override; default an toàn) ---
safety:
  dry_run: false
  write_disabled: false
```

`profiles/acme-web/SOUL.md` (persona — người viết; trống ⇒ prompt v1 nguyên vẹn):
```markdown
# Persona — ACME Web Platform agent

Bạn là PM agent cho team ACME Web Platform. Giọng điệu: ngắn gọn, thực tế, ưu tiên hành động.
Internal report: dùng issue key + assignee thật. External (stakeholder): bỏ hết key/PR#/tên người,
chỉ nói tiến độ business-level + rủi ro ở mức "có thể trễ release Q3".

(OVERRIDE/PREPEND vào system prompt ở src/llm/*. KHÔNG đè được lớp PII-sanitization của external —
bài học Phase 5, xem P2 risk.)
```

`profiles/acme-web/PROJECT.md` (context dự án — người viết; nền cho phân tích, tách khỏi persona):
```markdown
# ACME Web Platform — Project Context

- Team: 6 dev, 1 SM (Phúc), release theo quý.
- Milestone gần: Q3 launch (2026-09-30) — ưu tiên cao nhất.
- Quy ước nghiệp vụ:
  - Label "p0" = blocker bất kể tên label (analyzer coi như blocker).
  - >2 PR treo cùng 1 reviewer ⇒ gọi rủi ro "review bottleneck".
- Stakeholder external: CEO + nhà đầu tư (chỉ nhận business summary).
```

`profiles/acme-web/MEMORY.md` (agent TỰ ghi — khởi tạo rỗng; tích luỹ qua các run, ghi qua Store ở M2-P8):
```markdown
# Memory — acme-web (agent-maintained)

<!-- Agent tự append: quyết định/pattern đáng nhớ xuyên report. Vd: -->
- 2026-06-20: Sprint 4 trễ vì phụ thuộc API team Payment — theo dõi cross-team dependency.
- Reviewer "minh-le" thường là điểm nghẽn review PR backend.
```

### 3.2 Field-by-field

| Field | Vai trò | Map tới v1 |
|---|---|---|
| `id` | unique key — thư mục data + prefix `thread_id` + key trong registry | (mới) |
| `name`, `enabled` | hiển thị + bật/tắt ở registry | (mới) |
| `model` | OpenRouter model per-agent | `Settings.openrouter_model` |
| `bindings.jira/github/slack/confluence` | project bindings | `ReportingConfig` fields (`jira_project_key`, `github_repo`, `slack_*`, `confluence_*`) |
| `bindings.*.token_env` | **tên** env var chứa token (không phải giá trị) | `McpServerSpec.env` + `required_env_keys` |
| `bindings.*.mcp_dist` | override dist path per-agent | `McpServerSpec.dist_path` (default global) |
| `thresholds.*` | risk tuning | `ReportingConfig.pr_stale_days / blocker_label_substring / okr_behind_threshold / resource_overload_ratio / labor_cost_per_issue` |
| `budget.*` | hard-stop per-agent | `Settings.monthly_budget_usd / budget_warn_ratio` |
| `schedule.*` | worker scheduler đọc | (v1: launchd plists toàn cục) |
| `reports` | report kinds bật | (v1: CLI flag) |
| `safety.dry_run / write_disabled` | flag per-agent | `Settings.dry_run / write_disabled` |
| `SOUL.md` (file) | persona override prompt | (mới — v1 prompt hardcode) |
| `PROJECT.md` (file) | context dự án đưa vào phân tích | (mới) |
| `MEMORY.md` (file) | bộ nhớ agent tự ghi, xuyên report | (mới — cần Store M2-P8) |

> Synthesis nguồn (verify từ máy): `profile.yaml` config = OpenClaw `openclaw.json` agents.list[] (id/model/bindings); `SOUL.md` = Hermes/OpenClaw SOUL.md (persona freeform); `PROJECT.md` + `MEMORY.md` = tách concern kiểu OpenClaw `USER.md`/`MEMORY.md`. **Adapt cho PM-agent hẹp, không copy nguyên.**

### 3.4 YAGNI — file của reference mà ta KHÔNG lấy

OpenClaw 1 agent có 9-10 file; ta chỉ lấy 4. Bỏ (over-engineering cho PM agent dọc):
- `USER.md` (facts về người dùng) — PM agent không cần persona hoá quanh 1 người; gộp ý vào `PROJECT.md` nếu cần.
- `IDENTITY.md` (tên/avatar/origin-story agent) — gộp vào `SOUL.md`.
- `AGENTS.md` (bootstrap instructions kiểu CLAUDE.md) — không cần; worker biết cách load.
- `TOOLS.md` (tham chiếu script/CLI) — ta dùng tool cố định (MCP+gh), không cần.
- `HEARTBEAT.md` / `DREAMS.md` / `WORKFLOW_AUTO.md` — cơ chế polling/dreaming của personal assistant; ta dùng `schedule` trong `profile.yaml`.

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
   │  Web dashboard (FastAPI + HTMX/Streamlit, M2)                          │
   │  đọc registry + per-agent .data/{audit,budget,approvals}              │
   │  - agent list + status   - cost vs budget   - recent audit            │
   │  - pending Lớp B approvals (approve/reject)  - config view/edit        │
   │  - trigger report on-demand  - streaming live run (SSE, M2-P6)         │
   └──────────────────────────────────────────────────────────────────────┘
```

Vị trí Postgres/Store: **M1 vẫn dùng SqliteSaver per-agent** (1 file / agent — đủ vì mỗi worker 1 process, không tranh chấp). **M2-P8** mới giới thiệu Postgres khi cần multi-machine hoặc cross-thread memory. Store sống cạnh checkpointer, namespace theo `agent_id`.

## 5. Milestone M1 — Multi-agent core (CLI/worker, no UI)

> Mục tiêu M1: chạy được **N agent / N project, isolated, qua CLI/worker** — giá trị thật trước khi có UI. Mỗi phase chạy được + có giá trị, không big-bang (nguyên tắc v1 giữ nguyên).

### P1 — Config-injection refactor (kill singletons) **[BREAKING]**

- **Goal**: bỏ 2 `@lru_cache` singleton; config trở thành object truyền vào làm parameter. Đây là nền cho mọi thứ sau.
- **Key changes**:
  - Giữ `ReportingConfig` + `Settings` (đã là `@dataclass(frozen=True)` — `reporting_config.py:59`, `settings.py:47`) nhưng **bỏ `@lru_cache`** (`reporting_config.py:102`, `settings.py:78`); chuyển thành builder nhận `dict`/profile thay vì đọc `.env` toàn cục.
  - Thread config qua param tới ~21 call site (đã verify, theo category):
    - **Tool fetchers (4 file)**: `jira_read.py` (3 call: :99/:135/:160), `github_read.py` (2: :97/:114), `okr_read.py` (:73), `confluence_read.py` (:82) — đổi sang nhận `cfg` param.
    - **Graph builders / deps (factory)**: `report_graph.py:70`, `okr_weekly_section.py` (:36/:64/:81), `resource_weekly_section.py` (:37/:40/:69/:83), `audience_delivery.py:33` — `default_*_deps(...)` nhận `config`+`settings`.
    - **Action writers (3 file)**: `confluence_write.py` (:78/:100), `slack_write.py` (:29/:59), `action_gateway.py` (:106/:108 external_channels — đã có param `external_channels` ở `__init__:122`, chỉ cần bắt buộc truyền).
    - **Storage (4 file)**: `checkpoint.py:32` (đã nhận `db_path`), `approval_store.py:37` (đã nhận `db_path`), `audit_log.py:52` (đã nhận `path`), `dedup_store.py:25` (đã nhận `db_path`) — bỏ default `get_settings().data_dir`, bắt buộc truyền path.
    - **Budget / LLM (2 file)**: `budget_tracker.py:38` (đã nhận `settings`), `client.py:54` (đã nhận `settings`) — bỏ fallback `get_settings()`.
    - **Entrypoints (2 file)**: `cli.py` (:22/:35/:60), `cron.py` (:64/:72) — đọc profile, build config, truyền xuống.
- **Files touched**: ~21 (6 graph/section, 4 tool, 3 action, 4 storage, 2 budget/llm, 2 entrypoint) + 2 config.
- **Acceptance**:
  - `grep -rn "get_reporting_config\|get_settings" src/` → **0 hit** (ngoài định nghĩa builder).
  - Toàn bộ 269 test pass sau khi đổi sang truyền config (test có thể cần update fixtures — chấp nhận, breaking allowed).
  - `ruff` clean.
- **Risks**: lan rộng (21 file) nhưng **logic graph không đổi** — chỉ plumbing. Risk = bỏ sót call site → runtime `NameError`. Mitigation: grep-driven, acceptance = 0 hit.
- **BREAKING**: ✅ v1 CLI signature đổi (`build_*_graph` thêm `config=`, `settings=`). Backward-compat KHÔNG yêu cầu (user xác nhận).

### P2 — Profile system (thư mục 4 file + persona/project/memory + `default` profile)

- **Goal**: parse thư mục `profiles/<id>/` (4 file) → config object (P1's `ReportingConfig`+`Settings`) + persona + project-context + memory; inject vào prompt/analysis; ship một `default` profile migrate y hệt hành vi v1.
- **Key changes**:
  - `src/profile/loader.py`: đọc `profile.yaml` → build `ReportingConfig`+`Settings`+budget/schedule. `token_env` → resolve từ `os.environ[name]` lúc spawn server (map vào `McpServerSpec.env`, dùng lại `required_env_keys` validation — `reporting_config.py:41`). Đọc `SOUL.md`/`PROJECT.md`/`MEMORY.md` thành string (file thiếu ⇒ rỗng, no-op).
  - `src/profile/context.py`: inject 3 file Markdown vào lớp prompt:
    - `SOUL.md` → prepend system prompt (`src/llm/report_prompt.py` + `okr_/resource_` + `audience_external_prompts.py`); rỗng ⇒ prompt v1 nguyên vẹn.
    - `PROJECT.md` → đưa vào user-message context của analyze/compose (nền nghiệp vụ).
    - `MEMORY.md` → đọc vào context (đọc-only ở M1; ghi qua Store ở M2-P8).
  - `profiles/default/{profile.yaml,SOUL.md,PROJECT.md,MEMORY.md}`: tái tạo `.env` v1 (`profile.yaml` từ `config.example.env`; 3 file md rỗng ⇒ hành vi v1).
- **Files touched**: new `src/profile/{loader,context}.py`, `profiles/default/` (4 file); edit prompt modules để nhận persona/project param (5 prompt file).
- **Acceptance**:
  - Load `profiles/default/` (3 md rỗng) → config bằng-byte với `.env` v1; `cli report --daily` ra report **giống hệt** v1.
  - `SOUL.md` có nội dung → system prompt thực sự đổi (test: prompt chứa custom rule). `PROJECT.md` có quy ước → vào context analyze.
  - `token_env` resolve đúng từ `.env`; thiếu env → lỗi rõ ràng lúc spawn (không lúc load).
- **Risks**: persona/project có thể đè business-tone external (rò PII). Mitigation: 3 file Markdown **prepend** context, KHÔNG thay external-prompt sanitization (privacy giữ — bài học Phase 5). Test: external report với persona+project vẫn zero key/PII. Memory tự-ghi tới M2-P8 mới bật (M1 chỉ đọc).

### P3 — Registry + worker + per-agent isolation + per-agent gateway/budget/audit

- **Goal**: `registry.yaml` liệt kê agent; worker entrypoint load 1 profile, build graph + gateway + stores per-agent với data dir riêng; coordinating service spawn worker theo registry.
- **Key changes**:
  - `registry.yaml`: `agents: [{id, enabled}]` (đường dẫn = `profiles/<id>/` — thư mục 4 file). Model = OpenClaw `openclaw.json` agents.list[].
  - `src/runtime/worker.py`: nhận `--agent-id`, load thư mục profile (P2 loader), build mọi store với path `.data/agents/<id>/{checkpoints.db,audit/,budget/,approvals.db,dedup.db}`, build per-agent `ActionGateway(settings, stores, external_channels)` từ profile.
  - `thread_id` = `"<agent_id>:<kind>:<date>"` (v1 hiện flat: `cli.py:35`="cli", `cron.py:72`="cron-{kind}-{audience}" — thêm prefix `agent_id`).
  - `src/runtime/service.py`: đọc registry, scheduler (đọc `schedule` trong `profile.yaml`), spawn/giám sát worker. Pattern: OpenClaw registry + DeerFlow subagent executor (thread pool, per-thread state, timeout).
- **Files touched**: new `src/runtime/{worker,service}.py`, `registry.yaml`; reuse mọi store (đã nhận path từ P1).
- **Acceptance**:
  - 2 agent (acme-web + beta-app) chạy đồng thời, ghi vào 2 data dir riêng, audit/budget/dedup không lẫn.
  - Budget của agent A hit 100% **không** chặn agent B (budget per-agent).
  - Lớp B approval của A không xuất hiện trong queue của B (approval_store per-agent).
  - `thread_id` chứa agent_id → checkpoint của A và B không đụng.
- **Risks**:
  - **Resource cost**: 1 process/agent — N agent = N node subprocess spawn + N Python process (xem §9). Mitigation M1: worker on-demand/scheduled, không giữ N process thường trực.
  - Token isolation: 2 agent cùng project type cần 2 token khác nhau → `token_env` khác nhau per-profile (P2 đã lo).

### P4 — Multi-agent CLI (register / list / run)

- **Goal**: CLI quản lý nhiều agent thay cho CLI single-project v1.
- **Key changes**:
  - `mpm agent list` — đọc registry, in id/name/enabled/last-run.
  - `mpm agent register <id>` — scaffold `profiles/<id>/` (4 file từ template; 3 md có placeholder).
  - `mpm agent run <id> --report daily|weekly|okr|resource [--audience internal|external]` — chạy 1 report cho 1 agent qua worker.
  - `mpm agent approvals <id>` / `approve <id> <approval-id>` / `reject` — Lớp B per-agent (route tới approval_store của agent đó).
  - Giữ `audit` query nhưng thêm `--agent <id>`.
- **Files touched**: `src/entrypoints/cli.py` (rewrite dispatch quanh agent_id — **BREAKING** so với v1 CLI), reuse worker (P3).
- **Acceptance**: register 2 agent → list thấy cả 2 → run report từng cái → approvals/approve per-agent hoạt động end-to-end (DRY_RUN trước, rồi real write 1 agent).
- **Risks**: BREAKING CLI surface. Mitigation: `default` profile + `mpm agent run default ...` = đường tương đương v1 cho ai quen lệnh cũ.

**Exit M1**: nhiều agent / nhiều project, isolated hoàn toàn, chạy qua CLI/worker + scheduler. Guardrail per-agent. **Chưa có UI, chưa Postgres** — đó là M2.

## 6. Milestone M2 — Web UI + LangGraph upgrades

> Mục tiêu M2: web dashboard quản lý + 3 nâng cấp LangGraph (interrupt / streaming / Postgres+Store). Xây trên M1 đã chạy.

### P5 — Graph-native interrupts cho Lớp B (checkpoint-serialized)

- **Goal**: chuyển Lớp B approval từ gateway-queue sang **LangGraph interrupt** — graph pause tại node, UI hỏi, resume deterministic nhờ checkpoint.
- **Key changes**:
  - Hiện tại Lớp B **KHÔNG** phải graph interrupt: `action_gateway.py:193` gọi `needs_interrupt`, trả `pending_approval` + `approval_store` + `cli approve` (verified — graph không có `interrupt()`). P5 thêm node interrupt thật trong graph (LangGraph `interrupt()` + resume bằng `Command`).
  - Reference: DeerFlow `clarification_middleware.py` (interrupt qua `Command(goto=END)`) — adapt cho approve-to-execute.
  - Lớp A **không đổi** — vẫn hard-deny ở gateway trước LLM. Chỉ Lớp B chuyển sang interrupt.
- **Files touched**: graph builders (4) + gateway (Lớp B path) + một resume handler.
- **Acceptance**: external report → graph pause tại interrupt → state checkpoint → approve qua API → graph resume → Slack post live. Reject → graph dừng sạch, audited.
- **Risks**:
  - **Coexist vs replace** (open question §9): interrupt cần graph đang chạy để resume; approval async (người duyệt sau vài giờ) cần checkpoint bền + worker resume được. Mitigation: interrupt **augment** queue ở P5 (cả hai path tồn tại), quyết replace ở P8 khi Postgres checkpointer bền multi-process.
  - Resume xuyên process: cần checkpoint shared → phụ thuộc P8 Postgres cho production multi-machine. M2 sandbox: cùng worker resume từ SqliteSaver.

### P6 — Streaming + FastAPI service

- **Goal**: FastAPI backend; stream token/event của agent đang chạy ra UI qua SSE.
- **Key changes**:
  - `src/server/app.py` (FastAPI): routes `/api/agents`, `/api/agents/{id}/status`, `/api/agents/{id}/trigger`, `/api/agents/{id}/stream` (SSE).
  - LangGraph streaming (`graph.stream(...)` mode messages/events) → bridge sang SSE. Reference: DeerFlow `StreamBridge`/`thread_runs.py`.
- **Files touched**: new `src/server/{app,stream}.py`; reuse worker + registry.
- **Acceptance**: trigger report từ API → SSE phát event perceive→analyze→compose→deliver live; client thấy progress.
- **Risks**: SSE + worker process boundary — service phải đọc stream từ worker đang chạy (queue/pubsub nội bộ). Mitigation M2: service chạy graph in-process cho on-demand trigger (không qua subprocess) để stream trực tiếp; scheduled run vẫn qua worker.

### P7 — Web dashboard (HTMX hoặc Streamlit)

- **Goal**: dashboard surface mọi thứ ops cần.
- **Key changes** (surface):
  - Agent list + status (running/idle/error) — từ registry + worker heartbeat.
  - Cost vs budget per-agent — đọc `.data/agents/<id>/budget/`.
  - Recent audit — đọc per-agent audit JSONL (reuse `audit_log.query`).
  - **Pending Lớp B approvals — approve/reject ngay trên UI** (gọi P5 resume / approval_store).
  - Config view/edit — render `profile.yaml` + xem 3 file Markdown; save lại (validate trước khi ghi). `MEMORY.md` read-only trên UI (agent tự ghi).
  - Trigger report on-demand — gọi `/api/agents/{id}/trigger`.
- **Files touched**: new `src/server/templates/` (HTMX) hoặc `src/server/dashboard.py` (Streamlit); reuse P6 API.
- **Acceptance**: từ UI thấy 2 agent, cost mỗi cái, approve 1 pending Lớp B → Slack post live, sửa 1 threshold → `profile.yaml` update → run kế tiếp dùng giá trị mới.
- **Risks**: HTMX vs Streamlit chưa chốt (§9). HTMX = nhẹ, server-rendered, hợp FastAPI; Streamlit = nhanh dựng nhưng state model riêng, khó nhúng SSE live. Mitigation: chọn theo P6 — nếu streaming live là must-have → HTMX + SSE; nếu chấp nhận poll → Streamlit nhanh hơn.

### P8 — Postgres checkpointer + Store (multi-process + cross-thread memory)

- **Goal**: thay SqliteSaver per-agent bằng Postgres checkpointer (state bền multi-process/multi-machine) + LangGraph Store (cross-thread memory per-agent).
- **Key changes**:
  - `src/agent/checkpoint.py`: thêm `CheckpointerType = sqlite|postgres` (config từ profile/env). Reference: DeerFlow `checkpointer_config.py` (memory|sqlite|postgres).
  - LangGraph Store namespace theo `agent_id` cho cross-thread memory (vd "nhớ quyết định sprint trước" xuyên report run). Reference: DeerFlow `runtime/store/provider.py`.
  - Resume interrupt (P5) qua Postgres → approval bền + worker bất kỳ resume được.
- **Files touched**: `checkpoint.py`, new `src/agent/store.py`, worker (chọn checkpointer theo profile).
- **Acceptance**: agent ghi memory ở report run 1, đọc lại ở run 2 (cross-thread). Worker restart → resume interrupt từ Postgres. SqliteSaver vẫn là default local (Postgres opt-in qua profile).
- **Risks**: **Postgres = infra dependency mới** (§9 — M1 hay M2?). Quyết: **M2-P8, opt-in**. SQLite đủ cho M1 (1 process/agent, không tranh chấp). Postgres chỉ cần khi multi-machine hoặc cross-thread memory thật sự dùng.

**Exit M2**: web dashboard quản lý N agent (status/cost/audit/approve/config/trigger), agent chạy live streaming, Lớp B qua graph interrupt, Postgres+Store opt-in cho scale.

## 7. What's PRESERVED from v1

- **Action Gateway guardrail** — Lớp A hard-deny (red line, trước LLM), allowlist-default-deny, Lớp B approve, audit immutable + secret redaction, budget cap, dedup reserve-before-execute. **Giữ nguyên logic, chỉ per-agent hóa** (path + config từ profile). `classify()` / `needs_interrupt()` không đổi.
- **Report graphs + analyzers** — `perceive→analyze→compose→deliver`; `risk_analyzer / okr_analyzer / resource_analyzer` (pure functions); audience-split internal/external + business-tone prompts. **Chỉ config-injected** (P1), logic không rewrite.
- **State primitive-only** — kỷ luật checkpointer-safe giữ nguyên (model nặng trong closure).
- **Test + journal discipline** — 269 test giữ + mở rộng; mỗi phase có exit criteria đo được; journal "Vấp & học được" tiếp tục.

## 8. Cross-cutting principles (giữ từ v1)

- Mỗi phase **chạy được + giá trị thật** trước phase sau (không big-bang).
- Không mở write authority mới khi guardrail chưa vững — v2 **không thêm** Lớp A/B action nào, chỉ per-agent hóa.
- Đo cost management cắt được (North Star PDR §3) — giờ per-agent.
- `default` profile = đường migrate an toàn từ v1.

## 9. Risks + open questions

1. **Secrets cho nhiều agent** — ✅ CHỐT: **giữ `.env`** (user quyết — chưa làm secret store riêng). `profile.yaml.bindings.*.token_env` chỉ tham chiếu *tên* env var; giá trị thật ở `.env` toàn cục (1 file, nhiều token, mỗi binding trỏ tên khác nhau). Token KHÔNG nằm trong profile (an toàn để versionable). Residual: `.env` phình khi nhiều agent, và "Atlassian token pattern-undetectable" (v1 đã chấp nhận) — không đổi. Nếu sau cần versionable/multi-machine, nâng lên SOPS/Vault là *thêm 1 backend cho `token_env` resolver*, không đổi profile schema (để ngỏ, không làm bây giờ — YAGNI).
2. **Postgres — M1 hay M2?** Đề xuất **M2-P8, opt-in**. M1 dùng SqliteSaver per-agent (1 process/agent → không tranh chấp). Confirm: có use case multi-machine nào ở M1 không? Nếu không, hoãn Postgres là đúng (YAGNI).
3. **HTMX vs Streamlit** — chưa chốt (P7). HTMX nếu streaming live (P6 SSE) là must; Streamlit nếu dựng nhanh + chấp nhận poll. Quyết sau P6.
4. **Interrupt replace hay coexist với queue Lớp B?** P5 đề **augment** (cả hai), replace ở P8 khi Postgres bền resume xuyên process. Confirm: approval async (duyệt sau vài giờ) chấp nhận giữ graph paused + checkpoint, hay vẫn cần queue tách rời?
5. **Resource cost process-per-agent** — N agent = N Python process + N node MCP subprocess spawn/run. 5 agent OK; 50 agent cần worker pool / share. Quyết khi P3 đo RAM/process thật. Mitigation M1: worker on-demand/scheduled, không thường trực.
6. **Persona override an toàn** — body profile override prompt; phải KHÔNG đè được external-prompt sanitization (rò PII — bài học Phase 5). P2 acceptance test bắt buộc: external + persona vẫn zero key/PII.

---

> **Cook order**: M1 P1→P2→P3→P4 (mỗi cái chạy được), rồi M2 P5→P6→P7→P8. P1 BREAKING — cook trước hết. `default` profile (P2) là lưới an toàn migrate v1.
