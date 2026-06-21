# Phase 01 — Project Init

## Goal
Repo bootstrapped: 3.12 venv, pyproject + deps, git, ignore rules, env example, src tree.

## Steps
1. `uv python install 3.12` (ensure 3.12 available without touching global 3.14).
2. `uv init --python 3.12 --no-workspace` style: create `pyproject.toml` (name `my-project-manager`, `requires-python = ">=3.12"`). Pin venv to 3.12 (`.python-version` = 3.12).
3. `uv add` runtime deps: `langgraph`, `langgraph-checkpoint-sqlite`, `langchain-core`, `openai`, `pydantic`, `python-dotenv`. Dev: `uv add --dev ruff pytest`. Let uv resolve real versions; record them.
4. Create `src/` package tree per system-architecture §8: `src/{agent,adapters,tools,actions,llm,config,audit,entrypoints}/__init__.py` + `tests/`. (`adapters/` + `tools/` are empty `__init__` only this round — MCP/CLI adapters + READ handlers are Phase 1.)
5. `.gitignore`: `.venv/`, `.env`, `__pycache__/`, `*.pyc`, `.data/` (checkpoints + audit), `.python-version` kept, `*.db`.
6. `config.example.env` (committed) per deployment-guide §3 (post-MCP update): `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `DRY_RUN=true`, `AGENT_WRITE_DISABLED=false`, `MONTHLY_BUDGET_USD=50`, budget-warn ratio. NOTE: Atlassian/Slack tokens live in each MCP server's env, NOT here — only OpenRouter + (Phase 1) MCP connection config. No real values.
7. `git init`; stage nothing automatically; do NOT commit.

## Files created
- `pyproject.toml`, `.python-version`, `uv.lock`, `.gitignore`, `config.example.env`
- `src/**/__init__.py`, `tests/__init__.py`

## Validation
- `uv run python -c "import sys; print(sys.version)"` → 3.12.x
- `uv run python -c "import langgraph, openai, pydantic, dotenv"` → no error
- `git status` works (repo initialized)

## Risks/rollback
- If a dep has no 3.12 wheel → report exact failure, do not silently drop the dep. Rollback = delete `.venv` + retry.
