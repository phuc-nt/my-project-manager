# Phase 4 · Slice B — Prompts + standalone graph + CLI `--resource`

> **Status: ✅ DONE (2026-06-22).** `resource_report_prompt.py` (escaped XHTML/Slack + narrative),
> `resource_report_graph.py`, `--resource` CLI + cron. C1 fix: `_slack_safe` sanitizes assignee names
> in Slack. Real E2E: Confluence page 589825 + Slack post, dedup `resource-<date>`. 16 UT.

**Depends on:** Slice A (models + analyzer + config). Wires the standalone
`report --resource` flow end-to-end through the EXISTING Action Gateway. NO new write
authority.

## Context (verified file:line)

- Prompt analog to mirror: `src/llm/okr_report_prompt.py` — deterministic XHTML
  (`render_okr_table_xhtml` `okr_report_prompt.py:30-78`, escapes every field via
  `from html import escape` `okr_report_prompt.py:16`), Slack short
  (`build_okr_slack_short` `okr_report_prompt.py:87-105`, single `*`, `•`, link), LLM
  narrative messages (`build_okr_narrative_messages` `okr_report_prompt.py:117-137`) +
  no-key fallback (`fallback_okr_narrative` `okr_report_prompt.py:140-152`).
- Graph analog to mirror: `src/agent/okr_report_graph.py` — `OkrReportDeps`
  (`okr_report_graph.py:33-39`), `default_okr_deps(*, gateway=None)`
  (`okr_report_graph.py:46-100`) with lazy imports, `_compose`/`_narrate`/`_deliver`
  closures, `_make_okr_nodes` (`okr_report_graph.py:103-123`), `build_okr_graph`
  (`okr_report_graph.py:133-150`). Deliver uses `create_report_page` +
  `deliver_report` with dedup `okr-<today>` (`okr_report_graph.py:81-98`). State is
  `ReportState` (`src/agent/state.py:24-37`), primitives only; heavy model kept in a
  closure `box` (`okr_report_graph.py:104`).
- Title registry: `REPORT_TITLES` dict `src/llm/report_prompt.py:111-115` (currently
  `daily`/`weekly`/`okr`). Add `"resource": "Resource & Cost Status"`.
- CLI: `_parse_report_kind` `src/entrypoints/cli.py:66-75` (okr>weekly>daily);
  `_run_report` dispatch `src/entrypoints/cli.py:43-63` (branches on `report_kind`);
  usage string `src/entrypoints/cli.py:163-167,184`. Audit/approvals are handled BEFORE
  the key check (`cli.py:171-181`) — must stay keyless; the `--resource` change must not
  touch that ordering.
- Budget read (for cost scalars): `BudgetTracker().spent_this_month()`
  `src/llm/budget_tracker.py:62-63`; `get_settings().monthly_budget_usd` /
  `.budget_warn_ratio` `src/config/settings.py:91-92`.
- Open-issue source for the standalone report: `jira_read.get_open_issues()`
  `src/tools/jira_read.py:88-111` (returns normalized `Issue`s for the configured project).
- Gateway wrappers (already Auto-allowlisted, no change): `create_report_page`
  (`src/actions/confluence_write.py`, used at `okr_report_graph.py:84`), `deliver_report`
  (`src/actions/slack_write.py`, used at `okr_report_graph.py:90`).
- Test analog: `tests/test_okr_report.py` — render-no-markdown
  (`test_okr_report.py:39-43`), graph-with-fakes (`:90-109`), dedup-namespace spy
  (`:112-145`), CLI dispatch (`:160-179`), keyless-audit regression (`:182-189`).

## Requirements

1. `src/llm/resource_report_prompt.py` (deterministic, escaped):
   - `render_resource_xhtml(resource, cost, *, report_date) -> str` — one `<h2>` +
     per-assignee `<table>` + a cost `<table>`/`<ul>`. Every assignee name `html.escape`d.
     Labor line omitted when `cost.cost_per_issue == 0`.
   - `build_resource_slack_short(resource, cost, *, report_date, detail_url) -> str` —
     mrkdwn (single `*`, `•`, no `#`/`**`/`-`); assignee names plain (no markup); link line.
   - `build_resource_narrative_messages(resource, cost, *, report_date) -> list[dict]` +
     `fallback_resource_narrative(resource, cost, *, report_date) -> str` — LLM prose ONLY
     (no numbers), graceful no-key fallback.
2. `src/llm/report_prompt.py` — add `REPORT_TITLES["resource"] = "Resource & Cost Status"`.
3. `src/agent/resource_report_graph.py` — `ResourceReportDeps`, `default_resource_deps`,
   `build_resource_graph`; perceive→analyze→compose→deliver; dedup key `resource-<date>`;
   title from `REPORT_TITLES["resource"]`.
4. `src/entrypoints/cli.py` — `_parse_report_kind` add `--resource`; `_run_report` add the
   `resource` branch; usage string updated.
5. Tests in `tests/test_resource_report.py`.

## Files to create / modify

- **create** `src/llm/resource_report_prompt.py` (<160 LOC; split if over 200).
- **create** `src/agent/resource_report_graph.py` (<160 LOC).
- **create** `tests/test_resource_report.py`.
- **modify** `src/llm/report_prompt.py` — one line in `REPORT_TITLES`.
- **modify** `src/entrypoints/cli.py` — flag parse + dispatch branch + usage.

## Implementation steps

1. **`resource_report_prompt.py`** — copy the structure of `okr_report_prompt.py`:
   - `from html import escape` at top. Helpers `_fmt_money(v) -> "$1,234"` and
     `_fmt_pct(v)` (reuse the OKR `_fmt_pct` shape `okr_report_prompt.py:21-23`).
   - `render_resource_xhtml(resource, cost, *, report_date)`:
     - `<h2>Resource & Cost Status — {escape(report_date)}</h2>`.
     - Workload `<table>`: header row `Assignee | Mở | Quá hạn | Blocker | Tải`; one row per
       `AssigneeLoad`, **`escape(load.assignee)`**, numeric cells from the load, and a "Tải"
       cell showing `⚠️ quá tải` when `load.overloaded` else `ok`. If `resource.loads` is
       empty → `<p>Chưa có issue nào được phân công.</p>`.
     - A line for `unassigned_count` when > 0:
       `<p>Chưa phân công: {n} issue.</p>`.
     - Cost block `<h3>Chi phí</h3>` + a `<ul>`:
       - LLM budget li: `LLM tháng này: {_fmt_money(llm_spent)} / {_fmt_money(llm_cap)}
         ({llm_ratio×100:.0f}%) — {status_word}` where status_word maps
         ok→"trong ngưỡng", warn→"⚠️ gần ngưỡng", over→"❌ vượt ngưỡng".
       - Labor li ONLY when `cost.cost_per_issue > 0`:
         `Ước tính nhân công (tham khảo): {_fmt_money(labor_estimate)}
         ({open_issue_count} issue × {_fmt_money(cost_per_issue)})`. Label it an ESTIMATE
         ("ước tính … tham khảo"). When `cost_per_issue == 0`, omit the li entirely.
   - `build_resource_slack_short(resource, cost, *, report_date, detail_url)`:
     - `*Resource & Cost — {report_date}*` head; a line
       `*{len(loads)} người · {open_issue_count} issue đang mở*`.
     - `• ⚠️ Quá tải: {", ".join(escape-free plain names)}` when `resource.overloaded`
       (plain text — Slack short carries no markup around the names, but DO interpolate them
       as-is; no XHTML here, so no `escape`, but DO NOT wrap in `*…*` to avoid a name like
       `*x*` breaking mrkdwn — keep names in a plain segment).
     - `• LLM: {_fmt_money(llm_spent)}/{_fmt_money(llm_cap)} ({ratio:.0f}%)` + a warn/over
       marker.
     - labor `•` line only when `cost_per_issue > 0`.
     - link line copied from `build_okr_slack_short` `okr_report_prompt.py:100-104`.
   - `build_resource_narrative_messages` + `fallback_resource_narrative`: mirror
     `okr_report_prompt.py:108-152`. System prompt: a short Vietnamese `<p>` summary,
     qualitative only, "KHÔNG nhắc lại con số cụ thể" (numbers live in the table). User
     message states qualitative facts (how many overloaded, budget status word) WITHOUT
     passing raw `$`/`%` figures. Fallback `<p>` uses `escape` on any interpolated text.

   **Escaping rule (load-bearing — repeats the OKR finding fix):** every `assignee` rendered
   into XHTML goes through `escape(...)`. Add a test that an assignee named
   `"<script>x</script>"` appears escaped (`&lt;script&gt;`) and NOT raw in the XHTML output.

2. **`report_prompt.py`** — add to the dict at `report_prompt.py:111-115`:
   ```python
   REPORT_TITLES = {
       "daily": "Daily Standup",
       "weekly": "Sprint Review",
       "okr": "OKR Status",
       "resource": "Resource & Cost Status",
   }
   ```

3. **`resource_report_graph.py`** — mirror `okr_report_graph.py`:
   - `@dataclass ResourceReportDeps` with
     `fetch: Callable[[], tuple[ResourceReport, CostSummary]]`,
     `compose: Callable[[ResourceReport, CostSummary], tuple[str, float | None]]`,
     `deliver: Callable[[ResourceReport, CostSummary, str], tuple[bool, str]]`.
   - `default_resource_deps(*, gateway=None)` with LAZY imports (network-free build):
     - `_fetch()`:
       ```python
       from src.config.reporting_config import get_reporting_config
       from src.config.settings import get_settings
       from src.llm.budget_tracker import BudgetTracker
       from src.tools import jira_read
       cfg = get_reporting_config(); s = get_settings()
       issues = jira_read.get_open_issues()
       resource = build_resource_report(
           issues, today=_today_utc(),
           overload_ratio=cfg.resource_overload_ratio,
           blocker_label_substring=cfg.blocker_label_substring)
       open_count = sum(l.open_count for l in resource.loads)
       spent = BudgetTracker().spent_this_month()
       cost = build_cost_summary(
           open_count, llm_spent=spent, llm_cap=s.monthly_budget_usd,
           warn_ratio=s.budget_warn_ratio, cost_per_issue=cfg.labor_cost_per_issue)
       return resource, cost
       ```
     - `_compose(resource, cost)`: render the deterministic XHTML via
       `render_resource_xhtml`, prepend the LLM narrative (try `LlmClient().complete(...)`,
       fall back to `fallback_resource_narrative` on any exception — copy the `_narrate`
       try/except shape from `okr_report_graph.py:68-79`). Return `(narrative + table, cost_usd)`.
     - `_deliver(resource, cost, body)`: `today = _today_utc().isoformat()`;
       `title = f"{REPORT_TITLES['resource']} {today}"`; call `create_report_page(title,
       body, gateway=gw, report_date=f"resource-{today}", rationale="scheduled resource &
       cost status report (detail)")`; build `short = build_resource_slack_short(resource,
       cost, report_date=today, detail_url=page.url if page else None)`; call
       `deliver_report(short, gateway=gw, report_date=f"resource-{today}", rationale="resource
       & cost status report (short + link)")`. Return the same `ok` / summary shape as
       `okr_report_graph._deliver` `okr_report_graph.py:94-98`. **dedup key `resource-<date>`.**
   - `_make_resource_nodes(deps)` + `build_resource_graph(checkpointer=None, *, deps=None)`:
     copy `_make_okr_nodes` + `build_okr_graph` (`okr_report_graph.py:103-150`). State:
     `perceive` stashes `(resource, cost)` in a closure `box`; `analyze` returns a primitive
     summary into state (e.g. `{"risks": [{"assignee": n} for n in resource.overloaded]}` or
     a small dict list — keep state primitive like `_problems_to_dicts`
     `okr_report_graph.py:126-130`); `compose_report` returns `{"report_text", "cost_usd"}`;
     `deliver` returns `{"delivered", "delivery_summary"}`.

4. **CLI** (`src/entrypoints/cli.py`):
   - `_parse_report_kind` (`cli.py:66-75`) — add `--resource` FIRST per the proposed
     precedence `resource > okr > weekly > daily` (see plan Open Question 1):
     ```python
     if "--resource" in args:
         return "resource"
     if "--okr" in args:
         return "okr"
     if "--weekly" in args:
         return "weekly"
     return "daily"
     ```
     Update the docstring's precedence note.
   - `_run_report` (`cli.py:43-63`) — add a branch BEFORE the daily/weekly else:
     ```python
     if report_kind == "resource":
         from src.agent.resource_report_graph import build_resource_graph
         graph = build_resource_graph(get_checkpointer())
     elif report_kind == "okr":
         ...
     ```
   - Usage string (`cli.py:165-166,184`): add `--resource` to the `report [...]` options.
   - Do NOT move the audit/approvals/approve/reject handling (`cli.py:171-178`) — they stay
     above `_require_key()` and keyless.

5. **Cron** — NOT wired this phase (plan Open Question 2). `cron.py` stays daily/weekly.

## Tests / validation (`tests/test_resource_report.py`)

Build a small `ResourceReport` + `CostSummary` fixture (frozen dataclasses, inline).

- **render no GitHub markdown**: `render_resource_xhtml(...)` contains `<table>` + `<h2>`,
  and NOT `##`/`**`/`<html>`/`<body>` (mirror `test_okr_report.py:39-43`).
- **render numbers from the dataclasses**: assert specific counts + `$`/`%` strings appear.
- **assignee escaping (security)**: a load with `assignee="<script>alert(1)</script>"` →
  output contains `&lt;script&gt;` and NOT the raw `<script>` tag.
- **labor line gating**: `cost_per_issue=0` ⇒ output has NO "nhân công" line; `>0` ⇒ it
  appears and is labeled an estimate ("ước tính"/"tham khảo").
- **overloaded surfaced**: an overloaded assignee shows the "⚠️ quá tải" marker in the table
  and in the Slack short's "Quá tải" line.
- **unassigned shown**: `unassigned_count > 0` renders the "Chưa phân công" line.
- **Slack short mrkdwn**: single `*`, `•`, `<url|...>` link present; no `##`/`**`;
  `detail_url=None` → "không tạo được link" fallback (mirror `test_okr_report.py:68-78`).
- **fallback narrative**: `fallback_resource_narrative(...)` is a single `<p>…</p>` with no
  numbers leaking (qualitative only).
- **graph with fakes**: `build_resource_graph(deps=fake)` → `invoke({})` returns
  `report_text`/`delivered`; the analyze step serialized overloaded names into state
  (mirror `test_okr_report.py:90-109`).
- **dedup namespace spy**: monkeypatch `create_report_page`/`deliver_report` to capture
  `report_date`; assert both equal `resource-<today>` (mirror `test_okr_report.py:112-145`).
- **CLI dispatch**: `_parse_report_kind(["--resource"]) == "resource"`; precedence
  `["--resource","--okr","--weekly"] == "resource"`; existing `--okr`/`--weekly`/default
  unchanged. `report --resource` builds the resource graph (monkeypatch
  `build_resource_graph`, assert invoked — mirror `test_okr_report.py:160-179`).
- **keyless regression**: `audit`/`approvals` still run with `openrouter_api_key=None`
  after the `--resource` change (mirror `test_okr_report.py:182-189`).

Run: `uv run pytest tests/test_resource_report.py tests/test_resource_analyzer.py -q`
then the FULL suite `uv run pytest -q` (CLI/report-kind regressions) and
`uv run ruff check src tests`.

## Acceptance criteria (Slice B)

- [ ] `report --resource` builds + runs the resource graph; with `DRY_RUN=true` the
      delivery summary reads `confluence=dry_run slack=dry_run` and writes nothing real.
- [ ] Delivery goes through `create_report_page` + `deliver_report` with dedup
      `resource-<date>` on BOTH writes (spy test green). Title = "Resource & Cost Status <date>".
- [ ] XHTML render escapes every assignee name (injection test green); Slack short is clean
      mrkdwn; labor line omitted when `LABOR_COST_PER_ISSUE=0`; LLM only writes prose.
- [ ] Flag precedence `resource > okr > weekly > daily`; audit/approvals stay keyless.
- [ ] No new MCP write tool, no allowlist entry, no Lớp A/B change (verify: no new
      gateway/allowlist edits in the diff).
- [ ] Full `pytest` + `ruff` pass; each new file < 200 LOC.

## Risks / rollback

- **Risk**: XHTML/mrkdwn injection via assignee names — mitigated by `escape` + the
  injection unit test; Slack short keeps names out of `*…*` segments.
- **Risk**: standalone graph accidentally introduces a new write surface — mitigated:
  delivery reuses the exact two already-allowlisted wrappers; the dedup-spy test proves the
  path. No gateway/allowlist file is touched.
- **Risk**: budget read at module import (network/file at build time) — mitigated: the
  `BudgetTracker()` read happens inside `_fetch` (perceive node runtime), not at graph build;
  lazy imports keep `build_resource_graph` network-free (graph-compile test green).
- **Rollback**: delete the 2 new src files + the test; revert the `report_prompt.py` one-line
  add and the `cli.py` flag/dispatch/usage diffs. `report` returns to daily/weekly/okr.
