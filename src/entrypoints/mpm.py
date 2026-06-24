"""Multi-agent CLI entrypoint (v2 M1-P4) — `mpm agent ...`.

    python -m src.entrypoints.mpm agent list
    python -m src.entrypoints.mpm agent register <id>
    python -m src.entrypoints.mpm agent run <id> --report <kind> [--audience ...] [--dry-run]
    python -m src.entrypoints.mpm agent approvals <id>
    python -m src.entrypoints.mpm agent approve <id> <approval-id>
    python -m src.entrypoints.mpm agent reject <id> <approval-id>
    python -m src.entrypoints.mpm agent audit <id> [--tool X] [--verdict V] [--limit N]

The multi-agent surface over the P3 primitives (registry + per-agent worker + per-agent
stores). `cli.py` / `cron.py` stay as the legacy single-agent entrypoints. This is a thin
dispatcher: each command group lives in its own module (registry / run / management).
"""

from __future__ import annotations

import logging
import sys

_USAGE = (
    "usage: python -m src.entrypoints.mpm agent "
    "list | register <id> | run <id> --report <kind> [--audience ...] [--dry-run] | "
    "approvals <id> | approve <id> <approval-id> | reject <id> <approval-id> | audit <id> [filters]"
)


def _flag_value(args: list[str], flag: str) -> str | None:
    """Return the value after `--flag` in args, or None. Shared across the mpm modules."""
    if flag in args:
        i = args.index(flag)
        if i + 1 < len(args):
            return args[i + 1]
    return None


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = argv if argv is not None else sys.argv[1:]
    if len(args) < 2 or args[0] != "agent":
        print(_USAGE, file=sys.stderr)
        return 2

    sub, rest = args[1], args[2:]
    if sub == "list":
        from src.entrypoints.mpm_registry_cmds import run_list

        return run_list(rest)
    if sub == "register":
        from src.entrypoints.mpm_registry_cmds import run_register

        return run_register(rest)
    if sub == "run":
        from src.entrypoints.mpm_run_cmd import run_agent

        return run_agent(rest)
    if sub in {"approvals", "approve", "reject", "audit"}:
        from src.entrypoints.mpm_manage_cmds import run_manage

        return run_manage(sub, rest)

    print(f"error: unknown subcommand {sub!r}.\n{_USAGE}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
