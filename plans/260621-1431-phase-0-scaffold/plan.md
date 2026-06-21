# Plan — Phase 0 Scaffold (my-project-manager)

> Status: **IMPLEMENTED — Phase 0 exit met (guardrails verified). E2E smoke deferred (no OpenRouter key yet).** (2026-06-21)
> Mode: `/cook` interactive. Goal: hit roadmap Phase 0 exit criteria.

## Outcome (2026-06-21)

All phases built; 74 unit tests pass, ruff clean. Two code-review rounds drove a
significant design change in the guardrail core:

- **Guardrail model changed denylist → allowlist + Lớp A hard-deny (defense-in-depth).**
  Reason: review found real bypasses (a denylist permits anything unlisted; the
  red line cannot rely on enumerating all bad actions). Now: default-DENY allowlist,
  with catastrophic categories hard-denied even if allowlisted.
- New shared `src/actions/secret_patterns.py` — one secret detector used by both the
  hard-deny credential check and audit redaction, so a secret the gateway catches is
  also masked in the immutable audit log (fixed C1: free-text secret leak).
- Round-2 fixes: `gh api` implicit-POST / glued `-XPOST` writes now blocked;
  `updatePage` version must be a positive int; gateway validates action is a dict.

**Budget tracker moved P3→P2** (client.py depends on it; same llm/ layer).

**Deferred to when a real key exists:** E2E smoke (real OpenRouter call). Graph
lifecycle already proven end-to-end with a fake client; CLI no-key path tested.

**Residual risks (accepted / pending user decision):** Atlassian/Jira tokens have
no fixed prefix → pattern-undetectable, caught only under a secret-named key (not in
free text). Secrets appearing as dict *keys* not redacted (low likelihood).

**Locked dep versions:** langgraph 1.2.6, langgraph-checkpoint-sqlite 3.1.0,
langchain-core 1.4.8, openai 2.43.0, pydantic 2.13.4, python-dotenv 1.2.2,
ruff 0.15.18, pytest 9.1.1. Python venv 3.12.12.

## Goal (one line)

Scaffold the repo so `python -m src.entrypoints.cli "hello"` runs through a minimal LangGraph + 1 real OpenRouter call, with **DRY_RUN flag + audit-log skeleton + Lớp A hard-block list + budget tracker all present before any real write exists**.

## Locked requirements (from user, 2026-06-21)

- Python `>=3.12` in pyproject; use `uv python install 3.12` for the venv (do NOT use global 3.14).
- Hello-agent makes a **real** OpenRouter call (needs `OPENROUTER_API_KEY`). No no-key fallback.
- `git init` + `.gitignore` now; **no auto-commit**.
- Full Phase 0 exit scope (guardrails included before any real write).

## Acceptance criteria (Phase 0 exit)

1. `uv run python -m src.entrypoints.cli "hello"` → graph runs perceive→llm→respond, prints model output. Cost logged.
2. SQLite checkpointer wired into `compile()` (available even if hello doesn't resume).
3. `DRY_RUN` env flag exists; default `true` in `config.example.env`. When true, Action Gateway logs intended action instead of executing.
4. Audit log skeleton: append-only JSONL writer with entry schema. Every gateway call writes one entry.
5. Action Gateway exists with **Lớp A hard-block list** (PDR §7.9): force-push/delete/overwrite-without-version, credential exfil, security-incident ops — denied in code BEFORE reaching LLM/tool. Has unit tests proving denial.
6. Budget tracker: accumulates monthly OpenRouter cost, warns at 80% ($40), hard-stops at 100% ($50) by refusing new LLM calls. Resets monthly.
7. Kill switch: `AGENT_WRITE_DISABLED=true` → gateway refuses all mutations.
8. `ruff check` clean; all unit tests pass; imports compile on the 3.12 venv.

## Integration model (locked 2026-06-21)

Agent does NOT call Python SDKs for Jira/Confluence/Slack. Two adapters:
- **MCP adapter** — Jira/Confluence/Slack via existing Node stdio MCP servers (`~/workspace/{jira-cloud,confluence-cloud,slack-browser}-*-mcp-server`); agent is MCP client (`langchain-mcp-adapters`). Servers run standalone, agent connects.
- **CLI adapter** — GitHub via `gh` CLI (subprocess); future GWS via CLI.

Phase 0 does NOT wire any adapter (hello-agent is LLM echo only). But: tree includes `src/adapters/` placeholder, and `hard_block.py` is designed to classify **MCP tool name + args** and **`gh` command lines** (the real Phase-1 action shapes), not Python SDK calls. `langchain-mcp-adapters` is a **Phase-1** dep, not added in Phase 0.

## Out of scope (this round)

- Any real tool READ (jira/github/slack/confluence) — Phase 1.
- Any MCP/CLI adapter wiring — Phase 1 (`adapters/` is empty placeholder this round).
- Any real WRITE handler — Phase 1. Gateway has the guard skeleton + a no-op/dry-run path only.
- The full perceive→analyze→decide→deliver report graph — Phase 1. Phase 0 graph is minimal (perceive→llm→respond).
- Cron entrypoint logic — stub file only.
- Multi-project / state schema decisions — Phase 1 open questions.

## Non-negotiable constraints

- Stack: Python 3.12+, LangGraph, `uv`, `ruff`, type hints on public fns. snake_case.
- LLM: OpenRouter via raw `openai` SDK (provider-agnostic at llm/ layer; model via `OPENROUTER_MODEL` env). Set `HTTP-Referer` + `X-Title` headers.
- **No write API called outside `actions/action_gateway.py`.**
- Secrets only via env; `.env` not committed; `config.example.env` committed without values.
- Explicit errors (no silent swallow); bounded I/O (timeout + limited retry).
- Conventional commits, no AI refs. (No commit this round — user said no auto-commit.)

## Touchpoints

Greenfield — no existing code to modify. Creates `src/` (incl. empty `src/adapters/` placeholder), `tests/`, `pyproject.toml`, `config.example.env`, `.gitignore`. Updates `docs/codebase-summary.md` + `docs/project-roadmap.md` (Phase 0 checkboxes) at finalize. Honors tree in `system-architecture.md §8` (now includes `adapters/`). Docs PDR §7.9/§9, architecture §4/§5/§8, deployment §1/§3 already updated for MCP+CLI (2026-06-21).

## Phases

| # | Phase | File | Depends |
|---|---|---|---|
| 1 | Project init: venv, pyproject, deps, .gitignore, git init, env example | phase-01-project-init.md | — |
| 2 | Config + LLM layer (env loading, OpenRouter client, cost-aware call) | phase-02-config-llm.md | 1 |
| 3 | Audit log + budget tracker + Action Gateway w/ Lớp A hard-block + kill-switch + DRY_RUN | phase-03-guardrails.md | 2 |
| 4 | Minimal LangGraph + SQLite checkpointer + CLI entrypoint (hello agent) | phase-04-agent-cli.md | 2,3 |
| 5 | Tests (gateway denial, budget hard-stop, dry-run), ruff, smoke run | phase-05-verify.md | 1-4 |

## Key technical decisions (from research, verified 2026-06-21)

- **LangGraph:** `StateGraph` + `START`/`END` from `langgraph.graph`; `.compile(checkpointer=SqliteSaver...)`; sync `.invoke()`.
- **OpenRouter:** raw `openai` SDK (ChatOpenAI drops cost/usage extras). `extra_headers` per call. Read `response.usage` + `response.model_extra.get('cost')`; fallback = manual token×price if cost absent.
- **Gateway:** single function `deny(Lớp A) → kill-switch → dry-run → rate-limit → idempotency → execute → audit`. Not a middleware chain.
- **Audit:** append-only JSONL (`audit/*.jsonl`). Local-first; SQLite table is a later option.
- **Deps (pin, resolve real versions via `uv add`):** langgraph, langgraph-checkpoint-sqlite, langchain-core, openai, pydantic, python-dotenv, ruff, pytest. Set `LANGGRAPH_STRICT_MSGPACK=true`.

## Risks

- **Python 3.14 wheels:** mitigated by pinning venv to 3.12 via `uv python install 3.12`.
- **OpenRouter `cost` field may be absent** for some models → budget tracker must fall back to manual token×price (configurable rate, default 0 = warn-only if unknown). Verify empirically in phase 5 smoke run.
- **Real LLM call in smoke test needs a key** → if `OPENROUTER_API_KEY` absent at verify time, smoke run is skipped with a clear message (tests for gateway/budget/dry-run do NOT need a key and must still pass).
- Exact latest dep versions unverified → let `uv` resolve; record locked versions back into this plan + codebase-summary.

## Data dir (locked 2026-06-21)

Runtime data under `.data/` (gitignored): audit→`.data/audit/audit.jsonl`, checkpoints→`.data/checkpoints.db`, budget→`.data/budget/budget-YYYY-MM.json`.

## Unresolved questions

1. OpenRouter `cost` field present for `minimax/minimax-m2.7`? (verify in phase 5; fallback ready.)
2. MCP transport: 3 servers are stdio-default but we want "run standalone + connect" → need HTTP/SSE bridge or persistent stdio session manager. Decide in Phase 1 (does NOT block Phase 0).
3. Do the 3 MCP server repos have `dist/` built already, or do we `npm run build` each? (Phase 1 setup step.)
