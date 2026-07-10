"""Company identity — greenfield `company.yaml` at repo root.

Mirrors `registry.py`'s load shape (dataclass + yaml.safe_load) but is DEGRADE-NOT-RAISE:
`registry.yaml` must exist for the service to know which agents to run, but a missing
`company.yaml` is not a run-blocking condition — a fresh install has no company set up
yet, and every reader (Setup wizard, dashboard header) must render a safe default instead
of 500ing. Writes go through `save_company`, which mirrors `registry_edit`'s
validate-before-replace + atomic temp-then-rename pattern under the same style of
process-wide lock.

Config-only: no secret ever belongs in this file (name + coordinator id + a cost cap).
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path

import yaml

from src.config.settings import REPO_ROOT

_COMPANY_PATH = REPO_ROOT / "company.yaml"

#: Default monthly cap for a cross-agent "team task" (Validation Session 1 decision).
DEFAULT_TEAM_TASK_CAP_USD = 2.0

#: One process-wide lock for every company.yaml write — same rationale as
#: `registry_edit._EDIT_LOCK`: the web admin routes run in a threadpool, so two
#: concurrent saves (double-submit) must not interleave read-modify-write.
_EDIT_LOCK = threading.Lock()


@dataclass(frozen=True)
class Company:
    """Company identity: display name, coordinator agent id, team-task cost cap."""

    name: str
    coordinator_id: str | None
    team_task_cap_usd: float


def load_company(path: Path | None = None) -> Company:
    """Load `company.yaml`, degrading to a safe default instead of raising.

    Missing file, unreadable YAML, or a malformed shape all yield the same safe default
    (`name=""`, `coordinator_id=None`, `team_task_cap_usd=DEFAULT_TEAM_TASK_CAP_USD`) —
    company identity is cosmetic/config, never a hard dependency for the service to run.
    """
    company_path = path if path is not None else _COMPANY_PATH
    try:
        raw = company_path.read_text(encoding="utf-8")
    except OSError:
        return Company(name="", coordinator_id=None, team_task_cap_usd=DEFAULT_TEAM_TASK_CAP_USD)

    try:
        doc = yaml.safe_load(raw) or {}
    except yaml.YAMLError:
        return Company(name="", coordinator_id=None, team_task_cap_usd=DEFAULT_TEAM_TASK_CAP_USD)
    if not isinstance(doc, dict):
        return Company(name="", coordinator_id=None, team_task_cap_usd=DEFAULT_TEAM_TASK_CAP_USD)

    name = doc.get("name")
    name = str(name) if isinstance(name, str) else ""

    raw_coordinator_id = doc.get("coordinator_id")
    coordinator_id = (
        str(raw_coordinator_id)
        if isinstance(raw_coordinator_id, str) and raw_coordinator_id.strip()
        else None
    )

    cap = doc.get("team_task_cap_usd")
    try:
        team_task_cap_usd = float(cap) if cap is not None else DEFAULT_TEAM_TASK_CAP_USD
    except (TypeError, ValueError):
        team_task_cap_usd = DEFAULT_TEAM_TASK_CAP_USD

    return Company(name=name, coordinator_id=coordinator_id, team_task_cap_usd=team_task_cap_usd)


def save_company(
    name: str,
    coordinator_id: str | None,
    team_task_cap_usd: float = DEFAULT_TEAM_TASK_CAP_USD,
    *,
    path: Path | None = None,
) -> None:
    """Atomic write of `company.yaml` (temp-then-rename), guarded by the process lock.

    Validate-before-replace: the new document is round-tripped through `load_company` on
    the temp file before the real file is replaced, so a value that can't be read back
    correctly never lands (mirrors `registry_edit._replace_validated`).
    """
    company_path = path if path is not None else _COMPANY_PATH
    doc = {
        "name": str(name or ""),
        "coordinator_id": str(coordinator_id) if coordinator_id else None,
        "team_task_cap_usd": float(team_task_cap_usd),
    }
    text = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True)

    with _EDIT_LOCK:
        tmp = company_path.with_suffix(company_path.suffix + f".{os.getpid()}.tmp")
        tmp.write_text(text, encoding="utf-8")
        try:
            loaded = load_company(tmp)
            if (
                loaded.name != doc["name"]
                or loaded.coordinator_id != doc["coordinator_id"]
                or loaded.team_task_cap_usd != doc["team_task_cap_usd"]
            ):
                raise RuntimeError("company.yaml write did not round-trip the expected values")
        except Exception:
            tmp.unlink(missing_ok=True)
            raise
        os.replace(tmp, company_path)
