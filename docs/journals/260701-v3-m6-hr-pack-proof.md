# v3 M6 — hr-pack (ép abstraction)
2026-07-01 · ✅ Done

Pack thứ 2 (HR) chạy THẬT trên cùng lõi — bài kiểm tra abstraction M5. Domain mới = folder mới `domain-packs/hr-pack/`. HR đọc Google Sheet (transport lõi CHƯA TỪNG biết) → headcount → Confluence + Slack, tất cả qua guardrail cũ.

## Làm gì
- **hr-pack** (`domain-packs/hr-pack/`, `git diff src/`=RỖNG): manifest + `headcount` kind · ToolProvider (Confluence reuse + **gws CLI** Sheet adapter MỚI) · headcount analyzer (nhóm theo status/phòng ban, số deterministic) · prompt asset (internal + external) · Slack+Confluence allowlist · skill.
- **gws CLI thay gspread**: `gws sheets spreadsheets values get` spawn như `gh` (CLI-based, auth CLI tự quản, KHÔNG token trong .env/pack, chạy cron được). Tốt hơn plan gốc (gspread+service-account).
- **HR config env-only**: `HR_SHEET_ID`/`HR_SHEET_RANGE`/`HR_CONFLUENCE_PAGE_ID` — pack tự đọc env, không thêm field vào core config.

## GATE — đạt có điều kiện (bài học M5→M6)
hr-pack commit `git diff src/`=**rỗng tuyệt đối**. NHƯNG thêm HR lộ **3 M5 seam thiếu**, vá bằng 3 commit generic RIÊNG (0 HR logic — đúng plan R1):
1. `discover_domains()` — pack discovery từ filesystem (bỏ hardcode `_KNOWN_DOMAINS`).
2. `_ensure_pack_package()` — load pack thành importable package `domain_pack_<x>` (module trong pack import lẫn nhau; PM không cần vì chỉ gọi src.*, HR cần vì có analyzer/render/prompt riêng).
3. `all_report_kinds()` — kind validation (CLI+API) theo union mọi pack thay hardcode PM (nếu không `headcount` bị reject trước khi worker load).

→ "git diff src/=rỗng" **literal** không đạt với pack self-contained đầu tiên; nhưng **intent** (0 domain logic in core) ĐẠT. Pack thứ 3 (admin M8) sẽ rỗng thật (hạ tầng đã đủ).

## Lằn ranh đỏ (The Invariant) — VERIFIED
HR write qua Action Gateway y hệt PM: allowlist đóng góp (slack+confluence) NHƯNG Lớp A red-line GIỮ lõi, pack KHÔNG override (test: HR thử allowlist `delete_message`→DATA_LOSS; default-DENY jira→NOT_ALLOWLISTED). HR external red-line = PM resource: strip Confluence link khi external + prompt external KHÔNG inject project/memory + stakeholder channel. **PII-safe by design**: headcount output = số tổng theo nhóm, tên nhân viên chỉ ở input mapping (tools.py), KHÔNG bao giờ render.

## E2E LIVE
gws đọc Google Sheet thật (10 người, 4 phòng ban) → headcount analyzer → LLM narrate ($0.0006) → **Confluence page 3211265** (executed) → Lớp B queue → approve → **Slack post ts=1782916805**. Số deterministic đúng: Tổng 10, Active 7, Engineering 4.

## Review (DONE_WITH_CONCERNS → 4 finding đã vá, commit `285d5fa`)
- **H1** HR external ignore audience (không strip link như PM) → vá: strip link + prompt external + stakeholder channel + short coarser.
- **H2** `all_report_kinds()` không cô lập pack hỏng (1 pack lỗi chặn validation mọi agent) → vá: try/except + warn.
- **M1/M2/M3** HR read silent zero-headcount khi misconfig → vá: fail-loud (vắng nguồn / gws thiếu `values` key / gws binary vắng).
- gws subprocess: injection-SAFE (argv list, no shell), keyring banner skip đúng.

## Số liệu
839 test xanh (was 816 M5; +23), ruff clean, pm-pack byte-identical. 7 commit: 3 seam-patch generic + hr-pack + review-fix.

## Next
M7 UI low-tech (wizard tạo agent, giờ có ≥2 domain pm/hr để chọn) HOẶC M8 admin-pack (pack thứ 3, gate `git diff src/`=rỗng thật) HOẶC v4 M9 (multi-provider fallback).
