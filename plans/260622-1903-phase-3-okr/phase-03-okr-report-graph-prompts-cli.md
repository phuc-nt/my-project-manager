# Phase 03 — Slice C: OKR prompts + report_kind="okr" graph + CLI --okr + E2E delivery

> **Status: ✅ DONE (2026-06-22).** Shipped `okr_report_prompt.py` (deterministic table + LLM
> narrative), `okr_report_graph.py`, `--okr` CLI. Real E2E: Confluence page 557057 + Slack post, dedup
> confirmed. 13 UT.

> Goal: wire Slices A+B into a standalone OKR report that mirrors the existing daily/weekly delivery —
> a Confluence "OKR Status <date>" page + a Slack short+link — all through the Action Gateway, with no
> gateway/allowlist/Lớp A/B changes. Add `cli report --okr`.

## Context links

- Plan index: [plan.md](plan.md)
- Prompt builders to mirror: `src/llm/report_prompt.py:71` (`build_detail_messages`), `:117`
  (`build_slack_short`), `:111` (`REPORT_TITLES`), `:61` (`_DETAIL_SYSTEM`)
- Graph + deps to extend: `src/agent/report_graph.py:30` (`ReportDeps`), `:51` (`default_report_deps`),
  `:106` (`_deliver` — the Confluence-then-Slack gateway path to mirror), `:181` (`build_report_graph`)
- State: `src/agent/state.py:24` (`ReportState`, primitives only)
- Delivery primitives (REUSE as-is, no edits): `src/actions/confluence_write.py:87` (`create_report_page`),
  `src/actions/slack_write.py:47` (`deliver_report`)
- CLI dispatch: `src/entrypoints/cli.py:43` (`_run_report`), `:61` (`_parse_report_kind`), `:173`
- Allowlist confirmation: `src/actions/hard_block.py:120` (`slack: post_message`), `:122`
  (`confluence: createpage/updatepage`) — both Auto. No change needed.

## Gateway / guardrail confirmation (no changes)

The OKR report performs exactly the two mutations the daily/weekly report already does:
`confluence:createPage` (`create_report_page`) + `slack:post_message` (`deliver_report`). Both are
already on the allowlist (`hard_block.py:120-122`) and classified **Auto** for the internal report
channel. Therefore: **no new gateway code, no new allowlist entry, no Lớp A bypass, no Lớp B addition.**
Dedup key = `okr-<date>` (passed as `report_date=f"okr-{today}"` into the existing
`create_report_page` / `deliver_report`, whose dedup hints already namespace by tool+date). The plan
MUST NOT introduce any path that skips `ActionGateway.execute`. (If the configured Slack channel is an
external channel, the existing `needs_interrupt` logic already routes it to Lớp B — unchanged.)

## OKR data shape in graph state (primitives only)

`ReportState` holds only serializable primitives (`state.py:24`). Mirror the existing
`_risks_to_dicts` approach: serialize `Objective`/`KeyResult`/`OkrProblem`/`OkrRollup` to plain dicts
for state; keep the heavy fetched objects in the node closure `box` (as `report_graph._make_nodes`
already does at `report_graph.py:149`). Add to `ReportState` (total=False) only new primitive keys if
needed (e.g. reuse existing `report_text`, `cost_usd`, `delivered`, `delivery_summary`; OKR objectives
live in the closure, not state).

## Requirements

### 1. Prompt builders (`src/llm/report_prompt.py`)

- `REPORT_TITLES["okr"] = "OKR Status"`.
- `render_okr_table_xhtml(rollup) -> str` — PURE, deterministic, NO LLM. Build the Confluence storage
  XHTML for the OKR body: an `<h2>` title, a `<table>` of Objective/KR/progress%/weight, a
  `<ul>` of at-risk objectives, and a `<ul>` "OKR có vấn đề" listing each `OkrProblem`. Numbers
  (progress %, weights) are rendered here from computed values — the LLM never sees or invents them.
  Use only the storage tags already whitelisted in `_DETAIL_SYSTEM` (`report_prompt.py:61`): `<h2>`,
  `<h3>`, `<p>`, `<ul>`, `<li>`, `<strong>`, `<em>`, plus `<table>/<tr>/<td>/<th>` (Confluence storage
  supports tables — VERIFIED 2026-06-22: a `<table><tbody><tr><th>/<td></table>` round-trips through
  `createPage`→`getPageContent` intact, so tables are safe; `<ul>` fallback no longer required).
- `build_okr_detail_messages(rollup, *, report_date) -> list[dict]` — LLM narrative wrapper (USER
  DECISION 2026-06-22: option (b)). Produces a short **1-paragraph** `<p>` executive summary that the
  compose node prepends ABOVE the deterministic `render_okr_table_xhtml(rollup)` output. The system
  prompt: (1) forbids inventing or restating exact numbers — the model references trends/risks
  qualitatively ("phần lớn objective đang đúng tiến độ, một objective cần chú ý"), the TABLE carries the
  figures; (2) Confluence storage XHTML only (`<p>`, `<strong>`, `<em>` — no headings, no GitHub
  markdown); (3) Vietnamese, concise. The numbers in the body always come from the deterministic table,
  never from the LLM. **The graph still degrades gracefully without a key**: if `LlmClient` is
  unavailable / no `OPENROUTER_API_KEY`, compose falls back to a templated one-line summary (no LLM) so
  the OKR report still renders — narrative is an enhancement, not a hard dependency. This keeps the
  acceptance test for the deterministic table runnable without a key (inject a fake/None LLM).
- `build_okr_slack_short(rollup, *, report_date, detail_url) -> str` — PURE, deterministic Slack mrkdwn
  (mirror `build_slack_short` at `report_prompt.py:117`): overall line (e.g. `*OKR <date>* — N objective,
  X% trung bình`), the at-risk objectives bullet list, problem count, and the Confluence link. Slack
  mrkdwn rules from the existing module (single `*`, `•`, no `#`/`**`/`-`).

### 2. Graph wiring (`src/agent/report_graph.py`)

Two clean options — **choose the parallel-deps option** to avoid forcing OKR types through the existing
issue/PR `ReportDeps`:

- Add `default_okr_deps(*, gateway=None) -> ReportDeps`-shaped wiring OR a dedicated
  `OkrReportDeps` + `build_okr_graph`. Recommended: a small parallel builder `build_okr_graph` +
  `default_okr_deps` that reuses the SAME node skeleton (perceive→analyze→compose→deliver) but with OKR
  collaborators:
  - perceive: `confluence_read.get_page_content(cfg.okr_confluence_page_id)` → `parse_okr_table` →
    collect all epic keys → `okr_read.get_epic_progress_map(keys)`. Store raw rows + epic map in the box.
    If `okr_confluence_page_id` is unset ⇒ raise a clear config error (CLI surfaces it).
  - analyze: `okr_analyzer.build_objectives(raw_rows, epic_map, behind_threshold=cfg.okr_behind_threshold)`
    → `OkrRollup`. Serialize a primitive summary into state; keep `OkrRollup` in box.
  - compose: LLM 1-paragraph narrative (`build_okr_detail_messages` → `LlmClient.complete`) prepended to
    `render_okr_table_xhtml(rollup)` (deterministic numbers) → `report_text`; `cost_usd` from the LLM
    result. If no key/LLM, fall back to a templated summary line and `cost_usd=None`.
  - deliver: mirror `report_graph.py:106-130` exactly — `create_report_page(title="OKR Status <date>",
    body, gateway, report_date=f"okr-{today}", rationale=...)` then `deliver_report(build_okr_slack_short(...),
    gateway, report_date=f"okr-{today}", ...)`. Same success criteria, same gateway, same dedup namespace.
- Keep `build_report_graph` untouched for daily/weekly; OKR gets its own builder so neither flow leaks
  into the other. Both share `_make_nodes` if the closure shape allows; otherwise a small OKR-specific
  `_make_okr_nodes` (acceptable duplication < the cost of overloading `ReportDeps`).

### 3. CLI (`src/entrypoints/cli.py`)

- `_parse_report_kind` (`cli.py:61`): add `--okr` → return `"okr"` (precedence: explicit `--okr` wins;
  document order if multiple flags passed — recommend first-match: okr > weekly > daily).
- `_run_report` (`cli.py:43`): when kind is `"okr"`, call the OKR graph builder instead of
  `build_report_graph`. A clean branch: `if report_kind == "okr": graph = build_okr_graph(get_checkpointer())`
  else the existing path. Keep the same print/summary/cost output shape.
- Usage string (`cli.py:154`): add `--okr` to the help text.
- Preserve the no-key commands (`audit`/`approvals`/`approve`/`reject`) untouched — `--okr` is under the
  `report` branch which already sits behind `_require_key()` (`cli.py:170`). (OKR option (a) needs no
  LLM key, but it still posts via MCP servers; keeping it behind the key gate is acceptable for parity.
  If we want `--okr` to run without an OpenRouter key in option (a), move the key check to be daily/weekly
  only — note this as a small decision, default: keep behind the gate for now.)

## Files

- Modify: `src/llm/report_prompt.py` (+`render_okr_table_xhtml`, +`build_okr_slack_short`,
  +`REPORT_TITLES["okr"]`, optional `build_okr_detail_messages`). If it crosses 200 LOC, split OKR
  builders into `src/llm/okr_report_prompt.py`.
- Modify: `src/agent/report_graph.py` (+`default_okr_deps`/`build_okr_graph`; do NOT alter daily/weekly).
  If it crosses 200 LOC, extract OKR wiring into `src/agent/okr_report_graph.py` (preferred — keeps the
  existing file stable and gives D a clean import).
- Modify: `src/agent/state.py` only if a new primitive key is genuinely needed (prefer reusing existing).
- Modify: `src/entrypoints/cli.py` (`--okr` branch + usage).
- Create: `tests/test_okr_report.py`.

> Recommendation: implement OKR graph wiring in a NEW `src/agent/okr_report_graph.py` rather than
> bloating `report_graph.py`. This also removes the C/D file overlap noted in plan.md and keeps
> `report_graph.py` edits limited to Slice D's weekly hook.

## Implementation steps

1. Add prompt builders + `REPORT_TITLES["okr"]`.
2. Build `okr_report_graph.py` (`default_okr_deps` + `build_okr_graph`) reusing the delivery pattern.
3. Wire `--okr` into the CLI.
4. Tests (below). Run `uv run pytest tests/test_okr_report.py`, then full `uv run pytest` + `ruff`.
5. E2E with `DRY_RUN=true`: `cli report --okr` against a real configured OKR page → expect
   `confluence=dry_run slack=dry_run`, no real writes; verify audit entries recorded.

## Tests / validation (`tests/test_okr_report.py`)

- `render_okr_table_xhtml`: output contains only whitelisted storage tags; NO GitHub markdown
  (`assert "#" not in ...` for headings, no `**`, no leading `- `); progress numbers from the rollup
  appear verbatim; problems rendered in the "OKR có vấn đề" list.
- `build_okr_slack_short`: Slack mrkdwn (single `*`, `•`), includes detail link, at-risk list, problem
  count; no `#`/`**`/`-` (mirror the existing slack-short tests).
- Graph wiring with FAKE deps (no network, no key, mirror `test_slack_write_and_report_graph.py` /
  `test_sprint_and_report_kind.py`): inject fake `get_page`/`get_epic_progress_map`/gateway; assert the
  OKR graph perceives→analyzes→composes→delivers and the deliver step calls the gateway with
  `report_date="okr-<date>"` and the `OKR Status <date>` title.
- Gateway dedup: a second run same day → Slack `deduplicated` (reuses existing dedup store behavior).
- CLI: `main(["report","--okr"])` with patched graph builder returns 0 and prints the OKR summary;
  `audit`/`approvals` still work without a key (regression guard).
- Resilience E2E (fake): a page with malformed rows → report still produced, problems listed, no raise.

## Risks / rollback

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Confluence storage rejects `<table>` tags | RESOLVED | Spike verified `<table>` round-trips intact via `createPage`→`getPageContent` (2026-06-22). No fallback needed. |
| OKR flow accidentally bypasses the gateway | L×H | Deliver step MUST call `create_report_page`/`deliver_report` (which call `gateway.execute`); a test asserts the gateway is invoked; code review checks no direct `call_tool` write in the OKR path. |
| Editing `report_graph.py` regresses daily/weekly | M×H | Put OKR wiring in a NEW `okr_report_graph.py`; leave `report_graph.py` untouched in Slice C; existing graph tests must pass unchanged. |
| `--okr` requires a key it shouldn't (option a is LLM-free) | L×L | Decision documented: keep behind key gate for parity now; revisit if cron-running OKR without a key is desired. |

Rollback: revert the CLI `--okr` branch (restores daily/weekly only), delete `okr_report_graph.py`,
`tests/test_okr_report.py`, and the OKR prompt builders. No gateway/allowlist/state migration to undo.

## Open questions

1. ~~Confluence storage `<table>` support~~ — RESOLVED by spike (tables round-trip intact, 2026-06-22).
2. Should `cli report --okr` run without an `OPENROUTER_API_KEY` (option (a) is LLM-free)? Default:
   keep behind the gate. Flip only if OKR cron should run on a key-less host.
