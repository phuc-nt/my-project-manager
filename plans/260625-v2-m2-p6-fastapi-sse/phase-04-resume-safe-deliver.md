# Phase 04 (Slice 4) — Resume-safe deliver: checkpoint the composed Slack short

Status: pending
Risk: Med (touches all 3 report graphs + 4 short builders; non-resume path must stay byte-identical)
Depends on: nothing in P6 (independent bug fix; surfaced by the P6 E2E). Can land before or after Slices 1–3.
File ownership: `src/agent/report_graph.py`, `src/agent/okr_report_graph.py`,
`src/agent/resource_report_graph.py`, `src/agent/state.py`, `src/llm/slack_link.py` (new),
`src/llm/report_slack_short.py`, `src/llm/okr_report_prompt.py`,
`src/llm/resource_report_prompt.py`, `tests/test_resume_rebuild_deliver.py` (new).
No overlap with Slices 1–3 (which own only `src/server/**` + `run_event.py`/`service.py`).

---

## The bug (confirmed by the P6 E2E + traced in source)

The 3 report graphs keep heavy fetched models in a **closure `box`**, NOT in checkpointed
`ReportState` (deliberate: keeps state serializable):

- `report_graph.py:200` `box: dict` — `perceive` fills `issues/prs/ci`; `analyze` fills `risks`.
- `okr_report_graph.py:150` `box["rollup"]`.
- `resource_report_graph.py:165` `box["snapshot"] = (ResourceReport, CostSummary)`.

Flow: `perceive → analyze → compose_report → approval_gate → deliver`. `perceive`/`analyze`
fill `box`; `compose_report` writes `report_text` (the Confluence body) into state; `deliver`
reads `box` to rebuild the Slack SHORT.

On **real resume**, `resume_report` (`worker_resume.py:48`) calls
`build_graph(loaded, settings, kind, audience)` → a **fresh** graph via `_make_*_nodes` → a
**new empty `box`**. `Command(resume=...)` re-enters at `approval_gate` → `deliver`, SKIPPING
`perceive`/`analyze`. So at `deliver` the `box` is EMPTY:

- `okr_report_graph.py:169` `deps.deliver(box["rollup"], ...)` → **KeyError 'rollup' → resume
  errors, nothing posts**.
- `resource_report_graph.py:182` `resource, cost = box["snapshot"]` → **KeyError 'snapshot'**.
- `report_graph.py:223-225` `deps.deliver(box.get("risks", []), ...)` → no crash, but the short
  is rebuilt from `risks=[]` → **DEGRADED** post (`build_slack_short` →
  `*✅ Tiến độ ổn* — không phát hiện rủi ro` regardless of real risks). The Confluence detail
  body is FINE — it lives in `state["report_text"]`, checkpointed at compose.

### Why no existing test caught it

Every pause/resume test reuses the **SAME** graph object for both invokes
(`test_approval_gate_interrupt.py:87-89`, `test_approval_gate_okr_resource.py:107-110`), so the
closure `box` survives across the resume. **No test rebuilds the graph between pause and
resume** — which is exactly what the real worker does. This phase adds that missing test.

---

## Chosen design: Option A — checkpoint the composed short (URL-free) in state

At `compose_report` the heavy model is still live in `box`. Build the Slack short THERE, with
`detail_url=None` (the Confluence page does not exist yet anyway), and store the resulting
string in a new checkpoint-safe primitive `ReportState["slack_short"]`. At `deliver`, take
`state["slack_short"]` and swap its trailing "no link" placeholder line for the REAL link line
(built from the `detail_url` learned after `create_report_page`). `deliver` no longer reads the
heavy model for the short.

### Why A (and why not B / C / D-reconstruct)

- The detail_url is **never interleaved** into the model-derived body — it is a clean TRAILING
  line in all four builders (`report_slack_short.py:42-46`, `okr_report_prompt.py:109-113`,
  `resource_report_prompt.py:108-112` and `:152-156`). The no-URL fallback line
  `\n_(không tạo được link Confluence)_` is **byte-identical** across all four. So the URL can
  be injected post-hoc by replacing exactly that one trailing line — no fragile parsing of the
  body, no model needed at deliver.
- **B (checkpoint the model as primitives)** re-introduces the "state holds heavy data" problem
  the `box` was designed to avoid: `OkrRollup` (nested `Objective`→`KeyResult` tuples) and
  `ResourceReport`+`CostSummary` (per-assignee `AssigneeLoad` rows) would be fully serialized
  into state, and the resource per-assignee rows are PII the external short deliberately strips
  — putting them in state is a regression of the PII red line. Rejected.
- **C (re-run perceive/analyze on resume)** re-fetches Jira/GitHub — non-deterministic, the
  report could CHANGE between approval and resume. The human approved a SPECIFIC report.
  Rejected (this is the core reason to checkpoint, not recompute).
- **D-reconstruct (rebuild the model in deliver)** = B. The non-reconstruct D ("checkpoint the
  final short with a URL placeholder") **is** Option A here. We adopt it.

### What A stores (checkpoint-safe primitive)

One new `ReportState` key: `slack_short: str` — the fully composed short text with the URL
slot still unfilled (the no-URL fallback line). Pure `str`. No dataclass, no model, no PII the
short doesn't already expose (the external resource short already strips names/numbers BEFORE
this string is built, so storing the built string carries no new PII).

### PII check

The string stored is the OUTPUT of the existing builder, which for `audience="external"`
already dropped assignee names / per-person numbers / labor cost (resource:
`_resource_slack_short_external`, `resource_report_prompt.py:98-113`) and issue keys (daily:
`report_slack_short.py:35-39`; okr: `build_okr_slack_short` drops the "OKR có vấn đề" line for
external, `okr_report_prompt.py:106`). Storing the already-sanitized short introduces **no** new
PII into state. The internal short is unchanged (and state is local-only, same trust boundary as
`report_text` which already lives there).

---

## Data flow (before → after)

```
BEFORE (resume):  build_graph → empty box → approval_gate → deliver → box[...] → KeyError/degraded
AFTER  (resume):  build_graph → empty box → approval_gate → deliver
                    └─ state["slack_short"] (checkpointed at compose) → swap link line → POST
```

`deliver`'s two writes after the fix:
1. `create_report_page(title, state["report_text"], ...)` → Confluence (already resume-safe).
2. `final_short = inject_link(state["slack_short"], detail_url, link_text)` →
   `deliver_report(final_short, ...)` → Slack. **No `box` read.**

---

## Files + functions to change

### New: `src/llm/slack_link.py` (~25 LOC) — single source of the link line (DRY)

The link line is duplicated 4× today. Extract:

- `NO_LINK_LINE: str = "\n_(không tạo được link Confluence)_"` — the exact existing fallback.
- `slack_link_line(detail_url: str | None, *, text: str) -> str` → returns
  `f"\n📄 <{detail_url}|{text}>"` when `detail_url` else `NO_LINK_LINE`.
- `inject_link(short_no_url: str, detail_url: str | None, *, text: str) -> str` → if
  `detail_url` is falsy, return `short_no_url` unchanged (it already ends in `NO_LINK_LINE`);
  else `short_no_url.removesuffix(NO_LINK_LINE) + slack_link_line(detail_url, text=text)`.
  `removesuffix` is exact + safe (the stored string was built with `detail_url=None`, so it
  ALWAYS ends in `NO_LINK_LINE`).

Per-builder link TEXT constants (kept where they are, passed to the helper):
- daily/weekly: `"Xem báo cáo chi tiết trên Confluence"`
- okr: `"Xem OKR chi tiết trên Confluence"`
- resource: `"Xem chi tiết trên Confluence"`

### `src/llm/report_slack_short.py` — `build_slack_short`

Replace the inline `link = (...)` (lines 42-46) with
`return f"*Báo cáo tiến độ — {report_date}*\n{status}{headline}" + slack_link_line(detail_url, text=...)`.
Behavior byte-identical (same text, same fallback). Re-export path unchanged.

### `src/llm/okr_report_prompt.py` — `build_okr_slack_short`

Replace inline `link` (lines 109-113) with `head + slack_link_line(detail_url, text="Xem OKR chi tiết trên Confluence")`.

### `src/llm/resource_report_prompt.py` — both shorts

Replace the inline `link` in `_resource_slack_short_external` (108-112) and
`build_resource_slack_short` (152-156) with `slack_link_line(detail_url, text="Xem chi tiết trên Confluence")`.
**Preserve the external URL gate**: the gate lives in the graph's `_deliver`
(`resource_report_graph.py:142` `short_url = None if external`), not in the builder — keep it.
After the refactor, deliver passes the gated url to `inject_link`, so external still gets the
no-link line. (See deliver change below.)

### `src/agent/state.py` — `ReportState`

Add one key (with the others, `total=False`):
```python
slack_short: str  # Slice 4: short Slack body built at compose (URL-free), checkpoint-safe
```

### `src/agent/report_graph.py`

- `compose_report` (213-216): after composing, build the short URL-free and return it:
  ```python
  short = deps.build_short(box.get("risks", []))   # detail_url=None inside
  return {"report_text": text, "cost_usd": cost, "slack_short": short}
  ```
  Add `build_short` to `ReportDeps` (a closure that calls `build_slack_short(risks,
  report_date=today, detail_url=None, audience=audience)` and appends the weekly-internal okr +
  resource slack lines — i.e. the SAME assembly `_deliver` does today at lines 159-167, moved to
  compose). For weekly-internal, the okr/resource slack lines
  (`weekly_okr_slack_line`/`weekly_resource_slack_line`) are deterministic from config — fine to
  build at compose.
- `deliver` (218-226): drop the `box` read. Compute `detail_url` from the page as today, then
  `final_short = inject_link(state["slack_short"], detail_url, text="Xem báo cáo chi tiết trên Confluence")`
  and pass `final_short` to `deps.deliver`. `deps.deliver` no longer takes `risks`; it takes the
  finished short + body + approved.

  Cleaner seam: change `ReportDeps.deliver` to `Callable[[str, str, bool], tuple[bool, str]]`
  i.e. `deliver(final_short, detail_body, approved)`, and the link injection happens INSIDE
  `_deliver` (after it learns `detail_url`) — so `deliver` still owns page creation + URL.
  Then the node passes `state["slack_short"]` (URL-free) instead of `box["risks"]`:
  ```python
  delivered, summary = deps.deliver(state.get("slack_short", ""), state.get("report_text", ""), approved)
  ```
  and `_deliver(short_no_url, detail_body, approved)` does: create page → `detail_url` →
  `final = inject_link(short_no_url, detail_url, text=...)` → `deliver_report(final, ...)`.
  **This keeps URL ownership in `_deliver` (where the page is created) and makes the NODE
  model-free.** Adopt this seam (no separate `build_short` dep needed — compose builds the
  URL-free short directly).

  Revised `compose_report`: build the URL-free short inline via a small `_compose_short` helper
  (or reuse `_deliver`'s assembly factored into a shared local). For weekly-internal, compose
  appends the okr/resource slack lines so the stored short already carries them.

### `src/agent/okr_report_graph.py`

- `compose_report` (161-163): also return `"slack_short": build_okr_slack_short(box["rollup"],
  report_date=today, detail_url=None, audience=audience)`. (Needs `build_okr_slack_short` +
  `today` available in the node — wire via the deps closure: add a `build_short(rollup)` to
  `OkrReportDeps`, OR build in `_compose` and return alongside. Simplest: `_compose` already has
  the rollup + today; have `_compose` return `(body, cost, short)` and the node stores all
  three. **Lock: extend `compose` to also return the URL-free short.**)
- `OkrReportDeps.compose`: `Callable[[OkrRollup], tuple[str, float | None, str]]` (body, cost,
  short). `OkrReportDeps.deliver`: `Callable[[str, str, bool], tuple[bool, str]]`
  (final-short-source, body, approved) — `_deliver` injects the url after `create_report_page`.
- `deliver` (165-170): pass `state["slack_short"]` + `state["report_text"]`, no `box`.

### `src/agent/resource_report_graph.py`

- `_compose` (92-96) → return `(body, usd, short)` where
  `short = build_resource_slack_short(resource, cost, report_date=today, detail_url=None, audience=audience)`.
- `ResourceReportDeps.compose`: `tuple[str, float | None, str]`.
  `ResourceReportDeps.deliver`: `(final_short_source, body, approved)`.
- `_deliver` (127-155): keep the external URL gate (`short_url = None if external else detail_url`)
  but now apply it via `inject_link(short_no_url, short_url, text=...)` — for external,
  `short_url=None` ⇒ `inject_link` returns the stored no-link short unchanged (external short
  already has no link, identical to today).
- `deliver` node (181-188): pass `state["slack_short"]` + `state["report_text"]`, no `box`.

> NOTE on the seam: making `deps.deliver` take the **URL-free short** (not the model) is the
> crux — it severs deliver's dependency on `box`. The node reads only `state`. `_deliver` keeps
> page creation + URL injection (it owns the gateway + the resource external gate).

### LOC budget

`report_graph.py` is 288, okr 221, resource 232 — all pre-existing over 200. The change is
roughly net-neutral (move short assembly compose-ward, delete box reads in deliver). If any file
grows: extract the per-graph short-assembly + delivery helpers into a sibling
`*_delivery.py` (the okr/resource already lazy-import an `audience_delivery` helper module —
follow that precedent). Do not let any of the three grow beyond its current line count.

---

## Step-by-step

1. Add `src/llm/slack_link.py` with `NO_LINK_LINE`, `slack_link_line`, `inject_link`.
2. Refactor the 4 short builders to end with `slack_link_line(...)` (byte-identical output).
   Run the existing short-builder unit tests → must stay green (proves no-regression).
3. Add `slack_short: str` to `ReportState`.
4. `report_graph.py`: build URL-free short at `compose_report` (incl. weekly-internal okr/resource
   slack lines), store in `slack_short`; change `ReportDeps.deliver` to `(short_no_url, body,
   approved)`; `_deliver` injects the real url after page creation; `deliver` node reads
   `state["slack_short"]` (no box).
5. `okr_report_graph.py`: `_compose` returns `(body, cost, short)`; node stores `slack_short`;
   `_deliver` takes `(short_no_url, body, approved)` and injects url; node reads state.
6. `resource_report_graph.py`: same as 5, preserving the external URL gate via `inject_link`.
7. Update the fake-deps in the 2 existing interrupt tests to the new `deliver`/`compose`
   signatures (they currently pass `lambda r, body, approved` / `lambda r, c, body, approved`).
   Keep their assertions (single live deliver, approved flag).
8. Add `tests/test_resume_rebuild_deliver.py` (below) — the missing rebuild-on-resume coverage.
9. `uv run pytest -q` full suite; `ruff check`.

---

## Test plan

### CRITICAL new test: `tests/test_resume_rebuild_deliver.py`

Reproduces the REAL resume path: build to interrupt with checkpointer-A, **REBUILD a fresh
graph** (new empty box) sharing the SAME checkpointer + thread, resume with
`Command(resume="approve")`, and assert deliver posts the CORRECT short — proving the short came
from `state`, not the (now-empty) box.

Harness (mirror `test_approval_gate_okr_resource.py`):
- `_checkpointer()`: in-memory `SqliteSaver` (shared across both graph builds).
- A `_ShortSpy` fake `deliver` dep that RECORDS the short string it was asked to post:
  ```python
  class _ShortSpy:
      def __init__(self): self.posted_short = None; self.calls = 0
      def deliver(self, short_no_url, body, approved=False):
          self.calls += 1; self.posted_short = short_no_url
          return True, "confluence=executed slack=executed url=https://x"
  ```
  (The spy captures the URL-free short the node passed; the assertion checks it reflects the real
  model. Because `_deliver` is the SPY, url injection is irrelevant to the assertion — we assert
  on the content the node carried out of `state`.)
- The `compose` fake returns `(body, cost, short)` where `short` is built by the REAL short
  builder from the REAL model — so the test exercises the genuine compose→state→deliver carry.
  e.g. okr: `compose=lambda r: ("<p>okr</p>", None, build_okr_slack_short(r, report_date="2026-06-25", detail_url=None, audience="external"))`.

Three resume-correctness tests (one per graph kind):

1. `test_daily_resume_rebuild_posts_real_risks`
   - fake deps with `analyze_risks` → a HIGH risk; `compose` returns a short built from that risk.
   - graphA = `build_report_graph(deps=depsA, audience="external", checkpointer=cp)`;
     `graphA.invoke({}, cfg)` → pause at gate.
   - graphB = `build_report_graph(deps=depsB, audience="external", checkpointer=cp)` (FRESH box,
     SAME cp + thread); `graphB.invoke(Command(resume="approve"), cfg)`.
   - ASSERT `spyB.calls == 1` and `"⚠️" in spyB.posted_short` and
     `"không phát hiện rủi ro" not in spyB.posted_short` (NOT the degraded empty-risk short).
     i.e. the resumed short reflects the ACTUAL risks carried in state, not box=[].

2. `test_okr_resume_rebuild_posts_real_rollup`
   - rollup with an at-risk / objective; graphA pause; graphB rebuild + resume approve.
   - ASSERT `spyB.calls == 1`; **no KeyError** (the whole test would error today at
     `box["rollup"]`); and the posted short contains the objective/`OKR Status` head
     (e.g. `"OKR Status" in spyB.posted_short`), proving it came from the checkpointed short.

3. `test_resource_resume_rebuild_posts_real_snapshot`
   - resource snapshot with an overloaded person (internal) → short head reflects load;
     graphA pause; graphB rebuild + resume approve.
   - ASSERT `spyB.calls == 1`; **no KeyError** (today: `box["snapshot"]`); posted short contains
     the resource head (`"Resource & Cost" in spyB.posted_short`).

Plus an explicit no-KeyError guard:

4. `test_okr_resource_resume_rebuild_no_keyerror`
   - parametrized okr + resource: graphA pause → graphB (fresh) resume approve → assert it
     returns a dict with `delivered is True` and does NOT raise. (Today this raises KeyError;
     the test makes the regression permanent.)

Optional (cheap) regression assertion:

5. `test_internal_short_identical_after_fix` — build an internal graph (no checkpointer), capture
   the posted short, assert it equals the short the OLD path would produce (compare against the
   direct builder output) — guards "internal short byte-identical".

### Existing tests to update (signature only, assertions preserved)

- `tests/test_approval_gate_interrupt.py`: `_DeliverSpy.__call__(self, risks, body, approved)` →
  `(self, short, body, approved)`; `_fake_deps.compose` → return `(body, cost, short)`.
- `tests/test_approval_gate_okr_resource.py`: `_okr_graph`/`_resource_graph` deps `compose` →
  3-tuple; `deliver` lambdas → `(short, body, approved)`.

### Builder + round-trip regression

- Existing short-builder unit tests (grep `build_slack_short` / `build_okr_slack_short` /
  `build_resource_slack_short` in `tests/`) MUST pass unchanged after the `slack_link.py`
  extraction — that is the no-regression proof for the non-resume path.

### Run order

```
uv run pytest tests/test_resume_rebuild_deliver.py -q          # new, must pass
uv run pytest tests/test_approval_gate_interrupt.py tests/test_approval_gate_okr_resource.py -q
uv run pytest tests/test_worker_resume.py -q                   # worker path unaffected
uv run pytest -q                                               # full suite (target: 485 green + new)
ruff check src tests
```

---

## Risks (L×I → mitigation)

| # | Risk | L×I | Mitigation |
|---|---|---|---|
| S4-R1 | `inject_link` `removesuffix` mismatch (stored short didn't end in `NO_LINK_LINE`) → broken link or duplicated line. | L×Med | The stored short is ALWAYS built with `detail_url=None`, so it ALWAYS ends in `NO_LINK_LINE`; `removesuffix` is a no-op-safe exact match. Unit-test `inject_link` directly for both url/no-url. |
| S4-R2 | Non-resume internal short changes (regression). | L×High | The refactor produces byte-identical output (same text, same fallback); guard with the existing builder unit tests + test 5. |
| S4-R3 | Weekly-internal okr/resource slack lines now built at compose, not deliver → drift. | L×Low | They are deterministic from config (no model); building them at compose is equivalent. Covered by the weekly delivery test if present; add an assert if not. |
| S4-R4 | Resource external URL gate lost in the refactor → a stakeholder gets the internal Confluence link. | L×High | The gate (`short_url = None if external`) stays in `_deliver`; `inject_link(short, None)` returns the no-link short unchanged. Add an external-resource resume test asserting NO `📄` link in the posted short. |
| S4-R5 | Files push further over 200 LOC. | M×Low | Net-neutral move; extract `*_delivery.py` if any file grows past its current count (okr/resource already use a sibling delivery helper). |

## Rollback

Single focused commit on the feature branch. Revert restores the prior (buggy) box-based deliver
and removes `slack_short` from state — no migration, no schema, no checkpoint format change that
outlives the process (M2 checkpoints are local SqliteSaver, ephemeral per the P5 design note in
`worker_resume.py:13-15`). A checkpoint written WITH `slack_short` and resumed AFTER a revert
simply ignores the extra key (state is `total=False`); a checkpoint written WITHOUT it and
resumed after the fix hits the old bug — acceptable since checkpoints are not durable across the
fix (same-process/same-day in M2).

## Success criteria (observable)

- [ ] A graph built, paused at the gate, then **REBUILT fresh** (empty box) and resumed with
  `Command(resume="approve")` posts a short that reflects the ACTUAL risks/rollup/snapshot — for
  all 3 kinds.
- [ ] okr + resource resume on a rebuilt graph does NOT raise `KeyError` and returns
  `delivered is True`.
- [ ] daily resume on a rebuilt graph posts the real-risk short (NOT the
  `không phát hiện rủi ro` degraded short).
- [ ] External resource resumed short carries NO Confluence link (gate preserved).
- [ ] Internal (non-resume) short byte-identical to pre-fix.
- [ ] Full suite green (485 baseline + new), `ruff check` clean, no file grows past its current
  LOC.

## Unresolved questions

1. **Seam shape**: this phase locks `deps.deliver(short_no_url, body, approved)` (URL injected
   inside `_deliver`). The alternative — inject the URL in the NODE and pass a finished short —
   would move `inject_link` + the resource external gate into graph code (worse: the node would
   need to know the link text + the external gate). Confirm the in-`_deliver` injection is
   acceptable (it keeps URL ownership next to page creation). Recommended: yes.
2. **Compose-time okr/resource weekly slack lines** (`report_graph.py:162-167`) move to compose.
   Confirm no caller relies on them being built at deliver time (none found). 
