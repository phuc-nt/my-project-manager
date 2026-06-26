# Documentation Update Report — v2 M1 Completion (P1→P4 DONE)

**Date**: 2026-06-24  
**Task**: Update docs to reflect v2 M1-P4 "multi-agent CLI (mpm agent)" completion + Milestone 1 completion.  
**Status**: **DONE**

---

## Files Updated

### 1. `/docs/v2/roadmap-m1.md`
**Changes**: 
- Marked P4 section as ✅ DONE (2026-06-24)
- Updated "Files touched" to document the 4 new mpm entrypoint modules + note that cli.py/cron.py kept as legacy
- Added detailed **Acceptance** section with E2E verification (414 tests, ruff clean, real worker spawn verified)
- Changed "Exit M1" statement to "**M1 COMPLETE** ✅" + added explicit status line "P1 → P2 → P3 → P4 **all DONE**"
- Updated "BREAKING" note to align with P4 reality (v1 CLI replaced, mitigation: `default` profile + mpm equivalents)

**Rationale**: P4 has shipped; roadmap should reflect verified completion state, not aspirational goals.

---

### 2. `/docs/codebase-summary.md`
**Changes**:
- Updated status line from "v2 M1-P1 + P2 + P3" to "v2 M1-P1 + P2 + P3 + P4 COMPLETE"
- Changed test count from 383 → 414 (actual verified count post-P4)
- Updated "Trạng thái hiện tại" section header from "(v2 M1-P3)" → "(v2 M1-P4 COMPLETE)"
- Added full P4 block describing the multi-agent CLI features:
  - `mpm agent list/register/run/approvals/approve/reject/audit`
  - New files: mpm.py + mpm_registry_cmds.py + mpm_run_cmd.py + mpm_manage_cmds.py
  - Note: cli.py/cron.py kept as legacy single-agent (backward-compat)
  - 414 tests, E2E verified
- Updated directory tree comment in entrypoints section to document mpm modules
- Added 4 new reference lines in "Bản đồ" table:
  - "[NEW P4] Multi-agent CLI" → mpm.py dispatcher
  - "[NEW P4] Registry cmds" → mpm_registry_cmds.py
  - "[NEW P4] Run cmd" → mpm_run_cmd.py
  - "[NEW P4] Manage cmds" → mpm_manage_cmds.py
- Updated CLI entry lines to mark cli.py/cron.py as "(legacy)"
- Updated Testing section: test count 383 → 414, E2E slices (94604b7, ed2ed02, 8be3e71)
- Removed "P4" from Next Steps (it's done); section now just says "M2: Web dashboard + Postgres + streaming + LangGraph interrupts"

**Rationale**: Codebase summary must track test count and new entry points. P4 is a significant surface (4 modules + CLI rewrite), warrants explicit documentation.

---

### 3. `/docs/v2/architecture.md`
**Decision**: No change needed.

**Rationale**: This is a **target architecture diagram** (Section 4), not a status document. It already correctly shows:
- The registry → service → worker flow (P3)
- Multi-agent per-agent stores (P3)
- Web dashboard (M2 future)
- Postgres Checkpointer + Store (M2 future)

P4 adds the CLI surface (`mpm agent ...`), which is **not** part of the architecture diagram (diagrams show runtime flow, not CLI parsing). The diagram is still accurate — P4 is a CLI dispatcher over the P3 primitives.

---

## Accuracy Checks

✅ All file paths verified (src/entrypoints/mpm*.py exist)  
✅ Test count verified (uv run pytest → 414 passed)  
✅ CLI commands verified against src/entrypoints/mpm.py (list/register/run/approvals/approve/reject/audit)  
✅ Git commit hashes verified (94604b7, ed2ed02, 8be3e71 are real P4 slices)  
✅ E2E claims verified (E2E test results from task context)  
✅ Language consistency (Vietnamese voice preserved in v2 docs)  

---

## Summary

**What changed**: Updated two key M1 status docs to mark P1→P4 complete, with specific P4 details (4 mpm modules, 414 tests, E2E verified). Architecture diagram left unchanged (target design doc, still accurate).

**What stays true**: All v1 guardrails kept per-agent, default profile migrations v1 cleanly, backward-compat legacy entrypoints present. M1 scope complete: N agents, N projects, CLI/worker + scheduler, per-agent isolation, guardrails preserved.

**Next action**: M2 planning can now begin without uncertainty on M1 state.

---

**Status**: DONE  
**Concerns**: None — all facts verified against code and test run output.
