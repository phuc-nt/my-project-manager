"""`Pack` + `PackRegistry`: the seam that loads a domain's pieces for the core.

`Pack` is the resolved bundle of one domain's contributions. `PackRegistry.load(domain)`
returns the pack for a domain string (the value of `profile.yaml`'s `domain:`, default
`"pm"`). In S1 this is scaffolding: the registry knows the set of valid domains but each
`Pack` carries empty collections, so the core still runs through its existing hardcoded
PM paths. Subsequent M5 slices fill the pack fields and switch the core to read them.

`report_kinds` maps a report-kind string (`"daily"`, `"weekly"`, `"okr"`, `"resource"`,
or a future domain's kinds) to the callable that builds its graph — replacing the
`if/elif kind` ladder in `runtime/worker.py` (S2). The remaining fields back the other
two seams (ToolProvider in S3, allowlist/write handlers in S4) and pack assets
(prompts/skills in S5); they stay empty until those slices move the code in.
"""

from __future__ import annotations

import importlib.util
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType
from typing import Any

from src.config.settings import REPO_ROOT

#: A report-kind graph builder, called uniformly by the core:
#: build(checkpointer, *, config, settings, context, audience, store, remember).
GraphBuilder = Callable[..., Any]

#: The default domain for any profile that does not declare `domain:` — keeps every
#: pre-v3 (PM) profile loading and dispatching exactly as before.
DEFAULT_DOMAIN = "pm"

#: Domains the registry recognizes. S1 listed only PM; M6 adds "hr", M8 adds "admin".
#: An unknown domain is a load error, not a silent default.
_KNOWN_DOMAINS = (DEFAULT_DOMAIN,)

#: Where in-repo packs live (✅ CHỐT 2026-06-30: in-repo folder, not a plugin
#: entry-point). A domain `x` resolves to `domain-packs/x-pack/`.
_PACKS_DIR = REPO_ROOT / "domain-packs"


def pack_dir(domain: str) -> Path:
    """Absolute path to a domain's pack folder (`domain-packs/<domain>-pack/`)."""
    return _PACKS_DIR / f"{(domain or DEFAULT_DOMAIN).strip() or DEFAULT_DOMAIN}-pack"


def pack_skills_dir(domain: str) -> Path:
    """Where a domain bundles its skill `.md` files (v3 M5 S5 pack asset)."""
    return pack_dir(domain) / "skills"


def pack_prompts_dir(domain: str) -> Path:
    """Where a domain bundles its system-prompt `.md` files (v3 M5 S5 pack asset)."""
    return pack_dir(domain) / "prompts"


def load_pack_prompt(domain: str, name: str) -> str:
    """Read a pack's `prompts/<name>.md` verbatim (the system-prompt text asset).

    The PM message-builders moved their system-prompt STRINGS into pack assets in S5
    (the builder logic stays in core). The `.md` holds the exact prompt text — read
    raw, no trimming, so the composed prompt is byte-identical to the pre-v3 literal.
    """
    return (pack_prompts_dir(domain) / f"{name}.md").read_text(encoding="utf-8")


def _scan_pack_prompts(domain: str) -> dict[str, str]:
    """Load every `prompts/<name>.md` a pack ships → {name: text} (verbatim)."""
    pdir = pack_prompts_dir(domain)
    if not pdir.exists():
        return {}
    return {p.stem: p.read_text(encoding="utf-8") for p in sorted(pdir.glob("*.md"))}


def _scan_pack_skill_names(domain: str) -> tuple[str, ...]:
    """The skill `.md` filenames (stems) a pack bundles — for introspection/UI.

    Filename stems, not parsed `name:` fields (that parse lives in skill_loader); this
    is a cheap listing so a Pack advertises what skills it ships without a full load.
    """
    skills_dir = pack_skills_dir(domain)
    if not skills_dir.exists():
        return ()
    return tuple(sorted(p.stem for p in skills_dir.glob("*.md")))


def _load_pack_module(domain: str, module_name: str) -> ModuleType:
    """Import `domain-packs/<domain>-pack/<module_name>.py` by file path.

    Packs use hyphenated folder names (`pm-pack`), which are not importable as normal
    Python packages, so each module is loaded via importlib from its file. The module
    can still `import src.*` because the repo root is on sys.path at run time.
    """
    path = _PACKS_DIR / f"{domain}-pack" / f"{module_name}.py"
    if not path.exists():
        raise ImportError(f"Pack module not found: {path} (domain {domain!r}).")
    spec = importlib.util.spec_from_file_location(f"_pack_{domain}_{module_name}", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load pack module {path}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@dataclass(frozen=True)
class Pack:
    """One domain's resolved contributions to the otherwise-generic core.

    All collections default empty so an as-yet-unpopulated pack is inert: the core
    keeps using its existing hardcoded path until a slice moves that seam onto the
    pack. Fields are filled across M5 — `report_kinds` (S2), `tools` (S3),
    `allowlist` (S4), `prompts`/`skills` (S5).

    Note: write-handler DISPATCH stays in core (`approved_dispatch.py`) — slack/linear/
    email are cross-domain shared primitives a pack reuses rather than owns — so a pack
    contributes only its `allowlist`, not handler callables. If a future domain needs a
    domain-specific handler, add a `write_handlers` field then (YAGNI here).
    """

    domain: str
    report_kinds: dict[str, GraphBuilder] = field(default_factory=dict)
    # ToolProvider (S3): how this domain reads its source systems. `Any` until the
    # interface lands in `src/packs/tool_provider.py` and S3 binds the PM provider.
    tools: Any | None = None
    # Allowlist contribution (S4): the MCP server→tool names this pack may write to.
    # Merged into the gateway's default-DENY allowlist; never widens the Lớp A red line.
    allowlist: dict[str, tuple[str, ...]] = field(default_factory=dict)
    # Pack assets (S5): prompt texts by logical name, and the bundled skill .md pool.
    prompts: dict[str, str] = field(default_factory=dict)
    skills: tuple[str, ...] = ()


class PackRegistry:
    """Resolves a domain string to its `Pack`.

    S1 returns an empty `Pack(domain)` for any known domain — enough to thread the
    concept through the core without changing behavior. Later slices register real
    builders/tools/handlers per domain here (or have each pack self-register).
    """

    def __init__(self, known_domains: tuple[str, ...] = _KNOWN_DOMAINS) -> None:
        self._known = known_domains

    def known_domains(self) -> tuple[str, ...]:
        return self._known

    def load(self, domain: str | None) -> Pack:
        """Return the pack for `domain` (None/blank ⇒ the default PM domain).

        Raises ValueError for an unrecognized domain so a typo'd `domain:` fails
        loudly rather than silently running as PM. Populates the pack's report-kind
        builders from the pack's `graphs.py` (S2); the remaining seams (tools,
        allowlist, prompts, skills) are filled in later slices and stay empty here.
        """
        resolved = (domain or DEFAULT_DOMAIN).strip() or DEFAULT_DOMAIN
        if resolved not in self._known:
            raise ValueError(
                f"Unknown domain {resolved!r}: no pack registered. "
                f"Known domains: {', '.join(self._known)}."
            )
        graphs = _load_pack_module(resolved, "graphs")
        report_kinds: dict[str, GraphBuilder] = dict(getattr(graphs, "REPORT_KINDS", {}))
        tools_mod = _load_pack_module(resolved, "tools")
        tools = getattr(tools_mod, "TOOL_PROVIDER", None)
        wh = _load_pack_module(resolved, "write_handlers")
        allowlist: dict[str, tuple[str, ...]] = dict(getattr(wh, "ALLOWLIST", {}))
        skills = _scan_pack_skill_names(resolved)
        prompts = _scan_pack_prompts(resolved)
        return Pack(
            domain=resolved, report_kinds=report_kinds, tools=tools,
            allowlist=allowlist, skills=skills, prompts=prompts,
        )
