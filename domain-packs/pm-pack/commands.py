"""pm-pack chat-command catalog (v5 M12).

The CEILING of what a chat mention may ask a PM agent to do. Every entry is validated
at pack load against this pack's allowlist + Lớp A (registry._load_commands) and, at
request time, args are schema-validated in code and the action is FORCE-queued for
human approval — chat never executes directly.

v1 keeps ONE command (create_issue): enough to prove responsibility level 3; grow the
catalog only when the owner asks (trust ladder is a policy decision, not a default).
"""

from __future__ import annotations

from typing import Any


def _create_issue_args(args: dict[str, str], config: Any) -> dict[str, str]:
    """Validated args + the agent's OWN project key from config — the requester cannot
    point the issue at another project."""
    out = {"projectKey": config.jira_project_key, "summary": args["summary"]}
    if args.get("description"):
        out["description"] = args["description"]
    return out


COMMANDS: dict[str, dict] = {
    "create_issue": {
        "description": (
            "Tạo Jira issue mới trong project của agent. "
            "args: summary (bắt buộc, tiêu đề ngắn), description (tuỳ chọn, chi tiết)"
        ),
        "server": "jira",
        "tool": "createIssue",
        "args_schema": {
            "summary": {"required": True, "max_len": 200},
            "description": {"required": False, "max_len": 2000},
        },
        "build_args": _create_issue_args,
    },
}
