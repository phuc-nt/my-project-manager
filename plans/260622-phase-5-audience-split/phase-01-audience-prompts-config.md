# Phase 5 · Slice A — Audience-aware prompt builders + stakeholder config

> **Status: ✅ DONE (2026-06-22).** `audience` param on all 4 report families; external
> system prompts extracted to `audience_external_prompts.py`; external resource drops
> names/labor; config `slack_stakeholder_channel` + must-be-in-external validation. 17 UT;
> internal output byte-identical.

> Pure layer. Add an `audience: str = "internal"` parameter to every prompt builder
> for the 4 report families, with an external (business-tone) variant; add a
> `slack_stakeholder_channel` config field validated to be in the external set. No
> graph, delivery, or CLI changes here (Slice B). All unit-testable, no network.

## Context (file:line)

- `src/llm/report_prompt.py`
  - `_SYSTEM` (16-25), `build_report_messages` (40-56) — daily/weekly Slack-mrkdwn report.
  - `_DETAIL_SYSTEM` (61-68), `build_detail_messages` (71-107) — Confluence XHTML detail.
  - `_format_risks` (28-37) — renders raw `r.subject`/`r.detail` (carries issue keys).
  - `REPORT_TITLES` (111-116), `build_slack_short` (119-137) — deterministic Slack short.
- `src/llm/okr_report_prompt.py`
  - `_NARRATIVE_SYSTEM` (108-114), `build_okr_narrative_messages` (117-137),
    `fallback_okr_narrative` (140-152) — LLM prose (already qualitative, no keys).
  - `build_okr_slack_short` (87-105) — deterministic Slack short.
  - `render_okr_table_xhtml` (30-78) — deterministic table; **audience-neutral, keep as-is**.
- `src/llm/resource_report_prompt.py`
  - `_slack_safe` (30-32), `_cost_lines` (45-57), `render_resource_xhtml` (60-88) —
    deterministic; **keep as-is** (internal page).
  - `build_resource_slack_short` (91-119) — exposes assignee names + labor cost.
  - `_NARRATIVE_SYSTEM` (122-128), `build_resource_narrative_messages` (131-158),
    `fallback_resource_narrative` (161-175) — LLM prose (passes overloaded names).
- `src/config/reporting_config.py`
  - `ReportingConfig` dataclass (59-91), `slack_external_channels` field (67),
    `get_reporting_config` (99-155), the external-channels parse (140-142).
- `config.example.env:55` — `SLACK_EXTERNAL_CHANNELS=` (privacy-blocked; append via shell).

## Requirements

R1. Every prompt builder takes `audience: str = "internal"`. `internal` reproduces the
    current output **byte-identical** (same system prompt string, same user message,
    same deterministic Slack-short text). `external` selects a business-tone variant.

R2. External report tone (daily/weekly/okr/resource): a stakeholder/customer progress
    update — progress %, status, milestones; NO raw issue keys, NO PR numbers, NO
    internal blocker chatter, no "ai/cái gì" task-assignment detail. Vietnamese,
    business register (suitable to send a client).

R3. External daily/weekly user message must NOT pass raw `r.subject`/`r.detail`
    (they contain issue keys like `SCRUM-15`). Pass a SUMMARIZED risk view: counts by
    severity + a qualitative phrase, never the per-risk key/detail line.

R4. External Slack shorts are softer/summarized:
    - daily/weekly `build_slack_short`: drop the `Nổi bật: <subject> — <detail>`
      headline (it carries a key); show status + counts only.
    - okr `build_okr_slack_short`: keep progress %/status, but the at-risk list (which
      may name internal objective names) — keep objective names (they are business-level,
      not issue keys) but frame as "cần chú ý"; acceptable for external. Confirm in tests.
    - resource `build_resource_slack_short`: **external = no assignee names, no
      per-assignee numbers, no labor cost** — only `len(loads)` people, a capacity word
      (`ổn` vs `căng`), and the LLM-budget band. (Privacy — see R6.)

R5. okr/resource LLM narratives already pass only qualitative facts (no keys). For
    external, swap the system prompt to the business-tone one. The okr narrative may
    keep at-risk objective NAMES (business-level). The resource external narrative must
    NOT pass overloaded assignee names — pass only a capacity word + budget word.

R6. **External resource privacy:** external resource output (short + narrative) carries
    NO assignee names, NO per-person counts, NO labor cost. Recommended shape: a single
    capacity word derived from `len(resource.overloaded)` (`0 ⇒ "ổn"`, else `"đang
    căng tải"`) + LLM-budget band. The deterministic per-assignee `render_resource_xhtml`
    table is internal-only and unchanged (external still creates a Confluence page in
    Slice B — see Open Qs for whether external should get a different/no page).

R7. Config: add `slack_stakeholder_channel: str | None` to `ReportingConfig`, loaded
    from `SLACK_STAKEHOLDER_CHANNEL`. **Validation:** if set and NOT in
    `slack_external_channels`, raise a clear `RuntimeError` at `get_reporting_config()`
    load time (closes the auto-post-without-approval foot-gun). If unset, leave `None`
    (Slice B fails fast only when `--audience external` is actually requested).

R8. No file may exceed 200 LOC after the edits. `report_prompt.py` is 138 LOC,
    `okr_report_prompt.py` 153, `resource_report_prompt.py` 176 — adding an external
    branch may push `resource_report_prompt.py` over 200. If so, extract the external
    helpers into a sibling module `src/llm/audience_external_prompts.py` (KISS: one
    shared module for the external system-prompt strings + external Slack-short helpers
    across all 3 families) and import them. Decide during implementation; prefer
    in-file conditionals first, split only if a file would exceed 200 LOC.

## Design: how `audience` threads through a builder

Keep it a plain string param (matches existing `kind: str = "daily"` convention; no new
enum — YAGNI). Pattern per builder:

```
def build_report_messages(risks, *, report_date, audience="internal"):
    if audience == "external":
        system = _EXTERNAL_SYSTEM           # business tone, no keys/PR numbers
        user = _external_user(risks, report_date)   # summarized, no raw subject/detail
    else:
        system = _SYSTEM                    # unchanged
        user = _internal_user(risks, report_date)   # the exact current string
    return [{"role": "system", ...}, {"role": "user", ...}]
```

The `internal` branch must produce the **exact** current message list (extract the
current body verbatim into the `else`/`_internal_*` path — do not reword it).

### External summarized-risk helper (daily/weekly)

A new `_summarize_risks(risks) -> str` that yields, e.g.,
`"Tổng 5 tín hiệu: 2 nghiêm trọng, 3 trung bình. Tiến độ cần chú ý ở một số hạng mục."`
— counts by severity + a qualitative sentence, NEVER `r.subject`/`r.detail`/keys. The
external user message embeds this instead of `_format_risks`.

## Files to modify / create

**Modify** `src/llm/report_prompt.py`:
- Add `_EXTERNAL_SYSTEM` (Slack mrkdwn, business tone) + `_DETAIL_EXTERNAL_SYSTEM`
  (Confluence XHTML, business tone).
- Add `_summarize_risks(risks)` (severity counts, no keys).
- Add `audience="internal"` to `build_report_messages`, `build_detail_messages`,
  `build_slack_short`. Internal branch byte-identical; external branch per R2-R4.

**Modify** `src/llm/okr_report_prompt.py`:
- Add `_NARRATIVE_EXTERNAL_SYSTEM` (business tone).
- Add `audience="internal"` to `build_okr_narrative_messages`, `fallback_okr_narrative`,
  `build_okr_slack_short`. `render_okr_table_xhtml` + `overall_pct` UNCHANGED.

**Modify** `src/llm/resource_report_prompt.py`:
- Add `_NARRATIVE_EXTERNAL_SYSTEM` (business tone, capacity+budget only).
- Add `audience="internal"` to `build_resource_narrative_messages`,
  `fallback_resource_narrative`, `build_resource_slack_short`. External branch per
  R4/R6 (no names, no labor). `render_resource_xhtml` + `_cost_lines` UNCHANGED.
- Add `_capacity_word(resource) -> str` helper (`"ổn"` / `"đang căng tải"`).

**Modify** `src/config/reporting_config.py`:
- Add `slack_stakeholder_channel: str | None` field to `ReportingConfig`.
- Load `os.getenv("SLACK_STAKEHOLDER_CHANNEL") or None`.
- After building `slack_external_channels`, validate: if `slack_stakeholder_channel`
  and `slack_stakeholder_channel not in slack_external_channels` → raise `RuntimeError`
  with a message naming both env vars. (Place validation inside `get_reporting_config`
  before constructing/returning the dataclass.)

**Append** to `config.example.env` (privacy-blocked file — use shell `cat >>`):
```
# Phase 5: the single Slack channel external/stakeholder reports post to.
# MUST also be listed in SLACK_EXTERNAL_CHANNELS so the post routes through Lớp B
# human approval (otherwise it would auto-post to stakeholders without review).
SLACK_STAKEHOLDER_CHANNEL=
```

**Create** `tests/test_audience_prompts.py` (see Tests).

**(Conditional create)** `src/llm/audience_external_prompts.py` — only if a prompt file
would exceed 200 LOC; holds shared external system-prompt strings + external helpers.

## Implementation steps

1. `report_prompt.py`: extract current internal user/message bodies verbatim into the
   `internal` branch; add `_EXTERNAL_SYSTEM`, `_DETAIL_EXTERNAL_SYSTEM`,
   `_summarize_risks`; wire `audience` into the 3 functions.
2. `okr_report_prompt.py`: add `_NARRATIVE_EXTERNAL_SYSTEM`; wire `audience` into the 2
   narrative builders + Slack short. Keep the table renderer untouched.
3. `resource_report_prompt.py`: add `_NARRATIVE_EXTERNAL_SYSTEM` + `_capacity_word`;
   wire `audience` into the narrative builders + Slack short, dropping names/labor for
   external. Keep `render_resource_xhtml`/`_cost_lines` untouched.
4. `reporting_config.py`: add field + load + validation raise.
5. Append the env example.
6. If any prompt file > 200 LOC, extract external strings/helpers to
   `src/llm/audience_external_prompts.py` and import; re-run ruff.
7. Write `tests/test_audience_prompts.py`.

## Tests / validation (`tests/test_audience_prompts.py`)

Backward-compat (the gate):
- `build_report_messages(risks, report_date=D)` == its `audience="internal"` call ==
  the current byte-for-byte expected message list (assert system + user strings).
- Same equality for `build_detail_messages`, `build_slack_short`,
  `build_okr_*`, `build_resource_*` internal calls.

External tone + leak prevention:
- Daily/weekly: with a risk whose `subject="SCRUM-15"`, `detail="PR #42 ..."`, the
  `external` user message + system message contain neither `"SCRUM-15"` nor `"#42"`.
- okr external: narrative system prompt differs from internal; objective names allowed.
- resource external short + narrative: assert NO assignee name (seed
  `overloaded=["Alice"]`), NO labor figure, NO per-assignee count appears; capacity
  word + budget band present.
- External Slack shorts: daily/weekly external short has no `Nổi bật:` headline.

Config validation:
- `SLACK_STAKEHOLDER_CHANNEL` set + IN `SLACK_EXTERNAL_CHANNELS` → loads, field set.
  (Use monkeypatch on env + `get_reporting_config.cache_clear()`.)
- `SLACK_STAKEHOLDER_CHANNEL` set + NOT in `SLACK_EXTERNAL_CHANNELS` → raises
  `RuntimeError` naming both vars.
- `SLACK_STAKEHOLDER_CHANNEL` unset → field is `None`, no raise.

Run: `uv run pytest tests/test_audience_prompts.py` then full `uv run pytest` +
`uv run ruff check src tests`. ALL existing tests must pass unchanged.

## Data flow (Slice A)

```
risks / rollup / (resource,cost)  ──┐
                                     ├─ audience="internal" ─→ current prompt/short (unchanged)
report_date, audience  ─────────────┘
                                     └─ audience="external"  ─→ business-tone system prompt
                                                                + summarized/anonymized user msg
                                                                + names/labor-free resource short
env: SLACK_STAKEHOLDER_CHANNEL ──→ get_reporting_config() ──→ validate ∈ slack_external_channels
                                                              (raise on miss) → config.slack_stakeholder_channel
```

## Risks / rollback (slice)

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Internal output drifts (reworded while extracting to the `else` branch) | L×H | Byte-equality unit tests vs the current expected strings; extract verbatim, don't paraphrase. |
| External daily/weekly still leaks a key via the summarized helper | M×M | `_summarize_risks` uses only `len`/`severity`; unit test asserts no key in the external payload. |
| A prompt file crosses 200 LOC | M×L | Extract external strings/helpers to `audience_external_prompts.py` (step 6). |
| Config validation breaks unrelated flows that never set the stakeholder var | L×M | Validation only fires when `slack_stakeholder_channel` is set; unset ⇒ no-op. Test covers the unset case. |

**Rollback:** revert the 4 modified source files + the env append, delete
`tests/test_audience_prompts.py` (and `audience_external_prompts.py` if created). The
`audience` param defaults to `internal`, so even a partial revert leaves callers safe.

## Acceptance (slice)

- [ ] All prompt builders accept `audience="internal"`; internal output byte-identical
      (unit-asserted). #1 backward-compat criterion.
- [ ] External daily/weekly/okr/resource prompts use business tone; daily/weekly +
      resource external outputs contain no issue keys / PR numbers; resource external
      contains no assignee name / labor cost.
- [ ] `slack_stakeholder_channel` config field loads; validation raises iff set and not
      in `slack_external_channels`; unset ⇒ `None` no raise.
- [ ] `config.example.env` documents `SLACK_STAKEHOLDER_CHANNEL` + the must-be-external rule.
- [ ] `uv run pytest` + `uv run ruff check src tests` pass; no file > 200 LOC.
