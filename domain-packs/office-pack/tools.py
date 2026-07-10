"""office-pack ToolProvider (v12 M28b) — required export, minimal by design.

`PackRegistry._load_pack_module` raises `ImportError` if a pack has no `tools.py`, so
every pack (even one whose real work is the coordinator ticker, not a `--report` read)
must ship one. The coordinator does not read through the generic ToolProvider seam —
its inputs are the team_task_store (state machine) and the fleet registry (assignee
list), both read directly by `coordinator_graph.py` — so this provider's `read()` is a
documented no-op, never called by the ticker itself.
"""

from __future__ import annotations

from typing import Any


class OfficeToolProvider:
    """No report kind reads through this seam (office-pack ships none) — the ticker
    reads `team_task_store` + the registry directly, not through `ToolProvider.read`."""

    def read(self, kind: str, config: Any, settings: Any) -> dict[str, Any]:
        return {}


#: Required export name — loaded by PackRegistry into Pack.tools.
TOOL_PROVIDER = OfficeToolProvider()
