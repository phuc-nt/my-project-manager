# Brainstorm — M4: React visualization dashboard (localhost)

**Ngày:** 2026-06-28 · **Trạng thái:** ✅ Chốt design, sang /mk:plan

## Problem statement

v2 đóng (M1+M2+M3, 776 test, harness đầy đủ). Đã CÓ web dashboard HTMX+Jinja2 (M2-P7,
6 surface: agent list/detail · approvals · audit · config edit · run+SSE). Vấn đề user:
(a) UI thô (server-rendered htmx), (b) thiếu **visualization sâu** (timeline hoạt động,
cost charts, memory/automation insight, guardrail insight). User muốn **UI hiện đại để
visual hoạt động agent + config + quản lý chung**.

## Requirements (chốt với user)

- **Deploy:** localhost single-operator (như hiện tại — KHÔNG remote/auth round này).
- **Stack:** React/SPA (user chọn) thay HTMX.
- **Visual:** cả 4 nhóm — timeline runs · cost/budget charts · memory & automation view ·
  guardrail/audit insight.
- **HTMX cũ:** thay hẳn (xóa) khi React đủ tính năng — 1 UI, không maintain 2.
- **Bất biến:** guardrail/observability KHÔNG đổi; UI chỉ là cửa sổ đọc; mọi action vẫn
  qua Action Gateway (React không bypass approve path).

## Data sources — ĐÃ CÓ SẴN (không cần build data layer)

| View | Nguồn data hiện có | Cần |
|---|---|---|
| Timeline | `runtime/run_event.py` (runs.jsonl: status/kind/delivered/cost/ts) | JSON API |
| Cost charts | `llm/budget_tracker.py` (monthly cost JSON, per-agent) | JSON API |
| Memory + automation | `agent/store.py` (Store search) + `actions/approval_store.py` (pending) | JSON API |
| Guardrail/audit | `audit/audit_log.py` (`query()` verdict/tool/filter) | aggregate API |

→ Effort thật = expose JSON + build React UI; KHÔNG phải viết lại business logic.

## Approaches đã cân nhắc

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Mở rộng HTMX** (giữ stack) | Nhanh, 0 build step, native SSE, không viết lại | UI thô, khó làm charts/component đẹp, user đã từ chối | ❌ user muốn React |
| **B. Vite SPA tĩnh + FastAPI JSON** | Đẹp/component, FastAPI serve static (0 thêm process), không SSR thừa | Phải tách JSON API trước, viết lại UI layer | ✅ **CHỌN** |
| **C. Next.js SSR** | Mạnh nếu remote/SEO/auth | Over-engineering cho localhost single-op; thêm Node runtime process | ❌ YAGNI |

## Final solution: Vite SPA + FastAPI JSON (Approach B)

```
React SPA (Vite + TS) — views: Overview · Timeline · Cost · Memory+Automation · Guardrail
   │  Chart.js (nhẹ, không D3) · SSE cho live run
   ▼ JSON API (mới)
FastAPI (đã có) + endpoints JSON mới: /api/runs · /api/cost · /api/memory · /api/automation · /api/audit
   │  PII firewall (như summarize_node); memory = internal-only
   ▼
data sources ĐÃ CÓ (run-event / budget / Store / approval / audit)
```

**Quyết định kiến trúc:** Vite static (KHÔNG Next.js) — localhost không cần SSR/routing
server; build ra static → FastAPI serve thẳng như đang serve htmx static; zero thêm
runtime process.

## Phạm vi — 5 slice

| Slice | Nội dung | Effort |
|---|---|---|
| **S1 — JSON API layer** | Expose 5 nhóm endpoint JSON từ data có sẵn; PII firewall; KHÔNG đụng guardrail | M |
| **S2 — React shell + Vite** | Scaffold Vite+TS, client routing, layout, build→FastAPI static; view Overview | M |
| **S3 — 4 visual views** | Timeline · Cost (Chart.js) · Memory+Automation · Guardrail/audit insight | L |
| **S4 — Migrate ops surfaces** | approve/reject + config edit + trigger+SSE sang React (giữ đúng đường post thật) | M |
| **S5 — Wiring + e2e + docs + xóa htmx** | Backward-compat, test, docs, remove htmx templates/routes khi React đủ | M |

## Implementation considerations & risks

- **Effort ẩn lớn nhất:** backend hiện render HTML trực tiếp → S1 phải tách JSON API
  trước (boring nhưng bắt buộc).
- **Đây là viết lại UI layer** — ~5 slice, lớn ngang 1 milestone M2/M3. KHÔNG phải tính
  năng nhỏ.
- **Guardrail bất biến:** S4 phải giữ đúng `gw.approve(handler=dispatch_approved_action)` —
  React chỉ gọi API, không bypass. Code-review red-line như mọi slice đụng write path.
- **PII:** memory facts + audit params nhạy cảm → JSON API qua PII firewall; memory view
  internal-only (external audience lấy nothing — giữ lằn ranh đỏ).
- **Scope creep** = rủi ro số 1. Cap: 4 view + Chart.js (không D3, không design system
  nặng). Mỗi slice ship được + dashboard cũ vẫn chạy tới khi S5 xóa.

## Success metrics

- 4 visual view hiển thị data thật (timeline/cost/memory+automation/guardrail) từ JSON API.
- Ops surfaces (approve/config/trigger) hoạt động qua React đúng đường post thật (E2E verify).
- HTMX xóa hết, 1 UI duy nhất; test suite xanh; guardrail E2E không đổi.
- Backward-compat: API routes M2-P6 (`/api/agents`) giữ; FastAPI app vẫn localhost-only.

## Next steps

→ `/mk:plan` lập kế hoạch chi tiết M4 (S1→S5), mỗi slice acceptance + red-line note.

## Unresolved questions

- Auth/remote: defer round này (localhost). Nếu sau cần remote → 1 milestone riêng (auth +
  HTTPS), thiết kế S1 JSON API sao cho thêm auth middleware được mà không viết lại.
- Live-key E2E (Linear/SMTP/LangSmith): vẫn deferred, không liên quan M4.
