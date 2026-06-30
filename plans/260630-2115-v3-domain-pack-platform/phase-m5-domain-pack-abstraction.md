# Phase M5 — Domain-Pack Abstraction + pm-pack

> [← plan.md](plan.md) · sau: [phase-m6](phase-m6-hr-pack-proof.md)

## Context Links
- v2 architecture: [docs/v2/architecture.md](../../docs/v2/architecture.md) §10 (harness conformance)
- Research findings: 3 seam hardcoded (xem plan.md "Bối cảnh kỹ thuật")
- Files trọng tâm: `src/runtime/worker.py`, `src/actions/hard_block.py`, `src/actions/approved_dispatch.py`, `src/llm/*_prompt.py`, `src/tools/models.py`

## Overview
- **Priority:** P0 — nền tảng cho toàn v3.
- **Status:** ✅ DONE (2026-06-30). 6 slice xong, 816 test xanh, ruff clean, pm-pack byte-identical.
- **Mục tiêu:** Tách 3 seam coupling. Đóng gói PM hiện tại thành `pm-pack` chạy **byte-identical** pre-v3. KHÔNG thêm domain mới ở phase này.

## As-built notes (cho M6)
- **Pack loading:** `src/packs/registry.py` `PackRegistry.load(domain)` importlib-load `domain-packs/<domain>-pack/{graphs,tools,write_handlers,models}.py` (dir gạch ngang → load theo file-path). M6 hr-pack theo đúng khuôn này. `pack_skills_dir`/`pack_prompts_dir`/`load_pack_prompt` là helper cho pack asset.
- **ToolProvider (S3):** report graph nhận `tools=pack.tools`; `default_report_deps(tools=...)`. Interface transport-agnostic (`tool_provider.py` Protocol `read`), PM provider expose granular reads (issues/sprint/prs/ci). M6 GSheet adapter cắm vào đây.
- **Allowlist (S4):** `classify(action, allowlist=...)` + `ActionGateway(mcp_allowlist=...)`. Pack đóng góp `ALLOWLIST` (write_handlers.py). **QUYẾT ĐỊNH SCOPE:** write-handler DISPATCH (`approved_dispatch.py`) GIỮ Ở LÕI — slack/linear/email là shared primitive M6 HR tái dùng; chỉ allowlist thành pack-driven. Pack khai báo `WRITE_HANDLER_KEYS` cho khuôn M6. Lớp A red-line markers GIỮ trong lõi, pack KHÔNG override được (test ở `test_pack_allowlist_redline.py`).
- **Prompts (S5):** 8 system-string PM → `pm-pack/prompts/*.md` (sinh từ live constant → byte-exact), builder `load_pack_prompt("pm", ...)` ở MODULE-IMPORT time. Builder LOGIC giữ ở `src/llm/`. M6 HR viết prompt riêng (không reuse builder PM).
- **Generic model (S6):** `Task`/`Event` ở `src/tools/models.py`. **QUYẾT ĐỊNH SCOPE:** PM analyzer (risk/resource) GIỮ consume `Issue` (byte-identical); pm-pack `models.py` `issue_to_task`/`task_to_issue` round-trip lossless = PROOF generic model đủ phủ PM. M6 HR map sheet-row → `Task`, viết headcount analyzer RIÊNG (không ép PM analyzer sang Task).

## Key Insights
- Core đã 60% generic — chỉ cần phá 3 seam, KHÔNG viết lại lõi.
- Web UI + Action Gateway core + profile loader + memory + skill system: **không đụng** (đã generic).
- Hardest: graph builders hardcode `jira_read`/`github_read` import → ToolProvider abstraction.
- Backward-compat là điều kiện sống còn: `default` profile không khai báo `domain:` → mặc định `pm`.

## Requirements
**Functional:**
- Khái niệm `domain` thêm vào profile (`domain: pm` mặc định khi vắng).
- Report-kind dispatch registry-driven, không if/elif string.
- Allowlist + write handler load theo pack, không hardcode dict.
- Prompts của PM chuyển thành asset của pm-pack (file, không Python literal cứng trong lõi).
- Generic data model `Task`/`Event` + pm-pack mapping từ Jira Issue → Task.

**Non-functional:**
- pm-pack output **byte-identical** so với pre-v3 (so sánh report text + Slack mrkdwn + XHTML).
- THE INVARIANT giữ: Action Gateway Lớp A/B + default-DENY allowlist không nới lỏng.
- Test xanh sau mỗi seam (không big-bang).

## Architecture
**Domain pack = thư mục in-repo** (✅ CHỐT 2026-06-30 — không plugin entry-point, YAGNI):

> ⚠️ **Thiết kế ToolProvider phải đủ generic cho tool LÕI CHƯA TỪNG BIẾT.** M6 sẽ test bằng **Google Sheet adapter** (PM chưa từng đọc Google Sheet). Nếu ToolProvider của M5 chỉ trừu tượng quanh "MCP stdio + gh CLI" (2 loại PM dùng) → sẽ KẸT ở M6 khi HR cần Google Sheets API (HTTP, khác hẳn). Thiết kế interface ToolProvider **không giả định cơ chế transport** — chỉ giả định "đọc → trả Task/Event".
```
domain-packs/
└── pm-pack/
    ├── pack.yaml              # manifest: id, report_kinds, servers, required bindings
    ├── graphs.py             # build_report_graph / okr / resource (di từ src/agent/*)
    ├── analyzers.py          # risk / okr / resource (di từ src/agent/*)
    ├── prompts/*.md          # system prompts (di từ src/llm/*_prompt.py)
    ├── tools.py              # jira_read/github_read/confluence_read adapters → ToolProvider
    ├── write_handlers.py     # slack/confluence handlers + allowlist contribution
    └── skills/*.md           # 5 bundled PM skills (di từ skills/)
```
Lõi giữ: registry, worker, profile loader, Action Gateway core, memory, server, web UI.

**3 abstraction seam:**
1. **PackRegistry** — `load_pack(domain) → Pack` object cung cấp: report_kinds map, graph builders, ToolProvider, prompts, allowlist, write handlers, skill pool.
2. **ToolProvider interface** — graph builder nhận `pack.tools` thay vì import cứng. PM ToolProvider wrap jira/github/confluence read.
3. **Config-driven allowlist** — `hard_block` load allowlist từ pack đang active (giữ default-DENY: tool không trong pack allowlist → deny).

## Related Code Files
**Modify (lõi):**
- `src/runtime/worker.py` — dispatch qua PackRegistry thay if/elif kind.
- `src/actions/hard_block.py` — `_MCP_ALLOWLIST` load từ pack (giữ default-DENY).
- `src/actions/approved_dispatch.py` — handler lookup từ pack registry, bỏ if/elif server.
- `src/config/reporting_config.py` + `config_builders_reporting.py` — bindings generic dict + `domain` field.
- `src/profile/loader.py` + `context.py` — parse `domain:`, default `pm`.

**Create:**
- `src/packs/__init__.py`, `src/packs/registry.py` (PackRegistry, Pack dataclass), `src/packs/tool_provider.py` (interface).
- `domain-packs/pm-pack/` (di chuyển PM code vào, xem cây trên).
- Generic models: thêm `Task`/`Event` vào `src/tools/models.py` (giữ Issue/PR cho pm-pack mapping).

**Delete:** không xóa — di chuyển (giữ git history qua move).

## Implementation Steps (slice nhỏ, test xanh sau mỗi slice)
1. **S1 — Pack scaffolding + `domain` field.** Tạo `src/packs/` (Pack, PackRegistry rỗng), thêm `domain:` vào profile loader (default `pm`). Chưa di chuyển code. Test: profile cũ load OK, domain=pm.
2. **S2 — Report-kind registry.** Chuyển worker.py if/elif → `pack.report_kinds[kind].builder`. pm-pack đăng ký daily/weekly/okr/resource. Test: 4 kind chạy y hệt (so output).
3. **S3 — ToolProvider.** Graph builders nhận `pack.tools` thay import cứng. PM ToolProvider wrap jira/github/confluence read. Test: report graph byte-identical.
4. **S4 — Config-driven allowlist + dispatch.** `hard_block` + `approved_dispatch` load từ pack. **Red line test bắt buộc:** Lớp A vẫn chặn destructive; default-DENY giữ (tool ngoài allowlist → deny). Test: full red-line suite xanh.
5. **S5 — Prompts + skills thành pack asset.** Di `*_prompt.py` → `pm-pack/prompts/*.md` + loader; `skills/` → `pm-pack/skills/`. Test: prompt content + skill selection y hệt.
6. **S6 — Generic data model.** Thêm `Task`/`Event`; pm-pack map Issue→Task; analyzers nhận Task. Test: risk/resource analyzer byte-identical trên Task.

## Todo List
- [x] S1 Pack scaffolding + `domain` field (default pm)
- [x] S2 Report-kind registry dispatch
- [x] S3 ToolProvider abstraction + PM provider
- [x] S4 Config-driven allowlist + dispatch (RED LINE test)
- [x] S5 Prompts + skills → pm-pack assets
- [x] S6 Generic Task/Event model + PM mapping
- [x] Full regression: 816 test xanh, ruff clean
- [x] E2E: `default` profile chạy daily/weekly/okr/resource byte-identical pre-v3

## Success Criteria
- pm-pack chạy cả 4 report kind, output **byte-identical** pre-v3 (diff = rỗng).
- Lõi không còn import `jira_read`/`github_read`/`*_prompt` trực tiếp (chỉ qua pack).
- THE INVARIANT verified: red-line suite xanh trên pm-pack; default-DENY giữ.
- Toàn bộ test cũ xanh (không sửa test để pass — sửa code).

## Risk Assessment
- **R1 ToolProvider đụng graph sâu** → refactor từng builder, test sau mỗi cái.
- **R2 Red line regression** khi allowlist config-driven → red-line test là gate bắt buộc của S4.
- **R3 Output drift** (prompt/format đổi nhẹ) → byte-identical diff là exit criteria.

## Security Considerations
- Allowlist config-driven KHÔNG được cho phép pack tự nới Lớp A (destructive markers vẫn ở lõi, không trong pack).
- Pack chỉ *đóng góp* allowlist (thêm tool được phép), KHÔNG ghi đè red line.
- Token vẫn env-only (`token_env` tên biến); pack.yaml không chứa secret.

## Next Steps
- M6 dùng abstraction này để thêm hr-pack — nếu HR cần sửa lõi → M5 chưa đủ generic, quay lại.
