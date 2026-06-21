"""Jira READ tool — pull issues via the Jira MCP server, normalized to `Issue`.

Calls the MCP server (stdio subprocess) through `mcp_adapter` and maps raw Jira
REST v3 JSON into the tool-agnostic `Issue` model. The raw→Issue mapping is a
pure function (`parse_issue`) so it is unit-testable without spawning a server.

READ does not go through the Action Gateway (only mutations do).
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

from src.adapters.mcp_adapter import call_tool
from src.config.reporting_config import McpServerSpec, get_reporting_config
from src.tools.models import Issue

logger = logging.getLogger(__name__)

# Jira statuses that count as "done" (case-insensitive) for overdue checks.
_DONE_STATUSES = {"done", "closed", "resolved"}


def _parse_due(raw: Any) -> date | None:
    """Parse a Jira duedate ('YYYY-MM-DD') into a date, or None."""
    if not raw or not isinstance(raw, str):
        return None
    try:
        return datetime.strptime(raw[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def parse_issue(raw: dict[str, Any]) -> Issue:
    """Map one raw Jira issue object to a normalized Issue.

    Tolerant of missing optional fields; raises only if the issue has no key
    (a structural problem worth surfacing, not swallowing).
    """
    key = raw.get("key")
    if not key:
        raise ValueError(f"Jira issue missing 'key': {raw!r:.120}")

    # The Jira MCP server returns a FLAT, pre-normalized shape (verified 2026-06-21):
    # status/assignee/summary/labels/duedate at top level. Fall back to raw Jira
    # REST `fields.*` so we still work if the server changes its output.
    fields = raw.get("fields") or {}

    def pick(name: str):
        val = raw.get(name)
        return val if val is not None else fields.get(name)

    labels = tuple(pick("labels") or ())
    flagged = any("flag" in str(label).lower() for label in labels)

    return Issue(
        key=str(key),
        summary=str(pick("summary") or ""),
        status=_status_name(pick("status")),
        assignee=_assignee_name(pick("assignee")),
        due_date=_parse_due(pick("duedate") or pick("dueDate")),
        labels=labels,
        flagged=flagged,
    )


def _status_name(status: Any) -> str:
    """Status may be a dict ({'name': ...}) or a plain string."""
    if isinstance(status, dict):
        return str(status.get("name") or "Unknown")
    return str(status) if status else "Unknown"


def _assignee_name(assignee: Any) -> str | None:
    """Assignee may be a dict (displayName/name), a plain string, or None."""
    if isinstance(assignee, dict):
        return assignee.get("displayName") or assignee.get("name")
    return str(assignee) if assignee else None


def is_done(issue: Issue) -> bool:
    """True if the issue's status is a terminal/done state."""
    return issue.status.lower() in _DONE_STATUSES


def get_open_issues(
    project_key: str | None = None,
    *,
    server: McpServerSpec | None = None,
    max_results: int = 100,
) -> list[Issue]:
    """Fetch issues for a project from Jira and normalize them.

    Uses `enhancedSearchIssues` (full issue data). `project_key`/`server` default
    to reporting config so callers can stay terse.
    """
    cfg = get_reporting_config()
    project = project_key or cfg.jira_project_key
    if not project:
        raise RuntimeError("JIRA_PROJECT_KEY is not set (in .env or passed explicitly).")
    spec = server or cfg.jira_server

    result = call_tool(
        spec,
        "enhancedSearchIssues",
        {"projectKey": project, "maxResults": max_results},
    )
    issues_raw = result.get("issues", []) if isinstance(result, dict) else []
    return [parse_issue(item) for item in issues_raw]
