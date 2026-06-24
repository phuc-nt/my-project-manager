"""B1 run-event log — one JSONL line per worker run (v2 M1-P3).

Each worker run appends a single line to `<agent data dir>/runs.jsonl` recording what
ran and how it ended (status / cost / delivered). The coordinating service (Slice 3)
reads the last line to get the run detail alongside the worker's exit code. Lives next
to the per-agent audit log, so it is isolated per agent like every other store.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def append_run_event(data_dir: Path, event: dict[str, Any]) -> None:
    """Append one run-event as a JSON line to `data_dir/runs.jsonl`.

    Adds a UTC ISO `ts` if the caller did not provide one. Creates the data dir if
    missing. Append-only: never rewrites prior lines.
    """
    event = {"ts": datetime.now(UTC).isoformat(), **event}
    data_dir.mkdir(parents=True, exist_ok=True)
    line = json.dumps(event, ensure_ascii=False)
    with (data_dir / "runs.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
