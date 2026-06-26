# Slice 1 (v2 M1-P3) — Per-Agent Isolation Core — Code Review

**Reviewer:** code-reviewer · **Date:** 2026-06-24
**Scope:** uncommitted working-tree changes (registry+worker Slice 1)
**Verdict:** DONE_WITH_CONCERNS — implementation is correct and well-tested; two deferred-design items flagged (one input-validation gap is the headline concern).

---

## Scope

- **New:** `src/runtime/__init__.py` (6), `src/runtime/agent_paths.py` (35), `src/runtime/legacy_migration.py` (47) — 88 LOC total, all <200.
- **Modified (src):** `src/profile/loader.py` (+kwarg), `src/entrypoints/cli.py` (+thread_id), `src/entrypoints/cron.py` (+thread_id).
- **Tests:** new `tests/test_agent_isolation.py` (8 tests), `tests/test_legacy_migration.py` (4 tests); 3 existing fakes updated (`test_okr_report.py`, `test_profile_entrypoints.py`, `test_resource_report.py`) to add `profile_id`.
- **Validation run:** focused 11 passed; full suite **328 passed in 0.51s**; **ruff clean**; gitignore covers `.data/agents/`.

## Overall Assessment

High quality. The isolation tests have **real discriminating power** (not vacuous), the `data_dir` override is byte-identical on the default path, the migration is correctly **not** wired into the single-agent CLI, and no forbidden file was touched. Two items are deferred-by-design and need an explicit accept decision, not a code fix in this slice.

---

## Acceptance Verification (all 5 PASS)

### 1. Isolation matrix is REAL, not mocked-away — PASS

Every row genuinely exercises separate stores via two real `build_settings_from_dict` at two distinct tmp dirs (`tests/test_agent_isolation.py:18-32`). Verified discriminating power against the actual store code:

- **(a) separate dirs** (`:45-53`): asserts `ga._audit.path` starts with `tmp/a`, `gb` with `tmp/b`, budget dirs disjoint. Matches `ActionGateway.__init__` (`action_gateway.py:124-127`) and `BudgetTracker` (`budget_tracker.py:39`).
- **(b) audit no-mix** (`:59-68`): writes A's `C_A` line to `tmp/a/audit/audit.jsonl`, asserts B's file absent OR lacks `C_A`. Real I/O, real file read.
- **(c) dedup no-mix** (`:74-82`): A's 2nd identical action → `deduplicated`; the SAME action through B → `executed`. **Would fail if dedup.db were shared** (B would see A's claim). Backed by `DedupStore(data_dir/"dedup.db")`.
- **(d) budget A-over-cap** (`:88-96`): `ta.record_cost(0.02)` persists cumulative `total_usd` to `tmp/a/budget/budget-<month>.json`; A raises `BudgetExceededError`; B reads `tmp/b/budget/` → 0.0 → admitted. Verified against `budget_tracker.py:44-54,65-87`: B's freshness is a genuine file-absence read, not a stub.
- **(e) approval no-mix** (`:102-109`): external-channel post → `pending_approval`; A's `ApprovalStore` has 1 pending, B's has 0. Backed by `ApprovalStore(data_dir/"approvals.db")`.
- **(f) thread_id no-collision** (`:115-126`): distinct ids, each contains its agent_id.

These assertions would FAIL under a shared dir → non-vacuous.

### 2. `data_dir` override byte-identical on default path — PASS

`loader.py:93`: `resolved_data_dir = data_dir if data_dir is not None else DATA_DIR`, forwarded to `build_settings_dict(yaml_doc, resolved_data_dir)`. Confirmed `build_settings_dict` (`loader_mapping.py:73`) writes `out = {"data_dir": data_dir}` as the ONLY field derived from the argument — every other field comes from `yaml_doc`. `loader_mapping.py` is **UNMODIFIED** (git-verified). Default path ⇒ `data_dir == DATA_DIR`, P2-identical. Override path ⇒ `data_dir == X`, nothing else touched.

### 3. `migrate_legacy_data_dir` is SAFE — PASS (with one known limitation, see Special Scrutiny)

- **(a) idempotent**: `target_root.exists()` guard returns False (`legacy_migration.py:36-37`). Test `test_second_call_is_noop`.
- **(b) allowlisted**: only `_LEGACY_STORES = (audit, budget, checkpoints.db, dedup.db, approvals.db)` iterated (`:23,39,44`). `foo.txt` untouched — `test_full_move:39-40`.
- **(c) never touches `.data/agents/`**: only `DATA_DIR/<name>` for the 5 names is moved.
- **(d) fresh-install no-op**: `legacy_present` empty → return False, no empty dir created (`:39-41`). `test_fresh_install_is_noop:60-61`.
- **(e) existing-target not clobbered**: guard returns early; legacy copy left at top level. `test_existing_target_not_clobbered:75-79` asserts both the `EXISTING` target and the top-level `dedup` are preserved.
- **same-fs rename**: `.data` is on `/dev/disk3s5` (single fs) ⇒ `shutil.move` is `os.rename` (atomic). Documented at `:45`.
- **NOT called from cli.py/cron.py**: grep confirms zero call sites outside `src/runtime/` + tests. Correct — a plain `cli report` never moves a single-agent user's data.

### 4. thread_id change is BREAKING but contained — PASS

- No production code still emits the flat `report-*`/`cron-*` id (the one grep hit, `approval_store.py:6`, is a doc-comment, not a thread_id).
- No test pins a flat literal (grep clean).
- Orphaned v1 checkpoint threads (`report-daily-internal`) are simply not resumed — LangGraph starts a fresh thread under `default:daily:internal`; no crash, no data loss (the old rows are stranded in checkpoints.db, harmless).
- Hello path keeps `"cli"` (`cli.py:69`, unchanged) — intentional, Phase-0 echo with no agent.

### 5. Suite + LOC + untouched-files — PASS

- Full suite **328 passed**; ruff clean.
- `src/runtime/*` = 88 LOC total (6/35/47), all <200.
- `git diff --name-only` touches NONE of: `src/actions/`, `src/llm/`, `src/agent/checkpoint.py`, `loader_mapping.py`. Isolation falls out of `data_dir` as designed.

---

## Special Scrutiny — Two Judgments

### A. Path traversal on raw `agent_id` — HIGH (the one to act on)

`agent_data_dir(agent_id)` (`agent_paths.py:25`) does `DATA_DIR / "agents" / agent_id` with **no validation**. Demonstrated live:

```
agent_data_dir('/etc/passwd')     -> /etc/passwd          # absolute id discards the prefix
agent_data_dir('../../../tmp/evil') -> .../workspace/tmp/evil  # ../ escapes the .data/agents jail
```

`Path` `/`-join semantics mean an absolute or `..`-laden id escapes the per-agent jail entirely. An agent pointed at `/etc/...` or another agent's dir breaks the **isolation invariant this slice exists to provide** — and per the guardrail red-line contract, isolation is a security boundary, not just hygiene.

**Judgment:** A one-line guard belongs here, in the helper that constructs the path, NOT solely in Slice 2's registry. Rationale: the helper is the choke point; deferring trust to "the registry is the only caller" is exactly the trust-boundary assumption that breaks when a second caller appears (worker, test, future CLI `--agent` flag). Recommend validating `agent_id` against `^[a-z0-9][a-z0-9_-]*$` (or rejecting `/`, `..`, leading `.`, absolute) and raising `ValueError` on violation. ~3 lines, no new abstraction. If the team insists on deferring, it must be an explicit, written accept with the registry made the *enforced* sole supplier — but defer is the weaker choice given isolation is the security boundary.

### B. Interrupted-migration stranding via `target_root.exists()` guard — LOW (accept as known limitation)

Sequence: first migration moves *some* stores, crashes (or is killed) after `mkdir` + a partial move. `target_root` now exists with only some stores; the rest sit at top level. Next call hits the `exists()` guard → returns False → the **remaining top-level stores are never migrated** (stranded under `.data/`, not under the agent dir). The `default` agent then wouldn't see its old audit/dedup for the un-moved stores.

**Judgment: acceptable for M1, flag as known limitation.**
- **No data loss** — stranded stores still exist at top level, fully readable; this is a *visibility* gap (the default agent reads `.data/agents/default/`, so it'd start fresh stores for the un-moved ones), not destruction.
- **Crash window is microseconds** — 5 same-fs renames (no copy). Realistic only on hard kill / disk-full mid-loop.
- **Per-store move WITHOUT the early-return guard is NOT safer overall.** It would fix stranding but reintroduce a **clobber risk**: if `.data/agents/default/dedup.db` already holds real v2 data and a stale legacy `dedup.db` lingers at top level, a per-store "move if target absent" is fine, but a per-store "move always" would overwrite live data. The current design's per-store target-absent check (`:44`, currently gated behind the early return) is the right primitive; the safest evolution is to **drop the early `exists()` return and rely solely on the per-store target-absent check** — that resumes a partial migration AND never clobbers. That is a strictly better design, but it changes idempotency semantics (the function would re-scan top-level every call) and is **out of scope for Slice 1**. Recommend tracking it for Slice 2 hardening, not blocking here.

Net: the early-return is a reasonable M1 simplification; document the stranding window in the migration docstring or Slice 2 notes.

---

## Minor Observations (non-blocking)

- `test_audit_does_not_mix` (`:59-68`) only drives agent A and asserts B's file absent-or-clean; it never writes through B. Slightly weaker than (c)/(e) which write both sides. Not wrong (absence is a valid isolation proof), but a B-side write + cross-check would match the rigor of the other rows. Optional.
- `agent_thread_id` omits the date by design (`agent_paths.py:31-34`) — one stable thread per (agent,kind,audience). Correct for bounded checkpoint rows + resume; noting it as an intentional behavior change so downstream resume logic isn't surprised.

---

## Metrics

- Type coverage: full (frozen dataclasses, `Path | None` kwarg typed, `__future__ annotations`).
- Test: 12 new tests, all real I/O; full suite 328 passed.
- Lint: 0 issues (ruff, line-length 100).
- Runtime LOC: 88 / 200 budget.

## Unresolved Questions

1. **Path-traversal guard (A)** — add the `agent_id` validation in `agent_paths.py` now, or accept the deferral to Slice 2's registry as the enforced sole supplier? Recommend: add now (~3 lines).
2. **Migration stranding (B)** — accept the `exists()`-guard limitation for M1 (recommended), or pull the per-store-only redesign forward? Recommend: accept + note in docstring; track redesign for Slice 2.
