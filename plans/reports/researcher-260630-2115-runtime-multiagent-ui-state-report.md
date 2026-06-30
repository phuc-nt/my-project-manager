# Research: Runtime / Multi-agent / Web-UI State (cho v3 M7 UI)

**Date:** 2026-06-30 · **Repo:** my-project-manager
**Mục đích:** Map tầng runtime/multi-agent/web-serving để thiết kế UI low-tech (v3 M7) + xác nhận multi-domain khả thi.

> Input nền cho [v3 plan M7](../260630-2115-v3-domain-pack-platform/phase-m7-low-tech-ui.md).

## Kết luận 1 dòng

Runtime + orchestration + server + React SPA **đã production-ready cho multi-agent**. Gap cho v3 = **UX onboarding** (tạo agent qua web), KHÔNG phải kiến trúc.

## 1. Runtime/orchestration — multi-agent FULLY WORKING
- `runtime/registry.py:load_registry()` đọc `registry.yaml` (id + enabled).
- `runtime/service.py:Service.run_tick()` daemon đọc registry + `schedule:` mỗi profile (cron) → spawn ≤4 worker/tick (concurrency cap).
- `runtime/worker.py:main()` invoke `python -m src.runtime.worker --agent-id <id> --report <kind> --audience <i|e>`; load `profiles/<id>/`, data dir `.data/agents/<id>/`, graph isolated per (agent,kind,audience).
- Interrupt (P5): external report pause tại `approval_gate`, checkpoint per-agent SqliteSaver, resume `--resume --thread --decision`. Exit codes: 0 delivered / 1 not / 2 load-error / 3 paused.
- Sibling memory (`agent/sibling_memory.py`): agent cùng `project:` đọc fact của nhau (read-only, internal-only).
- **Verified working:** registry/service/worker isolated; scheduled + on-demand cùng qua gateway-routed path.

## 2. FastAPI server — endpoint đầy đủ (localhost:8765, NO AUTH, single-operator)

| Route | Method | Mục đích | R/W |
|---|---|---|---|
| `/api/agents` | GET | list enabled agents | R |
| `/api/agents/{id}/status` | GET | budget vs cap + pending count | R |
| `/api/agents/{id}/trigger` | POST | in-process graph run (run_id,thread_id) | **W** |
| `/api/runs/{run_id}/stream` | GET SSE | live per-node progress + terminal | R |
| `/api/runs/{id}` | GET | run timeline | R |
| `/api/cost/{id}` | GET | monthly cost series + cap | R |
| `/api/memory/{id}` | GET | facts (internal only; external→empty) | R |
| `/api/automation/{id}` | GET | pending Lớp B proposals | R |
| `/api/audit/{id}` | GET | guardrail verdict + rows | R |
| `/api/agents/{id}/approvals` | GET | pending approvals | R |
| `/api/agents/{id}/approvals/{aid}/approve` | POST | run approved (gw.approve + dispatch) | **W** |
| `/api/agents/{id}/approvals/{aid}/reject` | POST | reject (audit) | **W** |
| `/api/agents/{id}/config` | GET | 4 profile file text | R |
| `/api/agents/{id}/config/profile` | POST | save profile.yaml (validate→atomic; bad→400) | **W** |
| `/api/agents/{id}/config/{soul\|project}` | POST | save SOUL/PROJECT.md; memory read-only | **W** |

- Mọi write qua identical `ActionGateway.execute()/approve()` như CLI. Trigger default dry_run=true. Audience validation strict (422). SSE single-drain (409 nếu attach lần 2). PII firewall `summarize_node`.

## 3. React SPA (web/) — Vite + TS + React 19 + react-router
- Build → static commit `src/server/static/app/`, FastAPI catch-all serve `/` (zero Node ở serve time).
- **Views:** Overview, Timeline, Cost (chartjs), Memory&Automation, Guardrail (verdict+audit), Approvals (approve/reject), Config (4-file editor), Trigger (kind/audience/dry_run + SSE live).
- **Components:** AgentPicker, ConfigEditor, ConfirmDialog, FactsList, PendingProposals, AuditTable, charts.
- **Hooks:** useAgent, useAgentData, useSse.
- **API client:** `web/src/api/client.ts`.

## 4. Profile creation HÔM NAY — CLI hoặc tay
- `mpm agent register <id>` → `entrypoints/mpm_registry_cmds.py:run_register()`: validate id `[a-z0-9-_]`, scaffold `profiles/<id>/` từ `profiles/default/`, append `registry.yaml` (giữ comment). Exit 0/1(collision)/2(bad id).
- HOẶC copy tay profiles/default/ + sửa YAML + append registry.

## 5. GAP cho UI low-tech (v3 M7)
- ❌ KHÔNG có create-agent wizard (POST /api/agents/create chưa có).
- ❌ KHÔNG có guided setup (token → channel → schedule).
- ❌ KHÔNG có cron builder (cron là free-text trong YAML).
- ❌ KHÔNG có persona builder (SOUL.md là free markdown).
- ❌ KHÔNG có all-agents team view (chỉ per-agent picker).
- ✅ Config edit + Trigger + Approve ĐÃ CÓ.

## 6. AICoworker-style patterns ĐÃ có vs CHƯA
- ✅ Multi-provider (OpenRouter OpenAI-compatible, per-agent model override).
- ✅ Budget cap per-agent (`budget_tracker.py`, file-backed, hard-stop + warn).
- ✅ Cost tracking per request.
- ❌ OAuth (no — localhost no-auth).
- ❌ Local model (no — OpenRouter only).
- ❌ Multi-provider fallback chain.
- ❌ Multi-user / RBAC.

## 7. Multi-domain (PM/HR/Admin) khả thi?
Kiến trúc ĐÃ multi-agent: registry list + per-agent isolation (data dir, thread_id namespace `{id}:{kind}:{audience}:{hash}`, Store namespace `(id,"memory")`) + concurrent scheduling + sibling memory + per-agent config. Thêm HR/Admin = thêm registry entry + profile. **Không có blocker kiến trúc.**

## Unresolved
1. Token-via-UI cần secret store an toàn (hiện .env) — defer hay làm "copy .env lines" ở M7?
2. No-auth localhost — production multi-user defer (đã chốt: chưa cần).

**Status:** DONE
