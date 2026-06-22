"""OKR rollup fetch + the weekly-embedded OKR section (fault-isolated).

Split from `okr_report_graph` so the standalone OKR graph and the weekly-embedded
OKR section live in separate, small modules. `build_okr_rollup` is the single
fetch+analyze entry shared by both the standalone OKR report and the weekly
section; the `weekly_*` helpers wrap it so a missing page or a fetch failure never
aborts the weekly report.
"""

from __future__ import annotations

import logging

from src.agent.okr_analyzer import OkrRollup, build_objectives

logger = logging.getLogger(__name__)


def _split_keys(cell: str) -> tuple[str, ...]:
    """Split an Epic Key(s) cell into keys to fetch (reuses the table parser)."""
    from src.tools.confluence_read import parse_epic_keys

    return parse_epic_keys(cell)


def build_okr_rollup() -> OkrRollup:
    """Fetch + analyze the configured OKR page into a rollup.

    Raises if `OKR_CONFLUENCE_PAGE_ID` is unset or a fetch fails — callers that
    must not abort (the weekly report) wrap this in `weekly_okr_section`.
    """
    from src.config.reporting_config import get_reporting_config
    from src.tools import okr_read
    from src.tools.confluence_read import get_page_content, parse_okr_table

    cfg = get_reporting_config()
    page_id = cfg.okr_confluence_page_id
    if not page_id:
        raise RuntimeError("OKR_CONFLUENCE_PAGE_ID is not set.")
    content = get_page_content(page_id)
    rows, parse_problems = parse_okr_table(content)
    epic_keys = [k for _, _, cell, _ in rows for k in _split_keys(cell)]
    epic_progress = okr_read.get_epic_progress_map(epic_keys)
    rollup = build_objectives(rows, epic_progress, behind_threshold=cfg.okr_behind_threshold)
    if parse_problems:
        rollup = OkrRollup(
            objectives=rollup.objectives,
            problems=tuple(parse_problems) + rollup.problems,
            at_risk=rollup.at_risk,
        )
    return rollup


def weekly_okr_section(report_date: str) -> str:
    """OKR block to append to the weekly Confluence detail. Fault-isolated.

    Returns "" when OKR is not configured. On ANY fetch/analyze failure, returns a
    short error note instead of raising — the weekly report must never fail
    because OKR failed.
    """
    from src.config.reporting_config import get_reporting_config
    from src.llm.okr_report_prompt import render_okr_table_xhtml

    if not get_reporting_config().okr_confluence_page_id:
        return ""  # OKR not configured → omit silently
    try:
        rollup = build_okr_rollup()
    except Exception as exc:  # never abort the weekly report on OKR failure
        # Log the detail; keep raw exception text (which may contain markup or
        # leaked internals) out of the stakeholder-facing page body.
        logger.warning("Weekly OKR section skipped (fetch/analyze failed): %s", exc)
        return "<p>Không lấy được dữ liệu OKR (xem log để biết chi tiết).</p>"
    return render_okr_table_xhtml(rollup, report_date=report_date)


def weekly_okr_slack_line() -> str:
    """One-line OKR summary for the weekly Slack short, or "" when unconfigured/failed."""
    from src.config.reporting_config import get_reporting_config
    from src.llm.okr_report_prompt import overall_pct

    if not get_reporting_config().okr_confluence_page_id:
        return ""
    try:
        rollup = build_okr_rollup()
    except Exception as exc:
        logger.warning("Weekly OKR Slack line skipped: %s", exc)
        return ""
    overall = overall_pct(rollup)
    overall_txt = f"{overall:.0f}%" if overall is not None else "n/a"
    risk = f", {len(rollup.at_risk)} cần chú ý" if rollup.at_risk else ""
    return f"\n• OKR: {overall_txt} trung bình{risk}"
