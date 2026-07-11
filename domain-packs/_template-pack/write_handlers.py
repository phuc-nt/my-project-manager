"""_template-pack write handlers + allowlist (v20 authoring skeleton).

`ALLOWLIST` is this pack's contribution to the gateway's default-DENY allowlist: a mapping of
MCP server → the tuple of WRITE tool names permitted for that server. It is the load-bearing
source of truth (the Lớp A red line stays core-guarded — a pack can only widen the allowlist,
never bypass the hard-deny). A read-only pack leaves it empty.

    ALLOWLIST = {"slack": ("post_message",), "confluence": ("createpage",)}
"""

from __future__ import annotations

#: server → permitted write tool names. Empty ⇒ this pack writes nothing external.
ALLOWLIST: dict[str, tuple[str, ...]] = {}
