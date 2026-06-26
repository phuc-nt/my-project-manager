# Code Review — Slice 2 (v2 M1-P3): registry.yaml + worker subprocess + B1 run-event log

Date: 2026-06-24 · Reviewer: code-reviewer · Scope: uncommitted working-tree changes

## Scope
- New: `registry.yaml`, `src/runtime/registry.py` (55), `src/runtime/worker.py` (146), `src/runtime/run_event.py` (27)
- Modified: `src/runtime/__init__.py` (exports only)
- New tests: `test_registry.py`, `test_worker.py`, `test_run_event.py`
- LOC: all `src/runtime/*` <200 (worker fattest at 146). Net new src ~228 LOC.
- Focus: recent (working tree). No subprocess/network in tests — fully offline.

## Overall Assessment
Solid, well-scoped slice. The exit-code/run-event contract is correct and fully covered offline.
Per-agent isolation is genuinely exercised (thread_id + data_dir reach the report). Migration
wiring is unconditional-but-idempotent and safe. Full suite 355 passed; ruff clean on Python.
Two judgment calls flagged below — one is a real correctness gap worse than the task brief stated
(boolean-true ids are silently accepted, not just rejected), the other a known interim UX trap.

## Acceptance Verification (1–6)

1. **Worker offline + exit/event contract — PASS.** `test_worker.py` injects a fake `run_report`,
   no MCP/network. Exit map verified: 0=delivered (`test_happy_dry_run`), 1=not-delivered
   (`test_not_delivered`) AND run_report raised (`test_run_report_raising_exit_1_with_error_event`,
   status="error"), 2=missing id (`test_missing_agent_id`), bad/unknown id (`test_bad_agent_id`),
   malformed id (`test_malformed_agent_id`). Broad `except Exception` at worker.py:121 records
   status=error + returns 1, never lets a traceback escape (verified by reading the handler; the
   `# noqa: BLE001` is intentional and correct here). Run-event fields written on every terminal
   path: load_error (worker.py:111), error (worker.py:123), delivered/not_delivered (worker.py:130).

2. **Per-agent isolation actually used — PASS.** worker.py:99 `agent_data_dir(agent_id)`, :108
   `load_profile(agent_id, data_dir=data_dir)`, :118 `agent_thread_id(...)`. Test asserts
   `seen["thread_id"]=="default:daily:internal"` and `data_dir` endswith `agents/default`
   (test_worker.py:42-43). **Malformed-id ordering is correct and load-bearing:** `agent_data_dir`
   raises `ValueError` (Slice 1 guard, agent_paths.py:27) → caught at worker.py:100 → exit 2
   **BEFORE `migrate_legacy_data_dir()` (:105) and before any `append_run_event`** → no run-event,
   no file write for an unsafe id. Confirmed by reading control flow: the ValueError catch is the
   first thing after arg parse, ahead of every side effect.

3. **registry.py validation — PASS with a correctness flag (see HIGH-1).** Rejects missing
   `agents` / not-a-list (registry.py:42), blank id (:48), duplicate (:51); `FileNotFoundError`
   on missing file (:37); `enabled` defaults True (:54). All covered by tests. The boolean-id
   edge is worse than the brief described — see HIGH-1.

4. **registry.yaml committable, runs.jsonl ignored — PASS.** `git check-ignore registry.yaml` →
   nothing (rc=1, committable). `git check-ignore .data/agents/default/runs.jsonl` → printed
   (rc=0, ignored under `.data/`). `registry.yaml` holds only ids + enabled flags, no secrets.

5. **Migration wiring — PASS, verified live.** `migrate_legacy_data_dir()` called unconditionally
   at worker.py:105; idempotency guard is target-dir existence (legacy_migration.py:39), so safe
   every run. Confirmed live working-tree state: top-level `.data/` now holds only `agents/`;
   `.data/agents/default/` holds all 5 v1 stores (audit, budget, checkpoints.db, dedup.db,
   approvals.db) + `runs.jsonl`. Migration is real, intended, and one-way — dev's `.data/` is
   restructured as expected. The live `runs.jsonl` smoke event has all 7 documented fields in
   order with real `cost_usd=0.00142101, delivered=true` — proves the real graph path works too.

6. **Suite + lint + LOC + scope — PASS.** 355 passed; `ruff check` on the Python files = all clean
   (the plan's literal `ruff check ... registry.yaml` errors are a non-issue: ruff lints Python,
   not YAML — drop `registry.yaml` from that command). All `src/runtime/*` <200. `git diff
   --stat` = only `src/runtime/__init__.py`; `cli.py`/`cron.py` untouched in this slice.

## Critical Issues
None.

## High Priority

**HIGH-1 — Boolean-ish YAML ids: true-ish are SILENTLY ACCEPTED as id "True" (worse than brief).**
File: `src/runtime/registry.py:48,50`. YAML 1.1 (PyYAML `safe_load`) parses `on/yes/true` → `True`
and `off/no/false` → `False`. The brief flagged only the False case. Reproduced live:

```
id: off   -> False -> str(False or "")=""    -> REJECTED ("non-empty id"); operator SEES a string  → confusing error
id: on    -> True  -> str(True or "")="True" -> ACCEPTED as agent id "True"                          → silent miscoercion
id: yes   -> True  -> "True" -> ACCEPTED as "True"
id: true  -> True  -> "True" -> ACCEPTED as "True"
```

The False-ish branch gives a confusing-but-safe error. The **True-ish branch is the real defect**:
an operator writing `- id: on` silently gets an agent whose id is the literal string `"True"` — it
will `load_profile("True")` from `profiles/True/`, write to `.data/agents/True/`, and the registry
will not warn. This is a silent wrong-agent / typo-swallow, not just a confusing message.

Severity: HIGH (silent data-routing to an unintended id; passes all current tests because no test
uses a boolean-ish id). Likelihood LOW (ids are operator-authored, `default` is the only shipped
id), but the failure is silent and the fix is cheap.

Recommendation: type-check the raw id before stringifying. Reject any non-`str` id with a message
that names the YAML-boolean trap, e.g.:
```python
rid = raw.get("id")
if not isinstance(rid, str) or not rid.strip():
    raise RuntimeError(
        f"{registry_path}: each agent needs a non-empty string 'id'; got {rid!r}. "
        "Quote YAML-reserved words: write `id: \"on\"` not `id: on`."
    )
```
This turns both the silently-accepted `on/yes/true` and the confusingly-rejected `off/no/false`
into one clear, actionable error. (Add a test: `id: on` and `id: off` both raise with the quote hint.)

## Medium Priority

**MED-1 — cli/cron go stale after the worker migrates (the interim-state trap).** This is the
special-scrutiny concern; judgment: **acceptable as a documented P3→P4 interim state, but it MUST
be documented before P3 ships, and a one-line operator warning would materially reduce the foot-gun.**

Verified: `cli.py:45` calls `load_profile(_parse_profile(args))` with **no `data_dir=`** → loader
defaults to global `DATA_DIR`. `cli.py:223` reads `settings.data_dir / "audit" / "audit.jsonl"`
and `:164` builds the gateway from the global-data-dir settings. After the worker runs once and
moves audit/approvals into `.data/agents/default/`, the top-level `.data/audit/` no longer exists,
so `cli audit` / `cli approvals` read an empty/absent path and report "no entries" — the migrated
data is invisible to the single-agent CLI. cron.py has the same blind spot (it loads with the
global data dir too; only the *worker* uses the per-agent dir).

Why acceptable: the migration is intentional and one-way; P4's `mpm agent` CLI is the unification
point; this is a UX/operability concern, not a correctness bug (no data is lost — it is one level
down). Why it still needs action in P3: the failure mode ("ran the worker once, now my CLI shows
nothing") is silent and will surprise an operator badly — exactly the kind of thing that generates
a false "data loss" bug report.

Recommendation (cheapest first, pick one):
- (a) Doc-only: note the one-way migration + CLI-staleness in the P3 phase notes / deployment doc.
  Minimum bar to ship.
- (b) Warn: in `cli.py` audit/approvals paths, if the global store is empty but
  `.data/agents/default/audit/` exists, print "data migrated to per-agent store; use the agent
  worker / P4 CLI". ~5 lines, no behavior change.
- (c) (NOT recommended for P3) make cli read `.data/agents/default/` — that re-entangles the
  single-agent CLI with the per-agent layout and pre-empts P4's design. Scope creep.

I recommend (a) as the floor, (b) if the operator-surprise risk is judged real for the P3 window.

**MED-2 — Worker omits cron's `openrouter_api_key` preflight; degrades from clean exit to error
event.** cron.py:97-99 checks `if not settings.openrouter_api_key` and returns 1 with a specific
message *before* `graph.invoke`. The worker's `_default_run_report` (worker.py:51-78) has no such
preflight, so a missing key surfaces later as `settings.api_key` raising `RuntimeError` at the LLM
request (settings.py:53), which the worker's broad except catches → status="error", exit 1, clean
stderr. **Not a correctness bug** (no traceback, exit code still 1, event still written) — but the
run-event records `status="error"` for what is really a config/precondition miss, muddying the B1
log the service reads in Slice 3. Severity LOW-MED.
Recommendation: optional — add the same preflight in `_default_run_report` returning a
`{"delivered": False, ...}` or a distinct status, OR accept the divergence and note that a missing
key shows as status=error in B1. Cheap to align; not blocking.

## Low Priority

**LOW-1 — `--report` accepts any string; unknown kinds silently run as daily.** `_report_kind`
(worker.py:43) defaults to "daily" and does not validate; `_default_run_report` routes only
`resource`/`okr` explicitly, everything else → `build_report_graph(report_kind=kind)`, which only
special-cases `weekly` and otherwise falls back to daily framing (`REPORT_TITLES.get(kind,
'Báo cáo')`). So `--report bogus` silently runs a daily report. Matches cron.py's existing
looseness — consistent, not a Slice-2 regression. Optional: validate `kind in {daily,weekly,okr,
resource}` → exit 2 on bad flag.

**LOW-2 — `_event` helper is untyped positional.** worker.py:138 `_event(agent_id, kind, ...)`
has no annotations and is positional-only by convention; a future caller could swap `cost`/
`delivered`. Trivial; add type hints or keyword-only if touched.

## Edge Cases Found / Verified
- Malformed id (`../escape`) caught before any side effect → exit 2, no run-event. (verified)
- run_report raising → error event + exit 1, no traceback escape. (verified)
- Missing `--agent-id` → exit 2, usage on stderr, no data dir touched. (verified)
- load_error path writes a run-event to a *known-safe* data dir (id passed the regex but profile
  missing) — correct: the dir is safe, so recording is fine. (verified)
- Migration idempotency: second worker run no-ops (target exists). Stranded-store window on
  interrupted first run is documented + accepted in legacy_migration.py. (verified)
- Boolean-ish ids: `on/yes/true` accepted as "True" (HIGH-1); `off/no/false` rejected. (reproduced)

## Positive Observations (risk-calibration only)
- The ValueError-before-side-effect ordering is the single most important correctness property of
  the worker and it is right — no run-event/file write for an unsafe id.
- The broad `except Exception` is correctly scoped (records + returns, never swallows-and-continues)
  and the `# noqa: BLE001` is justified, not lint-dodging.
- Tests prove behavior (exact thread_id, exact data_dir suffix, exact status strings, file
  contents), not just execution — no phantom coverage.

## Recommended Actions (prioritized)
1. HIGH-1: reject non-string YAML ids with a quote-the-reserved-word message; add a test for
   `id: on` and `id: off`. (real silent-miscoercion fix, cheap)
2. MED-1: document the one-way migration + CLI-staleness in P3 notes (floor); consider the cli
   warning (option b) if operator surprise is judged likely.
3. MED-2: decide — align the worker's missing-key preflight with cron, or document that a missing
   key surfaces as B1 status=error.
4. LOW-1/LOW-2: optional polish, defer.
5. Drop `registry.yaml` from the ruff command in the phase doc (ruff can't parse YAML).

## Metrics
- Type coverage: high (frozen dataclasses, annotated public fns; `_event` untyped — LOW-2).
- Test coverage: 18 new tests, all terminal paths + registry validation branches + run-event
  append/order/parent-create covered. Full suite 355 passed.
- Linting: ruff clean on all Python files (0 issues). The 5 "errors" in the plan's command are
  ruff mis-parsing registry.yaml as Python — not real.

## Unresolved Questions
1. HIGH-1 boolean-id: do you want a hard reject with a quote-hint (recommended), or quietly coerce
   `on/yes/true`/etc. to their string forms? Reject is safer; coercion is surprising.
2. MED-1 cli-stale: doc-only (a) sufficient for P3, or add the cli warning (b)? Depends on how soon
   P4's unified CLI lands and whether any operator will run the worker before then.
