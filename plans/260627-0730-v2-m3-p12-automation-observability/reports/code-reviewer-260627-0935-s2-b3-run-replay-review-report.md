# Code Review — v2 M3-P12 Slice S2 (B3 run replay / time-travel)

Date: 2026-06-27
Reviewer: code-reviewer
Scope: `mpm agent replay` — list checkpoint history / replay-from-frozen-checkpoint.
Diff base: working tree vs HEAD `e8c3e58` (S1). NOTE: S2 is NOT yet committed — all reviewed code is in the working tree.

## Scope
- Files:
  - `src/runtime/replay.py` (NEW, 78 LOC)
  - `src/entrypoints/mpm_replay_cmd.py` (NEW, 89 LOC — task said 88; off by one)
  - `src/entrypoints/mpm.py` (replay dispatch + usage)
  - `tests/test_replay.py` (NEW, 5 tests — task said 6)
  - `tests/test_mpm_replay_cmd.py` (NEW, 6 tests — task said 7)
- Focus: re-fetch safety, gateway-bypass invariant, PII in listing, error handling, checkpointer lifetime.
- Verification: full suite `727 passed`; `ruff check` clean; both new files <200 LOC; langgraph 1.2.6 / checkpoint 4.1.1 confirmed; StateSnapshot shape verified empirically.

## Overall Assessment
The two **stated** safety properties HOLD and are well-implemented. Replay does NOT re-fetch live data, and it opens NO gateway bypass. However, empirical testing surfaced a **real correctness/robustness defect not covered by the tests**: replay from a checkpoint that sits *between perceive and compose* recomputes the report from an EMPTY in-memory `box` closure (fetched Issues/PRs/CI/snapshot/rollup are NOT in checkpointed state). Depending on the graph this yields either a **silently degenerate report** (report graph) or an **uncaught `KeyError` traceback** (resource + okr graphs) — the latter violates the "no crash/traceback to the user" acceptance criterion. The listing tool already exposes these unsafe checkpoints (their `next` is `analyze`/`compose`) and nothing steers the operator away from them.

---

## CRITICAL
None. The two red-line invariants this slice exists to protect are intact (see explicit confirmation at the end).

## HIGH

### H1 — Replay from a mid-pipeline checkpoint recomputes from an EMPTY `box` → degenerate report or uncaught `KeyError`
**Files:** `src/agent/report_graph.py:225-246`, `src/agent/resource_report_graph.py:184-198`, `src/agent/okr_report_graph.py:170-183` (the failure surfaces through `src/runtime/replay.py:78` `replay_from_checkpoint`).

All three report graphs keep the heavy fetched objects in a **closure-local `box` dict that is NOT checkpointed** — only primitive summaries reach graph state. `perceive` is the only writer of `box`. Replay (`invoke(None, checkpoint_id=X)`) runs the nodes in `X.next` onward *without re-running perceive* (that is exactly the desired no-refetch property), so on a fresh CLI process the `box` is empty when `analyze`/`compose` run.

Empirically reproduced (mirroring the report-graph pattern):
```
--- REPLAY from post-perceive checkpoint (box cleared, like fresh process) ---
perceive re-called during replay: 0          # good: no re-fetch
RESULT report_text: report-from-['risk-from-EMPTY-BOX']   # bad: garbage report
```

Per-graph behavior of a replay whose `next` is `analyze` or `compose`:
- **report_graph** — `analyze_node`/`compose_report` use `box.get(...)` (`:238`, `:245`) → empty risks → **silently degenerate report** composed and (if it reaches deliver) posted/dedup-checked. No crash, but a wrong report.
- **resource_report_graph** — `analyze_node` `:191` and `compose_report` `:196` use `box["snapshot"]` (direct index) → **`KeyError`**.
- **okr_report_graph** — `compose_report` `:182` uses `box["rollup"]` (direct index) → **`KeyError`**; `analyze_node` `:177` uses `.get` → passes `None` into `_problems_to_dicts`.

Why this is HIGH not CRITICAL: it does not violate the gateway/no-refetch red lines and does not corrupt persisted state. But (a) a `KeyError` propagates out of `replay_from_checkpoint` uncaught — `_do_replay` only catches `(ValueError, RuntimeError)` (`mpm_replay_cmd.py:60`), so the operator gets a raw traceback, breaking the "error cleanly" acceptance criterion; and (b) a silently wrong report from the report graph is a quiet-failure footgun.

**Only checkpoints whose `next` is `deliver` (or `END`/`remember`) are safe to replay**, because `deliver` reads ONLY state (`report_text`, `slack_short`) — confirmed at `report_graph.py:252-255`, `resource_report_graph.py:202-206`, `okr_report_graph.py:188-191`. A post-compose checkpoint replays faithfully and is gateway-safe.

**Fix options (pick one, smallest first):**
1. **Guard the replay target** in `replay_from_checkpoint`: look up the chosen snapshot and reject (clean `ValueError`) any checkpoint whose `next` is not in a safe set (`{"deliver"}` plus terminal). Message: "checkpoint <id> is mid-pipeline (next=analyze); only post-compose checkpoints can be replayed without re-fetch." This is KISS, keeps the no-refetch guarantee, and converts the KeyError/garbage into a clean error.
2. **Annotate the listing**: mark each entry `replayable: bool` (true only when `next` ⊆ safe set) and have `_print_history` flag/hint unsafe rows, so the operator never picks one. Pairs well with option 1.
3. (Heavier, explicitly deferred by the plan) checkpoint the fetched payload — do NOT do this now; it grows checkpoint rows and re-fetch/time-travel is out of scope.

Recommend option 1 (+ optionally 2). At minimum, broaden the `except` in `_do_replay` to also catch `KeyError`/`Exception` → clean exit 1 so no traceback leaks, but that only masks the symptom; the report graph's silent-garbage path still needs the `next`-guard.

## MEDIUM

### M1 — `--checkpoint` with no value silently LISTS instead of erroring
**File:** `src/entrypoints/mpm_replay_cmd.py:38,57` via `mpm.py:30-36` `_flag_value`.

`mpm agent replay acme <thread> --checkpoint` (operator forgot the id) → `_flag_value` returns `None` → falls into the LIST branch and prints history with exit 0. The operator asked to replay and silently got a listing. Low blast radius (read-only), but it masks a typo. Consider: if `--checkpoint` is present in argv but has no following value, print usage + return 2 (distinguish "flag absent" from "flag present, value missing"). `--checkpoint ""` is already handled correctly (clean `ValueError` → exit 1).

### M2 — Acceptance criterion "missing-thread ⇒ exit 2" is not met (benign divergence)
**File:** `src/runtime/replay.py:39` + `mpm_replay_cmd.py:65-69`.

A missing/unknown thread id yields an **empty** `get_state_history` (verified empirically), so `_print_history` prints `"<thread>: no checkpoints found."` and returns **exit 0** — not the exit 2 the task brief implies. This is arguably the *better* behavior (an unknown thread is indistinguishable from a known-but-empty one at the checkpointer level, and "no checkpoints" is truthful), but it does not match the stated acceptance text. Flag for the lead to confirm intent: either accept exit 0 + message (recommended) or update the acceptance criterion. No code defect.

## LOW

### L1 — `replay_from_checkpoint` runs `get_state_history` twice on the replay path
**File:** `src/runtime/replay.py:72` then `:78`. The validation pass iterates full history to build the `known` set, then `invoke` re-scans internally to locate the checkpoint. For SQLite/local this is negligible; for the Postgres opt-in with deep histories it is a second full history scan per replay. Acceptable for now (KISS, correctness-first) — note only.

### L2 — Test count / LOC drift vs brief
`test_replay.py` has 5 tests (brief said 6), `test_mpm_replay_cmd.py` has 6 (brief said 7), `mpm_replay_cmd.py` is 89 LOC (brief said 88). Immaterial, but the brief's numbers are slightly off — mention so the plan/journal records the real counts.

### L3 — No test exercises the mid-pipeline replay failure (H1)
Both `test_replay_from_checkpoint*` pick a post-perceive checkpoint whose `next` is `["work"]` in a 2-node toy graph where `work` reads only state — so the box-closure trap that the real 4-node graphs have is structurally absent from the fixtures. The tests PROVE no-refetch (meaningful: the seeded `perceive` would re-run on a fresh `invoke`, and asserting 0 calls is a real proof) but do NOT prove a replayed report is *faithful*. Add a fixture whose `analyze`/`compose` read a non-checkpointed closure to lock in the H1 fix.

---

## Critical-check results (as requested)

1. **No re-fetch (H×H risk):** CONFIRMED. `replay_from_checkpoint` invokes `graph.invoke(None, config=_thread_config(thread_id, checkpoint_id))` (`replay.py:78`) — `input=None` + checkpoint-pinned config resumes frozen state; perceive/fetch is not re-run. Empirically: `perceive re-called during replay: 0`. The test is a meaningful proof (seeded perceive would re-run on a fresh invoke; the chosen checkpoint is post-perceive). **Caveat:** a checkpoint BEFORE perceive (`next=["perceive"]`, step 0) WOULD re-run perceive and re-fetch live data. The code does not block replaying step-0/pre-perceive checkpoints, and that re-fetch is NOT documented as acceptable. This is the inverse face of H1 — recommend the same `next`-guard (only post-compose checkpoints replayable) which also closes the pre-perceive re-fetch hole.
2. **No new write path / gateway bypass:** CONFIRMED. `replay.py` imports only `parse_thread_id` + `typing.Any`; it calls only `graph.get_state_history` and `graph.invoke` — no `actions/*`, no gateway, no dispatch, no execute. Any write a replay reaches goes through the SAME compiled `deliver` → `deps.deliver` → `ActionGateway` chain (Lớp A/B + dedup) as the original run. No new authority.
3. **Replay reaching deliver — double-post risk:** CONFIRMED gateway-safe. `deliver` routes through the gateway; same-day re-post hits the dedup key (`{kind}-{today}` / `{kind}-external-{today}`, `audience_delivery.py:46`) → `deduplicated` no-op. External audience: `approved` is true ONLY when the replayed state already carries `approval_decision == "approve"`; otherwise the gateway re-enters Lớp B (enqueue, not auto-write) — `report_graph.py:253`, `action_gateway.py:201-204`. Even the approved path keeps Lớp A hard-deny + dedup (`action_gateway.py:161-179`). No double-delivery outside the gateway.
4. **PII in the listing:** CONFIRMED structural-only. `list_checkpoints` reads `snap.config.configurable.checkpoint_id`, `snap.metadata.step/source`, `snap.next`, `snap.created_at` — never `snap.values` (which holds `report_text`). Test asserts no `SECRET`/`report_text` in the blob and exact key set. Good.
5. **Error handling:** PARTIAL. unknown agent → clean exit 1; unknown checkpoint_id → `ValueError` → exit 1; empty checkpoint_id → `ValueError` → exit 1; malformed thread id → `parse_thread_id` `ValueError` → exit 1 (all verified). GAP: a mid-pipeline replay of the resource/okr graphs raises **`KeyError`** (H1), which `_do_replay`'s `except (ValueError, RuntimeError)` does NOT catch → uncaught traceback. Also "missing-thread ⇒ exit 2" is actually exit 0 (M2).
6. **Checkpointer lifetime:** CONFIRMED single-open. In-process path builds the graph once via `_default_build_graph` → `build_graph_for` → `get_checkpointer` (one open SQLite/PG connection, process-lifetime by design, `checkpoint.py:31-47`). No double-open, no per-call connection. In-process is correct for read-mostly replay (vs the subprocess resume uses, which must isolate a live external post). No leaked connection in the production path. (Tests close their own tmp conn in the fixture teardown.)

## API-usage / compat
`get_state_history` + checkpoint-pinned `invoke` match langgraph 1.2.6. Verified empirically: `snap.config` is always a `dict` (safe `.get`), `snap.metadata` is a dict and the code defends None via `meta = snap.metadata or {}` (`replay.py:42`), `snap.created_at` present, `snap.next` is a tuple (wrapped with `list(... or ())`). Unknown thread → empty history (no raise). All good.

---

## EXPLICIT VERDICT ON THE RED LINE
**CONFIRMED: replay does NOT re-fetch live data (frozen-state, input=None, checkpoint-pinned) and opens NO gateway bypass (no new write path; every write re-enters the same Action Gateway Lớp A/B + dedup chain).**

The defects found (H1/M1/M2) are *robustness and correctness-of-output* issues on mid-pipeline / pre-perceive checkpoints — they do not breach either red line, but H1 can (a) leak a raw traceback and (b) replay a silently-wrong report, and the pre-perceive case (check #1 caveat) can re-fetch. All three are closed by one small guard: restrict replayable checkpoints to the post-compose/deliver set.

## Recommended Actions (prioritized)
1. **H1 + check#1 caveat:** in `replay_from_checkpoint`, resolve the target snapshot and reject any checkpoint whose `next` is not the safe set (`deliver` / terminal) with a clean `ValueError`. Optionally annotate `list_checkpoints` entries with `replayable`. (One fix closes the KeyError, the silent-garbage report, AND the pre-perceive re-fetch.)
2. **L3:** add a replay test with a closure-backed (non-checkpointed) analyze/compose to lock in the guard.
3. **M1:** treat `--checkpoint` present-but-valueless as a usage error (exit 2).
4. **M2:** confirm with lead whether missing-thread exit 0 is acceptable; update acceptance text or behavior accordingly.

## Metrics
- Tests: 727 passed (full suite); 11 new (5 + 6).
- Lint: 0 issues (ruff). Type: no mypy/pyright configured in repo.
- LOC: replay.py 78, mpm_replay_cmd.py 89 (both <200).

## Unresolved Questions
1. Is replaying a **pre-compose** checkpoint an intended use case at all? If replay is only ever meant to re-deliver a finished report, the `next`-guard (option 1) is strictly correct and loses nothing. If operators are expected to replay from `analyze` to re-derive risks, the box must be checkpointed (deferred scope) — needs a product decision.
2. Acceptance text says missing-thread ⇒ exit 2; implementation gives exit 0 ("no checkpoints found"). Which is the intended contract?

---
Status: DONE_WITH_CONCERNS
Summary: Both red lines (no re-fetch, no gateway bypass) CONFIRMED intact; found one HIGH robustness defect — replay of a mid-pipeline (or pre-perceive) checkpoint recomputes from an un-checkpointed empty `box`, yielding an uncaught KeyError (resource/okr graphs) or a silently degenerate report (report graph), plus a pre-perceive re-fetch hole — all closable by restricting replayable checkpoints to the post-compose/deliver set.
Concerns: H1 leaks a raw traceback (KeyError not caught by `_do_replay`) and can replay a wrong report; the listing surfaces these unsafe checkpoints with no guard; minor `--checkpoint`-no-value and missing-thread-exit-code divergences.
