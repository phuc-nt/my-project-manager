# Research: Generic Core vs PM-Domain Coupling (cho v3 domain-pack)

**Date:** 2026-06-30 · **Repo:** my-project-manager · **Scope:** ~11.3k src Python + ~1.3k web TSX + ~10.4k tests
**Mục đích:** Map chính xác phần nào của lõi là GENERIC (tái dùng cho HR/Admin) vs PM-HARDCODED, để thiết kế "domain pack" (v3 M5).

> Đây là input nền cho [v3 plan M5](../260630-2115-v3-domain-pack-platform/phase-m5-domain-pack-abstraction.md).

## Kết luận 1 dòng

Core **60% generic / 40% PM-hardcoded**. Generic 100%: web UI, Action Gateway core, profile loader, memory, skill system. Hardcoding tập trung ở **3 seam**.

## Phân loại generic vs PM-hardcoded

### Graph pipeline (perceive→analyze→compose→deliver)
- `src/agent/graph.py` — **GENERIC** (base minimal LLM graph, zero PM).
- `src/agent/report_graph.py` (328 LOC) — **PM-HARDCODED**: Jira+GitHub+Confluence bindings; `report_kind` enum (daily/weekly) baked ~L96-105; weekly sprint logic L98. Audience split generic nhưng data model PM-specific.
- `src/agent/okr_report_graph.py` (252) — **PM-HARDCODED** (Jira epic rollup + Confluence table; không generalize được).
- `src/agent/resource_report_graph.py` (259) — **PM-HARDCODED** (assume Jira open-issue làm workload proxy).

→ Pattern perceive→analyze→compose→deliver **generic**, nhưng mỗi `default_*_deps` wire PM data-model cứng.

### Analyzers (pure functions)
- `risk_analyzer.py` (111) — **GENERIC structurally** (pure, threshold injected) NHƯNG phụ thuộc `Issue.flagged/.labels/.due_date` (Jira semantics).
- `okr_analyzer.py` (154) — **PM-HARDCODED** (Objective/KeyResult/EpicProgress = OKR-only).
- `resource_analyzer.py` (115) — **GENERIC** nhưng Issue-shape-dependent (assume "open issue count" = load).

### Read tools — TẤT CẢ PM-HARDCODED
- `tools/models.py` — **GENERIC** (Issue/PullRequest/CiRun/Risk normalized dataclasses, tool-agnostic contracts).
- `jira_read.py / github_read.py / confluence_read.py / linear_read.py / okr_read.py` — đều hardcode tool-name + PM semantics. HR/Admin cần parallel `hr_read.py`.

### Write tools — hardcoded ở 3 nơi
1. `actions/hard_block.py` L127-150 `_MCP_ALLOWLIST` dict (slack/confluence/jira/linear keys).
2. `actions/approved_dispatch.py` L19-45 if/elif `action["server"] == "slack"/"linear"` + `type=="email"` (3 branch).
3. `config/config_builders_reporting.py` hardcode parse slack/confluence/jira/github bindings.

### Prompts — 100% PM-domain wording
- `llm/report_prompt.py`, `okr_report_prompt.py`, `resource_report_prompt.py`, `audience_external_prompts.py` — persona PM/SM tiếng Việt hardcode, terminology "issue/PR/blocker". Không có knob domain.

### Skill system — GENERIC, pool PM-specific
- `skills/skill_loader.py / skill_selector.py / skill_pool.py` — **GENERIC** (load .md + LLM pick by name/desc, works any domain).
- `skills/*.md` (5 file) — **PM-specific** (flag-risk, prioritize-blockers, estimate-effort, fetch-jira-epics, parse-github-labels).

### Profile + Registry
- `profile/loader.py`, `profile/context.py`, `registry.yaml` — **GENERIC**.
- `profiles/default/profile.yaml` — **PM-HARDCODED** (bindings jira/github/slack/confluence là required field).

### Action Gateway
- `action_gateway.py` — **GENERIC** (guard chain: hard-deny→interrupt→allowlist→kill-switch→dedup→audit, zero PM).
- `hard_block.py` — **PM-HARDCODED by enumeration** (`_MCP_ALLOWLIST` server names). `BlockCategory` enum generic.
- `secret_patterns.py`, `approval_store.py`, `dedup_store.py` — **GENERIC**.

### Web UI (React SPA M4) — 100% GENERIC
- Tất cả views (Timeline/Cost/Memory/Approvals/Config/Guardrail) + JSON API routes domain-agnostic. PM-ness CHỈ nằm ở **graph output text** (report/OKR table/resource narrative), không ở UI infra.

## 3 SEAM cần phá (cho domain pack)

### Seam 1 (HARD nhất) — Report-kind enum + graph dispatch
`src/runtime/worker.py:~81-100` if/elif on kind string → graph builder import cứng `jira_read/github_read`.
→ Cần **registry-driven dispatch** + **ToolProvider interface** (graph nhận `pack.tools` thay import cứng).

### Seam 2 (MEDIUM) — Allowlist + write handlers
`_MCP_ALLOWLIST` dict + `approved_dispatch.py` if/elif. → Load allowlist từ pack đang active (GIỮ default-DENY); handler lookup từ registry.

### Seam 3 (MEDIUM-HARD) — Prompts + analyzers + data model
Prompts → pack asset (.md file + loader). Data model: thêm generic `Task`/`Event`; pack map domain entity → Task; analyzer nhận Task.

## Effort estimate (giải thể PM-core → domain-pluggable)

| Component | Coupling | Difficulty | Days |
|---|---|---|---|
| Graph builders (ToolProvider DI) | hardcoded tool import | HARD | 8-10 |
| Report-kind dispatch | if/elif string | EASY | 2-3 |
| Allowlist + write handlers | hardcoded dict | MEDIUM | 3-4 |
| Prompt system | hardcoded Python | MEDIUM | 3-4 |
| Config bindings schema | explicit fields | MEDIUM | 2-3 |
| Analyzer data models | Issue/PR shape | HARD | 5-7 |
| Skill system | đã generic | EASY | 1-2 |
| Web UI | đã generic | NONE | 0 |
| **TOTAL** | | | **24-34 ngày (~5-7 tuần)** |

## Test coverage
83 test files, ~10.4k LOC, pytest. Heavy: config builders, Action Gateway (red line), profile loading, analyzers. Thin: live OKR/resource E2E (fakes), skill selector, Linear/email integration.

## Unresolved
1. Domain pack ở `domain-packs/` in-repo hay Python entry-point plugin? (đề xuất in-repo, YAGNI).
2. Generic `Task`/`Event` model đủ phủ HR/Admin entity không? (validate ở M6 HR).

**Status:** DONE
