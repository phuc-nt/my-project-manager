# Phase M6 — hr-pack (ép abstraction)

> [← plan.md](plan.md) · trước: [phase-m5](phase-m5-domain-pack-abstraction.md) · sau: [phase-m7](phase-m7-low-tech-ui.md)

## Context Links
- Phụ thuộc M5 (PackRegistry, ToolProvider, config-driven allowlist).
- pm-pack làm reference structure: `domain-packs/pm-pack/`.

## Overview
- **Priority:** P0 — đây là *bài kiểm tra* abstraction M5, không phải feature phụ.
- **Status:** ✅ DONE (2026-07-01). hr-pack `git diff src/`=rỗng, E2E live, 839 test xanh, review DONE_WITH_CONCERNS→4 finding đã vá.
- **Mục tiêu:** Xây `hr-pack` chạy thật trên cùng lõi, **KHÔNG sửa lõi**. Nếu phải sửa lõi → M5 chưa đủ generic, quay lại M5.

## As-built notes (kết quả M6)
**GATE ĐẠT có điều kiện:** hr-pack commit (`2f268fc`) `git diff src/`=**rỗng tuyệt đối**. NHƯNG thêm HR lộ **3 M5 seam thiếu** — vá bằng 3 commit generic RIÊNG (0 HR logic), đúng tinh thần plan R1:
1. `discover_domains()` — pack discovery từ filesystem (bỏ hardcode `_KNOWN_DOMAINS`). Commit `0eea7c0`.
2. `_ensure_pack_package()` — load pack thành importable package `domain_pack_<x>` để module trong pack import lẫn nhau (PM không cần vì chỉ gọi src.*; HR cần vì có analyzer/render/prompts riêng). Commit `2174eb7`.
3. `all_report_kinds()` — kind validation (CLI+API) theo union mọi pack thay hardcode PM set (nếu không, `headcount` bị reject trước khi worker load). Commit `25db918`.

→ **Bài học M5→M6:** "git diff src/=rỗng" literal KHÔNG đạt được với pack self-contained đầu tiên; nhưng *intent* (0 domain logic in core) ĐẠT. 3 seam trên là hạ tầng pack generic, không phải HR-specific. Pack thứ 3+ (admin M8) sẽ `git diff src/`=rỗng thật (hạ tầng đã đủ).

**gws CLI thay gspread:** HR đọc Google Sheet qua `gws` CLI (`gws sheets spreadsheets values get`) spawn như `gh` — nhất quán triết lý CLI-based, auth CLI tự quản (không token trong .env/pack), chạy được cả cron. Tốt hơn gspread+service-account của plan gốc.

**HR config env-only:** `HR_SHEET_ID`/`HR_SHEET_RANGE`/`HR_CONFLUENCE_PAGE_ID` — pack tự đọc env (không thêm field vào core config). Fail-loud nếu vắng nguồn.

**Review fix (`285d5fa`):** HR external red-line (strip Confluence link + prompt external riêng + stakeholder channel, giống PM resource) · pack-load isolation (pack hỏng ≠ chặn validation mọi agent) · fail-loud reads (không publish "0 nhân sự" giả).

## Key Insights
- Giá trị thật của M6 không phải "có HR agent" mà là **chứng minh thêm domain = thêm pack, lõi bất động**.
- Tiêu chí pass cứng: **0 dòng thay đổi trong `src/` (lõi)** khi thêm hr-pack — chỉ thêm `domain-packs/hr-pack/` + `.env` + profile.
- HR scope nên TỐI THIỂU (1-2 report kind) — đủ để ép abstraction, không lan man (YAGNI).

## Scope ĐÃ CHỐT (2026-06-30)
1. **HR đọc:** **Confluence** (tái dùng `confluence_read` sẵn) + **Google Sheet** (**adapter MỚI trong hr-pack** — đây là bài test thật của ToolProvider: pack tự mang tool mà lõi không biết Google Sheet là gì).
2. **HR report kind đầu:** **Headcount** (đếm/nhóm nhân sự theo trạng thái/phòng ban).
3. **HR ghi:** **Slack HR channel** (tái dùng `slack_write`, channel khác; KHÔNG email/Confluence-write ở v3).

> Google Sheet adapter là điểm đáng chú ý: PM pack chưa từng đọc Google Sheet → nếu hr-pack thêm được tool này mà KHÔNG sửa lõi (`git diff src/` rỗng) → ToolProvider abstraction (M5) đã đúng. Nếu phải sửa lõi để hỗ trợ Google Sheet → M5 thiếu seam, quay lại.

**Functional:**
- hr-pack manifest + `headcount` kind chạy E2E thật (đọc Confluence + Google Sheet → Slack).
- Google Sheet read adapter trong `hr-pack/tools.py` (gspread / Google Sheets API; token env-only).
- Reuse 100% lõi: Action Gateway, audit, budget, dedup, memory, web UI, approval flow.
- HR write (Slack) qua Action Gateway: red line + Lớp A/B áp y hệt PM (không ngoại lệ).

**Non-functional:**
- **0 thay đổi `src/`** (gate cứng — nếu vi phạm, là tín hiệu M5 thiếu seam).
- pm-pack vẫn byte-identical (regression check).

## Architecture
```
domain-packs/hr-pack/
├── pack.yaml              # id: hr, report_kinds: [headcount], servers: [slack], bindings: confluence+gsheet
├── graphs.py             # build_headcount_graph(...) dùng PackRegistry pattern
├── analyzers.py          # headcount pure function (đếm/nhóm theo trạng thái/phòng ban)
├── prompts/*.md          # HR persona + headcount report system prompt
├── tools.py              # HR ToolProvider: confluence_read (reuse) + GOOGLE SHEET adapter (MỚI)
├── write_handlers.py     # Slack HR write + allowlist (reuse slack handler, channel khác)
└── skills/*.md           # HR skills (vd: flag-understaffed-team)
```
Generic `Task`/`Event` (từ M5) dùng lại: HR map entity (headcount row: người/vai trò/phòng ban/trạng thái) → Task.
**Google Sheet adapter:** dùng `gspread` hoặc Google Sheets API; service-account JSON path / token env-only (KHÔNG trong pack.yaml). Map sheet rows → generic Task/Event.

## Related Code Files
**Create (chỉ trong domain-packs/, KHÔNG src/):**
- `domain-packs/hr-pack/` (toàn bộ cây trên).
- `profiles/hr-demo/{profile.yaml,SOUL.md,PROJECT.md,MEMORY.md}` (`domain: hr`).
- `registry.yaml` — thêm `{id: hr-demo, enabled: true}`.
- `.env` — token cho HR tool (env-only).

**Modify:** **không có file `src/` nào** (đây là tiêu chí pass). Nếu buộc phải sửa src → ghi rõ file nào, vì sao, rồi rút bài học về M5.

## Implementation Steps
*(S0 scope đã chốt — xem trên. Bắt đầu thẳng S1.)*
1. **S1 — hr-pack manifest + `headcount` kind.** Dùng pm-pack làm khuôn.
2. **S2 — HR ToolProvider:** reuse `confluence_read` + viết **Google Sheet adapter mới** (gspread/Sheets API) → map rows sang `Task`/`Event`. **Đây là test ToolProvider quan trọng nhất.**
3. **S3 — Headcount analyzer + prompts** (pure function đếm/nhóm + prompt file HR persona).
4. **S4 — Slack HR write handler + allowlist** qua Action Gateway. **Red line test trên hr-pack** (Lớp A chặn destructive; default-DENY giữ).
5. **S5 — E2E thật:** `mpm agent register hr-demo` → trigger headcount → đọc Confluence+Google Sheet thật → report → post Slack HR channel (dry-run trước, rồi live).
6. **S6 — Regression gate:** pm-pack byte-identical; **`git diff src/` = rỗng** (kể cả sau khi thêm Google Sheet adapter — nếu adapter buộc sửa lõi, M5 thiếu seam).

## Todo List
- [x] S0 Scope HR đã chốt (Confluence+GSheet / headcount / Slack)
- [x] S1 hr-pack manifest + headcount kind
- [x] S2 HR ToolProvider: confluence_read reuse + **gws CLI** Sheet adapter MỚI + Task mapping
- [x] S3 Headcount analyzer + prompt assets (internal + external)
- [x] S4 Slack+Confluence HR write + allowlist + RED LINE test
- [x] S5 E2E thật: gws Sheet (10 người) → headcount → Confluence 3211265 + Slack ts=1782916805
- [x] S6 `git diff src/` = rỗng cho hr-pack (GATE ĐẠT) + pm-pack byte-identical

## Success Criteria
- hr-pack chạy ≥1 report kind E2E thật trên hệ thống HR thật.
- **`git diff src/` rỗng** sau khi thêm hr-pack (abstraction đủ — gate cứng).
- HR write qua Action Gateway: red line verified, audit ghi, budget tính per-agent.
- Web UI hiện hr-demo agent cùng PM agent (không sửa UI — reuse generic).
- pm-pack regression: byte-identical.

## Risk Assessment
- **R1 Phải sửa lõi để HR chạy** → đây CHÍNH LÀ tín hiệu giá trị: dừng, ghi seam còn thiếu, vá M5. Đừng "lách" bằng cách nhét HR-logic vào src/.
- **R2 HR system không có MCP/CLI sẵn** → có thể cần viết tool adapter mới (chấp nhận, nằm trong hr-pack, không phải lõi).
- **R3 Scope creep HR** → giới hạn 1-2 report kind ở v3.

## Security Considerations
- HR data nhạy cảm (lương, nghỉ phép, đánh giá) → PII firewall + audit redaction áp y hệt; external audience của HR phải bỏ PII (lằn ranh đỏ giống PM resource report).
- HR write (vd đổi trạng thái nhân sự) → cân nhắc Lớp B mặc định cho hành động nhạy cảm HR.

## Next Steps
- M7 wizard giờ có ≥2 domain (pm/hr) để người dùng chọn khi tạo agent.
