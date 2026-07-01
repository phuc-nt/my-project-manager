"""hr-pack headcount graph (v3 M6).

Builds a `perceive → analyze → compose → deliver` graph for the HR `headcount` report,
reusing the SAME core machinery PM uses — ReportState, the approval gate, the remember
node, the Confluence/Slack writers, the Action Gateway — all IMPORTED from `src/`, none
modified (the M6 `git diff src/` = empty gate). What is HR-specific lives in this pack:
the tool provider (Confluence + Google Sheet via `gws`), the headcount analyzer, and the
prompt assets (all in sibling `domain_pack_hr.*` modules).

The builder signature matches the uniform pack contract so the core dispatches headcount
exactly like any PM kind.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, date, datetime

from langgraph.graph import END, START, StateGraph

from src.actions.action_gateway import ActionGateway
from src.actions.confluence_write import create_report_page
from src.actions.slack_write import deliver_report
from src.agent.approval_gate import add_approval_gate, external_summary
from src.agent.audience_delivery import SLACK_OK_STATUSES, delivery_summary
from src.agent.memory_node import add_remember_node
from src.agent.state import ReportState
from src.llm.client import LlmClient
from src.llm.slack_link import inject_link
from src.profile.context import EMPTY


def _today_utc() -> date:
    return datetime.now(UTC).date()


def build_headcount_graph(
    checkpointer=None, *, config=None, settings=None, context=EMPTY,
    audience="internal", store=None, remember=None, tools=None,
):
    """Build + compile the HR headcount graph. `tools` is the HR ToolProvider (M6 S2);
    None ⇒ resolve the hr pack's provider so the graph is runnable standalone."""
    if config is None or settings is None:
        raise ValueError("build_headcount_graph needs config + settings.")
    if tools is None:
        from src.packs.registry import PackRegistry

        tools = PackRegistry().load("hr").tools

    from domain_pack_hr.analyzers import (
        build_headcount,
        build_headcount_slack_short,
        fallback_headcount_narrative,
        render_headcount_xhtml,
    )
    from domain_pack_hr.prompts_build import build_headcount_narrative_messages

    gw = ActionGateway(settings, external_channels=config.slack_external_channels)
    box: dict[str, object] = {}
    llm_box: dict[str, object] = {}

    def perceive(_state: ReportState) -> dict:
        # HR ToolProvider reads Confluence + the Google Sheet into generic Task records.
        box["records"] = tools.read("headcount", config, settings)
        return {}

    def analyze_node(_state: ReportState) -> dict:
        report = build_headcount(box.get("records", []))  # pure function
        box["report"] = report
        # Serialize the per-group counts into ReportState.risks (checkpoint-safe dicts).
        return {"risks": [asdict(g) for g in report.groups]}

    def compose_report(_state: ReportState) -> dict:
        report = box.get("report")
        report_date = _today_utc().isoformat()
        body = _narrate(report, report_date) + render_headcount_xhtml(report, report_date)
        short = build_headcount_slack_short(report, report_date=report_date)
        return {"report_text": body, "cost_usd": llm_box.get("cost"), "slack_short": short}

    def _narrate(report, report_date: str) -> str:
        try:
            llm = llm_box.get("llm") or LlmClient(settings)
            llm_box["llm"] = llm
            result = llm.complete(
                build_headcount_narrative_messages(
                    report, report_date=report_date, persona=context.persona,
                    project=context.project, memory=context.memory,
                )
            )
            llm_box["cost"] = result.cost_usd
            return result.content
        except Exception:  # noqa: BLE001 — a narrative failure must not drop the numeric table
            return fallback_headcount_narrative(report)

    def deliver(state: ReportState) -> dict:
        approved = state.get("approval_decision") == "approve"
        report_date = _today_utc().isoformat()
        title = f"Báo cáo nhân sự (Headcount) {report_date}"
        conf_result, page = create_report_page(
            title, state.get("report_text", ""), gateway=gw, config=config,
            report_date=report_date, rationale="HR headcount report (detail)", approved=approved,
        )
        detail_url = page.url if page else None
        short = inject_link(
            state.get("slack_short", ""), detail_url,
            text="Xem báo cáo nhân sự chi tiết trên Confluence",
        )
        slack_result = deliver_report(
            short, gateway=gw, config=config, channel=config.slack_report_channel,
            report_date=report_date, rationale="HR headcount report (short + link)",
            approved=approved,
        )
        ok = (
            conf_result.status in {"executed", "dry_run"}
            and slack_result.status in SLACK_OK_STATUSES
        )
        return {
            "delivered": ok,
            "delivery_summary": delivery_summary(conf_result.status, slack_result, detail_url),
        }

    builder = StateGraph(ReportState)
    builder.add_node("perceive", perceive)
    builder.add_node("analyze", analyze_node)
    builder.add_node("compose_report", compose_report)
    builder.add_node("deliver", deliver)
    builder.add_edge(START, "perceive")
    builder.add_edge("perceive", "analyze")
    builder.add_edge("analyze", "compose_report")
    # Same Lớp B interrupt gate as PM: an external-audience run pauses before deliver.
    add_approval_gate(
        builder, audience=audience, summary=external_summary("headcount", audience, config)
    )
    if remember is not None:
        add_remember_node(builder, remember)
    else:
        builder.add_edge("deliver", END)
    return builder.compile(checkpointer=checkpointer, store=store)


REPORT_KINDS = {"headcount": build_headcount_graph}
