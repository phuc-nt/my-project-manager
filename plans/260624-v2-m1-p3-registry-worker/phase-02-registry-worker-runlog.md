# Phase 2 — Registry + worker subprocess + B1 run-event log

> Slice 2 of [plan.md](plan.md). Depends on Slice 1 (`agent_data_dir`, `agent_thread_id`,
> `migrate_legacy_data_dir`). Delivers `registry.yaml` + its loader, the per-agent worker
> entrypoint (`python -m src.runtime.worker`), and the B1 run-event log. After this slice a
> SINGLE agent runs end-to-end through the worker CLI, isolated, with a recorded run-event —
> no daemon yet. Additive: `cli.py`/`cron.py` are untouched.

## Context (verified file:line)

- **Slice 1 helpers (consume):** `src/runtime/agent_paths.py` (`agent_data_dir`,
  `agent_thread_id`), `src/runtime/legacy_migration.py` (`migrate_legacy_data_dir`).
- **The worker = `cron.py`'s report path, per-agent.** `cron.py` already shows the full
  shape to mirror:
  - profile load + clean error: `cron.py:85-90` (`load_profile`, catch
    `(FileNotFoundError, RuntimeError)` ⇒ `print(... file=sys.stderr); return 1`).
  - context build: `cron.py:92-94` (`ProfileContext(persona=loaded.soul,
    project=loaded.project, memory=loaded.memory)`).
  - key check: `cron.py:96-98` (`if not settings.openrouter_api_key: return 1`).
  - graph dispatch by kind: `cron.py:52-76` (`_build_graph` — resource/okr/default →
    `build_resource_graph` / `build_okr_graph` / `build_report_graph`, each taking
    `cp, config=, settings=, context=, audience=`); checkpointer at `cron.py:54`
    (`get_checkpointer(settings.data_dir / "checkpoints.db")`).
    The ONLY differences for the worker: `settings.data_dir` is now the per-agent dir, and
    the thread_id is `agent_thread_id(agent_id, kind, audience)`.
  - invoke + delivered: `cron.py:103-106`
    (`graph.invoke({}, config={"configurable":{"thread_id": ...}})`; `result.get("delivered")`,
    `result.get("delivery_summary")`, `result.get("cost_usd")`).
- **Per-agent gateway:** the report graphs build their own `ActionGateway(settings=...,
  external_channels=config.slack_external_channels)` internally from the injected
  `settings`/`config` (P1/P2). Because the worker sets `settings.data_dir =
  agent_data_dir(id)`, the gateway's stores (`action_gateway.py:124-127`) land under the
  agent dir automatically — NO gateway code change.
- **`registry.yaml` does not exist; `src/runtime/registry.py` does not exist** (verified).
- **PyYAML available** (`pyproject.toml` has `pyyaml>=6.0.3`).
- **`.gitignore`:** `.data/` is ignored (so `runs.jsonl` under `.data/agents/<id>/` is
  ignored). `registry.yaml` is a NEW root file holding only agent IDs — committed (decision
  #6); verify it is NOT caught by any existing ignore rule.

## Requirements

1. `registry.yaml` at repo root, committed: `agents: [{id, enabled}]`. Ship with a `default`
   entry. `src/runtime/registry.py` loads + shape-validates it into a frozen list.
2. `src/runtime/worker.py` — `python -m src.runtime.worker --agent-id <id> --report <kind>
   [--audience internal|external] [--dry-run]`:
   - `migrate_legacy_data_dir()` once at startup (no-op after first run / for non-default).
   - `load_profile(agent_id, data_dir=agent_data_dir(agent_id))` — per-agent data dir.
   - `--dry-run` ⇒ force the gateway into dry-run WITHOUT requiring an OpenRouter key/MCP:
     **decision** — `--dry-run` sets `settings.dry_run=True` AND short-circuits BEFORE
     `graph.invoke` is reached for a network run; for a deterministic no-network test the
     worker supports a `WORKER_FAKE_GRAPH` seam (see Tests) OR builds the graph and relies on
     the gateway's existing dry-run (no real write) — but MCP spawn still needs servers. To
     keep the test fully offline, the worker accepts an injectable `run_report` fn (default =
     the real cron-style dispatch); tests pass a fake. (KISS: one optional param, no env
     magic.)
   - Build + run ONE report (mirror `cron._build_graph` dispatch); thread_id =
     `agent_thread_id(agent_id, kind, audience)`.
   - Append a B1 run-event to `agent_data_dir(agent_id)/runs.jsonl`.
   - Exit codes: `0` = delivered; `1` = ran but not delivered (or recoverable error);
     `2` = bad invocation / profile load failure (clean stderr, no traceback).
3. `src/runtime/run_event.py` — `append_run_event(data_dir, event: dict)` appends one JSON
   line to `data_dir/runs.jsonl` (create parent if needed). Event fields:
   `{ts, agent_id, kind, audience, status, cost_usd, delivered}`.

## Files to create

- `registry.yaml` (repo root):
  ```yaml
  # Agent registry — the coordinating service reads this to know which agents exist.
  # IDs only (no secrets); committed. Path for each = profiles/<id>/. enabled:false ⇒ skipped.
  agents:
    - id: default
      enabled: true
  ```
- `src/runtime/registry.py` — ~50 LOC.
  ```
  @dataclass(frozen=True)
  class RegistryEntry:
      id: str
      enabled: bool

  def load_registry(path: Path | None = None) -> tuple[RegistryEntry, ...]
  ```
  Default `path = REPO_ROOT / "registry.yaml"`. `yaml.safe_load`; validate `agents` is a list
  of mappings each with a non-empty `id`; `enabled` defaults `True` if absent. Raise a clear
  `RuntimeError` on a malformed file (missing `agents`, duplicate ids, blank id).
- `src/runtime/worker.py` — the entrypoint. Keep ≤ 200 LOC; if it nears the gate, extract the
  kind→graph dispatch into a tiny `_dispatch` helper (mirrors `cron._build_graph`). `main(argv)`
  + `if __name__ == "__main__": raise SystemExit(main())`.
- `src/runtime/run_event.py` — ~25 LOC (`append_run_event`).
- `tests/test_registry.py` — load/validate happy + malformed + `enabled` default + duplicate-id.
- `tests/test_worker.py` — the offline worker (acceptance 8) via an injected fake `run_report`.
- `tests/test_run_event.py` — one append → one parseable JSON line; two appends → two lines.

## Files to modify

- `.gitignore` — only if `registry.yaml` is caught by an existing rule (it should not be);
  otherwise NO change. Confirm with `git check-ignore registry.yaml` (must print nothing).
  `runs.jsonl` is under `.data/` ⇒ already ignored; no rule needed.

## Worker argv + exit-code contract

```
python -m src.runtime.worker --agent-id <id> --report <daily|weekly|okr|resource>
                             [--audience internal|external]   # default internal
                             [--dry-run]                       # no real write
```

| Exit | Meaning | runs.jsonl status |
|------|---------|-------------------|
| 0 | report delivered (or dry-run "delivered" = queued/printed) | `delivered` |
| 1 | ran but NOT delivered, OR recoverable runtime error | `not_delivered` / `error` |
| 2 | bad `--agent-id` / profile load failure / bad flag | `load_error` (best-effort; may be no file if data dir unknown) |

The service (Slice 3) collects the exit code AND reads the last `runs.jsonl` line, so both
the coarse signal (exit code) and the detail (cost/delivered) are available.

## Implementation steps

1. `run_event.py`: `append_run_event(data_dir, event)` → `data_dir.mkdir(parents=True,
   exist_ok=True)`; `with open(data_dir/"runs.jsonl","a") as f: f.write(json.dumps(event)+"\n")`.
   Add `ts` (UTC ISO) if absent.
2. `registry.py`: `load_registry` per the spec; frozen `RegistryEntry`.
3. `registry.yaml`: ship the `default` entry.
4. `worker.py`:
   - arg parse (mirror `cron._report_kind` / `_audience`; add `--agent-id` required,
     `--dry-run` flag).
   - `migrate_legacy_data_dir()`.
   - `data_dir = agent_data_dir(agent_id)`; `try: loaded = load_profile(agent_id,
     data_dir=data_dir) except (FileNotFoundError, RuntimeError) as exc: print(...stderr);
     return 2`.
   - `settings = loaded.settings` (its `data_dir` is already the per-agent dir);
     `if dry_run: settings = replace(settings, dry_run=True)` (frozen dataclass ⇒
     `dataclasses.replace`).
   - run the report via the injectable `run_report(loaded, settings, kind, audience,
     thread_id)` (default impl = the cron-style dispatch + `graph.invoke`).
   - build the event from the result (`delivered`, `cost_usd`, `delivery_summary`); `status`
     per the table; `append_run_event(data_dir, event)`.
   - return the exit code per the table.
5. Tests (below). Focused first, then full suite + ruff.

## Tests / validation

`tests/test_worker.py` (acceptance 8 — fully offline, no MCP/network):

- **happy dry-run:** a `tmp profiles/<id>/profile.yaml` (minimal, like P2's loader tests) +
  `monkeypatch` `agent_paths.DATA_DIR` to `tmp/.data`; call `worker.main(["--agent-id", id,
  "--report", "daily", "--dry-run"], run_report=<fake returning {"delivered": True,
  "cost_usd": 0.0, "delivery_summary": "dry"}>)`; assert exit `0` AND
  `tmp/.data/agents/<id>/runs.jsonl` has ONE line whose JSON has `agent_id==id, kind=="daily",
  audience=="internal", status=="delivered", delivered==True, cost_usd==0.0`.
- **not-delivered ⇒ exit 1:** fake returns `{"delivered": False, ...}` ⇒ exit `1`, run-event
  `status=="not_delivered"`.
- **bad agent-id ⇒ exit 2:** `--agent-id nope` (no profile) ⇒ exit `2`, clean stderr, no
  traceback (assert no exception escapes; capture stderr contains "not found").
- **thread_id is agent-prefixed:** assert the fake `run_report` received
  `thread_id == "<id>:daily:internal"`.
- **migration invoked once:** spy that `migrate_legacy_data_dir` is called at startup
  (monkeypatch a counter); a second `main` call still calls it but it is a no-op (target
  exists).

`tests/test_registry.py`:

- valid file → tuple of `RegistryEntry`; `enabled` defaults True when omitted.
- `enabled: false` preserved.
- malformed (no `agents` key / `agents` not a list / blank id / duplicate id) ⇒ `RuntimeError`
  with a clear message.

`tests/test_run_event.py`:

- one `append_run_event` → file has one line, `json.loads` round-trips the dict (+ a `ts`).
- two appends → two lines, order preserved.

Shell validation:
```
uv run pytest tests/test_worker.py tests/test_registry.py tests/test_run_event.py -q
git check-ignore registry.yaml        # MUST print nothing (committed)
git check-ignore .data/agents/default/runs.jsonl   # MUST print (ignored under .data/)
uv run ruff check src/runtime registry.yaml tests/test_worker.py tests/test_registry.py tests/test_run_event.py
uv run pytest -q   # full suite green
# Optional real smoke (needs key + profile): a true dry-run report through the worker
uv run python -m src.runtime.worker --agent-id default --report daily --dry-run
```

## Acceptance (slice)

- `python -m src.runtime.worker --agent-id default --report daily --dry-run` runs offline (via
  the test's fake `run_report`) → exit 0 + one `runs.jsonl` event with the documented fields.
- Bad `--agent-id` → exit 2, clean stderr, no traceback.
- `load_registry` parses `registry.yaml` → `(RegistryEntry(id="default", enabled=True),)`;
  malformed files raise a clear error.
- thread_id passed to the report is `<id>:<kind>:<audience>`; data dir is `.data/agents/<id>/`.
- `registry.yaml` committed; `runs.jsonl` ignored. All new `src/runtime/*` ≤ 200 LOC; ruff
  clean; full suite green.

## Risks / rollback

- **Risk: a real `python -m src.runtime.worker` subprocess in a test is slow/flaky/env-bound.**
  → Tests call `worker.main([...], run_report=<fake>)` IN-PROCESS with an injected fake — no
  subprocess, no MCP, no network. The real subprocess is exercised only by the optional manual
  smoke. The service-level spawn is tested in Slice 3 with a fake-spawn (no real worker).
- **Risk: `--dry-run` still tries to spawn MCP servers / needs a key.** → The default
  `run_report` builds the graph (which lazily spawns MCP only on a real read); for the offline
  test the fake `run_report` replaces the whole dispatch, so no MCP is touched. The manual
  smoke is the only path that hits real servers, and `--dry-run` blocks real writes via the
  gateway.
- **Risk: worker writes a run-event even on a hard crash → partial/missing line.** → Wrap the
  run in try/except; on an unexpected exception, best-effort append `status="error"` then
  return 1. A crash before the data dir is known (bad agent-id) has no file — exit 2 is the
  signal (service reads the exit code too).
- **Risk: `registry.yaml` accidentally gitignored.** → `git check-ignore registry.yaml` must
  print nothing; add an explicit `!registry.yaml` only if a broad rule catches it.
- **Rollback:** delete `src/runtime/{worker,registry,run_event}.py`, `registry.yaml`, the 3
  test files. Zero impact on Slice 1 or on `cli.py`/`cron.py` (untouched). The worker is purely
  additive.
