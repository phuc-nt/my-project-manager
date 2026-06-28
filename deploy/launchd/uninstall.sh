#!/bin/bash
# Unload + remove all mpm launchd jobs installed by install.sh.
# Usage: ./deploy/launchd/uninstall.sh
set -euo pipefail

DEST="$HOME/Library/LaunchAgents"
for name in com.mpm.service.plist com.mpm.report.daily.plist com.mpm.report.weekly.plist com.mpm.report.resource.plist; do
  dst="$DEST/$name"
  if [[ -f "$dst" ]]; then
    launchctl unload "$dst" 2>/dev/null || true
    rm -f "$dst"
    echo "removed $name"
  fi
done
echo "Done."
