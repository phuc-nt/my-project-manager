# Phase M9 — Multi-provider Fallback Chain

> [← plan.md](plan.md) · sau: [phase-m10](phase-m10-local-model-offline.md)

## Context Links
- LLM client: `src/llm/client.py` (OpenRouter, OpenAI-compatible, provider-agnostic call site).
- Budget: `src/llm/budget_tracker.py` (per-agent cap, hard-stop, warn ratio).
- Cost: `src/llm/cost.py`.
- Guardrail: [PDR §7.8 budget cap](../../docs/v1/project-overview-pdr.md).

## Overview
- **Priority:** P1 — rẻ, ROI cao, giải nỗi đau 402 ngay.
- **Status:** ⬜ Planned.
- **Mục tiêu:** Model chính lỗi (402/429/5xx/timeout) → tự fallback sang model kế trong chain, budget-aware, có log. Thuần Python, chỉ chạm `src/llm/`.

## Key Insights
- `client.py` đã provider-agnostic (OpenAI-compatible base_url) → fallback = thêm lớp retry/route TRÊN client, không viết lại client.
- Budget hard-stop hiện CHẶN khi chạm trần nhưng KHÔNG có đường lui → fallback sang model rẻ/local là đường lui đúng.
- Fallback phải **minh bạch:** mỗi lần dùng model phụ → log + run-event, không âm thầm.

## Requirements
**Functional:**
- Profile khai báo `model_chain: [primary, fallback1, fallback2]` (mặc định: chỉ `model` đơn như v3 → backward-compat).
- Client thử primary; lỗi đủ điều kiện → thử fallback kế tiếp; hết chain → raise (như hiện tại).
- Mỗi fallback ghi run-event + audit (model nào, lý do, lần thứ mấy).
- Budget-aware: trước mỗi lần thử, check budget; gần trần → ưu tiên model rẻ hơn trong chain (hoặc local ở M10).

**Non-functional:**
- Backward-compat: không khai báo `model_chain` → byte-identical v3 (1 model).
- Số liệu deterministic không đổi (fallback chỉ ảnh hưởng prose).
- THE INVARIANT không đụng (v4 không chạm Action Gateway).

## Architecture
```
src/llm/
├── client.py            # giữ: 1 call tới 1 model (không đổi signature core)
├── model_chain.py       # MỚI: ModelChain wrap client, thử lần lượt, classify lỗi
├── fallback_policy.py   # MỚI: lỗi nào trigger fallback (402/429/5xx/timeout/empty)
└── budget_tracker.py    # reuse: check trước mỗi lần thử
```
- `ModelChain.complete(messages)` → thử model[i]; `FallbackPolicy.should_fallback(err)` quyết; record per attempt; trả kết quả đầu tiên thành công + metadata (model dùng thật, số lần thử).
- Cost tracking: cộng cost của MỌI lần thử (kể cả lần fail có tính phí) vào budget.

## Related Code Files
**Create:**
- `src/llm/model_chain.py` (ModelChain).
- `src/llm/fallback_policy.py` (phân loại lỗi → fallback hay raise).

**Modify:**
- `src/llm/client.py` — expose lỗi đủ chi tiết để classify (status code, timeout, empty); không đổi call site khác.
- `src/config/reporting_config.py` + `config_builders*.py` — parse `model_chain` (list, default = [model]).
- `src/profile/loader.py` — `model_chain` field.
- Call sites compose/select (`src/agent/*_graph.py`, `src/skills/skill_selector.py`) — dùng ModelChain thay client trực tiếp (chỉ đổi điểm gọi, logic giữ).
- `src/runtime/run_event.py` — record fallback event.

## Implementation Steps
1. **S1 — FallbackPolicy** pure: classify exception/response → `RETRY_NEXT | RAISE`. Test bảng lỗi (402/429/5xx/timeout/empty/200).
2. **S2 — ModelChain** wrap client: thử lần lượt, áp policy, gom cost mọi attempt. Test với fake client (model A fail 402 → model B OK).
3. **S3 — Config** `model_chain` (default = [model], backward-compat). Test profile cũ → chain 1 phần tử.
4. **S4 — Budget-aware ordering** trước mỗi attempt check budget; gần trần → skip model đắt, ưu tiên rẻ. Test cap.
5. **S5 — Wire call sites** compose/select dùng ModelChain. Test report graph fallback E2E offline.
6. **S6 — Observability** run-event + audit mỗi fallback. Test log xuất hiện.

## Todo List
- [ ] S1 FallbackPolicy (classify lỗi)
- [ ] S2 ModelChain (thử lần lượt + gom cost)
- [ ] S3 `model_chain` config (default backward-compat)
- [ ] S4 Budget-aware ordering
- [ ] S5 Wire call sites (compose/select)
- [ ] S6 Fallback observability (run-event/audit)
- [ ] pytest xanh; E2E: primary 402 → fallback chạy report thật

## Success Criteria
- Primary model 402/timeout → agent tự dùng fallback, report vẫn ra (không crash silent).
- Mỗi fallback có log minh bạch (model + lý do).
- Budget cap vẫn tối thượng (fallback không vượt trần; cost mọi attempt tính đủ).
- Không khai báo chain → byte-identical v3.

## Risk Assessment
- **R1 Fallback che lỗi thật** → log + cảnh báo bắt buộc mỗi lần dùng model phụ.
- **R2 Cost nhân đôi** (fail rồi retry đều tính phí) → gom cost mọi attempt vào budget; cảnh báo nếu chain dài đốt nhanh.
- **R3 Model phụ chất lượng khác** → số liệu deterministic giữ; chỉ prose đổi; người chọn thứ tự chain.

## Security Considerations
- Mỗi model trong chain dùng token env-only riêng nếu khác provider (giữ mô hình token_env).
- Không log nội dung prompt/response chứa PII khi ghi fallback event (reuse audit redaction).

## Next Steps
- M10 cắm local model vào CUỐI chain làm fallback free/offline (ModelChain đã sẵn abstraction).
