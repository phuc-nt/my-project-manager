---
title: "v2 M3-P11 — Integrations + multi-channel delivery"
description: "Config-driven MCP servers (Linear, gated write) + channel abstraction with Email (SMTP), all behind the Action Gateway."
status: completed
priority: P1
effort: 16h
branch: main
tags: [v2, m3, integrations, mcp, delivery, email, action-gateway, security]
created: 2026-06-26
completed: 2026-06-27
---

# v2 M3-P11 — Integrations + multi-channel delivery

Two features this round, BOTH with **gated new WRITE tools** (each new mutating tool
classified Lớp A/B + added to the default-DENY allowlist with red-line review):

- **C3 — generic MCP integration gateway**: today only 3 hardcoded MCP servers
  (jira/slack/confluence) wired via fixed fields `ReportingConfig.{jira,slack,confluence}_server`
  (`src/config/reporting_config.py:86-88`). Make MCP servers config-driven: a
  `profile.yaml` block DECLARES an extra server (name + dist_path + env keys) so the
  agent READs from it and (gated) WRITEs to it without code change. Proof = **Linear**:
  read epics/issues + ONE gated WRITE (`createComment`) flowing through the allowlist +
  Lớp A/B path as a NEW server.
- **D2 — multi-channel report delivery**: today reports deliver to exactly Slack
  (`src/actions/slack_write.py:deliver_report`) + Confluence (`create_report_page`),
  audience-routed in `src/agent/audience_delivery.py`. Add a channel abstraction + ONE
  new channel = **Email (SMTP)**. Outbound email send is a MUTATION → routes through the
  Action Gateway (classified Lớp A/B), NOT a side path.

## THE INVARIANT (non-negotiable — restated in every phase's risks)

ANY write-authority expansion (new MCP write tool, new mutating delivery channel) MUST
stay behind the Action Gateway: Lớp A hard-deny red line + Lớp B approve + default-DENY
allowlist. `_MCP_ALLOWLIST` / `_GH_ALLOWLIST_PREFIXES` (`src/actions/hard_block.py:119-140`)
is the safety net: a new server's write tools are DENIED by default until explicitly
allowlisted, each classified Lớp A (never) / Lớp B (approve) / safe. New email send must be
a gateway-routed action type that flows through `ActionGateway.execute()` — never bypasses
it. (Memory: "Action Gateway is allowlist + Lớp A hard-deny, not denylist; new tools deny by
default".)

## RESOLVED decisions (research + locked policy — implementation needs no guessing)

- **Linear server** = `@tacticlaunch/mcp-linear` (community, stdio `node <dist>/index.js`). Official
  Linear MCP is HTTP/SSE remote-only ⇒ incompatible with our stdio-spawn model (blocker noted).
- **Linear tools (verbatim):** read `linear_getIssues`/`linear_searchIssues`/`linear_getIssueById`/
  `linear_getProjects`; gated write `linear_createComment` (Lớp B). `_MCP_ALLOWLIST["linear"]` =
  lowercased frozenset of those 5; `_LOP_B_MCP_TOOL_MARKERS` += `"createcomment"`. Destructive
  `linear_delete*`/`linear_archive*` already Lớp A via `_DATA_LOSS_TOOL_MARKERS` (no allowlist entry).
- **Linear auth:** env `LINEAR_API_TOKEN` (scope Read + Create comments). Env-only.
- **Email:** stdlib `smtplib` + `email.message.EmailMessage`, STARTTLS, `login()`. NO new dep.
- **Email policy LOCKED:** ALL email = Lớp B (every send queues for approval; no domain/internal split).
  `needs_interrupt` returns True unconditionally for `email_send`. SMTP password env-only (`SMTP_PASSWORD`).
- **Graph coverage:** all 3 report graphs apply the channel registry uniformly.

## Architecture decisions (verified against codebase)

1. **C3 = config/registry plumbing, no new adapter.** `src/adapters/mcp_adapter.py:101`
   `call_tool(spec, tool_name, args)` is integration-agnostic. A new `server="linear"`
   `mcp_tool` action flows through the gateway unchanged — `_label`/`_action_dedup_key`
   (`action_gateway.py:74,92`) are server-agnostic; `_MCP_ALLOWLIST.get(server, frozenset())`
   (`hard_block.py:390`) returns empty for an unknown server = DENY by default. So C3 adds:
   (a) an `extra_servers` mapping on `ReportingConfig`, (b) a profile `integrations:` block +
   loader mapping, (c) the `linear` entry in `_MCP_ALLOWLIST` (read tools safe; `linear_createcomment`
   Lớp B), (d) a Linear read helper + an approved-write dispatch branch.
2. **D2 email = a new gateway action `type`.** `_MUTATING_TYPES = {"mcp_tool","gh_cli"}`
   (`action_gateway.py:38`). Email is neither, so we ADD `"email_send"` to `_MUTATING_TYPES`
   and to `classify()` (`hard_block.py:397`). This is the ONLY safe route — the gateway's
   dry-run/kill-switch/dedup/audit then apply automatically. A channel registry selects channels;
   Email builds an `email_send` action and calls `gateway.execute()` (always Lớp B ⇒ pending_approval),
   the real send happening on approval via `dispatch_approved_action` (mirroring `slack_write.py:62`).
3. **Backward-compat:** no `extra_servers` + no `smtp:` declared ⇒ byte-identical to
   pre-P11. Empty `extra_servers` mapping, default channel list = `[slack, confluence]`.

## Phases

| # | Phase | File | Status | Depends |
|---|-------|------|--------|---------|
| S1 | Generic MCP registry/config + read-only Linear | [phase-01-generic-mcp-registry-readonly-linear.md](phase-01-generic-mcp-registry-readonly-linear.md) | ✅ done (76ad0c5) | — |
| S2 | Gated Linear write (allowlist + Lớp A/B + dispatch) | [phase-02-gated-linear-write-allowlist-lop-ab.md](phase-02-gated-linear-write-allowlist-lop-ab.md) | ✅ done (d61ac6e) | S1 |
| S3 | Channel abstraction + Email (SMTP) gateway-routed | [phase-03-channel-abstraction-email-smtp-gateway.md](phase-03-channel-abstraction-email-smtp-gateway.md) | ✅ done (3df09d8) | — |
| S4 | Wiring through 3 entry points + offline e2e + red-line + docs | [phase-04-wiring-entrypoints-e2e-redline-docs.md](phase-04-wiring-entrypoints-e2e-redline-docs.md) | ✅ done (8ca62c5) | S1,S2,S3 |

S1 and S3 are independent (different files) — parallelizable. S2 needs S1's registry. S4
integrates all + threads the 3 entry points (`worker.py:54`, `cron.py:95`, `cli.py:272`).

## Dependency graph

```
S1 (registry + Linear read) ──► S2 (Linear write) ──┐
                                                     ├──► S4 (wiring + e2e + docs)
S3 (channel abstraction + Email) ────────────────────┘
```

## File ownership (no two parallel phases touch the same file)

- **S1**: `reporting_config.py`, `config_builders_reporting.py`, `loader_mapping.py`,
  `profiles/default/profile.yaml`, new `src/actions/linear_read.py`.
- **S2**: `hard_block.py` (linear allowlist entry), `approved_dispatch.py`, new
  `src/actions/linear_write.py`.
- **S3**: `hard_block.py` (`email_send` classify), `action_gateway.py` (`_MUTATING_TYPES`),
  new `src/actions/email_write.py`, new `src/agent/channel_registry.py`.
- **Conflict note**: S2 + S3 both touch `hard_block.py`. RESOLUTION: S2 owns
  `_MCP_ALLOWLIST` (linear key) + `_LOP_B_MCP_TOOL_MARKERS`; S3 owns the `email_send`
  branch in `classify()` + a new `_hard_deny_email`. Disjoint regions; if run in parallel,
  S4 merges. SAFEST: run S2 then S3 sequentially to avoid `hard_block.py` merge.
- **S4**: `worker.py`, `cron.py`, `cli.py`, `report_graph.py` (+ okr/resource graphs),
  `audience_delivery.py`, docs.

## Acceptance criteria (measurable)

- [x] `uv run pytest -q` ⇒ 704 pass (628 baseline + 76 new), no regressions; ruff clean.
- [x] Profile declares a `linear` extra server ⇒ correct `McpServerSpec` reached;
      missing dist/env ⇒ clear error (selection test, P8-style). `test_extra_servers_config.py`.
- [x] `linear_createComment` DENIED until allowlisted, then Lớp B-queued after (gateway test).
- [x] `linear:deleteIssue` AND `linear:archiveProject` (destructive names) ⇒ Lớp A hard-deny
      regardless of allowlist. `test_p11_redline.py` + `test_linear_write.py`.
- [x] Secret in Linear/email args ⇒ CREDENTIAL deny.
- [x] Email send routes through gateway: dry_run ⇒ no send; kill-switch ⇒ refused;
      empty body / no recipient ⇒ refuse. `test_email_write.py`.
- [x] EVERY `email_send` (any recipient) ⇒ Lớp B-queued (approval), never auto-sent.
- [x] No `extra_servers` + no `smtp:` ⇒ byte-identical pre-P11 behavior
      (Slack+Confluence only), backward-compat test. `test_p11_integration_e2e.py`.
- [x] New profile config threads through all 3 entry points (`worker`/`cron`/`cli`) +
      M2-P6 server (inherits via worker) — config passed whole, no entry-point change needed.
- [x] Offline-first: fake MCP server spec + fake SMTP; NO live Linear key / real send.
- [x] Docs updated: `docs/v2/architecture.md` (§6), `config.example.env`, `profiles/default/profile.yaml`,
      `docs/v2/roadmap-m2.md` (P11 entry).

## Rollback

Each phase is independently revertable: S1 (delete `linear_read.py` + revert config field
defaults to empty mapping), S2 (remove linear allowlist entry + dispatch branch — write then
denies by default, fail-safe), S3 (remove `email_send` from `_MUTATING_TYPES` + channel
registry falls back to Slack-only). No DB migration, no schema change to persisted approvals
(action dicts are JSON — an `email_send` dict deserializes fine; an un-dispatched approved
email raises "No live handler wired" rather than mis-sending).

## Status / Summary / Concerns

- **Status**: in-progress (plan authored + research-baked; implementation not started).
- **Summary**: 4 phases. C3 = config-driven MCP servers (tacticlaunch Linear read + gated
  `linear_createComment`); D2 = channel registry + Email via a new `email_send` gateway action
  (ALL email = Lớp B). Every write stays behind the gateway's default-DENY allowlist + Lớp A/B.
- **Concerns**: all 4 originally-open questions RESOLVED (Linear server/tools/auth, SMTP stdlib,
  all-email-Lớp-B, all-3-graphs-uniform). Remaining items are DEFERRED, not blocking: live Linear/SMTP
  key E2E; Linear key-scope adequacy for `searchIssues`; port-465 implicit-SSL toggle. Confirm
  `linear_createComment` arg keys (`issueId`/`body`) against the installed server version before the
  live run. See each phase's "Unresolved questions".
