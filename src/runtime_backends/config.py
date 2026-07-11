"""AgentRuntimeConfig — the parsed `agent_runtime:` profile block (v20 Phase 1).

This is a TOP-LEVEL profile key, deliberately NOT nested under the existing `runtime:` block
(which holds M2-P8 infra: checkpointer / store / postgres_dsn / tracing). Overloading that
infra block with a loop-backend selector would conflate two orthogonal concerns and risk a
silent regression across every profile that carries the infra block.
"""

from __future__ import annotations

from dataclasses import dataclass

_KNOWN_KINDS = {"native", "create_agent", "deep_agent"}


@dataclass(frozen=True)
class AgentRuntimeConfig:
    """Which loop backend runs an agent. Absent ⇒ native (byte-identical pre-v20)."""

    kind: str = "native"


def parse_agent_runtime_config(raw: object) -> AgentRuntimeConfig:
    """Validate the optional `agent_runtime:` block. Absent/empty ⇒ native.

    Fail-loud (RuntimeError, matching the loader's `_parse_*` convention so it does not escape
    the entrypoint catch) on shape errors or an unknown kind. Accepts either a bare string
    (`agent_runtime: native`) or a mapping (`agent_runtime: {kind: native}`).
    """
    if raw is None or raw == {} or raw == "":
        return AgentRuntimeConfig()
    if isinstance(raw, str):
        kind = raw.strip() or "native"
    elif isinstance(raw, dict):
        kind = str(raw.get("kind") or "native").strip() or "native"
    else:
        raise RuntimeError("profile agent_runtime: must be a string or a mapping {kind: ...}.")
    if kind not in _KNOWN_KINDS:
        raise RuntimeError(
            f"profile agent_runtime: unknown kind {kind!r} (known: {sorted(_KNOWN_KINDS)})."
        )
    return AgentRuntimeConfig(kind=kind)
