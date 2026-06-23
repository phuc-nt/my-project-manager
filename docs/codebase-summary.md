# Codebase Summary — my-project-manager

> Bản đồ codebase, cập nhật khi code hình thành. Đọc để biết "cái gì ở đâu" nhanh.
> Status: **2026-06-24 — v2 M1-P1 + P2 HOÀN TẤT.** Multi-agent core (config injection + profile-based load) + CLI with `--profile` flag. 317 UT, ruff clean.

## Trạng thái hiện tại (v2 M1-P2)

- **v2 M1-P1 DONE**: Config-injection refactor; 21 call sites parametrized, no more singletons.
- **v2 M1-P2 DONE**: Profile system (`profiles/<id>/` → 4 files + config + persona/project/memory injection).
  - `cli report --daily [--profile default]` loads config from profile, not `.env` directly.
  - `profiles/default/` ships v1-equivalent behavior (empty SOUL/PROJECT/MEMORY, profile.yaml from config.example.env).
  - 317 tests pass, ruff clean.
- **Entry points**: `python -m src.entrypoints.cli` (P2 adds `--profile`); `python -m src.entrypoints.cron` (P2 adds `--profile`).

## Cây thư mục (v2 M1-P1/P2 state)

```
src/
├── agent/        # LangGraph graph + nodes + state — LÕI
├── tools/        # *_read.py: jira/github/slack/confluence (READ)
├── actions/      # action_gateway.py + *_write.py (WRITE, qua guardrail)
├── llm/          # provider config + prompts (P2: accepts persona/project/memory params)
├── config/       # Settings, ReportingConfig (P1: no singletons); config_builders
├── profile/      # [NEW P2] Profile loader + context injection
│   ├── loader.py         # Load profiles/<id>/ → LoadedProfile (yaml + 3 MD files)
│   ├── loader_mapping.py # Map profile.yaml → P1 dicts (Settings, ReportingConfig)
│   └── context.py        # ProfileContext (persona/project/memory) + prompt helpers
├── audit/        # audit log (append-only)
└── entrypoints/  # cli.py, cron.py (P2: accept --profile flag)

profiles/         # [NEW P2] Agent configs (gitignored except default/)
└── default/      # v1 migration template (empty SOUL/PROJECT/MEMORY; profile.yaml)
   ├── profile.yaml
   ├── SOUL.md
   ├── PROJECT.md
   └── MEMORY.md
```

## Bản đồ "tìm gì ở đâu"

| Cần tìm | Ở |
|---|---|
| **[NEW P2] Load profile** | `src/profile/loader.py::load_profile()` — parse `profiles/<id>/profile.yaml` + SOUL/PROJECT/MEMORY |
| **[NEW P2] Profile → config** | `src/profile/loader_mapping.py` — map profile.yaml fields to P1's Settings/ReportingConfig dicts |
| **[NEW P2] Prompt injection** | `src/profile/context.py::ProfileContext` — persona (system msg), project+memory (user msg, internal only) |
| **[P2 UPDATE] CLI entry** | `src/entrypoints/cli.py` — now accepts `--profile` (default `default`); calls `load_profile()` + passes config downstream |
| **[P2 UPDATE] Cron entry** | `src/entrypoints/cron.py` — now accepts `--profile`; scheduler loads profile per agent-run |
| Flow agent (graph) | `src/agent/report_graph.py` (perceive→analyze→compose→deliver) + injectable deps with config/settings |
| Cách đọc Jira | `src/tools/jira_read.py` (get_open_issues, parse_issue); adapter MCP ở `src/adapters/mcp_adapter.py` |
| Cách đọc GitHub | `src/tools/github_read.py` (get_open_prs, get_recent_ci); adapter CLI `src/adapters/cli_adapter.py` |
| Models | `src/tools/models.py` (Issue, PullRequest, CiRun, Risk, Sprint) |
| Risk phát hiện | `src/agent/risk_analyzer.py` (pure: overdue/blocker/stale_pr/ci_failure) |
| **[P1 UPDATE] Config reporting** | `src/config/reporting_config.py` + `src/config/settings.py` (no `@lru_cache` singletons; parametrized builders) |
| Cách agent ghi/post | `src/actions/action_gateway.py` (MỌI mutation; per-agent isolation in P3) |
| Post Slack | `src/actions/slack_write.py` (deliver_report + build_slack_short) |
| Tạo page Confluence | `src/actions/confluence_write.py` (create_report_page via gateway) |
| Guardrail allow/deny | `src/actions/hard_block.py` (allowlist + Lớp A/B + per-agent in P3) |
| Guardrail giải thích | `docs/v1/action-gateway-explainer.md` — safety model (giữ nguyên từ v1) |
| Lớp B duyệt người | `src/actions/approval_store.py` (queue SQLite) + gateway `approve/reject` |
| Dedup bền | `src/actions/dedup_store.py` (SQLite, reserve-before-execute) |
| Xem audit | `cli audit [--tool/--verdict/--since/--limit]` |
| Phát hiện/redact secret | `src/actions/secret_patterns.py` |
| Report prompt | `src/llm/report_prompt.py` (P2: accepts persona/project params) |
| OKR Confluence read | `src/tools/confluence_read.py` |
| OKR epic progress | `src/tools/okr_read.py` |
| OKR analyzer | `src/agent/okr_analyzer.py` |
| Resource analyzer | `src/agent/resource_analyzer.py` |

## Key M1-P2 Changes vs v1

| Aspek | v1 | v2 M1-P2 |
|---|---|---|
| **Config source** | `.env` (singleton `get_settings()`) | `profiles/<id>/profile.yaml` (parametrized loader) |
| **Entry point** | `cli report --daily` | `cli report --daily [--profile default]` |
| **Token storage** | ENV values in `.env` | Profile refs ENV var NAME; token resolved at spawn |
| **Persona/project/memory** | Hardcoded prompts | Profile SOUL/PROJECT/MEMORY files → injected at prompt time |
| **External report** | PII scrub at prompt time | Same (persona/project/memory NOT injected to external path — safety preserved) |
| **Data isolation** | All data in `.data/` | P3 will per-agent isolate; M1-P2 still shared |
| **Default profile** | N/A | `profiles/default/` = v1 replica (empty MD, yaml from config.example.env) |

## Testing

- **Unit tests**: `uv run pytest` — 317 tests pass (P2 adds profile loader tests).
- **Linting**: `uv run ruff check src tests` — clean.
- **E2E**: `cli report --daily --profile default --dry-run` (dry-run to avoid external write); real run verified (commits 37433be / 0b4f3a2 / dd04271).

## Next Steps (P3+)

- **P3**: Registry + worker + per-agent isolation + per-agent gateway/budget/audit.
- **P4**: Multi-agent CLI (`agent list`, `agent register`, `agent run`).
- **M2**: Web dashboard + Postgres + streaming + LangGraph interrupts.
