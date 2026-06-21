# Phase 02 — Config + LLM Layer

## Goal
Provider-agnostic config loading + OpenRouter call that reports token usage and cost.

## Files created
- `src/config/settings.py` — load `.env` via `load_dotenv()`; typed `Settings` (pydantic BaseModel or dataclass) exposing: `openrouter_api_key`, `openrouter_model` (default `minimax/minimax-m2.7`), `openrouter_referer`, `openrouter_title`, `dry_run` (bool, default True), `write_disabled` (bool), `monthly_budget_usd` (default 50.0), `budget_warn_ratio` (0.8), data dir paths. Explicit error if required secret missing when actually needed (not at import).
- `src/llm/client.py` — `complete(messages, *, model=None) -> LlmResult`. Builds `openai.OpenAI(base_url="https://openrouter.ai/api/v1", api_key=...)`, calls `chat.completions.create(..., extra_headers={HTTP-Referer, X-Title})`. Bounded: timeout + 1-2 retries. Returns `LlmResult{content, prompt_tokens, completion_tokens, cost_usd|None, model}`.
- `src/llm/cost.py` — extract cost from response: try `response.model_extra.get("cost")`; if None, fallback manual = tokens × configurable rate (default rate 0 → cost unknown, flagged). Keep provider-agnostic.

## Constraints
- llm/ layer must NOT import agent/ or actions/. One-way deps.
- No hardcoded model/key. Model from env. Prompts (later) live under llm/, not inline.
- Errors explicit: wrap API errors with context, re-raise; never swallow.

## Validation
- Unit: `cost.py` parses a sample response dict with and without `cost` field correctly (no network).
- Unit: `settings.py` reads env + applies defaults; missing key raises only when `complete()` called, with clear message.
- `complete()` real call deferred to phase 5 smoke (needs key).

## Risks
- `model_extra` shape may differ → cost.py tolerant of missing/renamed field, returns `None` not crash.
