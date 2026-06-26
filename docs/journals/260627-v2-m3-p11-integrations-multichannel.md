# v2 M3-P11 — Integrations (Linear) + multi-channel delivery (Email)

**Ngày:** 2026-06-27 · **Trạng thái:** ✅ Done · **Commits:** S1 `76ad0c5` · S2 `d61ac6e` · S3 `3df09d8` · S4 `8ca62c5`

## Mục tiêu

C3 + D2 cùng đợt, **mở write authority có kiểm soát**: integrations-agnostic qua MCP (Linear) + multi-channel delivery (Email). Mọi write mới phải qua Action Gateway — Lớp A red-line + allowlist default-DENY + Lớp B approve. Không nới `classify()`/`needs_interrupt()`.

## Đã làm (4 slice)

- **S1 — generic MCP registry (C3, read).** `ReportingConfig.extra_servers: dict[str, McpServerSpec]`; profile `integrations:` block khai server stdio (tên + mcp_dist + required_env NAMES; token VALUES từ os.environ, KHÔNG vào yaml). Wired Linear `@tacticlaunch/mcp-linear` (stdio — MCP chính chủ Linear là HTTP/SSE remote, không hợp mô hình spawn). `src/tools/linear_read.py` (getIssues/searchIssues/getProjects) — read bypass gateway như jira_read. No `integrations:` ⇒ `{}` ⇒ byte-identical.
- **S2 — gated Linear write (C3, write).** `linear_createComment` = write DUY NHẤT trong `_MCP_ALLOWLIST["linear"]` (allowlist = bề mặt write thực thi) + marker `createcomment` ⇒ Lớp B (queue duyệt). Tool huỷ diệt (`linear_delete*`/`archive*`) trúng Lớp A DATA_LOSS bất kể allowlist. `linear_write.post_comment` qua gateway (token env trong closure, không vào action/audit); branch `linear` ở `approved_dispatch`. Review xác nhận red line không yếu đi.
- **S3 — Email/SMTP channel (D2).** `email_send` = action type MỚI trong `_MUTATING_TYPES` → funnel gateway (dry-run/kill-switch/dedup/audit + Lớp A/B tự động). **ALL email = Lớp B** (chốt): `needs_interrupt` True mọi email, gửi thật chỉ qua approved dispatch. `_hard_deny_email` quét secret recipient/subject/body + chặn rỗng. stdlib `smtplib` STARTTLS (zero dep mới); password env-only `SMTP_PASSWORD` lúc gửi — không field, không action. `channel_registry` + fail-loud khi smtp thiếu recipients.
- **S4 — wiring + e2e + red-line + docs.** 3 graph (report/okr/resource) `_deliver` gọi `deliver_extra_channels_and_summarize` đồng nhất. **Email INTERNAL-ONLY**: bỏ qua `audience=external` (body = detail đầy đủ gồm tên/cost per-assignee — cùng lằn ranh resource external link-strip). Config chảy qua 3 entry point không đổi (truyền nguyên `loaded.config`), server M2-P6 thừa hưởng qua worker.

## Lằn ranh đỏ (giữ vững)

Mọi write mới (Linear comment, email) sau Action Gateway: Lớp A hard-deny + allowlist default-DENY + Lớp B approve. Tool write mới DENY mặc định tới khi allowlist tường minh. Email không bao giờ ra ngoài qua side-path (test grep: `smtplib` chỉ ở `email_write.py`). External report KHÔNG email (defense-in-depth: gate audience ở đầu helper). `classify()`/`needs_interrupt()` chỉ THÊM nhánh, không nới logic cũ.

## Kết quả

704 test xanh (628 baseline + 76 mới), ruff sạch. Code-reviewer mỗi slice: S1 DONE_WITH_CONCERNS (chuyển linear_read về `src/tools/` + sửa docstring) · S2 DONE (6 red-line check empirical, thắt allowlist còn đúng 1 write) · S3 DONE_WITH_CONCERNS (thêm try/except channel, fail-loud smtp thiếu recipient, tách `config_builders_channels.py` về <200 LOC) · S4 DONE_WITH_CONCERNS (type params + test dedup approved-path). Backward-compat byte-identical khi không khai integrations/smtp.

## Còn lại / mở

- **Live-key E2E hoãn**: chưa chạy Linear thật (`linear_createComment` sau duyệt) + SMTP thật (gửi inbox thật). Offline fake `call_tool`/`smtplib.SMTP`. Cần khi cấp key.
- **Arg keys Linear** (`{issueId, body}`) giả định theo tacticlaunch TOOLS.md — xác nhận với bản server cài đặt trước live run.
- **SMTP port-465 implicit-SSL**: đợt này chỉ STARTTLS:587; `use_tls` để dành cho toggle 465 khi gặp endpoint corp.
- **LOC**: 3 graph + `hard_block.py` >200 (pre-existing cho hard_block/report_graph; okr/resource +~7 dòng từ wiring) — modularize hoãn, không do P11 gây.
- **Lớp B re-queue**: re-run `_deliver` queue email mới (giống external Slack post từ Phase 5) vì interrupt enqueue trước dedup — đã ghi nhận, không phải regression; approved execute path dedup theo (recipients, date).
