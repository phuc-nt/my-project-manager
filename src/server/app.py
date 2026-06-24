"""FastAPI app factory for the multi-agent web service (v2 M2-P6).

SECURITY POSTURE (M2 sandbox): this service is LOCALHOST-ONLY and has NO AUTH. It can
trigger real report runs (which write to Slack/Confluence through the per-agent Action
Gateway), so it must NOT be exposed beyond 127.0.0.1 without adding authentication —
that is deliberately deferred. The guardrail still applies per-agent (Lớp A/B + audit +
budget + dedup), DRY_RUN default still holds, and external audience still routes through
Lớp B approval.

`create_app()` builds the app; `app = create_app()` is the module-level ASGI target for
both `uvicorn src.server.app:app` and FastAPI's TestClient. The uvicorn `__main__` runner
(binding 127.0.0.1) is added in Slice 3.
"""

from __future__ import annotations

from fastapi import FastAPI

from src.server import routes_agents


def create_app() -> FastAPI:
    """Build the FastAPI app with the agent routers mounted."""
    app = FastAPI(
        title="my-project-manager — agent web service",
        description="Localhost-only multi-agent dashboard backend (no auth).",
        version="0.0.0",
    )
    app.include_router(routes_agents.router)
    return app


app = create_app()
