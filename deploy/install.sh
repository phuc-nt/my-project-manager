#!/bin/bash
# v6 M16: one-command production install for the whole system (Mac / launchd).
#
#   ./deploy/install.sh
#
# Does, in order:
#   1. uv sync            — install Python deps into the venv
#   2. build the web SPA  — so FastAPI serves the dashboard as one process (no Vite)
#   3. .env preflight     — warn on missing required keys (auth, secrets, tokens)
#   4. install launchd    — the coordinating service (agents) + the web service
#   5. print a status checklist
#
# Idempotent: re-run after `git pull` to rebuild + reload. Does NOT write secrets — you
# fill .env yourself (see the preflight output + docs/v2/deployment-production.md).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"
echo "== my-project-manager install =="
echo "repo: $REPO_DIR"

echo
echo "[1/6] uv sync"
uv sync

echo
echo "[2/6] build web SPA"
if command -v npm >/dev/null 2>&1; then
  ( cd web && npm install --silent && npm run build )
  echo "  built → src/server/static/app/"
else
  echo "  ! npm not found — install Node then re-run (dashboard won't serve without it)."
fi

echo
echo "[3/6] MCP servers (Jira / Confluence / Slack)"
# The agent spawns 3 stdio MCP servers built from separate repos. Clone + build them into
# ~/workspace/ (the default dist path the config looks for) if not already present. Idempotent.
MCP_BASE="${MCP_BASE:-$HOME/workspace}"
mkdir -p "$MCP_BASE"
if command -v git >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  for repo in jira-cloud-mcp-server confluence-cloud-mcp-server slack-browser-mcp-server; do
    dir="$MCP_BASE/$repo"
    if [ -f "$dir/dist/index.js" ]; then
      echo "  ✓ $repo (already built)"
    else
      echo "  building $repo …"
      [ -d "$dir/.git" ] || git clone -q "https://github.com/phuc-nt/$repo.git" "$dir" || {
        echo "  ! clone $repo failed (network?); re-run installer to retry"; continue; }
      ( cd "$dir" && npm install --silent && npm run build --silent ) \
        && echo "  ✓ $repo built" || echo "  ! build $repo failed; re-run installer"
    fi
  done
else
  echo "  ! git/npm not found — cannot build MCP servers. Install both then re-run."
fi
command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 \
  && echo "  ✓ gh CLI authenticated" \
  || echo "  ! GitHub: run 'gh auth login' once (needed for PR/issue reads)"

echo
echo "[4/6] setup mode"
# The First-run Setup Wizard (M17) handles .env keys + password IN THE BROWSER — no manual
# .env editing. If auth is already configured, setup is done and the wizard is closed (410).
if [ -f .env ] && grep -q "^WEB_AUTH_PASSWORD_HASH=." .env 2>/dev/null; then
  echo "  auth already configured — setup complete, going straight to login"
else
  [ -f .env ] || cp config.example.env .env
  echo "  first run — the browser will open the Setup Wizard to enter keys + set a password"
fi

echo
echo "[5/6] install launchd services (coordinator + web)"
DEST="$HOME/Library/LaunchAgents"
mkdir -p "$DEST"
for name in com.mpm.service.plist com.mpm.web.plist; do
  src="deploy/launchd/$name"
  dst="$DEST/$name"
  sed "s#__REPO_DIR__#$REPO_DIR#g" "$src" > "$dst"
  launchctl unload "$dst" 2>/dev/null || true
  launchctl load "$dst"
  echo "  loaded $name"
done

echo
echo "[6/6] done — opening the dashboard"
PORT_VAL="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
URL="http://127.0.0.1:${PORT_VAL:-8765}"
echo "  Dashboard: $URL"
echo "  Logs:      .data/web.log  .data/service.log"
echo "  Backup:    ./deploy/backup.sh   (daily cron recommended)"
# Give launchd a moment to start the web service, then open the browser (macOS `open`).
sleep 2
if command -v open >/dev/null 2>&1; then
  open "$URL" 2>/dev/null || true
  echo "  → browser opened; follow the Setup Wizard (first run) or log in."
else
  echo "  → open $URL in your browser."
fi
echo
