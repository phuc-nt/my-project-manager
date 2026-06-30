"""Load a domain pack's bundled skills (v2 M3-P10; v3 M5 S5 = pack asset).

Each skill is a `<name>.md` with a `---`-delimited YAML frontmatter (`name`,
`description`, optional `applies_to`, optional `allowed-tools` — the last is
PARSED-AND-IGNORED this round) followed by the markdown instruction body. A malformed
file (no frontmatter, bad YAML, missing name/description) is SKIPPED with a warning —
one bad file never aborts the scan.

The skill `.md` files moved from the repo-root `skills/` into the owning domain pack
(`domain-packs/<domain>-pack/skills/`) in v3 M5 S5, so each domain bundles its own
skills without the core enumerating them. `load_skills(domain=...)` resolves the active
pack's dir; `domain` defaults to "pm" so the pre-v3 PM skill pool loads unchanged.
"""

from __future__ import annotations

import logging
from pathlib import Path

import yaml

from src.skills.models import Skill

logger = logging.getLogger(__name__)


def load_skills(skills_dir: Path | None = None, *, domain: str = "pm") -> list[Skill]:
    """Scan a domain pack's skills dir → the Skills it holds.

    `skills_dir` overrides the location (tests pass a tmp dir); otherwise the active
    `domain`'s pack skills dir is used. Returns sorted by name (deterministic), with
    names UNIQUE: if two files declare the same `name`, the first by filename order wins
    and later duplicates are warned + dropped. Malformed files are skipped, never raised.
    """
    if skills_dir is not None:
        base = skills_dir
    else:
        from src.packs.registry import pack_skills_dir

        base = pack_skills_dir(domain)
    if not base.exists():
        return []
    by_name: dict[str, Skill] = {}
    for path in sorted(base.glob("*.md")):
        skill = _load_one(path)
        if skill is None:
            continue
        if skill.name in by_name:
            logger.warning("skill %s skipped: duplicate name %r", path.name, skill.name)
            continue
        by_name[skill.name] = skill
    return sorted(by_name.values(), key=lambda s: s.name)


def _load_one(path: Path) -> Skill | None:
    try:
        meta, body = _parse_frontmatter(path.read_text(encoding="utf-8"))
        name = meta.get("name")
        description = meta.get("description")
        if not name or not description:
            logger.warning("skill %s skipped: missing name/description in frontmatter", path.name)
            return None
        applies = meta.get("applies_to") or []
        applies_to = tuple(str(x) for x in applies) if isinstance(applies, list) else ()
        return Skill(
            name=str(name), description=str(description), body=body.strip(),
            applies_to=applies_to,
        )
    except Exception as exc:  # noqa: BLE001 — one bad skill file must not abort the scan
        logger.warning("skill %s skipped: %s", path.name, exc)
        return None


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Split `---`-delimited YAML frontmatter from the markdown body.

    No leading `---` ⇒ ({}, text) (caller treats empty meta as malformed → skip).
    """
    if not text.lstrip().startswith("---"):
        return {}, text
    stripped = text.lstrip()
    rest = stripped[3:]  # drop the opening ---
    end = rest.find("\n---")
    if end == -1:
        return {}, text  # no closing fence → treat as no frontmatter
    front = rest[:end]
    body = rest[end + 4:]  # skip the "\n---"
    meta = yaml.safe_load(front) or {}
    if not isinstance(meta, dict):
        return {}, text
    return meta, body.lstrip("\n")
