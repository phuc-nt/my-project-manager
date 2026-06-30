"""pm-pack ToolProvider (v3 M5 S3).

The report graph used to `from src.tools import github_read, jira_read` and call those
modules directly — the PM coupling M5 removes. S3 moves those reads behind a provider
the graph receives from the active pack. The graph asks the provider for issues /
sprint / PRs / CI; the provider owns *how* (here: MCP-spawned `jira_read` + `gh`-CLI
`github_read`). A different domain supplies a different provider with the same shape
(M6's HR provider reads Confluence + Google Sheets) without the core importing either.

Every method delegates to the existing `src/tools/*_read.py` functions with identical
arguments, so the PM report graph stays byte-identical to pre-v3.
"""

from __future__ import annotations

from typing import Any


class PmToolProvider:
    """PM domain reads: Jira issues/sprint (MCP) + GitHub PRs/CI (gh CLI).

    Conforms to `src.packs.tool_provider.ToolProvider` structurally. The report graph
    drives sprint logic (weekly pulls the active sprint), so the provider exposes the
    granular reads rather than one opaque `read()` — but the contract is the same
    "read a source → return normalized records", with transport hidden inside.
    """

    def get_open_issues(self, *, config: Any) -> list:
        from src.tools import jira_read

        return jira_read.get_open_issues(config=config)

    def get_active_sprint(self, *, config: Any):
        from src.tools import jira_read

        return jira_read.get_active_sprint(config=config)

    def get_sprint_issues(self, sprint_id: Any, *, config: Any) -> list:
        from src.tools import jira_read

        return jira_read.get_sprint_issues(sprint_id, config=config)

    def get_open_prs(self, *, config: Any) -> list:
        from src.tools import github_read

        return github_read.get_open_prs(config=config)

    def get_recent_ci(self, *, config: Any) -> list:
        from src.tools import github_read

        return github_read.get_recent_ci(config=config)


#: The pack's tool provider instance. Loaded by PackRegistry into Pack.tools (S3).
TOOL_PROVIDER = PmToolProvider()
