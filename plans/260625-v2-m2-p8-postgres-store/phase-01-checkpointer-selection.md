# Phase 01 — Checkpointer selection (CheckpointerType config + postgres branch)

Status: pending · Slice S1 · Effort ~3h

## Context

- `src/agent/checkpoint.py:24` — `get_checkpointer(db_path: Path) -> SqliteSaver`, the ONLY factory.
- Callers (re-grepped, exactly 3): `src/runtime/worker.py:64`, `src/entrypoints/cron.py:55`, `src/entrypoints/cli.py:27` — all pass `settings.data_dir / "checkpoints.db"`.
- The 4 builders type-hint `checkpointer: SqliteSaver | None`: `report_graph.py:249`, `okr_report_graph.py:191`, `resource_report_graph.py:198`, `graph.py:56`.
- Settings: `src/config/settings.py:25`; builder `src/config/config_builders.py:47`; profile mapping `src/profile/loader_mapping.py:69`.
- Dep verified: single package `langgraph-checkpoint-postgres>=3.1.0` ships `langgraph.checkpoint.postgres.PostgresSaver` (+ the store, used in S2); pulls `psycopg>=3.2.0` + `psycopg-pool`.

## Requirements

1. Resolve checkpointer type via the established 3-tier rule. SQLite is the DEFAULT. Postgres opt-in via a DSN.
2. `get_checkpointer(settings)` returns the selected saver; sqlite path byte-identical to today.
3. Widen the 4 builders' checkpointer hint so they accept a Postgres saver.
4. Add the dep; `uv sync` green; both postgres imports resolve.

## Files to modify

- `pyproject.toml` — add `"langgraph-checkpoint-postgres>=3.1.0"` to `dependencies`. Run `uv sync`.
- `src/config/settings.py` — add to frozen `Settings`: `checkpointer: str = "sqlite"`, `postgres_dsn: str | None = None`. (Keep `store` field for S2 or add both now — recommend add `checkpointer` + `postgres_dsn` here; S2 adds `store`. To avoid two churny edits to the frozen dataclass, OPTION: add all three (`checkpointer`, `postgres_dsn`, `store`) in S1 and leave `store` unused until S2. Recommend this — one dataclass edit, S2 only wires the factory.)
- `src/config/config_builders.py` — `build_settings_from_dict`: read `checkpointer` (default `"sqlite"`), `postgres_dsn` (default `None`), `store` (default `"memory"`). `build_settings_from_env`: add `CHECKPOINTER_TYPE`, `POSTGRES_DSN`, `STORE_TYPE` to the env dict.
- `src/profile/loader_mapping.py` — `build_settings_dict`: map a new `runtime:` (or reuse `safety:`?) yaml section → these keys via `_fallback`/`_explicit`. Recommend a new top-level `runtime:` section: `runtime.checkpointer`, `runtime.postgres_dsn`, `runtime.store`. Use `_fallback` (strings; empty defers to env then default).
- `src/agent/checkpoint.py` — change signature to `get_checkpointer(settings) -> BaseCheckpointSaver`. Branch on `settings.checkpointer`. Keep the sqlite branch identical (open `settings.data_dir / "checkpoints.db"`). Add the postgres branch (lazy import `PostgresSaver`, build from `settings.postgres_dsn`, `.setup()`); raise `ValueError` if `postgres` selected with no dsn.
- `src/runtime/worker.py:64`, `src/entrypoints/cron.py:55`, `src/entrypoints/cli.py:27` — update to `get_checkpointer(settings)`.
- The 4 builders — widen the hint to `BaseCheckpointSaver | None` (`from langgraph.checkpoint.base import BaseCheckpointSaver`), keep behavior. (Type-only change; runtime unaffected.)
- `profiles/default/profile.yaml` — add a `runtime:` block defaulting to `checkpointer: sqlite`, `store: memory`, `postgres_dsn: ""` (so default = unchanged behavior).

## Files to create

- `tests/test_checkpointer_selection.py` — the selection unit tests.

## Implementation steps

1. `pyproject.toml` + `uv sync`. Confirm both postgres imports resolve. (GATE: AC0.)
2. Add the 3 Settings fields (frozen dataclass).
3. Wire `build_settings_from_dict` + `build_settings_from_env` + `build_settings_dict` (3-tier). Keep defaults sqlite/memory/None.
4. Rewrite `get_checkpointer(settings)`:
   - sqlite branch: identical open at `settings.data_dir / "checkpoints.db"`.
   - postgres branch: lazy `from langgraph.checkpoint.postgres import PostgresSaver`; build the long-lived saver from `settings.postgres_dsn` (mirror sqlite: open the raw connection so the saver outlives a `with`); `.setup()`. Document the lifecycle TODO for the real-PG round.
   - no dsn + postgres → `ValueError("checkpointer=postgres requires postgres_dsn")`.
5. Update the 3 callsites to `get_checkpointer(settings)`.
6. Widen the 4 builder hints to `BaseCheckpointSaver | None`.
7. `profiles/default/profile.yaml` `runtime:` block (sqlite/memory defaults).
8. Tests, then full suite.

## Test / validation (offline)

- `get_checkpointer(settings)` with default settings → `SqliteSaver`, file at `tmp/checkpoints.db`.
- postgres + dsn: `monkeypatch.setattr("langgraph.checkpoint.postgres.PostgresSaver", FakeCtor)`; assert reached with the dsn (NO real connect).
- postgres + no dsn → `ValueError`.
- Settings 3-tier: yaml `runtime.checkpointer: postgres` wins; else `CHECKPOINTER_TYPE` env; else `"sqlite"`.
- Regression: `uv run pytest -q` → 490 + new green.
- `uv run ruff check` clean.

## Risks + rollback

- R1 (3-callsite breakage): all enumerated; same-commit update; sqlite path byte-identical. R2 (psycopg `uv sync`): GATE AC0 before code. R3 (PostgresSaver lifecycle): selection-tested only this round; document TODO.
- Rollback: revert checkpoint.py + 3 callsites + Settings fields + builders/mapping + pyproject. No data migration (sqlite format unchanged).

## LOC watch

`checkpoint.py` ~37 LOC today → ~70 with the branch; well under 200. Settings/builders/mapping each gain a few lines. No split needed.

## Open questions

- yaml section name: `runtime:` (new) vs folding into `safety:`. Recommend `runtime:` (semantically distinct from safety flags). Confirm with the user if a naming convention exists for infra config.
