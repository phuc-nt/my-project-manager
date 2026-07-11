"""ToolCallingRuntime (v20 Phase 2) — a tool-calling loop that keeps the moat.

Class name is `ToolCallingRuntime` (NOT `CreateAgentRuntime`) to avoid colliding with the
existing `agent_create.create_agent` employee-registration function.

The safety design (red-team C1/C2/C3/H2/H4):

- **No new heavy dep (C3).** LangChain `create_agent` is not installed and churns across
  minor versions; instead this uses `langgraph.prebuilt.create_react_agent`, already in the
  dependency tree — a tool-calling loop with the same shape, no `langchain` meta-package.
- **Swaps ONLY the work loop.** It overrides `TeamTaskDeps.run_work` via
  `build_team_task_graph(work_override=...)`; perceive / self_check / rework / deliver→gateway
  stay native. So mutation-only-via-gateway holds no matter how `work` produces its text.
- **Positive read-allowlist + policy shim (C1/C2).** The loop is bound ONLY the callables from
  `build_read_toolset` — read-only, classify-shimmed, audience-aware. It can never reach a
  write/destructive tool because none is in the toolset.
- **Per-loop hard cap (H2).** A recursion/step cap bounds the loop so a runaway cannot burn the
  monthly budget; the cap is enforced in the loop config, not left to a per-tick cost check.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.profile.loader import LoadedProfile

#: Hard ceiling on tool-calling iterations per step (red-team H2). create_react_agent counts
#: recursion in super-steps; a small cap keeps a looping agent from spending unbounded LLM $.
MAX_LOOP_STEPS = 8


class ToolCallingRuntime:
    """A read-only tool-calling loop backend for team-step work."""

    def build_report(self, loaded: LoadedProfile, settings: Any, kind: str, audience: str):
        # Reports do not use a tool-calling loop in v20; the report guard in build_graph_for
        # already fails loud for non-native. Kept for Protocol shape.
        raise RuntimeError("ToolCallingRuntime chưa hỗ trợ báo cáo (report) — chỉ team-step.")

    def build_task(self, **kwargs: Any):
        from src.agent.team_task_graph import build_team_task_graph

        settings = kwargs.get("settings")
        context = kwargs.get("context")
        config = kwargs.pop("reporting_config", None)  # optional, threaded by the runner
        work = self._make_work_override(settings, context, config)
        return build_team_task_graph(work_override=work, **kwargs)

    def _make_work_override(self, settings, context, config):
        """Build the run_work replacement: a create_react_agent loop over the read toolset."""
        from src.runtime_backends.read_only_toolset import assert_read_only, build_read_toolset

        def _run_work(title: str, handoff: str, hook) -> tuple[str, float | None]:
            # team-step is inherently internal (no external audience).
            tools_map = build_read_toolset(config, audience="internal")
            assert_read_only(list(tools_map))  # defense-in-depth: prove no write tool leaked in

            from src.runtime_backends.react_loop import run_react_work

            return run_react_work(
                title=title, handoff=handoff, context=context, settings=settings,
                tools_map=tools_map, max_steps=MAX_LOOP_STEPS,
            )

        return _run_work
