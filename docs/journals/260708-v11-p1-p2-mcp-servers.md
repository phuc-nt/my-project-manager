# v11 P1+P2 — MCP server tối ưu (Slack, Jira, Confluence) (2026-07-08)

3 repo server ngoài my-pm, commit riêng. Chưa publish (P4). Không đụng my-pm.

## Bối cảnh

my-pm spawn 1 node subprocess/tool-call, tắt ngay → mọi tối ưu boot-time server bị nhân N/run.
LLM không thấy tool list (gọi deterministic) → giảm tool-surface không giúp token, nhưng boot nhanh + cache thì được.

## P1 — Slack (v1.2.0 → 1.3.0, commit d0f8506)

- **whoami tool** + phân loại lỗi `TOKEN_EXPIRED` (invalid_auth/not_authed/token_expired/account_inactive) — giải quyết failure-mode vận hành số 1: xoxc/xoxd hết hạn giờ chẩn đoán được, hint "lấy lại từ browser". `classifySlackError` dùng chung mọi tool catch (DRY).
- **Disk cache** channels/users (`~/.cache/slack-browser-mcp/<hash-xoxc>/`, TTL 900s, metadata-only, atomic tmp-per-pid + rename, dir 0700, key = hash token KHÔNG team-domain). Cache populate từ **superset tối đa** (all types + archived + limit 1000) rồi filter client-side — sửa BLOCKER review bắt: bản đầu cache theo arg caller → caller sau args rộng hơn nhận data thiếu.
- Bỏ pre-flight `auth.test` ở write tool; 429 retry-once theo Retry-After; `SLACK_TEAM_DOMAIN` optional.
- Xoá ~4–5k LOC chết (factory cũ + thread sub-tree + benchmarks + config/errors). `list_workspace_channels` thêm arg optional `bypass_cache` (cho P3 inbox retry). serverInfo = package.json version; stdin-EOF exit; SDK pin exact; engines >=20.
- **Live 5/5** (token thật): serverInfo 1.3.0, whoami trả identity thật, **cache cold 363ms → warm 2ms**, bypass refetch, token sai → TOKEN_EXPIRED. 5 tool my-pm dùng: schema bất biến (chỉ +bypass_cache).

## P2 — Confluence (1.4.1 → 1.5.0, commit 609dcf2) + Jira (4.1.7 → 4.2.0, commit 9b09bc5)

- **Confluence lazy boot**: bỏ `testConnection()` (live GET /spaces + exit(1)) khỏi boot mặc định — bỏ 1 network RT + 1 failure-mode khỏi MỖI spawn. Opt-in `API_CONNECTION_TEST=true`; giữ `SKIP_API_CONNECTION_TEST` backward-compat + deprecation log. Env-presence vẫn fail-fast ở boot; 401/403 message thêm "check CONFLUENCE_API_TOKEN/EMAIL" (vì lỗi giờ lộ ở call đầu, không phải boot).
- **Jira dọn dep chết**: xoá `axios`, `axios-retry`, `mcp-jira-cloud-server` (self-ref!), `jira.js` (client vestigial — callJiraApi là stub 501, HTTP thật qua native fetch), + `cross-fetch` (review bắt: chết sau khi gỡ jira.js). **node_modules 122M → 80M (−42M)**.
- Cả 2: serverInfo = package.json version (jira giữ MCP_SERVER_VERSION override); stdin-EOF exit; SDK pin exact 1.17.4 (jira nâng 1.11→1.17.4 SẠCH, không breaking); engines >=20. Jira `capabilities` chuyển sang ServerOptions arg đúng chỗ (review bắt: đang bị SDK ignore).
- **Live 8/8** (Atlassian thật): confluence serverInfo 1.5.0 + **boot 134ms KHÔNG network call**, jira serverInfo 4.2.0 + `enhancedSearchIssues` trả SCRUM-32 thật. stdout thuần JSON-RPC cả 2. 8 tool my-pm dùng: không đổi (0 file src/tools/ bị chạm).

## Bài học

- **Cache theo arg caller = data thiếu ngầm (P1 BLOCKER)**: 1 cache dùng chung nhiều caller phải populate từ SUPERSET rồi mới filter — không thì caller args rộng đọc phải bản hẹp cache trước đó, sai 15'. Review adversarial bắt đúng chỗ.
- **Boot network I/O × spawn-per-call = thuế nhân N (P2 Confluence)**: 1 GET /spaces tưởng rẻ, nhưng nhân số call/run + là failure-mode (exit ở boot). Lazy hóa là win lớn nhất phía Confluence.
- **Dep chết gồm self-reference (P2 Jira)**: pkg phụ thuộc chính bản npm của nó — 122→80M sau dọn. Audit grep-import trước khi xoá là gate.
- **Guard sandbox chặn Edit ngoài repo chính**: dandori G2 chặn Edit/Write ra ngoài my-pm; subagent từ chối lách qua Bash (đúng kỷ luật) → chủ dự án gỡ guard, làm bình thường.

## Unresolved / next

- **Latent (không chặn)**: allowlist my-pm ghi `addcomment` nhưng server đăng ký `addIssueComment`; my-pm hiện KHÔNG gọi jira addComment ở flow nào (chỉ createIssue qua chat-command + reads) nên chưa cắn. Nếu sau này giao việc tạo comment jira → phải khớp tên. Ghi cho P3/P4.
- P3: my-pm McpSessionPool (session reuse per-run, owner-task design) + version contract (đọc serverInfo qua initialize) + whoami health probe + inbox retry bypass_cache.
- P4: esbuild bundle 3 server + publish npm + installer npm-path.
