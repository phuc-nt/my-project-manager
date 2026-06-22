# Phase 5 · Slice B — Thread audience through graphs + delivery + CLI/cron + E2E

> **Status: ✅ DONE (2026-06-22).** `audience` threaded through 3 graphs + deps;
> `audience_delivery.resolve_audience_delivery` (channel + dedup, fail-fast); `pending_approval`
> accepted as success; CLI/cron `--audience`. Plus `_dispatch_approved_action` (E2E exposed the
> Phase-2 approve stub). C1 fixed (external resource short omits the leaky Confluence link). Real
> E2E: external weekly → Lớp B → approve → posted ts=…. 18 UT.

> Wires Slice A's audience-aware builders into the 3 report graphs: compose picks the
> audience prompt; deliver picks the channel (stakeholder for external) and treats
> `pending_approval` as success; CLI + cron gain `--audience internal|external`. Then
> E2E: internal unchanged, external → Confluence page + Slack post that returns
> `pending_approval` → appears in `cli approvals`.

Depends on: **Slice A** (audience prompt builders + `slack_stakeholder_channel` config
+ its validation must exist).

## Context (file:line)

- `src/agent/report_graph.py`
  - `ReportDeps` (30-44), `default_report_deps(*, report_kind=..., client, gateway)`
    (51-158), `_compose` (93-114), `_deliver` (116-146 — calls `build_slack_short`
    127-129, `deliver_report` 136-141, ok-check 142-145), `build_report_graph`
    (197-221).
- `src/agent/okr_report_graph.py`
  - `OkrReportDeps` (33-39), `default_okr_deps(*, gateway)` (46-100), `_compose`
    (62-66), `_deliver` (81-98), `build_okr_graph` (133-150).
- `src/agent/resource_report_graph.py`
  - `ResourceReportDeps` (35-41), `default_resource_deps(*, gateway)` (48-109),
    `_compose` (64-68), `_deliver` (86-105), `build_resource_graph` (137-154).
- `src/actions/slack_write.py` — `deliver_report(text, *, gateway, channel=None,
   report_date, rationale)` (47-73); `_dedup_key(channel, report_date)` (38-44,
   per-channel ⇒ internal+external dedup independently).
- `src/actions/action_gateway.py` — `GatewayResult.status` includes `pending_approval`
   with `approval_id` set (63-72, 202-206); Lớp B enqueue path (192-206).
- `src/actions/hard_block.py` — `needs_interrupt` (79-111): `post_message` to a channel
   in `external_channels` ⇒ Lớp B. **UNCHANGED — confirm, do not edit.**
- `src/config/reporting_config.py` — `slack_stakeholder_channel` (added in Slice A),
   `slack_external_channels` (67).
- `src/entrypoints/cli.py` — `_run_report(report_kind)` (43-67), `_parse_report_kind`
   (70-81), `main` dispatch (189-190).
- `src/entrypoints/cron.py` — `_report_kind` (22-30), `_build_graph` (33-46), `main`
   (49-69, `return 0 if delivered else 1`).
- `src/agent/report_graph.py` weekly embed (108-114, 130-135) — embedded okr/resource
   sub-sections (Open Q: drop for external weekly).

## Requirements

R1. **Thread `audience` into the 3 graph builders + their default-deps.** Signatures:
    - `default_report_deps(*, report_kind="daily", audience="internal", client=None,
      gateway=None)`
    - `default_okr_deps(*, audience="internal", gateway=None)`
    - `default_resource_deps(*, audience="internal", gateway=None)`
    - `build_report_graph(checkpointer=None, *, deps=None, report_kind="daily",
      audience="internal")`
    - `build_okr_graph(checkpointer=None, *, deps=None, audience="internal")`
    - `build_resource_graph(checkpointer=None, *, deps=None, audience="internal")`
    Each `build_*` passes `audience` to `default_*_deps` only when `deps` is None
    (mirrors how `report_kind` is passed today). State stays primitives-only; `audience`
    is a closure var in the deps, NOT a state field.

R2. **Compose picks the audience prompt.** `_compose` passes `audience=audience` to the
    relevant builder(s): `build_detail_messages(..., audience=audience)` (report),
    `build_*_narrative_messages(..., audience=audience)` + `fallback_*` (okr/resource).

R3. **Deliver picks the channel + handles pending_approval.**
    - Resolve the target channel: `external` ⇒ `cfg.slack_stakeholder_channel`;
      `internal` ⇒ `None` (i.e. the default `slack_report_channel`, current behavior).
    - **Fail fast** if `audience=external` and `slack_stakeholder_channel` is None:
      raise a clear `RuntimeError` ("SLACK_STAKEHOLDER_CHANNEL not set; required for
      --audience external") — never silently fall back to the internal channel.
    - Pass `channel=target` to `deliver_report` (signature already supports it).
    - Build the Slack short via the audience-aware builder (`audience=audience`).
    - **Dedup namespace by audience+kind**: the report_date passed to `create_report_page`
      and `deliver_report` becomes `f"{kind}-{audience}-{today}"` so an internal and an
      external run on the same day do not collide on the Confluence/Slack dedup key.
      (Slack dedup is already per-channel, but the Confluence page dedup is per
      space+date — without the audience suffix, the external run would dedup against the
      internal page. Add the audience suffix to BOTH report_date hints.)
    - **ok-check:** Slack `pending_approval` is SUCCESS. New accepted Slack statuses:
      `{"executed", "dry_run", "deduplicated", "pending_approval"}`. Confluence stays
      `{"executed", "dry_run"}` (external still creates a page). Return ok accordingly.
    - Delivery summary should surface the approval id when pending (the gateway result
      carries `approval_id`); include `slack=<status>` so the CLI prints it.

R4. **CLI `--audience` flag.** Add `_parse_audience(args) -> str` (default `"internal"`;
    `--audience external` ⇒ `"external"`, anything else ⇒ `"internal"`). Thread into
    `_run_report(report_kind, audience)`; pass to the matching `build_*_graph`. Update
    the usage string + the trailing status print to include the audience.

R5. **Cron `--audience` flag.** Mirror the CLI: `_audience(args)`; thread into
    `_build_graph(report_kind, audience)`. Document that an external cron → Lớp B →
    `pending_approval` → `delivered=True` (queued is success) but NOT posted until a
    human approves — the correct guardrail. Cron `return 0 if delivered else 1` still
    holds (pending counts as delivered).

R6. **Weekly external embedded sub-sections (Open Q resolution).** For an external
    weekly, the embedded okr/resource sub-sections (`weekly_okr_section`,
    `weekly_resource_section`, and the Slack lines) are internal-detail noise. Plan:
    SKIP the embedded sub-sections when `audience=external` (gate the two appends in
    `_compose`/`_deliver` on `audience == "internal"`). Flag for user confirmation
    (Open Q3). This keeps the external weekly a clean stakeholder summary.

R7. No change to `hard_block.py`, `action_gateway.py`, `slack_write.py`,
    `confluence_write.py`, the allowlist, or any approval mechanism. External routing is
    purely channel selection + Slice A prompts. Confirm by diff.

## Design: channel + dedup selection (in each `_deliver`)

```
cfg = get_reporting_config()
if audience == "external":
    target = cfg.slack_stakeholder_channel
    if not target:
        raise RuntimeError("SLACK_STAKEHOLDER_CHANNEL not set; required for --audience external.")
else:
    target = None  # ⇒ deliver_report uses slack_report_channel (current behavior)

date_hint = f"{kind}-{audience}-{today}"   # e.g. daily-external-2026-06-22
# create_report_page(report_date=date_hint, ...) and deliver_report(report_date=date_hint, channel=target)

slack_ok = slack_result.status in {"executed", "dry_run", "deduplicated", "pending_approval"}
conf_ok  = conf_result.status in {"executed", "dry_run"}
ok = conf_ok and slack_ok
summary = f"confluence={conf_result.status} slack={slack_result.status}"
if slack_result.approval_id is not None:
    summary += f" approval_id={slack_result.approval_id}"
summary += f" url={detail_url}"
```

> Backward-compat: with `audience="internal"`, `target=None` and
> `date_hint = f"{kind}-internal-{today}"`. **Caution:** the current internal hint is
> `f"{kind}-{today}"` (no audience). Changing it to `{kind}-internal-{today}` changes
> the dedup key, which is fine for fresh runs but means a same-day re-run after deploy
> won't dedup against a pre-deploy post. To keep internal byte-identical dedup, special-
> case: `date_hint = f"{kind}-{today}" if audience == "internal" else
> f"{kind}-{audience}-{today}"`. Use this form so the internal dedup key is UNCHANGED.

## Files to modify / create

**Modify** `src/agent/report_graph.py`: add `audience` param to `default_report_deps` +
`build_report_graph`; thread into `_compose` (`build_detail_messages` + the weekly embed
gate per R6) and `_deliver` (channel + dedup hint + ok-check + summary). `build_slack_short`
call gets `audience=audience`.

**Modify** `src/agent/okr_report_graph.py`: add `audience` to `default_okr_deps` +
`build_okr_graph`; thread into `_compose`/`_narrate` (narrative + fallback) and
`_deliver` (channel + dedup hint + ok-check + `build_okr_slack_short(audience=...)`).

**Modify** `src/agent/resource_report_graph.py`: add `audience` to
`default_resource_deps` + `build_resource_graph`; thread into `_compose`/`_narrate` and
`_deliver` (channel + dedup hint + ok-check + `build_resource_slack_short(audience=...)`).

**Modify** `src/entrypoints/cli.py`: add `_parse_audience`; `_run_report(report_kind,
audience)`; pass `audience` to each `build_*_graph`; update usage + status print.

**Modify** `src/entrypoints/cron.py`: add `_audience`; `_build_graph(report_kind,
audience)`; thread `audience` into the builders; log the audience.

**Create** `tests/test_audience_delivery.py` (see Tests).

> If `report_graph.py` (222 LOC today) grows past a comfortable limit after the audience
> threading, the weekly-embed gating is the only added branching — keep it inline
> (a 2-line `if audience == "internal":` guard). No new module needed.

## Implementation steps

1. `report_graph.py`: thread `audience` (deps + builder), compose prompt + weekly-embed
   gate, deliver channel/dedup/ok-check/summary.
2. `okr_report_graph.py`: same threading (no weekly embed here).
3. `resource_report_graph.py`: same threading.
4. `cli.py`: `_parse_audience` + `_run_report` signature + dispatch + usage/status.
5. `cron.py`: `_audience` + `_build_graph` signature + dispatch + log.
6. `tests/test_audience_delivery.py`.
7. Full `uv run pytest` + `uv run ruff check src tests`.
8. E2E (manual, real or dry-run) — see E2E below.

## Tests / validation (`tests/test_audience_delivery.py`)

Use injected fake deps + a fake gateway (the existing test pattern in
`test_slack_write_and_report_graph.py` / `test_okr_report.py` / `test_resource_report.py`).

Backward-compat:
- Build each graph with `audience="internal"` (default) using a fake gateway; assert the
  Slack channel arg is None (internal channel) and the dedup hint is `f"{kind}-{today}"`
  (no audience suffix) — matching current behavior. Existing graph tests untouched + pass.

External delivery routing:
- A fake `deliver_report` (or fake gateway) captures the `channel` kwarg; with
  `audience="external"` + config `slack_stakeholder_channel="C_STAKE"` (and
  `slack_external_channels={"C_STAKE"}`), assert `channel == "C_STAKE"` and the dedup
  hint is `f"{kind}-external-{today}"`.

pending_approval = success:
- Fake gateway returns `GatewayResult(status="pending_approval", summary=..., approval_id=7)`
  for the Slack post and `executed`/`dry_run` for the page. Assert `_deliver` returns
  `ok=True` and the summary contains `slack=pending_approval` + `approval_id=7`.

Fail-fast:
- `audience="external"` with `slack_stakeholder_channel=None` → `_deliver` (or graph
  invoke) raises `RuntimeError` mentioning `SLACK_STAKEHOLDER_CHANNEL`.

Lớp B integration (real gateway, dry-run off, fake MCP):
- Construct an `ActionGateway` with `external_channels={"C_STAKE"}` + a temp dedup/
  approval store; post via `deliver_report(channel="C_STAKE")`; assert result status is
  `pending_approval` and `gateway.pending_approvals()` lists it. (Confirms
  `needs_interrupt` routes the stakeholder channel to Lớp B WITHOUT any hard_block edit.)

CLI/cron parsing:
- `_parse_audience(["--audience","external"]) == "external"`;
  `_parse_audience([]) == "internal"`; `_parse_audience(["--audience","bogus"]) ==
  "internal"`. Same for cron `_audience`.

Weekly external embed gate (R6):
- With `audience="external"`, `_compose` for weekly does NOT append the okr/resource
  embedded sub-sections (assert the embed markers are absent from the body); with
  `audience="internal"` they ARE present (unchanged).

## E2E (manual — verify before marking phase done)

1. `.env`: set `SLACK_STAKEHOLDER_CHANNEL=<a test channel id>` and add the same id to
   `SLACK_EXTERNAL_CHANNELS`. (If the channel is NOT added to the external set,
   `get_reporting_config` must RAISE — verify that negative case once.)
2. `uv run python -m src.entrypoints.cli report --daily --audience external`:
   - Confluence page created (business-tone prose, no raw keys).
   - Slack post returns `pending_approval`; run prints `delivered=True
     slack=pending_approval approval_id=N`.
   - `uv run python -m src.entrypoints.cli approvals` lists action #N (post to the
     stakeholder channel).
   - `uv run python -m src.entrypoints.cli approve N` (optional) posts it for real.
3. `uv run python -m src.entrypoints.cli report --daily` (no flag) → posts to the
   internal channel, auto-executed (`delivered=True slack=executed`), behavior identical
   to pre-Phase-5.
4. Repeat #2 for `--weekly --audience external` (no internal okr/resource embed),
   `--okr --audience external`, `--resource --audience external` (no assignee names /
   labor cost in the Slack short).
5. `DRY_RUN=true` external run → `slack=dry_run`, no real post, no approval queued.

## Data flow (Slice B)

```
CLI/cron --audience ─→ build_*_graph(audience) ─→ default_*_deps(audience)
                                                      │
   perceive → analyze → compose ──(audience)──→ build_*_messages(audience) → LLM prose (tone)
                                                      │
                             deliver ──(audience)──→ channel = stakeholder|None
                                                     report_date = {kind}-{audience?}-{today}
                                                     deliver_report(channel=...) → gateway
                                                                                      │
   external channel ∈ slack_external_channels ──→ needs_interrupt = Lớp B ──→ GatewayResult(
                                                                                pending_approval, approval_id)
                                                      │
                             ok = conf_ok and slack_status ∈ {executed,dry_run,deduplicated,pending_approval}
                                                      │
                             cli approvals ←── ApprovalStore queue
```

## Risks / rollback (slice)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Internal dedup key changes → same-day re-run double-posts after deploy | M×M | Keep internal hint EXACTLY `f"{kind}-{today}"` (special-case in the date_hint expr); only external gets the `-external-` suffix. Unit test asserts the internal hint is unchanged. |
| `pending_approval` not handled in ALL 3 `_deliver` ok-checks → external `delivered=False` | M×M | Add the status to all 3 ok-checks; unit test each graph's `_deliver` with a fake `pending_approval` gateway result. |
| External requested but `slack_stakeholder_channel` None → silent post to internal channel (leak) | L×H | `_deliver` raises before posting; never falls back. Fail-fast unit test. |
| Threading `audience` accidentally changes the internal default path | L×H | `audience="internal"` default everywhere; existing graph test files run UNCHANGED as the gate. |
| Weekly external embed gate also breaks internal weekly | L×M | Gate is `if audience == "internal":` around the existing appends — internal path identical; unit test both branches. |

**Rollback:** revert the 5 modified files + delete `tests/test_audience_delivery.py`.
`audience` defaults to `internal`, so reverting B (leaving A) restores the current CLI/
cron/graph behavior with A's external prompts dormant. No gateway/allowlist/schema undo.

## Acceptance (slice)

- [ ] `--audience` threads CLI → cron → 3 graphs → deps → compose + deliver; state stays
      primitives-only.
- [ ] Internal default path byte-identical (channel None, dedup `{kind}-{today}`,
      auto-executed); existing graph tests pass UNCHANGED. #1 backward-compat.
- [ ] External posts to `slack_stakeholder_channel`, dedup `{kind}-external-{today}`,
      returns `pending_approval`, `ok=True`, appears in `cli approvals`.
- [ ] `--audience external` with no stakeholder channel raises a clear error (no
      internal fallback).
- [ ] External weekly omits the internal okr/resource embedded sub-sections.
- [ ] `hard_block.py` / `action_gateway.py` / `slack_write.py` / allowlist UNCHANGED
      (verified by diff). `uv run pytest` + `uv run ruff check src tests` pass.
- [ ] E2E: external daily → Confluence page + `pending_approval` Slack + listed in
      `approvals`; internal daily unchanged.

## Open questions (whole phase)

1. **External resource report shape / existence.** Plan implements a high-level,
   names-free, labor-free external resource report (capacity word + LLM-budget band).
   Should external resource exist at all, or be suppressed (stakeholders may not need
   internal team-capacity data)? Defaulting to "exists, high-level"; confirm.
2. **External Confluence page.** Plan creates the SAME Confluence page (same space,
   internal-visibility) for external runs; the stakeholder receives only the Slack
   short. Should external instead skip the Confluence page, or write to a separate
   stakeholder space/parent? Defaulting to same page; confirm.
3. **Weekly external embedded sub-sections.** Plan DROPS the embedded okr/resource
   sub-sections from an external weekly (they are internal noise). Confirm this is the
   desired stakeholder weekly shape (vs. keeping external-tone sub-sections).
4. **External Slack short link.** The internal short links to the Confluence detail page.
   For external (when the page is internal-visibility) the link may be useless/leaky to
   a stakeholder. Plan: external short omits the Confluence link (`detail_url=None` in
   the external short) — confirm, or keep the link if stakeholders share the wiki.
5. **deploy/launchd plist for external cron?** None planned (external cron just queues
   for approval; likely run on demand, not scheduled). Confirm no external plist needed.
