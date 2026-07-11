"""DeepAgentRuntime (v20 Phase 3) — isolated, optional, experimental.

⚠️ EXPERIMENTAL. `deepagents` is a Beta package that ships a "Shell access — run commands"
middleware and pulls network deps (langchain-anthropic / langsmith) that would run IN-PROCESS
with the Action Gateway and the agent's tokens (red-team C5). So this backend is deliberately
kept behind a hard boundary:

- **Lazy import.** `deepagents` is imported only inside `build_task`, never at module load —
  so a host without the optional dep imports the app fine (isolation, red-team C5).
- **Fail-loud EARLY, not per-tick.** `require_available()` lets the registry/enable path reject
  a `deep_agent` agent the moment the dep is missing, instead of every scheduled tick spawning
  a worker that exits 1 silently (red-team FM5).
- **Shell + tracing OFF; read-only toolset + policy shim.** When the dep IS present, the
  wrapper must disable the shell middleware and LangSmith tracing and bind only the Phase 2
  read-only toolset, so mutation-only-via-gateway holds even for subagents. Until that
  hardening is vendor-reviewed against a pinned `deepagents==` version, the backend refuses to
  run (raising with guidance) rather than run unsafely.

Native + ToolCallingRuntime already prove the AgentRuntime interface; this slot exists so a
`deep_agent` profile resolves to a real (if gated) backend and the isolation is testable.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.profile.loader import LoadedProfile


def deepagents_available() -> bool:
    """True iff the optional `deepagents` package can be imported (no side effects)."""
    import importlib.util

    return importlib.util.find_spec("deepagents") is not None


def require_available() -> None:
    """Raise (fail-loud) if `deepagents` is not installed — call at enable/registry time.

    This surfaces the missing dep to the operator ONCE, at the moment they opt an agent into
    the deep_agent runtime, instead of a silent per-tick exit-1 loop later (red-team FM5).
    """
    if not deepagents_available():
        raise RuntimeError(
            "agent_runtime: deep_agent cần package tùy chọn 'deepagents' (chưa cài). "
            "Cài: uv sync --extra deep và bật lại — hoặc dùng agent_runtime: native/create_agent."
        )


class DeepAgentRuntime:
    """A deepagents-backed loop backend — optional, shell/tracing disabled, read-only."""

    def build_report(self, loaded: LoadedProfile, settings: Any, kind: str, audience: str):
        raise RuntimeError("DeepAgentRuntime chưa hỗ trợ báo cáo (report) — chỉ team-step.")

    def build_task(self, **kwargs: Any):
        require_available()
        # deepagents IS installed here. Building a hardened wrapper (shell off, tracing off,
        # read-only toolset + policy shim, subagent mutation via deliver→gateway only) requires
        # a vendor review against a pinned version (red-team C5). Until that lands, refuse to
        # run unsafely rather than expose a shell-capable agent in-process with the gateway.
        raise RuntimeError(
            "DeepAgentRuntime: deepagents đã cài nhưng wrapper an toàn (tắt shell/tracing + "
            "read-only toolset) CHƯA vendor-review cho version pin. Dùng agent_runtime: "
            "create_agent (ToolCallingRuntime) — đã có loop tool-calling an toàn tương đương."
        )
