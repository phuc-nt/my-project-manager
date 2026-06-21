"""MCP client adapter — spawn a stdio MCP server and invoke tools by name.

The 3 Atlassian/Slack MCP servers are stdio-only (no HTTP), so the agent spawns
each as a subprocess and talks MCP over stdio via `langchain-mcp-adapters`
(MultiServerMCPClient). We don't bind tools to an LLM here — the reporting flow
calls specific tools directly by name.

The library API is async; this module exposes a sync `call_tool()` for the sync
CLI/graph by wrapping the async core in `asyncio.run`. Each call opens a session
(`async with`) so the spawned node process is torn down afterwards — no leaks.

Tokens are passed to the server's subprocess env; they are never logged.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from langchain_mcp_adapters.client import MultiServerMCPClient

from src.config.reporting_config import McpServerSpec

logger = logging.getLogger(__name__)

# Bound how long we wait for a single tool round-trip (spawn + call).
_TOOL_TIMEOUT_S = 60.0


def _client_for(spec: McpServerSpec) -> MultiServerMCPClient:
    """Build a one-server MCP client config for a stdio server."""
    return MultiServerMCPClient(
        {
            spec.name: {
                "transport": "stdio",
                "command": "node",
                "args": [str(spec.dist_path)],
                "env": spec.env,
            }
        }
    )


async def _acall_tool(spec: McpServerSpec, tool_name: str, args: dict[str, Any]) -> Any:
    """Async core: open a session, find the tool by name, invoke it."""
    client = _client_for(spec)
    async with client.session(spec.name) as session:
        from langchain_mcp_adapters.tools import load_mcp_tools

        tools = await load_mcp_tools(session)
        tool = next((t for t in tools if t.name == tool_name), None)
        if tool is None:
            available = ", ".join(sorted(t.name for t in tools))
            raise ValueError(
                f"MCP tool {tool_name!r} not found on server {spec.name!r}. "
                f"Available: {available}"
            )
        return await tool.ainvoke(args)


def _coerce_result(raw: Any) -> Any:
    """Normalize a tool result to a Python object.

    MCP tools often return their payload as a JSON string (or a ToolMessage whose
    `.content` is one). Parse JSON when possible; otherwise return as-is so the
    caller's `tools/` layer can normalize.
    """
    content = getattr(raw, "content", raw)
    if isinstance(content, str):
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return content
    return content


def call_tool(spec: McpServerSpec, tool_name: str, args: dict[str, Any]) -> Any:
    """Spawn the server (if needed), invoke one tool by name, return its result.

    Sync wrapper over the async MCP API for use in the sync CLI/graph. Validates
    the server's dist build + required env first, with a clear error. Bounded by
    a timeout so a hung server cannot stall the agent.
    """
    spec.validate()
    try:
        raw = asyncio.run(asyncio.wait_for(_acall_tool(spec, tool_name, args), _TOOL_TIMEOUT_S))
    except TimeoutError as exc:
        raise RuntimeError(
            f"MCP server {spec.name!r} timed out after {_TOOL_TIMEOUT_S:.0f}s "
            f"calling {tool_name!r}."
        ) from exc
    except Exception as exc:  # explicit context, never swallowed
        raise RuntimeError(
            f"MCP call failed: server={spec.name!r} tool={tool_name!r}: {exc}"
        ) from exc
    return _coerce_result(raw)
