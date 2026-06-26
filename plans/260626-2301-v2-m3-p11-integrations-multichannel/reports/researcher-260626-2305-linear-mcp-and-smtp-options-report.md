---
title: Linear MCP server + SMTP research
date: 2026-06-26
researcher: technical-analyst
---

# Q1: Linear MCP Server (stdio, node-based)

## Finding: Official Linear MCP is HTTP/SSE-only (BLOCKER for stdio spawn)

**Linear's official MCP server** (https://mcp.linear.app/sse) is **remote HTTP/SSE transport only**, NOT stdio. This is a **hard blocker** for your spawn model (`MultiServerMCPClient, transport="stdio"`). To use Linear's official server, you'd need:
1. A proxy bridge (`mcp-remote`) translating stdio ↔ HTTP/SSE (adds complexity)
2. OR switch to HTTP transport for Linear only (inconsistent with your jira/slack/confluence stdio pattern)

**Recommended path: Use community stdio implementation instead.**

## Recommendation: tacticlaunch/mcp-linear (stdio, node-based)

**Server:** `@tacticlaunch/mcp-linear` ([GitHub](https://github.com/tacticlaunch/mcp-linear), [npm](https://www.npmjs.com/package/@tacticlaunch/mcp-linear))

**Transport:** stdio (command: `npx @tacticlaunch/mcp-linear` or post-build: `node dist/index.js`)

**Matches your pattern:** Yes — identical to jira/slack/confluence MCP servers (local Node dist, stdio subprocess).

**Read tools (sample):**
- `linear_getIssues` — list/filter issues
- `linear_searchIssues` — search issues  
- `linear_getIssueById` — fetch single issue
- `linear_getProjects` — list projects
- `linear_getMilestones`, `linear_getCycles` — read roadmaps/sprints

All read tools are safe (no dangerous substrings like delete/remove/archive/grant). Safe to allowlist as-is.

**Write tool (the one to gate):**
- `linear_createComment` — **Lớp B approval required** (creates a comment on an issue; matches your "ONE gated write" spec). Exact casing: `linear_createComment` (camelCase, lowercase `linear_`).

**Destructive tool names (Lớp A hard-deny, trigger on name alone):**
- `linear_deleteComment`, `linear_deleteDocument`, `linear_deleteIssue`, `linear_archiveProject`, `linear_archiveIssue` (and ~15 other archive/delete/unarchive tools). These must be hard-blocked regardless of allowlist due to name pattern matching.

**Environment variable:**
- `LINEAR_API_TOKEN` (required; read from env at subprocess startup)

**Auth model:**
- Linear personal API key (static, user-scoped, non-expiring). Generated from Linear Settings > Security & Access > Personal API Keys.
- Key is scoped: can be restricted to Read, Write, Admin, Create issues, Create comments, and/or specific teams.
- **For read + create-comment**: an API key scoped to `Read + Create comments` is sufficient. No OAuth refresh complexity needed.
- Header sent by server: `Authorization: <LINEAR_API_TOKEN>` to Linear's GraphQL API endpoint.

**Approval classification:**
- `linear_getIssues`, `linear_searchIssues`, etc. → **safe** (allowlist, auto-approve)
- `linear_createComment` → **Lớp B** (queue for human approval before sending to Linear)
- All `linear_delete*`, `linear_archive*` → **Lớp A hard-deny** (hard-coded never, regardless of allowlist)

**Config block (profile.yaml):**
```yaml
extra_servers:
  linear:
    dist_path: ~/workspace/mcp-linear/dist/index.js  # or npx @tacticlaunch/mcp-linear
    env:
      LINEAR_API_TOKEN: ${LINEAR_API_TOKEN}  # from .env
```

---

# Q2: SMTP Send from Python (outbound email as gated mutation)

## Recommendation: stdlib `smtplib` + app-password STARTTLS

**Stdlib sufficient?** Yes. `smtplib` + `email.message.EmailMessage` cleanly support STARTTLS, login(user, password), and sendmail(). No gotcha for synchronous graph nodes (blocking I/O is fine; your nodes are sync). **Prefer stdlib: zero new dependency, full Python 3.12 stdlib guarantee.**

**Auth: app-password over STARTTLS, not OAuth2.** For a single-operator agent:
- App-password (Gmail, corporate SMTP) is **KISS**: user/password over STARTTLS, no token refresh, no scope negotiation.
- OAuth2/XOAUTH2 adds complexity (token refresh, consent flow, scopes) with **zero benefit** for single-operator use. Not warranted.
- Recommendation: **app-password over STARTTLS is sufficient and advised.**

**Common SMTP settings:**

| Provider | Host | Port | STARTTLS/SSL | Auth |
|----------|------|------|--------------|------|
| Gmail | smtp.gmail.com | 587 | STARTTLS (after EHLO) | app-password + username |
| Generic corporate | host (e.g. smtp.company.com) | 587 (or 465 for SSL) | STARTTLS or implicit SSL | user/password or custom |

**Config fields (minimal, for .env + profile.yaml):**
```yaml
email:
  smtp_host: smtp.gmail.com       # or corp server
  smtp_port: 587                  # 465 for implicit SSL
  smtp_user: my-email@gmail.com   # or corp user
  # smtp_password: from env only (see below)
  use_tls: true                   # STARTTLS if true, implicit SSL if false (port 465)
```

**Credential handling:**
- `smtp_password` must come from env (e.g., `SMTP_PASSWORD` in .env), **never in profile.yaml or committed config**.
- At runtime: read `SMTP_PASSWORD` from env, pass to `smtplib.SMTP(...).login(smtp_user, smtp_password)`.
- This matches your existing pattern (LINEAR_API_TOKEN from env).

**Security note on send body:**
- Your send body (report text) likely contains role names, project names, metrics — **already PII-firewalled in code** (you check audience before deciding to send to external vs internal). No additional redaction needed; the env credential principle is the blocker.

**Stdlib code pattern (for node implementation):**
```python
import smtplib
from email.message import EmailMessage

msg = EmailMessage()
msg['Subject'] = 'Report'
msg['From'] = os.getenv('SMTP_USER')
msg['To'] = recipient  # from action args
msg.set_content(body_text)

with smtplib.SMTP(host, port) as server:
    server.ehlo()
    if use_tls:
        server.starttls()
        server.ehlo()  # resend after TLS
    server.login(os.getenv('SMTP_USER'), os.getenv('SMTP_PASSWORD'))
    server.send_message(msg)
```

**When NOT to use stdlib:** If your graph becomes async (event loop + asyncio nodes), use `aiosmtplib` instead (same API, async/await compatible). **Current sync graph: smtplib only.**

**Lớp classification:**
- `email_send` action to external (stakeholder) recipient → **Lớp B** (queue for approval; external channel exposure).
- `email_send` action to internal (team) recipient → **Lớp A/B decision: depends on your policy** (if internal-only send is automatic, classify safe; if always gated, classify Lớp B). Recommend: **internal auto, external gate** (matches Slack/Confluence audience routing).

---

## Unresolved Questions

1. **Linear tool names (exact casing)**: Confirmed from tacticlaunch/mcp-linear TOOLS.md as `linear_createComment` (camelCase). Official Linear MCP docs do not publish tool names; if Linear's official MCP is used in future, tool names must be re-confirmed from that server's schema/spec.

2. **Linear API key scoping**: Confirmed that a key can be scoped to "Create comments" + "Read". However, tacticlaunch/mcp-linear's internal GraphQL queries (e.g., for `linear_searchIssues`) may require additional read scopes. **Recommendation: Test with a "Read + Create comments" scoped key; if insufficient, widen to "Read + Write" (still not Admin).**

3. **Email recipient validation**: Your plan mentions checking audience before external send. **Implementation detail not covered here:** must validate recipient email format and deny obviously fake/test addresses in the Lớp A hard-deny (e.g., "test@example.com", "noreply@", etc.). This is a code-level check, not research scope.

4. **SMTP provider-specific quirks**: Gmail's app-password flow is standard; corporate SMTP servers often have custom TLS/auth requirements. **Recommendation: config should expose `use_tls` (boolean) to handle both port 587 STARTTLS and port 465 implicit SSL cases; test early with the actual corp SMTP endpoint you'll use.**

---

## Sources

**Linear MCP:**
- [Linear MCP Docs](https://linear.app/docs/mcp) — official remote server (HTTP/SSE)
- [tacticlaunch/mcp-linear GitHub](https://github.com/tacticlaunch/mcp-linear) — stdio Node implementation, TOOLS.md tool registry
- [Linear API Key Docs](https://linear.app/developers/oauth-2-0-authentication) — auth model & scoping
- [Unified.to Linear API Key Guide](https://unified.to/blog/linear_api_key_how_to_generate_and_use_it_graphql_guide_for_developers) — personal key creation & scopes

**SMTP:**
- [Python smtplib docs](https://docs.python.org/3/library/smtplib.html) — stdlib SMTP client
- [Mailtrap smtplib tutorial](https://mailtrap.io/blog/smtplib/) — STARTTLS + auth patterns
- [Gmail SMTP with app password](https://community.latenode.com/t/setting-up-gmail-smtp-with-app-password-for-server-side-python-scripts/12824) — Gmail-specific setup
- [aiosmtplib docs](https://aiosmtplib.readthedocs.io/en/latest/reference.html) — async alternative (not recommended for current sync graph)
