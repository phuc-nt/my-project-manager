"""Normalized data models shared by the READ tools + risk analyzer.

Tools return these dataclasses (not raw Jira/GitHub JSON) so the LLM and the
analyzer work against a stable, tool-agnostic shape. Raw-API field mapping lives
in each `*_read.py`; everything downstream depends only on these types.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass(frozen=True)
class Issue:
    """A normalized Jira issue."""

    key: str
    summary: str
    status: str
    assignee: str | None
    due_date: date | None
    labels: tuple[str, ...] = ()
    flagged: bool = False


@dataclass(frozen=True)
class PullRequest:
    """A normalized GitHub pull request with computed staleness."""

    number: int
    title: str
    author: str | None
    updated_at: date | None
    review_decision: str | None  # APPROVED | REVIEW_REQUIRED | CHANGES_REQUESTED | None
    checks_state: str | None  # SUCCESS | FAILURE | PENDING | None
    age_days: int | None
    stale: bool = False


@dataclass(frozen=True)
class CiRun:
    """A normalized recent CI/workflow run."""

    workflow: str
    status: str  # queued | in_progress | completed
    conclusion: str | None  # success | failure | cancelled | ...


@dataclass(frozen=True)
class Sprint:
    """A normalized Jira sprint (for weekly sprint review)."""

    id: str
    name: str
    state: str  # active | closed | future
    start_date: date | None
    end_date: date | None


@dataclass(frozen=True)
class Risk:
    """One detected risk, with a suggested action (design-guidelines: actionable)."""

    kind: str  # "overdue_task" | "stale_pr" | "blocker" | "ci_failure"
    severity: str  # "high" | "medium" | "low"
    subject: str  # e.g. issue key or PR number
    detail: str
    suggested_action: str
    refs: tuple[str, ...] = field(default_factory=tuple)
