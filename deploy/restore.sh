#!/bin/bash
# v6 M16: restore state from a backup archive made by backup.sh.
#
#   ./deploy/restore.sh <archive.tar.gz>
#
# Extracts .data/ profiles/ registry.yaml back into the repo root. Does NOT touch .env
# (secrets stay as they are — the backup never contained them). Stop the services first so
# nothing writes mid-restore:
#   launchctl unload ~/Library/LaunchAgents/com.mpm.{web,service}.plist
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"
ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "usage: ./deploy/restore.sh <archive.tar.gz>"; exit 2
fi

# Safety: refuse an archive that somehow contains a .env (it never should).
if tar -tzf "$ARCHIVE" | grep -q '\.env$'; then
  echo "ERROR: archive contains a .env — refusing to restore (secrets must come from a password manager)."
  exit 1
fi

echo "restoring from $ARCHIVE into $REPO_DIR"
# --no-absolute-names: reject absolute-path members (GNU tar needs this explicitly; bsdtar
# on Mac blocks '..' natively — the flag makes the script safe on Linux too, M2).
tar --no-absolute-names -xzf "$ARCHIVE" -C "$REPO_DIR" 2>/dev/null \
  || tar -xzf "$ARCHIVE" -C "$REPO_DIR"   # bsdtar has no --no-absolute-names; it's safe by default
echo "done. Restart services:"
echo "  launchctl kickstart -k gui/\$(id -u)/com.mpm.service"
echo "  launchctl kickstart -k gui/\$(id -u)/com.mpm.web"
