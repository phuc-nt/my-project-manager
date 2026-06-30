# Phase M10 — Local Model Offline

> [← plan.md](plan.md) · trước: [phase-m9](phase-m9-multi-provider-fallback.md)

## Context Links
- Phụ thuộc M9 (ModelChain abstraction — local là 1 mắt xích trong chain).
- LLM client: `src/llm/client.py` (OpenAI-compatible call site).
- Reference: AICoworker dùng local Gemma 4 qua node-llama-cpp + HTTP server :18790 (`docs` reverse-engineering report openclaw-workspace). **CHỈ tham khảo pattern — KHÔNG port (TS≠Python).**

## Overview
- **Priority:** P2 — nặng nhất v4; làm sau M9.
- **Status:** ⬜ Planned. Backend + model ✅ CHỐT: **Ollama (HTTP) + Gemma 4**.
- **Mục tiêu:** Chạy model local không cần API key, dùng cho task nhẹ (skill-select, compose ngắn) hoặc làm fallback free cuối chain. Offline-capable.

## Key Insights
- AICoworker stack là **TS + node-llama-cpp** → KHÔNG dùng trực tiếp. mpm là Python → cần binding Python.
- **2 lựa chọn backend Python** (chốt ở research S0):
  - **Ollama** (HTTP local server, OpenAI-compatible) — ĐƠN GIẢN nhất: mpm gọi như 1 "provider" qua base_url `localhost:11434`, tái dùng client + ModelChain gần như nguyên. Đề xuất mặc định.
  - **llama-cpp-python** (in-process binding) — kiểm soát sâu (RAM-aware, GPU), nhưng nặng cài đặt + native build. Chỉ chọn nếu cần in-process không server.
- Vì Ollama OpenAI-compatible → local model trở thành **1 entry trong `model_chain` của M9** (base_url khác). Tối giản công sức.
- Local model nhỏ viết prose tiếng Việt PM/HR có thể yếu → giới hạn dùng cho task nhẹ; report chính ưu tiên cloud.

## Requirements
**Functional:**
- Profile khai báo local provider (vd `local: { backend: ollama, model: qwen2.5, base_url: ... }`).
- Local model dùng được ở: (a) skill-select / compose ngắn; (b) fallback cuối chain M9 khi cloud lỗi/hết budget.
- Offline: cloud không reachable → vẫn chạy được report (chất lượng giảm, có cảnh báo).
- Budget: local = $0 → budget tracker ghi cost 0 nhưng vẫn log usage.

**Non-functional:**
- Không khai báo local → byte-identical v4-M9 (cloud-only).
- Số liệu deterministic giữ; local chỉ ảnh hưởng prose.
- Cài đặt local là **opt-in** (không bắt mọi user cài Ollama).

## Architecture
**Đề xuất: Ollama HTTP (tối giản):**
```
[ModelChain (M9)]
  ├─ primary: openrouter/minimax-m2.7   (cloud, base_url openrouter)
  ├─ fallback1: openrouter/qwen-3.7     (cloud)
  └─ fallback2: local/qwen2.5           (Ollama localhost:11434, OpenAI-compatible)
```
- Local = thêm 1 ProviderSpec với base_url local → client hiện tại gọi được (OpenAI-compatible) → **ít code mới nhất**.
- `src/llm/local_provider.py` (MỚI): health-check Ollama (server chạy? model pull chưa?), cảnh báo nếu thiếu.
- RAM/GPU awareness: với Ollama, để Ollama tự quản; với llama-cpp-python (nếu chọn) mới cần context-size RAM-aware như AICoworker.

## Related Code Files
**Create:**
- `src/llm/local_provider.py` (Ollama health-check + spec; hoặc llama-cpp wrapper nếu chọn in-process).
- `docs/v4/local-model-setup.md` (hướng dẫn cài Ollama + pull model — vì là opt-in).

**Modify:**
- `src/config/reporting_config.py` + `config_builders*.py` — parse `local:` block.
- `src/profile/loader.py` — local field.
- `src/llm/model_chain.py` (M9) — chấp nhận local entry (base_url local) trong chain.
- `src/llm/budget_tracker.py` — local cost = 0 nhưng record usage.

## Implementation Steps
*(S0 đã chốt: Ollama + Gemma 4. Còn lại: verify Gemma 4 prose tiếng Việt đủ dùng cho headcount/skill-select lúc S5 — nếu yếu, đổi model trong Ollama, không đổi code.)*
1. **S1 — Local provider spec** (Ollama base_url localhost:11434, model gemma) + health-check (server up? model pull chưa?). Test offline mock.
3. **S2 — Wire vào ModelChain** local làm 1 entry (reuse client OpenAI-compatible). Test chain rớt xuống local.
4. **S3 — Budget = $0 + usage log.** Test local run ghi cost 0, có run-event.
5. **S4 — Task routing:** profile chọn local cho skill-select/compose-ngắn; report chính giữ cloud-first. Test routing.
6. **S5 — Offline E2E:** tắt mạng cloud → report chạy local (cảnh báo chất lượng). Test thật với Ollama local.
7. **S6 — Docs** setup guide (opt-in).

## Todo List
- [x] S0 Backend + model chốt: Ollama (HTTP) + Gemma 4
- [ ] S1 Local provider spec (Ollama localhost:11434, gemma) + health-check
- [ ] S2 Wire local vào ModelChain
- [ ] S3 Budget $0 + usage log
- [ ] S4 Task routing (local cho task nhẹ)
- [ ] S5 Offline E2E (cloud down → local chạy)
- [ ] S6 Docs setup guide
- [ ] pytest xanh; E2E offline report qua local model

## Success Criteria
- Cloud lỗi/hết budget → local model chạy report (chất lượng giảm, có cảnh báo) — agent không chết.
- Local model dùng được cho skill-select/compose nhẹ, cost $0.
- Không khai báo local → byte-identical v4-M9.
- Setup là opt-in, có docs; user không cài Ollama vẫn chạy cloud bình thường.

## Risk Assessment
- **R1 Model local viết prose dở** → giới hạn task nhẹ + report chính cloud-first; người chọn qua profile.
- **R2 Cài đặt nặng** (native build llama-cpp) → ưu tiên Ollama (HTTP, không build) làm mặc định.
- **R3 RAM không đủ** → health-check cảnh báo trước; chọn model nhỏ; để Ollama quản RAM.
- **R4 Python≠AICoworker TS** → KHÔNG port node-llama-cpp; dùng binding Python thật (quyết S0).

## Security Considerations
- Local model = data KHÔNG rời máy → tốt cho PII (HR data nhạy cảm). Có thể là lý do CHÍNH để dùng local cho HR pack.
- Local server bind localhost-only (không expose 11434 ra ngoài).

## Next Steps
- v4 hoàn tất. Đánh giá v5: OAuth/multi-user/production deploy (đã defer) nếu cần lên production.
