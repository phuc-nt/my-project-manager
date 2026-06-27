# Phase 03 — D3 workflow automation engine (READ-ONLY + PROPOSE)

**Status**: pending · **Effort**: 6h · **Blocks**: none · **Blocked by**: none

The biggest + riskiest slice. A declarative `automation.yaml` describes a workflow; the
engine interprets it: chains READ steps and, where the workflow says to act, it PROPOSES
the action by ENQUEUEING it into the EXISTING Lớp B approval queue via
`ActionGateway.execute()`. It NEVER auto-executes a write.

## Context (verified 2026-06-27)

- Gateway PROPOSE seam: `src/actions/action_gateway.py:133` `execute(action, ...)` →
  for a Lớp B action calls `ApprovalStore.enqueue` (`:205`) and returns
  `GatewayResult(status="pending_approval", approval_id=..)`. THIS is the only call D3
  makes to act. `src/actions/approval_store.py` is the queue. `ActionGateway.__init__`
  takes `external_channels` (inject `config.slack_external_channels` like
  `cli._gateway:204-206`).
- Action-dict shape to mirror EXACTLY (so a proposed write is identical to a report's):
  - Slack: `src/actions/slack_write.py:80-87` —
    `{"type":"mcp_tool","server":"slack","tool":"post_message","args":{"channel","text"},"dedup_hint":..}`.
  - Linear: `src/actions/linear_write.py:86-89` —
    `{"type":"mcp_tool","server":"linear","tool":"<createComment>","args":{"issueId","body"}}`.
  - The gateway's `_MUTATING_TYPES = {"mcp_tool","gh_cli","email_send"}`
    (`action_gateway.py:40`). A `propose` step builds one of these dicts — NOTHING else.
- Read tools the workflow chains (all bypass the gateway by design):
  `src/tools/{jira_read,github_read,linear_read,confluence_read,okr_read}.py`.
- Lớp A classify (the red line a destructive propose hits): `src/actions/hard_block.py`
  (`classify` / `needs_interrupt` / `BlockCategory`). D3 does NOT touch this file — it
  relies on the gateway calling it.
- Config seam for the `automation.yaml` path / opt-in: NOT a settings field — the path is
  a CLI ARGUMENT (`mpm agent automate <id> <path>`), so no `loader_mapping` change is
  needed. (Schedule-triggered automation is deferred — see unresolved Q.)
- CLI dispatcher: `src/entrypoints/mpm.py` (add an `automate` branch like the others).
  Approved-dispatch already handles slack/linear/email (`approved_dispatch.py`) — a
  proposed action the user later approves flows through the EXISTING approve path
  unchanged.

## Minimal schema (YAGNI — "YAML đơn giản hơn DSL", "BỎ Workflow DSL kiểu Airflow DAG")

A flat list of steps. NO DAG, NO branching graph, NO loops, NO parallelism. Linear
sequence with a single optional top-level `when` condition.

```yaml
name: p0-bug-stakeholder-note          # required, identifier
when: "status == overdue"              # optional, SINGLE `field == value` comparison only
steps:
  - read:    jira.issue                 # step type `read`: a whitelisted read tool + args
    args:    { issue_key: "SCRUM-123" }
    as:      issue                      # bind result into the context under this name
  - analyze: impact_note                # step type `analyze`: bind output of a NAMED prompt
    prompt:  analyze_impact             # named prompt from the bundled registry (NOT free text)
    using:   [issue]
    as:      impact_note
  - propose: slack.post                 # step type `propose`: build a Lớp B action + enqueue
    args:    { channel: "stakeholders", text: "{{impact_note}}" }
```

Three step types ONLY: `read`, `analyze`, `propose`.

**`when` condition (LOCKED — single comparison):** `when: <field> == <value>` ONLY.
Parse by splitting on the FIRST `==`, trim both sides, look the LHS field up in the flat
context and compare to the RHS literal. NO boolean operators (`and`/`or`/`in`), NO `eval`,
NO mini-expression-language. A malformed / multi-operator `when` ⇒ schema error.
(Boolean expressions deferred — see Unresolved.)

**`analyze` step (LOCKED — named prompts only):** `analyze` references a prompt by NAME
via `prompt: <name>` from a small BUNDLED named-prompt registry — there is NO free-text
`prompt:` body in yaml, so yaml cannot inject arbitrary LLM instructions (minimizes the
prompt-injection surface). An unknown prompt name ⇒ schema error. Start with 2–3 named
prompts (e.g. `analyze_impact`, `summarize_blockers`).

## Requirements

1. Parse + VALIDATE `automation.yaml` against the minimal schema; reject unknown step
   types / unknown read tools / unknown propose targets at parse time (fail closed).
2. `read` steps map to a WHITELIST of read-tool functions only — a `read:` naming a
   non-whitelisted tool is a parse error (no arbitrary import). Reads bypass the gateway
   (safe by design).
3. `propose` steps build the SAME action dict shape as the report graphs and call
   `ActionGateway.execute()` — which enqueues Lớp B (`pending_approval`). The engine
   NEVER calls a write handler. NEVER calls `execute_approved`/`approve`.
4. `propose` target whitelist: `slack.post`, `linear.comment` (mirror existing handlers).
   An unknown propose target = parse error. NO `gh_cli` destructive proposes this round.
5. The engine imports `ActionGateway` ONLY — never `slack_write` / `linear_write` /
   `email_write` / `confluence_write` / `call_tool`. Enforced by a grep-guard test.
6. Output: print each step's outcome; a `propose` prints the `pending_approval` id so the
   user can `mpm agent approve <id> <approval-id>`. NEVER prints "executed".
7. `analyze` prompts are FIXED NAMED prompts only (`prompt: <name>` validated against the
   bundled registry; unknown name ⇒ schema error). No free-text prompts in yaml.
8. **Dry-run** (`--dry-run`): PARSE + run READ/analyze steps + RESOLVE each `propose`
   step's action dict, then PRINT what it WOULD enqueue WITHOUT calling
   `ActionGateway.execute()` — NOTHING enters the ApprovalStore. The exact branch:
   dry-run ⇒ `build_propose_action(...)` + print the dict; real (no flag) ⇒
   `build_propose_action(...)` + `gateway.execute(...)` ⇒ `pending_approval`. Dry-run is
   the ONLY divergence between modes; both build the identical action dict.

## Files

**Create** (`src/automation/` new package, each file <200 LOC):
- `src/automation/__init__.py`
- `src/automation/schema.py` (~90 LOC) — frozen dataclasses for the parsed workflow
  (`Workflow`, `ReadStep`, `AnalyzeStep`, `ProposeStep`) + `parse_automation(yaml_doc) ->
  Workflow` with strict validation (unknown keys/types/targets raise a clear error). The
  `when` parser is the single-`field == value` comparator (split on first `==`, trim,
  compare); a multi-operator/malformed `when` raises. `analyze.prompt` is validated
  against the named-prompt registry (unknown name raises). NO execution logic here.
- `src/automation/prompts.py` (~40 LOC) — the bundled NAMED-prompt registry: a dict
  `{name: prompt_text}` (start with `analyze_impact`, `summarize_blockers`). The ONLY
  source of `analyze` prompt text — yaml references a name, never supplies a body.
- `src/automation/propose.py` (~70 LOC) — `build_propose_action(target, args, context) ->
  dict`: maps `slack.post` → the slack action dict shape, `linear.comment` → the linear
  shape (mirrors `slack_write.py:80-87` / `linear_write.py:86-89`). Resolves `{{var}}`
  templating from the context. This is the ONLY place action dicts are built. Imports
  nothing from `src/actions/*write*` — it constructs plain dicts.
- `src/automation/engine.py` (~150 LOC) — `run_workflow(workflow, *, context, read_tools,
  analyze_fn, gateway, config, dry_run=False) -> list[StepResult]`:
  - Evaluate `when` (single comparison; skip the whole workflow if false → clear
    "condition not met" output).
  - For each step: `read` → call the whitelisted read tool, bind `as`; `analyze` → resolve
    the NAMED prompt from the registry, call the injected `analyze_fn(prompt_text, vars)`
    (LLM summarize, injectable so tests are offline), bind `as`; `propose` →
    `build_propose_action(...)`, then BRANCH on `dry_run`: dry-run ⇒ record + print the
    action dict WITHOUT touching the gateway (nothing enqueued); real ⇒
    `gateway.execute(action, rationale=...)` and record the `GatewayResult` (expect
    `pending_approval`). Collaborators (`read_tools` dict, `analyze_fn`, `gateway`) are
    INJECTED → fully offline-testable.
  - Engine imports `ActionGateway` for the TYPE only; the instance is injected.

**Create** (entrypoint):
- `src/entrypoints/mpm_automate_cmd.py` (~80 LOC) — `run_automate(args) -> int`:
  - Args: `<id> <automation.yaml> [--dry-run]`. Existence pre-check on the agent (like
    `mpm_resume_cmd.py:50-56`) + the yaml path. Load the agent profile at its data dir.
  - Build the real read-tools map (the 5 read modules), the real `analyze_fn` (LLM via the
    agent's settings — needs the OpenRouter key; preflight like the worker), and the real
    gateway (`ActionGateway(settings, external_channels=config.slack_external_channels)`).
  - Parse `--dry-run` and pass it to `run_workflow(..., dry_run=...)`. Dry-run prints what
    each `propose` WOULD enqueue (the action dict) and never touches the ApprovalStore.
  - Call `run_workflow`; print step outcomes + any `pending_approval` ids (real mode). Exit
    0 on a clean run (even if a propose was enqueued — enqueue is success; dry-run printing
    a plan is also success), non-zero on a parse/validation/runtime error.

**Modify**
- `src/entrypoints/mpm.py` — add `if sub == "automate": from src.entrypoints.mpm_automate_cmd
  import run_automate; return run_automate(rest)` + add `automate` to `_USAGE`.

**Add** a sample workflow for docs/tests (NOT executed by default):
- `docs/v2/examples/automation-p0-bug-stakeholder-note.yaml` (illustrative sample).

## Implementation steps

1. Define the schema dataclasses + strict parser (fail closed on unknown type/target/tool;
   single-`==` `when`; `analyze.prompt` validated against the registry).
2. Write `prompts.py` (2–3 named prompts) + `propose.py` building the slack/linear action
   dicts that match the existing shapes EXACTLY (diff against `slack_write.py` /
   `linear_write.py`).
3. Write `engine.py` with all collaborators injected + the `dry_run` branch in `propose`.
4. Write `mpm_automate_cmd.py` wiring real read-tools + named-prompt analyze + gateway +
   `--dry-run` parse.
5. Wire the `automate` dispatch line + usage in `mpm.py`.
6. Add the sample yaml under `docs/v2/examples/`.

## Tests / validation (the most red-line tests of P12)

`tests/test_automation_schema.py` (NEW, offline):
- Valid yaml parses; unknown step type / unknown read tool / unknown propose target each
  raise a clear validation error (fail closed).
- `analyze` with an UNKNOWN `prompt:` name ⇒ schema error (registry-validated).
- `when: <field> == <value>` parses + evaluates true/false over a flat context; a
  multi-operator `when` (e.g. `a == b and c == d`) ⇒ schema error (single comparison only).

`tests/test_automation_engine.py` (NEW, offline, all collaborators faked):
- Happy path: fake read tools return canned dicts, fake `analyze_fn` returns a string, a
  REAL `ActionGateway` over a tmp data dir + a `propose: slack.post` → assert the result
  is `pending_approval` AND `ApprovalStore.list_pending()` shows the action — and that NO
  handler ran (the action was enqueued, never executed). This is the core invariant test.
- **Dry-run**: same workflow with `dry_run=True` → the proposed action dict is RETURNED/
  printed but `ApprovalStore.list_pending()` stays EMPTY (gateway.execute never called).
  Asserts dry-run never enqueues.
- `analyze` resolves the NAMED prompt from the registry (fake `analyze_fn` receives the
  registry's prompt text, not yaml text).
- `when` false ⇒ no steps run, no proposal enqueued.
- `{{var}}` templating resolves from context.

`tests/test_automation_redline.py` (NEW, offline — the RED LINE suite):
- A `propose` whose action resolves to a DESTRUCTIVE op (e.g. a `gh_cli` delete / a Lớp A
  category) ⇒ `gateway.execute` raises `HardBlockedError` (Lớp A hard-deny). The engine
  surfaces it; nothing enqueued, nothing executed.
- A proposed action carrying a SECRET (e.g. a token-shaped string in args) ⇒ CREDENTIAL
  Lớp A deny (verify against `hard_block.classify`).
- **Grep-guard**: assert `src/automation/` imports NEVER include `slack_write`,
  `linear_write`, `email_write`, `confluence_write`, or `mcp_adapter.call_tool` — only
  `action_gateway`. (A test that greps the module source / inspects imports.)
- A workflow can ONLY reach a write via `gateway.execute` returning `pending_approval` —
  assert the engine never calls `execute_approved` or `approve` (spy on the gateway).

`tests/test_mpm_automate_cmd.py` (NEW, offline, injected collaborators):
- `automate <id> <good.yaml>` with a propose ⇒ exit 0, prints a `pending_approval` id,
  NEVER prints "executed".
- `automate <id> <good.yaml> --dry-run` ⇒ exit 0, prints the planned action, the
  ApprovalStore stays EMPTY (nothing enqueued).
- `automate <unknown-id> ...` ⇒ clean unknown-agent error.
- `automate <id> <bad.yaml>` ⇒ validation error, non-zero.

Commands:
```
uv run pytest -q tests/test_automation_schema.py tests/test_automation_engine.py \
  tests/test_automation_redline.py tests/test_mpm_automate_cmd.py
uv run pytest -q tests/   # full suite green
uv run ruff check src/ tests/
```

## Risks + rollback

| Risk | L×I | Mitigation |
|------|-----|------------|
| A `propose` step auto-executes a write (bypasses the gateway) | L×**Critical** | Engine builds a plain action dict and calls `gateway.execute()` ONLY — which enqueues Lớp B. NO `execute_approved`/`approve`/direct-handler path. Grep-guard test forbids importing any write module. Core engine test asserts `pending_approval` + nothing executed. |
| The schema grows into an Airflow-style DAG (scope creep) | M×M | HARD cap: 3 step types, flat linear list, single `when`. Doc says "BỎ Workflow DSL kiểu Airflow DAG". Parser rejects anything else. No branching/loops/parallel this round. |
| Condition `when` uses `eval` ⇒ code injection | L×H | NO `eval`. LOCKED to a single `field == value` comparator (split on first `==`, trim, compare); a multi-operator/malformed `when` ⇒ schema error. Test a malicious expr is rejected. |
| `read:` names an arbitrary importable function ⇒ SSRF/arbitrary call | L×H | `read` maps to a fixed WHITELIST of the 5 read modules; an unlisted name is a parse error. No dynamic import from yaml. |
| `analyze` free-text prompt injects arbitrary LLM instructions from yaml | L×M | LOCKED to NAMED prompts only (`prompt: <name>` validated against the bundled registry; unknown name ⇒ schema error). yaml carries NO prompt body. |
| `{{var}}` templating injects a secret into a proposed action | L×M | Templating only substitutes already-bound context strings; a secret reaching the action still hits the gateway's CREDENTIAL Lớp A deny (red-line test covers it). |
| `analyze` LLM call needs a key ⇒ breaks offline tests | L×L | `analyze_fn` is INJECTED; tests pass a fake. The CLI preflights the key like the worker (`worker.py:149`). |

**Rollback**: delete `src/automation/` + `mpm_automate_cmd.py` + the one `mpm.py`
dispatch line + the sample yaml. No schema/data-store change — D3 only READS and
ENQUEUES through the EXISTING `ApprovalStore` (same enqueue a report uses). Reverting
leaves the gateway + queue + all existing commands untouched. A workflow already enqueued
a proposal? It's a normal pending Lớp B item — approve/reject it via the existing CLI.

## INVARIANT (restated — this is THE phase it governs)

D3 workflow automation MUST NOT bypass the Action Gateway. It reads freely (reads bypass
the gateway by design) and PROPOSES writes by ENQUEUEING the SAME action dict shape the
report graphs build into the EXISTING Lớp B approval queue via `ActionGateway.execute()`.
NO auto-execute, NO new write authority, NO new allowlist entry, NO new bypass. A
destructive propose hits Lớp A hard-deny. The engine imports `ActionGateway` only.

## Unresolved questions

1. Boolean `when` expressions (`and`/`or`/`in`/multiple comparators) are DEFERRED — this
   round is locked to a single `field == value` comparison. Revisit only if a real
   workflow needs compound conditions.
2. Schedule-triggered automation (via `src/runtime/scheduler.py` / `cron.py`) is DEFERRED
   to a future round (this round = on-demand CLI invoke only). Confirm that's the accepted
   scope.

_Resolved by coordinator (2026-06-27): `analyze` = named prompts only; `when` = single
`field == value`; `--dry-run` added (parses + plans, never enqueues)._
