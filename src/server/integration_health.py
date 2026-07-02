"""Integration health checks for the dashboard (v3 M7 S9). READ-ONLY, secret-safe.

Answers "which connection is broken?" for a non-technical operator: each check returns
ok/not-ok + a fix hint for whoever does the technical setup. NO secret VALUE is read or
returned — env checks report presence only (bool), and no check sends any token anywhere.

`gh auth status` is the only network-ish probe (the gh CLI's own check, 5s timeout);
everything else is env-presence, file-existence, or PATH lookup. Results are cached for
30s per process so a dashboard poll cannot spawn a subprocess storm.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time

from dotenv import load_dotenv

from src.config.reporting_config import (
    _DEFAULT_CONFLUENCE_DIST,
    _DEFAULT_JIRA_DIST,
    _DEFAULT_SLACK_DIST,
)
from src.config.settings import REPO_ROOT

_CACHE_TTL_SECONDS = 30.0
_cache: dict = {"at": 0.0, "payload": None}


def integration_checks(*, use_cache: bool = True) -> dict:
    """{checks: [{id, label, ok, detail, hint}], checked_at} — cached 30s."""
    now = time.time()
    if use_cache and _cache["payload"] is not None and now - _cache["at"] < _CACHE_TTL_SECONDS:
        return _cache["payload"]
    load_dotenv(REPO_ROOT / ".env")  # presence checks must see .env values (no override)
    payload = {"checks": _run_checks(), "checked_at": now}
    _cache["at"], _cache["payload"] = now, payload
    return payload


def _env_set(*names: str) -> tuple[bool, str]:
    """(all set?, 'NAME1 ✓, NAME2 ✗' presence detail — names only, never values)."""
    marks = [f"{n} {'✓' if os.getenv(n) else '✗'}" for n in names]
    return all(os.getenv(n) for n in names), ", ".join(marks)


def _run_checks() -> list[dict]:
    checks: list[dict] = []

    ok, detail = _env_set("OPENROUTER_API_KEY")
    checks.append(
        _check("openrouter", "OpenRouter (LLM)", ok, detail, "Set OPENROUTER_API_KEY in .env")
    )

    ok, detail = _env_set("ATLASSIAN_SITE_NAME", "ATLASSIAN_USER_EMAIL", "ATLASSIAN_API_TOKEN")
    checks.append(
        _check(
            "atlassian", "Atlassian token (Jira + Confluence)", ok, detail,
            "Set the 3 ATLASSIAN_* vars in .env (one shared API token)",
        )
    )

    ok, detail = _env_set("SLACK_XOXC_TOKEN", "SLACK_XOXD_TOKEN", "SLACK_TEAM_DOMAIN")
    checks.append(
        _check(
            "slack", "Slack browser-token", ok, detail,
            "Set SLACK_XOXC_TOKEN / SLACK_XOXD_TOKEN / SLACK_TEAM_DOMAIN in .env",
        )
    )

    for check_id, label, env_name, default in (
        ("jira_mcp", "Jira MCP server build", "JIRA_MCP_DIST", _DEFAULT_JIRA_DIST),
        ("confluence_mcp", "Confluence MCP server build", "CONFLUENCE_MCP_DIST",
         _DEFAULT_CONFLUENCE_DIST),
        ("slack_mcp", "Slack MCP server build", "SLACK_MCP_DIST", _DEFAULT_SLACK_DIST),
    ):
        path = os.getenv(env_name) or str(default)
        exists = os.path.isfile(path)
        checks.append(
            _check(
                check_id, label, exists, path,
                f"Clone + `npm install && npm run build` the server, or set {env_name} in .env",
            )
        )

    checks.append(_gh_check())

    gws = shutil.which("gws")
    checks.append(
        _check(
            "gws", "gws CLI (Google Sheets — hr-pack only)", gws is not None,
            gws or "not on PATH",
            "Only needed for hr-pack. Install the gws CLI and run `gws auth`",
        )
    )
    return checks


def _gh_check() -> dict:
    """`gh auth status` exit code — the CLI's own auth probe (5s timeout, no token read)."""
    try:
        proc = subprocess.run(
            ["gh", "auth", "status"], capture_output=True, timeout=5, check=False
        )
        ok, detail = proc.returncode == 0, f"gh auth status → exit {proc.returncode}"
    except FileNotFoundError:
        ok, detail = False, "gh not on PATH"
    except subprocess.TimeoutExpired:
        ok, detail = False, "gh auth status timed out (5s)"
    return _check("github", "GitHub (gh CLI)", ok, detail, "Install gh and run `gh auth login`")


def _check(check_id: str, label: str, ok: bool, detail: str, hint: str) -> dict:
    return {"id": check_id, "label": label, "ok": bool(ok), "detail": detail, "hint": hint}
