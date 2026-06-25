"""Resolve a profile's `skills:` name list into the runtime skill context (M3-P10 S3).

The single seam the three graph-build entry points (worker / cron / cli) call to wire
skills into the `ProfileContext` they construct. `load_skill_pool` turns the candidate
NAMES (from `LoadedProfile.skills`) into the matching `Skill` objects; `build_skill_context`
pairs that pool with the default LLM selector — but ONLY when the pool is non-empty, so the
no-skills path (the default profile) never constructs an `LlmClient` and stays identical.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from src.skills.skill_loader import load_skills

if TYPE_CHECKING:
    from src.config.settings import Settings
    from src.profile.loader import LoadedProfile
    from src.skills.models import Skill
    from src.skills.skill_selector import SkillSelector

logger = logging.getLogger(__name__)


def load_skill_pool(skill_names: tuple[str, ...]) -> tuple[Skill, ...]:
    """Load the bundled skills named in `skill_names`, preserving pool (declared) order.

    Empty `skill_names` ⇒ `()` with NO disk read. A named-but-missing skill is warned and
    dropped (a typo in profile.yaml must not crash a run — graceful, like the loader itself).
    """
    if not skill_names:
        return ()
    by_name = {s.name: s for s in load_skills()}
    pool: list[Skill] = []
    for name in skill_names:
        skill = by_name.get(name)
        if skill is None:
            logger.warning("profile skill %r not found among bundled skills; skipped", name)
            continue
        pool.append(skill)
    return tuple(pool)


def build_skill_context(
    loaded: LoadedProfile, settings: Settings
) -> tuple[tuple[Skill, ...], SkillSelector | None]:
    """Build the `(skills, selector)` pair to pass into a `ProfileContext`.

    Returns `((), None)` when the profile declares no skills — WITHOUT constructing an
    `LlmClient` — so the default-profile path needs no key and allocates nothing new.
    """
    pool = load_skill_pool(loaded.skills)
    if not pool:
        return (), None
    from src.llm.client import LlmClient
    from src.skills.skill_selector import make_llm_selector

    return pool, make_llm_selector(LlmClient(settings))
