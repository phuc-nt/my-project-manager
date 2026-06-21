"""Agent graph state (Phase 0 — minimal).

This is the typed state threaded through the LangGraph nodes. Phase 0 only needs
to carry a user message in and the LLM reply + cost out. The full reporting state
(raw_signals, analysis, risks, planned_actions, report_draft, ...) arrives in
Phase 1 per system-architecture.md §3.
"""

from __future__ import annotations

from typing import Any

from typing_extensions import TypedDict


class AgentState(TypedDict):
    """Minimal hello-agent state. Optional keys are filled by nodes."""

    user_input: str
    llm_response: str
    cost_usd: float | None


class ReportState(TypedDict, total=False):
    """State for the Phase 1 reporting flow: perceive→analyze→compose→deliver.

    `total=False` so each node fills its slice. `issues`/`prs`/`ci`/`risks` hold
    normalized model objects; `report_text` is the composed report; `delivered`
    + `audit_ref` capture the post outcome.
    """

    issues: list[Any]  # list[Issue]
    prs: list[Any]  # list[PullRequest]
    ci: list[Any]  # list[CiRun]
    risks: list[Any]  # list[Risk]
    report_text: str
    cost_usd: float | None
    delivered: bool
    delivery_summary: str
