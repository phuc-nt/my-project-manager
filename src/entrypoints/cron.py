"""Cron entrypoint — run a scheduled report (daily or weekly).

Invoked by launchd (see deploy/launchd/) or any scheduler:

    python -m src.entrypoints.cron --daily
    python -m src.entrypoints.cron --weekly

Delegates to the same report flow as the CLI. Exit non-zero on failure so the
scheduler can surface it. Honors DRY_RUN / AGENT_WRITE_DISABLED like every run.
"""

from __future__ import annotations

import logging
import sys

from src.agent.checkpoint import get_checkpointer
from src.config.settings import get_settings


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = argv if argv is not None else sys.argv[1:]
    report_kind = "weekly" if "--weekly" in args else "daily"

    if not get_settings().openrouter_api_key:
        print("OPENROUTER_API_KEY is not set; cannot run scheduled report.", file=sys.stderr)
        return 1

    from src.agent.report_graph import build_report_graph

    graph = build_report_graph(get_checkpointer(), report_kind=report_kind)
    result = graph.invoke(
        {}, config={"configurable": {"thread_id": f"cron-{report_kind}"}}
    )
    delivered = result.get("delivered", False)
    logging.getLogger(__name__).info(
        "cron %s report: delivered=%s %s",
        report_kind,
        delivered,
        result.get("delivery_summary", ""),
    )
    return 0 if delivered else 1


if __name__ == "__main__":
    raise SystemExit(main())
