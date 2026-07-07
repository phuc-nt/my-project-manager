#!/bin/bash
# v6 M16 / hardened v10 M26: one-command production install for the whole system (Mac / launchd).
#
#   ./deploy/install.sh
#
# Does, in order:
#   1. preflight          — fail loud with the exact fix if a required tool is missing
#   2. uv sync            — install Python deps into the venv
#   3. build the web SPA  — into a temp dir, then swap atomically (never breaks a live server)
#   4. MCP servers        — clone + build the 3 stdio servers (idempotent; honors *_MCP_DIST)
#   5. .env preflight     — copy the template on first run (secrets go in the browser wizard)
#   6. launchd services   — install/reload ONLY when the plist or SPA actually changed
#   7. health gate        — report what is / isn't ready before declaring success
#
# Idempotent: re-running when nothing changed is a no-op — it does NOT restart the coordinator
# (which would kill in-flight agent runs) or the web service (which would drop sessions). It only
# reloads a service when its plist changed, and only rebuilds/swaps the SPA when the build differs.
# Does NOT write secrets — you fill .env yourself (browser wizard + the preflight output).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"
echo "== my-project-manager install =="
echo "repo: $REPO_DIR"

# ---------------------------------------------------------------------------------------------
# [1/7] preflight — required tools. We do NOT auto-install onto the user's machine; we fail loud
# with the exact command so nothing runs half-configured (KISS: the user stays in control).
# ---------------------------------------------------------------------------------------------
echo
echo "[1/7] preflight (required tools)"
missing=0
require() { # name  install-hint
  if command -v "$1" >/dev/null 2>&1; then
    echo "  ✓ $1"
  else
    echo "  ✗ $1 not found — install it:  $2"
    missing=1
  fi
}
require uv  "curl -LsSf https://astral.sh/uv/install.sh | sh"
require node "brew install node"
require npm  "brew install node"
require git  "brew install git"
if [ "$missing" -ne 0 ]; then
  echo
  echo "  Install the tools above, then re-run ./deploy/install.sh"
  exit 1
fi
# gh is only needed for GitHub reads and its login is interactive — don't hard-block install on
# it (a Jira/Confluence-first operator can set gh up later). The health gate reports it at the end.
if command -v gh >/dev/null 2>&1; then
  echo "  ✓ gh"
else
  echo "  • gh not found (optional now) — for GitHub reads: brew install gh && gh auth login"
fi

echo
echo "[2/7] uv sync"
uv sync

# ---------------------------------------------------------------------------------------------
# [3/7] build the web SPA into a TEMP dir (vite --outDir override), then swap into the served dir
# only if the output actually differs. Building straight into src/server/static/app/ — which
# vite.config.ts does by default with emptyOutDir:true — would first WIPE the live-served dir and
# then rewrite it, handing a client a 404/partial bundle mid-build. Building to a temp dir and
# rsync-ing in place avoids that window and lets us skip the web restart when the SPA is unchanged
# (F6). The rsync --delete makes the served dir exactly match the fresh build.
# ---------------------------------------------------------------------------------------------
echo
echo "[3/7] build web SPA"
SPA_DIR="src/server/static/app"
SPA_TMP="$(mktemp -d "${TMPDIR:-/tmp}/mpm-spa.XXXXXX")"
spa_changed=0
# Fingerprint a build dir by RELATIVE-path + content, so a dir hashes the same regardless of where
# it lives (the temp build vs the served dir have different absolute prefixes). Without stripping
# the base dir, the two fingerprints would ALWAYS differ and F6 would restart web on every run.
spa_fingerprint() { # dir
  ( cd "$1" 2>/dev/null && find . -type f -exec shasum {} \; | sort | shasum | cut -d' ' -f1 )
}
if [ -f "$SPA_DIR/index.html" ]; then
  before="$(spa_fingerprint "$SPA_DIR")"
else
  before="none"
fi
# Build into the temp dir (override vite's outDir). The live dir is untouched until the swap.
( cd web && npm install --silent && npm run build -- --outDir "$SPA_TMP" --emptyOutDir )
after="$(spa_fingerprint "$SPA_TMP")"
if [ "$before" != "$after" ]; then
  spa_changed=1
  mkdir -p "$SPA_DIR"
  # Atomic-enough for a local single-operator deploy: rsync writes new files then removes stale
  # ones; the served dir is only briefly inconsistent (vs emptyOutDir which starts empty).
  rsync -a --delete "$SPA_TMP/" "$SPA_DIR/"
fi
rm -rf "$SPA_TMP"
echo "  built → $SPA_DIR$( [ "$spa_changed" -eq 1 ] && echo '  (changed, swapped in)' || echo '  (unchanged — live dir untouched)')"

# ---------------------------------------------------------------------------------------------
# [4/7] MCP servers. Honor any *_MCP_DIST already set in .env (a custom location the config
# resolves against) — if that dist exists we do NOT re-clone into the default ~/workspace.
# ---------------------------------------------------------------------------------------------
echo
echo "[4/7] MCP servers (Jira / Confluence / Slack)"
MCP_BASE="${MCP_BASE:-$HOME/workspace}"
mkdir -p "$MCP_BASE"
# Read a *_MCP_DIST override from .env (value only), if present.
env_dist() { [ -f .env ] && grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
# macOS ships bash 3.2 (no associative arrays), so map repo → env-var name with a case (portable).
mcp_env_key() {
  case "$1" in
    jira-cloud-mcp-server) echo "JIRA_MCP_DIST" ;;
    confluence-cloud-mcp-server) echo "CONFLUENCE_MCP_DIST" ;;
    slack-browser-mcp-server) echo "SLACK_MCP_DIST" ;;
  esac
}
for repo in jira-cloud-mcp-server confluence-cloud-mcp-server slack-browser-mcp-server; do
  key="$(mcp_env_key "$repo")"
  override="$(env_dist "$key")"
  if [ -n "$override" ] && [ -f "$override" ]; then
    echo "  ✓ $repo (using $key=$override)"
    continue
  fi
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
  # If MCP_BASE is not the default, the config won't find the dist unless *_MCP_DIST points to it.
  # Write the override into .env (only when absent — never clobber an existing value).
  if [ "$MCP_BASE" != "$HOME/workspace" ] && [ -f "$dir/dist/index.js" ] && [ -f .env ]; then
    if ! grep -qE "^$key=" .env 2>/dev/null; then
      printf '%s=%s\n' "$key" "$dir/dist/index.js" >> .env
      echo "    → wrote $key to .env (custom MCP_BASE)"
    fi
  fi
done

echo
echo "[5/7] .env setup"
# The First-run Setup Wizard (M17) handles .env keys + password IN THE BROWSER — no manual
# .env editing, and no secret ever passes through this script. If auth is already configured,
# setup is done and the wizard is closed (410).
if [ -f .env ] && grep -q "^WEB_AUTH_PASSWORD_HASH=." .env 2>/dev/null; then
  echo "  auth already configured — setup complete, going straight to login"
else
  [ -f .env ] || cp config.example.env .env
  echo "  first run — the browser will open the Setup Wizard to enter keys + set a password"
fi

# ---------------------------------------------------------------------------------------------
# [6/7] launchd services — install/reload ONLY when the rendered plist differs from what's
# installed, OR (for the web service) when the SPA changed. A no-change re-run must not restart
# anything: restarting the coordinator kills in-flight agent runs; restarting web drops sessions.
# ---------------------------------------------------------------------------------------------
echo
echo "[6/7] launchd services (coordinator + web)"
DEST="$HOME/Library/LaunchAgents"
mkdir -p "$DEST"
reload_service() { # plist-name  force-reload(0/1)
  local name="$1" force="$2"
  local src="deploy/launchd/$name" dst="$DEST/$name"
  local rendered; rendered="$(sed "s#__REPO_DIR__#$REPO_DIR#g" "$src")"
  local changed=1
  if [ -f "$dst" ] && [ "$rendered" = "$(cat "$dst")" ]; then changed=0; fi
  if [ "$changed" -eq 0 ] && [ "$force" -eq 0 ]; then
    echo "  = $name (unchanged — not restarted)"
    return
  fi
  printf '%s\n' "$rendered" > "$dst"
  launchctl unload "$dst" 2>/dev/null || true
  launchctl load "$dst"
  echo "  ↻ $name ($( [ "$changed" -eq 1 ] && echo 'plist changed' || echo 'SPA changed' ))"
}
reload_service com.mpm.service.plist 0
# Web serves the SPA, so a changed build means it must reload to pick up new static files.
reload_service com.mpm.web.plist "$spa_changed"

# ---------------------------------------------------------------------------------------------
# [7/7] health gate — report readiness before declaring success. No secret values are printed.
# ---------------------------------------------------------------------------------------------
echo
echo "[7/7] health gate"
gate_ok=1
# MCP builds
for repo in jira-cloud-mcp-server confluence-cloud-mcp-server slack-browser-mcp-server; do
  override="$(env_dist "$(mcp_env_key "$repo")")"
  dist="${override:-$MCP_BASE/$repo/dist/index.js}"
  if [ -f "$dist" ]; then echo "  ✓ MCP $repo built"; else echo "  ✗ MCP $repo missing — re-run installer"; gate_ok=0; fi
done
# gh auth (the one live check we can do without secrets)
if gh auth status >/dev/null 2>&1; then
  echo "  ✓ GitHub CLI authenticated"
else
  echo "  ✗ GitHub — run 'gh auth login' once (needed for PR/issue reads)"; gate_ok=0
fi
# .env password → whether the setup wizard still needs completing
if grep -q "^WEB_AUTH_PASSWORD_HASH=." .env 2>/dev/null; then
  echo "  ✓ dashboard auth configured"
else
  echo "  • dashboard not yet set up — finish the browser wizard (keys + password)"
fi

echo
PORT_VAL="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
URL="http://127.0.0.1:${PORT_VAL:-8765}"
echo "  Dashboard: $URL"
echo "  Logs:      .data/web.log  .data/service.log"
echo "  Backup:    ./deploy/backup.sh   (daily cron recommended)"
if [ "$gate_ok" -eq 1 ]; then
  echo "  Status:    ✓ all prerequisites ready"
else
  echo "  Status:    some prerequisites missing (see ✗ above) — fix, then re-run this script"
fi
# Give launchd a moment to start the web service, then open the browser (macOS `open`).
sleep 2
if command -v open >/dev/null 2>&1; then
  open "$URL" 2>/dev/null || true
  echo "  → browser opened; follow the Setup Wizard (first run) or log in."
else
  echo "  → open $URL in your browser."
fi
echo
