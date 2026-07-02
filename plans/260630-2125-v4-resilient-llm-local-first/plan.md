# v4 Plan — Resilient LLM + Local-First Inference

> **⚠️ Đọc [v3 CONTEXT-HANDOFF.md](../260630-2115-v3-domain-pack-platform/CONTEXT-HANDOFF.md) TRƯỚC** — bối cảnh quyết định gốc áp cho cả v3+v4.
> Milestone series v4. Tiếp sau [v3 domain-pack platform](../260630-2115-v3-domain-pack-platform/plan.md).
> Tham khảo AICoworker (mượn pattern): [reference-aicoworker/](reference-aicoworker/).
> Đọc [v2 architecture](../../docs/v2/architecture.md) §10 (Provider/Model node) + [budget guardrail PDR §7.8](../../docs/v1/project-overview-pdr.md).
> Status: **PLANNED (2026-06-30)**. Chưa code. v4 cook SAU khi v3 (M5-M8) ổn định.

## North Star v4

Làm tầng LLM **bền (resilient)** và **giảm phụ thuộc API trả tiền**: mượn 2 pattern từ AICoworker — **multi-provider fallback** (model chính lỗi/hết credit → tự chuyển model khác) + **local model offline** (chạy không cần API key). Mục tiêu: agent không chết vì 1 provider 402/timeout, và có lựa chọn chạy free/offline.

**Quyết định nền (2026-06-30):**
- Mượn **pattern**, KHÔNG mượn code (AICoworker là TS/node-llama-cpp; mpm là Python — không port lõi).
- v4 vẫn **local-first, single-operator** — KHÔNG làm OAuth/multi-user/production/deploy ở v4 (defer xa hơn).
- Token vẫn env-only (giữ chốt v2 risks #1).
- THE INVARIANT (Action Gateway) không đụng — v4 chỉ chạm tầng `src/llm/`.

## Vì sao v4 cần (bằng chứng)

- **Nỗi đau thật:** OpenRouter credit cap → pipeline crash silent (HTTP 402) — đã gặp ở hệ Hermes research. Budget hard-stop hiện CHẶN khi chạm trần nhưng không có đường lui sang model khác.
- v2 đã có: OpenRouter client provider-agnostic, budget cap, cost tracking. **Chưa có:** fallback chain, local model.
- AICoworker confirmed có cả hai (local Gemma 4 + multi-provider proxy) — chứng minh khả thi cho agent harness.

## Milestones

| MS | Tên | Trạng thái | Mục tiêu | Phase file |
|----|-----|-----------|----------|------------|
| **M9** | Multi-provider fallback chain | ⬜ Planned | Model chính lỗi/402/timeout → tự fallback model kế; budget-aware | [phase-m9](phase-m9-multi-provider-fallback.md) |
| **M10** | Local model offline | ⬜ Planned (nặng) | Chạy model local không cần API key (compose/select nhẹ) | [phase-m10](phase-m10-local-model-offline.md) |

## Thứ tự + lý do

M9 trước: rẻ, ROI cao, giải nỗi đau 402 ngay, thuần Python (chỉ logic retry/route trên client có sẵn). M10 sau: nặng (binding native, GPU, RAM-aware), và M9 đã tạo sẵn abstraction "provider chain" để M10 cắm local provider vào như một mắt xích.

## Nguyên tắc xuyên suốt

- **Budget guardrail tối thượng:** fallback KHÔNG được vượt budget cap (PDR §7.8). Fallback sang model rẻ hơn/local khi gần trần, KHÔNG đốt thêm mù.
- **Số liệu deterministic giữ nguyên:** đổi model chỉ ảnh hưởng prose của LLM; số liệu render deterministic (không để model bịa) — bài học Phase 1.
- **Provider-agnostic giữ nguyên:** không hardcode tên model; chain cấu hình qua profile.
- Backward-compat: không khai báo fallback/local → hành vi byte-identical v3 (1 model OpenRouter).

## Rủi ro lớn nhất

1. **Fallback che giấu lỗi thật** (M9) — model phụ trả kết quả kém mà không ai biết. Mitigation: log mọi lần fallback (audit/run-event), cảnh báo khi dùng model phụ.
2. **Local model chất lượng thấp** (M10) — model nhỏ viết prose dở. Mitigation: local chỉ cho task nhẹ (skill-select, compose ngắn); report chính vẫn ưu tiên cloud; người chọn qua profile.
3. **Python ≠ AICoworker TS stack** (M10) — node-llama-cpp không dùng trực tiếp. Mitigation: chọn binding Python thật (llama-cpp-python / Ollama HTTP), xem M10 research task.

## Quyết định đã chốt (2026-06-30)

- **Local backend:** ✅ **Ollama (HTTP local, localhost:11434)** — OpenAI-compatible, không build native. → local model = 1 entry trong `model_chain` (base_url local), tối giản code.
- **Local model:** ✅ **Gemma 4** (qua Ollama) cho task nhẹ (skill-select, compose ngắn) + fallback free.

## Unresolved còn lại (quyết lúc cook)

1. Fallback trigger nào tính "lỗi"? (402 / 429 / 5xx / timeout / empty) — quyết ở M9 (đề xuất: tất cả + empty response).
2. ~~v4 cook trước/sau v3 M7?~~ ✅ CHỐT 2026-07-02: **M9 cook ngay SAU M7, TRƯỚC v3 M11** (ask-agent cần nền LLM bền — agent "thay người" không được chết im lặng khi bị hỏi). M10 defer-able sau M11.
