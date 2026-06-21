"""Phase 1 reporting graph: perceive → analyze → compose_report → deliver.

Reads Jira (MCP) + GitHub (gh), detects risks, has the LLM compose a report, and
posts it to Slack through the Action Gateway. All external dependencies are
injected via `ReportDeps` so the graph runs in tests with fakes (no network, no
key, no subprocess). The default deps wire the real implementations.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from src.actions.action_gateway import ActionGateway
from src.actions.slack_write import deliver_report
from src.agent.risk_analyzer import analyze
from src.agent.state import ReportState
from src.llm.client import LlmClient
from src.llm.report_prompt import build_report_messages
from src.tools.models import CiRun, Issue, PullRequest, Risk

logger = logging.getLogger(__name__)


@dataclass
class ReportDeps:
    """Injectable collaborators for the report flow (real or fake)."""

    fetch_issues: Callable[[], list[Issue]]
    fetch_prs: Callable[[], list[PullRequest]]
    fetch_ci: Callable[[], list[CiRun]]
    analyze_risks: Callable[[list[Issue], list[PullRequest], list[CiRun]], list[Risk]]
    compose: Callable[[list[Risk]], tuple[str, float | None]]
    deliver: Callable[[str], tuple[bool, str]]


def _today_utc() -> date:
    return datetime.now(UTC).date()


def default_report_deps(
    *, client: LlmClient | None = None, gateway: ActionGateway | None = None
) -> ReportDeps:
    """Wire the real implementations (lazy imports keep graph-build network-free)."""
    from src.config.reporting_config import get_reporting_config
    from src.tools import github_read, jira_read

    cfg = get_reporting_config()
    gw = gateway or ActionGateway()
    llm = client

    def _compose(risks: list[Risk]) -> tuple[str, float | None]:
        nonlocal llm
        if llm is None:
            llm = LlmClient()
        messages = build_report_messages(risks, period_label="hôm nay")
        result = llm.complete(messages)
        return result.content, result.cost_usd

    def _deliver(text: str) -> tuple[bool, str]:
        outcome = deliver_report(
            text,
            gateway=gw,
            report_date=_today_utc().isoformat(),
            rationale="scheduled/triggered progress report",
        )
        return outcome.status in {"executed", "dry_run"}, outcome.summary

    return ReportDeps(
        fetch_issues=lambda: jira_read.get_open_issues(),
        fetch_prs=lambda: github_read.get_open_prs(),
        fetch_ci=lambda: github_read.get_recent_ci(),
        analyze_risks=lambda issues, prs, ci: analyze(
            issues, prs, ci, today=_today_utc(),
            blocker_label_substring=cfg.blocker_label_substring,
        ),
        compose=_compose,
        deliver=_deliver,
    )


def _make_nodes(deps: ReportDeps):
    def perceive(_state: ReportState) -> dict:
        return {
            "issues": deps.fetch_issues(),
            "prs": deps.fetch_prs(),
            "ci": deps.fetch_ci(),
        }

    def analyze_node(state: ReportState) -> dict:
        risks = deps.analyze_risks(
            state.get("issues", []), state.get("prs", []), state.get("ci", [])
        )
        return {"risks": risks}

    def compose_report(state: ReportState) -> dict:
        text, cost = deps.compose(state.get("risks", []))
        return {"report_text": text, "cost_usd": cost}

    def deliver(state: ReportState) -> dict:
        delivered, summary = deps.deliver(state.get("report_text", ""))
        return {"delivered": delivered, "delivery_summary": summary}

    return perceive, analyze_node, compose_report, deliver


def build_report_graph(
    checkpointer: SqliteSaver | None = None, *, deps: ReportDeps | None = None
) -> CompiledStateGraph:
    """Build + compile the reporting graph. `deps` defaults to real wiring."""
    resolved = deps or default_report_deps()
    perceive, analyze_node, compose_report, deliver = _make_nodes(resolved)

    builder = StateGraph(ReportState)
    builder.add_node("perceive", perceive)
    builder.add_node("analyze", analyze_node)
    builder.add_node("compose_report", compose_report)
    builder.add_node("deliver", deliver)
    builder.add_edge(START, "perceive")
    builder.add_edge("perceive", "analyze")
    builder.add_edge("analyze", "compose_report")
    builder.add_edge("compose_report", "deliver")
    builder.add_edge("deliver", END)
    return builder.compile(checkpointer=checkpointer)
