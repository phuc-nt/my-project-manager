"""AgentRuntime Protocol + resolver (v20 Phase 1).

Two methods, not one union — the report builder (`build_graph_for(loaded, settings, kind,
audience)`) and the team-step builder (`build_team_task_graph(**kwargs)` with task_id /
data_dir / step context, no audience) have incompatible shapes; forcing them into one
`build(spec)` breeds dead params. So the Protocol exposes `build_report` and `build_task`.

`resolve_runtime(loaded)` picks the backend from `loaded.agent_runtime.kind`:
  - "native"       → NativeGraphRuntime (the existing graphs, byte-identical)
  - "create_agent" → RuntimeError (Phase 2)
  - "deep_agent"   → RuntimeError (Phase 3)
  - anything else  → RuntimeError (fail-loud)

`loaded=None` (a team-step whose profile could not load — a live, supported degrade path)
resolves to native. `RUNTIME_FORCE_NATIVE=1` (env) forces native fleet-wide regardless of
profile — the kill-switch for reverting the whole fleet while investigating a runtime.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

if TYPE_CHECKING:
    from src.profile.loader import LoadedProfile


@runtime_checkable
class AgentRuntime(Protocol):
    """One employee's loop backend. Produces a compiled graph the orchestrator runs.

    Invariant across ALL implementations (THE INVARIANT): the runtime never writes
    external directly — its only external-write path is the graph's `deliver` node routing
    through the Action Gateway. A tool-calling runtime must additionally confine its toolset
    to read-only + internal-artifact and route every in-loop tool through hard_block.classify
    (Phase 2).
    """

    def build_report(self, loaded: LoadedProfile, settings: Any, kind: str, audience: str):
        """Build the compiled graph for a report kind (daily/weekly/okr/resource)."""
        ...

    def build_task(self, **kwargs: Any):
        """Build the compiled graph for one team-task step (kwargs mirror build_team_task_graph)."""
        ...


def _forced_native() -> bool:
    """The RUNTIME_FORCE_NATIVE kill-switch: any truthy env value forces native."""
    return os.environ.get("RUNTIME_FORCE_NATIVE", "").strip().lower() in {"1", "true", "yes", "on"}


def runtime_kind_for(loaded: LoadedProfile | None) -> str:
    """The effective runtime kind for a profile, honoring None-degrade + the kill-switch.

    Kept separate from `resolve_runtime` so the report-build guard (`build_graph_for`) can
    ask "is this agent native?" cheaply without constructing a runtime object.
    """
    if loaded is None or _forced_native():
        return "native"
    cfg = getattr(loaded, "agent_runtime", None)
    return getattr(cfg, "kind", "native") if cfg is not None else "native"


def resolve_runtime(loaded: LoadedProfile | None) -> AgentRuntime:
    """Resolve the AgentRuntime for a profile (None → native; kill-switch → native)."""
    # Imported lazily to keep this module import-light and dependency-free.
    from src.runtime_backends.native_graph_runtime import NativeGraphRuntime

    kind = runtime_kind_for(loaded)
    if kind == "native":
        return NativeGraphRuntime()
    if kind == "create_agent":
        from src.runtime_backends.tool_calling_runtime import ToolCallingRuntime

        return ToolCallingRuntime()
    if kind == "deep_agent":
        from src.runtime_backends.deep_agent_runtime import DeepAgentRuntime

        return DeepAgentRuntime()
    raise RuntimeError(
        f"agent_runtime {kind!r} không hợp lệ (known: native, create_agent, deep_agent)."
    )
