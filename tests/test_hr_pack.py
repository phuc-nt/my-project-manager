"""v3 M6: hr-pack — second domain proving the pack abstraction.

Covers:
- hr-pack loads via filesystem discovery (no core registration).
- headcount analyzer groups Tasks by status + department, deterministically.
- gws Sheet rows + Confluence table rows map to generic Tasks (the ToolProvider seam).
- HR write goes through the SAME red line: a pack CANNOT allowlist a destructive Slack
  tool; HR's allowlist permits only safe posts; default-DENY holds.
"""

from __future__ import annotations

from src.actions.hard_block import BlockCategory, classify
from src.packs import PackRegistry
from src.packs.registry import _load_pack_module
from src.tools.models import Task


def _hr_module(name: str):
    return _load_pack_module("hr", name)


# --- discovery + assembly (no core edit needed) ---


def test_hr_pack_discovered_and_loads():
    reg = PackRegistry()
    assert "hr" in reg.known_domains()
    pack = reg.load("hr")
    assert pack.domain == "hr"
    assert "headcount" in pack.report_kinds
    assert pack.tools is not None
    assert set(pack.allowlist) == {"slack", "confluence"}  # HR writes Slack + Confluence
    assert "flag-understaffed-team" in pack.skills
    assert "headcount-narrative-system" in pack.prompts


# --- headcount analyzer (pure, deterministic) ---


def _people():
    return [
        Task(id="1", title="Alice", status="Active", assignee="Alice", labels=("Eng",),
             kind="headcount-row"),
        Task(id="2", title="Bob", status="Active", assignee="Bob", labels=("Eng",),
             kind="headcount-row"),
        Task(id="3", title="Carol", status="On Leave", assignee="Carol", labels=("Sales",),
             kind="headcount-row"),
    ]


def test_headcount_groups_by_status_and_department():
    an = _hr_module("analyzers")
    r = an.build_headcount(_people())
    assert r.total == 3
    assert {(g.label, g.count) for g in r.by_status} == {("Active", 2), ("On Leave", 1)}
    assert {(g.label, g.count) for g in r.by_department} == {("Eng", 2), ("Sales", 1)}


def test_headcount_missing_fields_bucket_not_dropped():
    an = _hr_module("analyzers")
    r = an.build_headcount([Task(id="1", title="x", status="", kind="headcount-row")])
    # A person with no status/dept still counts (unknown / unspecified buckets).
    assert r.total == 1
    assert r.by_status[0].label == "unknown"
    assert r.by_department[0].label == "unspecified"


def test_headcount_render_and_short_deterministic():
    an = _hr_module("analyzers")
    r = an.build_headcount(_people())
    xhtml = an.render_headcount_xhtml(r, "2026-07-01")
    assert "<h2>" in xhtml and "Tổng số nhân sự: <strong>3</strong>" in xhtml
    short = an.build_headcount_slack_short(r, report_date="2026-07-01")
    assert "*3* nhân sự" in short


# --- ToolProvider mapping: rows → generic Task ---


def test_sheet_rows_map_to_tasks():
    tools = _hr_module("tools")
    rows = [
        ["Name", "Department", "Status"],
        ["Alice", "Engineering", "Active"],
        ["Bob", "Sales", "On Leave"],
        ["", "", ""],  # blank row skipped
    ]
    tasks = tools._rows_to_tasks(rows, source="sheet")
    assert len(tasks) == 2
    assert tasks[0].title == "Alice"
    assert tasks[0].status == "Active"
    assert "Engineering" in tasks[0].labels
    assert tasks[0].kind == "headcount-row"


def test_confluence_table_parser_extracts_rows():
    tools = _hr_module("tools")
    p = tools._TableRowParser()
    p.feed(
        "<table><tbody>"
        "<tr><th>Name</th><th>Dept</th></tr>"
        "<tr><td>Alice</td><td>Eng</td></tr>"
        "</tbody></table>"
    )
    assert p.rows == [["Name", "Dept"], ["Alice", "Eng"]]


# --- RED LINE: HR write obeys the same invariant (S4 gate) ---


def _slack(tool):
    return {"type": "mcp_tool", "server": "slack", "tool": tool, "args": {}}


def test_hr_cannot_allowlist_destructive_slack_tool():
    # Even if HR's pack tried to permit a destructive Slack op, Lớp A denies it.
    hr_allowlist = PackRegistry().load("hr").allowlist
    verdict = classify(_slack("delete_message"), allowlist=hr_allowlist)
    assert verdict.blocked
    assert verdict.category == BlockCategory.DATA_LOSS


def test_hr_allowlist_permits_safe_post():
    hr_allowlist = PackRegistry().load("hr").allowlist
    assert not classify(_slack("post_message"), allowlist=hr_allowlist).blocked


def test_hr_default_deny_undeclared_server():
    # HR declared only slack + confluence; a jira write is denied by default.
    hr_allowlist = PackRegistry().load("hr").allowlist
    verdict = classify(
        {"type": "mcp_tool", "server": "jira", "tool": "addComment", "args": {}},
        allowlist=hr_allowlist,
    )
    assert verdict.blocked
    assert verdict.category == BlockCategory.NOT_ALLOWLISTED
