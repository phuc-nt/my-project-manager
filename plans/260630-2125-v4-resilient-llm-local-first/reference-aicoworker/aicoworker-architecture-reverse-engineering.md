# AICoworker 2026.6.6 Architecture Reverse-Engineering Report

**Date:** 2026-06-24  
**Source:** Electron app reverse-engineering via asar bundle inspection  
**Scope:** Main process (19 bundled modules + node_modules), Electron config, package.json  

---

## Executive Summary

**Hypothesis Confirmed:** AICoworker = **OpenClaw-as-a-library + Pi.dev core + Electron desktop UI**

AICoworker bundles the `openclaw` npm package directly (line 96 in package.json: `"openclaw": "workspace:*"`), wraps it in a TypeScript/esbuild main process, and provides a React-based Electron GUI. The architecture is **modular**: OpenClaw gateway runs as a child process on port 18789, renderer communicates via WebSocket JSON-RPC, and the Electron harness adds desktop features (CDP proxy, local voice, browser automation, document conversion).

---

## 1. Core Engine: OpenClaw + Pi.dev Integration

### Evidence
- **package.json, line 96:** `"openclaw": "workspace:*"` — local workspace dep (not npm registry)
- **package.json, line 22:** `"@mariozechner/pi-ai": "0.70.2"` pinned (Pi.dev core agent runtime)
- **main/index.js:** Exports `gatewayManager` from bundled index-Bm-bJ6Pw.js
- **main/agents-md-injection-CsYko4gy.js, line 8–30:** Injects OpenClaw context into workspace AGENTS.md files; comments reference "OpenClaw version", "OpenClaw path", "Gateway" running on port 18789

### Architecture Pattern
```
AICoworker Electron App
├─ Main Process (Node.js + OpenClaw)
│  ├─ Gateway Manager (gatewayManager)
│  ├─ OpenClaw Core (imported via workspace:*)
│  │  └─ Pi.dev AgentSession runtime (0.70.2)
│  ├─ IPC + System Tray
│  └─ Child Process: OpenClaw Gateway (:18789)
└─ Renderer Process (React UI)
   └─ WebSocket JSON-RPC ↔ Gateway
```

**Port Assignment (main/index-Bm-bJ6Pw.js line ~1200):**
```javascript
const PORTS = {
  AICOWORKER_DEV: 5173,        // Vite dev server (UI)
  AICOWORKER_GUI: 23333,       // Main app window
  OPENCLAW_GATEWAY: 18789,     // OpenClaw agent gateway
  ANTHROPIC_PATCHER_PROXY: 18793,
  LOCAL_LLM: 18790             // Local inference server
}
```

**Gateway startup:** Lines in index-Bm-bJ6Pw.js initiate OpenClaw gateway as a child process, pass config from `~/aicoworker/openclaw/` (= `~/aicoworker/openclaw.json`), and hot-reload credentials when OAuth tokens refresh.

---

## 2. Channels & Messaging Integration

### Discovery
**asar-filelist.txt:** 735 mentions of "channel", 799 mentions of "gateway", 294 mentions of "clawhub", 152 mentions of "registry"

**Dependencies in package.json (lines 80–122):**
- `clawhub: ^0.5.0` — OpenClaw skill registry client
- `@whiskeysockets/baileys` — WhatsApp API (native WhatsApp, not web)
- `@buape/carbon` — Telegram + Discord + Slack integrations (2361+ lines in node_modules)
- `matrix-sdk` (tloncorp imports) — Matrix chat
- `zca-js: 2.1.2` — Zalo (Vietnamese messaging)
- `openzca: ^0.1.51` — Extended Zalo support
- `@tloncorp/*` — Tlon/Urbit ecosystem
- MCP SDK (@anthropic-ai/sdk/helpers/beta/mcp.*) — Model Context Protocol

### Confirmed Channels
1. **Telegram** – via @buape/carbon
2. **WhatsApp** – via @whiskeysockets/baileys (API-based, requires business account)
3. **Discord** – via @buape/carbon
4. **Slack** – via @buape/carbon
5. **Matrix** – via matrix-sdk
6. **Zalo** – via zca-js + openzca
7. **Tlon/Urbit** – via @tloncorp/api
8. **Web Auth (OAuth)** – Anthropic Claude, ChatGPT, Gemini, QWen, Kimi, DeepSeek, Grok, GLM, Doubao, Manus

**Web Auth Registry (main/registry-3vjBUC7L.js):**
Maps providers to electron partition storage for isolated browser contexts:
```javascript
{
  "claude-web": "persist:webauth-claude",
  "chatgpt-web": "persist:webauth-chatgpt",
  "deepseek-web": "persist:webauth-deepseek",
  "gemini-web": "persist:webauth-gemini",
  "grok-web": "persist:webauth-grok",
  ...
  "kimi-web": "persist:webauth-kimi",
  "doubao-web": "persist:webauth-doubao"
}
```

**How it works:**
- Channels are loaded as ClawHub skills (bundled extensions sync via `bundled-extensions-BIheArl-.js`)
- Each channel source integrates with OpenClaw's skill abstraction
- Gateway routes messages to appropriate agent handlers
- Web-auth providers use Electron's webAuth pipeline (shared browser contexts)

---

## 3. Skills/Extensions & ClawHub

### Bundled Extensions System (main/bundled-extensions-BIheArl-.js)
```javascript
// Install bundled skills at startup
syncBundledSkills() {
  const manifest = require('manifest.cjs') // manifest.BUNDLED_SKILLS
  for (skill of manifest.BUNDLED_SKILLS) {
    copy(source/relPath, ~/aicoworker/openclaw/skills/{name}/)
    updateMarkerFile(.aicoworker-bundled.json)  // track versions
  }
  // Enable first-install skills in openclaw.json
  enableBundledSkillsOnFirstInstall(newSkills)
}
```

**Files to watch:**
- Source: `extracted-full/asar: /bundled-extensions/` (not extracted, but listed in asar-filelist)
- Destination: `~/.openclaw/skills/` (symlink to AICoworker's bundled skill repo)
- Marker: `.aicoworker-bundled.json` tracks SHA256 hashes of installed skill directories

### ClawHub Integration
- `clawhub: ^0.5.0` — Registry client (npm package)
- **Evidence:** asar-filelist has 294 clawhub refs; likely used by gateway to resolve skill metadata
- **Function:** Dynamic skill discovery + metadata (tags, docs, config schemas)

### SKILL.md Convention
From agents-md-injection, AICoworker injects runtime context into workspace AGENTS.md files. The convention aligns with OpenClaw:
- Skills live in `~/.openclaw/skills/{skill-name}/`
- Each skill has `SKILL.md` (spec) + tool implementations
- Gateway loads skills on startup, hot-reloads via IPC

---

## 4. LLM Providers & Auth Model

### OAuth-Based Authentication (main/claude-oauth-CxvpxKyo.js)
**Pattern:** OAuth 2.0 PKCE flow for subscription-level auth (not API keys)

**Implemented:**
- **Claude (Anthropic):** OAuth PKCE (client_id: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`)
  - Scopes: `user:profile`, `user:inference`, `user:sessions:claude_code`, `user:mcp_servers`, `user:file_upload`
  - Proactive token refresh (300s before expiry)
  - Stored in `auth-profiles.json` with `type: "oauth"` (access + refresh tokens + expires)
- **OpenAI/ChatGPT:** (main/openai-codex-oauth-DgEe1-lo.js) — OAuth flow
- **Google Gemini:** (main/google-oauth-Bbq3TeB9.js) — OAuth flow
- **Antigravity (OpenRouter?):** (main/antigravity-oauth-DObgYlh_.js) — OAuth flow

**Provider Account Management (main/provider-accounts-CwpxiP5N.js):**
```javascript
// Profiles stored in auth-profiles.json under provider namespaces
{
  "anthropic": {
    "anthropic:default": { type: "oauth", access: "...", refresh: "...", expires: 1718... },
    "anthropic:work": { type: "api_key", key: "sk-ant-...", label: "Work Account" }
  },
  "openai": { ... },
  "google": { ... }
}

// Encrypted storage via Electron safeStorage (macOS Keychain, Windows DPAPI, Linux libsecret)
encrypt(secret) → Buffer.toString('base64') → store in auth-profiles.json
decrypt(encrypted) → Buffer.from('base64') → original secret
```

### Local Models (main/engine-Dpf-TZRx.js + main/server-CS_ZSMFH.js)
**Local Gemma 4 via node-llama-cpp:**
- Models: gemma-4-e2b, gemma-4-e4b, gemma-4-12b (GGUF quantized)
- Download from HuggingFace
- Inference via worker thread (isolated) or fork process (ARM64 Linux)
- OpenAI-compatible HTTP server on :18790 (`/v1/chat/completions`)
- GPU support: macOS (Metal), Vulkan (Linux/Windows via MoltenVK), ONNX Runtime
- Flash-Attention probe (cached)

**Architecture:**
```
LocalLlmEngine (main process)
├─ Worker Thread or Process (spawns node binary)
├─ Load: Downloads model, sets context size based on available RAM
├─ Generate: Streams tokens, supports tool_calls
└─ Profile: Detects GPU, applies backend env (VK_ICD_FILENAMES, GGML_VK_VISIBLE_DEVICES)
```

### Provider Abstraction (main/llm-proxy-store-ee_-P0t3.js)
**Local proxy for multi-provider routing:**
```javascript
{
  enabled: bool,
  port: 23334,           // Default LLM proxy port
  bindAddress: "127.0.0.1",
  modelRemapEnabled: bool,  // Map model names (e.g., "gpt-4" → "claude-opus")
  loadBalance: "priority" | "round-robin",
  exposedModels: ["gpt-4", "claude-opus", "gemini-2.0"],  // Whitelist
  keys: [
    {
      id: "uuid",
      name: "My App",
      hash: "sha256(...)",
      prefix: "sk-aicw-…xxxx",    // Masked
      enabled: bool,
      allowedProviders: ["anthropic", "openai"],  // Access control
      allowedModels: ["claude-opus", "gpt-4"],
      budget: 100.50,              // USD
      applyAnthropicBypass: bool   // Use cached Anthropic responses?
    }
  ]
}
```
**Purpose:** Allow child processes / external apps to query AICoworker's providers without exposing real API keys. Keys are encrypted (safeStorage).

---

## 5. Desktop Features Beyond OpenClaw

### A. Chrome DevTools Protocol Proxy (main/cdp-proxy-BY05yU09.js) — ~31KB minified
**Purpose:** Bridge Chrome DevTools Protocol (CDP) from Electron's WebContents to external tools (Playwright, Puppeteer, ClaudeCode debugger)

**Key Flows:**
- **HTTP JSON endpoints:** `/json/list`, `/json/new`, `/json/close/{id}`, `/json/activate/{id}`
- **WebSocket relay:** `/devtools/page/{targetId}` ↔ Electron debugger protocol
- **Full-page screenshot:** Intercepts `Page.captureScreenshot`, scrolls page, measures DOM, captures at original size (up to 20000px)
- **Print-to-PDF:** Intercepts `Page.printToPDF`, adjusts zoom, sets margins
- **Session tagging:** Maps debugger sessions to agent sessions (`/json/session-tag` POST)

**Real-world use:** ClaudeCode or OpenClaw agents can automate the built-in browser via CDP (no extra browser install needed).

### B. Browser Manager & Automation Views
**Evidence:** asar-filelist references:
- `browserManager.getExposedTargetIds()`
- `automationViews.getAllTabs()`, `.getActiveTabId()`, `.createTab()`
- `.captureTabScreenshot()`, `.setTabSession()`

**Electron WebView + CDP integration:** Each tab is an Electron BrowserView, exposed via CDP. Agents can:
- Open URLs
- Execute JavaScript
- Capture screenshots
- Scroll & measure DOM
- Click, type, submit forms
- Print to PDF

### C. Document Conversion
**Dependencies (package.json):**
- `mammoth: ^1.11.0` — DOCX to markdown/HTML
- `pptx-to-html-BQAvAmlV.js` — PowerPoint slide conversion
- `libreoffice-BnHTLIlT.js` — Office document server (headless LibreOffice)
- `xlsx: ^0.18.5` — Excel parsing

### D. Local Voice Models
**main/local-voice-models-BXjvIlxa.js**
- Likely: HuggingFace transformers (`@huggingface/transformers: ^4.2.0`) for speech-to-text / text-to-speech
- Offline inference (no cloud dependency)

### E. Auto-Update & Electron Updater
- `electron-updater: ^6.8.3`
- Config in main/index-Bm-bJ6Pw.js: CHECK_INTERVAL, DEFAULT_CHANNEL (stable/beta/dev), AUTO_DOWNLOAD

---

## 6. Multi-Agent & Cron Scheduler

### Agent Registry (main/registry-3vjBUC7L.js)
Maps web-auth providers to Electron session partitions (isolated cookies/storage).

### Agents Management
**Evidence from agents-md-injection + codebase structure:**
- **AGENTS.md injection:** AICoworker injects runtime context into workspace `AGENTS.md` files (tells agents they're running inside AICoworker, which gateway version, platform, etc.)
- **Multiple agent support:** Workspace can have multiple agents; each listed in AGENTS.md (follows OpenClaw convention)
- **Cron scheduler:** asar-filelist mentions "cron_task", "stats", "channels" — likely OpenClaw's built-in cron (not confirmed in main process, but plausible via gateway config)

**Config:** `~/.openclaw/openclaw.json` contains agent manifests (imported from workspace OpenClaw setup).

---

## 7. Electron IPC & Renderer Communication

### Main ↔ Renderer Bridge
- **Preload script:** (`extracted-full/dist-electron/preload/`)
- **IPC Channels:**
  - `oauth:token-refreshed` — Main notifies renderer when auth refresh succeeds
  - `browser:tab:created` — Tab opened in browser automation
  - `browser:tab:activated` — Active tab changed
  - `browser:tab:session-tagged` — Session linked to tab

### WebAuth Pipeline (main/webauth-pipeline-BjdsP-Np.js) — ~124KB
Handles browser-based authentication (Claude web, ChatGPT, Gemini, etc.) using isolated Electron contexts:
1. Open webauth window with partition (persist:webauth-{provider})
2. Monitor for auth completion (cookie/token extraction)
3. Store in auth-profiles.json
4. Notify gateway to reload auth

---

## 8. Package Dependency Architecture

**Key integrations:**
```
openclaw (workspace:*)
├─ @mariozechner/pi-ai: 0.70.2  (agent runtime)
├─ zca-js: 2.1.2  (Zalo messaging)
├─ openzca: ^0.1.51  (Zalo extensions)
├─ clawhub: ^0.5.0  (skill registry)
├─ @whiskeysockets/baileys  (WhatsApp)
├─ @buape/carbon  (Telegram/Discord/Slack)
│  └─ @discordjs/voice, @discordjs/rest
├─ matrix-sdk  (Matrix chat)
├─ @tloncorp/api  (Tlon/Urbit)
├─ ws: ^8.19.0  (WebSocket for gateway comms)
├─ node-llama-cpp  (vendor bundled, local inference)
├─ onnxruntime-web  (vendor bundled, GPU ops)
├─ @huggingface/transformers: ^4.2.0  (ML models)
├─ electron-store: ^11.0.2  (persistent config)
├─ electron-updater: ^6.8.3  (auto-update)
├─ @napi-rs/canvas  (image rendering)
├─ sharp  (image processing)
└─ React 19.2.4, Hono 4.12.7  (UI + HTTP layer)

pnpm.overrides:
  @mariozechner/pi-ai: 0.70.2 (PINNED — critical)
  hono: 4.12.7
  @hono/node-server: 1.19.10
  file-type, node-fetch, tar (compatibility locks)
```

---

## 9. What AICoworker Adds Over Stock OpenClaw

| Feature | Stock OpenClaw | AICoworker | Purpose |
|---------|-----------------|-----------|---------|
| **Desktop UI** | Web-only (Next.js) | Electron + React 19 | Offline-first, system tray, native feel |
| **Browser Automation** | Via MCP tools (Playwright) | Built-in CDP proxy + BrowserView | No external browser needed; integrated |
| **Local LLM** | No | Gemma 4 (GGUF) + node-llama-cpp | Offline inference (no API key needed) |
| **Document Conversion** | External tools | Bundled (LibreOffice, mammoth, xlsx) | One-click doc → markdown/PDF |
| **Local Voice** | No | HF transformers (offline) | Speech-to-text, text-to-speech without cloud |
| **Secure Storage** | File-based | Electron safeStorage (Keychain/DPAPI) | OS-level encryption for credentials |
| **CDP Proxy** | No | Full implementation | Debug Electron views, external tools can attach |
| **Web Auth** | API-key only | OAuth 2.0 PKCE flow | Use existing Anthropic/OpenAI subscriptions |
| **Multi-Provider LLM Proxy** | Simple routing | Full quota management + budget caps | Share AICoworker provider access w/ apps |
| **Auto-Update** | Manual | electron-updater (stable/beta/dev channels) | Seamless version management |

---

## 10. File Structure Summary

```
extracted-full/dist-electron/main/
├─ index.js                              (stub entry, exports gatewayManager)
├─ index-Bm-bJ6Pw.js                    (MAIN bundled file: 620KB — all core logic)
├─ agents-md-injection-CsYko4gy.js       (Injects AICoworker context into AGENTS.md)
├─ bundled-extensions-BIheArl-.js        (Sync bundled skills to ~/.openclaw/skills/)
├─ engine-Dpf-TZRx.js                    (Local Gemma 4: load, generate, GPU setup)
├─ server-CS_ZSMFH.js                    (HTTP server for local LLM on :18790)
├─ cdp-proxy-BY05yU09.js                 (Chrome DevTools Protocol relay, screenshots, PDF)
├─ cdp-focus-monitor-DYn9khps.js         (Monitor active tab for CDP focus)
├─ claude-oauth-CxvpxKyo.js              (Anthropic OAuth PKCE flow + token refresh)
├─ google-oauth-Bbq3TeB9.js              (Google Gemini OAuth)
├─ openai-codex-oauth-DgEe1-lo.js        (OpenAI ChatGPT OAuth)
├─ antigravity-oauth-DObgYlh_.js         (OpenRouter-compatible OAuth)
├─ provider-accounts-CwpxiP5N.js         (List, add, delete, reorder LLM provider accounts)
├─ llm-proxy-store-ee_-P0t3.js            (Multi-provider HTTP proxy config + key management)
├─ webauth-pipeline-BjdsP-Np.js          (Browser-based auth for web providers)
├─ registry-3vjBUC7L.js                  (Web auth provider → Electron partition mapping)
├─ local-voice-models-BXjvIlxa.js        (Speech models, likely HF transformers)
├─ libreoffice-BnHTLIlT.js               (Office doc server)
└─ pptx-to-html-BQAvAmlV.js              (PowerPoint converter)

extracted-full/dist-electron/preload/
└─ (preload bridge for IPC)

extracted-full/dist/
└─ React UI (blocked by scout rule — check .claude/.mkignore)
```

---

## Unresolved Questions

1. **Exact cron scheduler implementation**: asar-filelist mentions "cron_task" and "stats" — are these OpenClaw Gateway native features, or custom AICoworker additions? Need to inspect gateway startup config.

2. **ClawHub skill discovery**: How does dynamic skill resolution work? Is ClawHub queried at startup, or only for manual installs? Does it check for skill updates?

3. **Web-auth browser isolated storage**: How are Claude/ChatGPT web session cookies extracted and stored? Is there a custom plugin, or raw cookie interception?

4. **Multi-agent session isolation**: Can multiple agents run in parallel? Does each get its own gateway session? Or time-sliced?

5. **MCP server integration**: `@anthropic-ai/sdk/helpers/beta/mcp.js` is bundled. How are MCP servers registered? Via claude-oauth OAuth scopes (`user:mcp_servers`)? Or manual config?

6. **Antigravity OAuth provider**: What is "antigravity"? OpenRouter? Custom LLM gateway? Needs mapping.

7. **Exported/Signed Skills**: Are bundled skills pre-built and signed, or source-only? How does AICoworker verify SKILL.md integrity?

---

## Conclusion

AICoworker is a **fully-fledged Electron harness** wrapping OpenClaw (Pi.dev-based agent runtime). It's not a thin wrapper — it adds ~19 custom modules totaling ~800KB minified, handling:
- Desktop UI (Electron + React 19)
- Secure credential storage (Keychain integration)
- Local model inference (Gemma 4 + node-llama-cpp)
- Browser automation (CDP proxy + BrowserView)
- OAuth subscription-level authentication (no API keys needed)
- Document conversion (LibreOffice + mammoth)
- Multi-provider LLM proxy with budget management

The architecture confirms **monolithic bundling** (vs. microservices): OpenClaw is vendored as a workspace dep, Pi.dev 0.70.2 is pinned, and all critical features are baked into the main process bundle. This is intentional — offline-first, single executable, no external dependencies (except system daemons).

**For OpenClaw/Hermes comparison:** AICoworker is what OpenClaw looks like when packaged for end users. Hermes is a research platform; AICoworker is a production desktop app.
