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
echo "[1/5] uv sync"
uv sync

echo
echo "[2/5] build web SPA"
if command -v npm >/dev/null 2>&1; then
  ( cd web && npm install --silent && npm run build )
  echo "  built → src/server/static/app/"
else
  echo "  ! npm not found — skipping web build (dashboard won't be served). Install Node then re-run."
fi

echo
echo "[3/5] .env preflight"
MISSING=0
check_env() {
  if [ ! -f .env ] || ! grep -q "^$1=." .env 2>/dev/null; then
    echo "  ! missing $1  ($2)"
    MISSING=$((MISSING + 1))
  fi
}
# Auth (required for any non-localhost / real deployment)
check_env WEB_AUTH_PASSWORD_HASH "run: uv run python -m src.entrypoints.mpm web hash-password"
check_env WEB_SESSION_SECRET     "run: uv run python -m src.entrypoints.mpm web gen-secret"
# Core agent secrets
check_env OPENROUTER_API_KEY     "LLM provider key"
check_env ATLASSIAN_API_TOKEN    "Jira/Confluence token"
if [ "$MISSING" -gt 0 ]; then
  echo "  → $MISSING key(s) missing. Fill .env before the services can run live."
else
  echo "  ok — required keys present"
fi

echo
echo "[4/5] install launchd services (coordinator + web)"
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
echo "[5/5] done"
PORT_VAL="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
echo "  Dashboard: http://127.0.0.1:${PORT_VAL:-8765}"
echo "  Logs:      .data/web.log  .data/service.log"
echo "  Backup:    ./deploy/backup.sh   (daily cron recommended)"
[ "$MISSING" -gt 0 ] && echo "  NOTE: fill the $MISSING missing .env key(s) above, then: launchctl kickstart -k gui/\$(id -u)/com.mpm.web"
echo
