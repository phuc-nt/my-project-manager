# CONTEXT HANDOFF — v3/v4 (đọc TRƯỚC khi cook)

> File này lấp khoảng trống mà các phase file không tự nói được: **bối cảnh quyết định** + **con trỏ tài liệu**.
> Viết bởi planner session 2026-06-30. Người viết plan ≠ người cook. Đọc file này → đọc plan → cook.

## TL;DR thứ tự đọc
1. File này (bối cảnh + quyết định gốc).
2. `plan.md` (v3 overview) + 4 phase file M5-M8.
3. 2 research report ở `../reports/` (trạng thái codebase — input nền của plan).
4. Khi tới v4: `../260630-2125-v4-resilient-llm-local-first/` + `reference-aicoworker/`.
5. `docs/v1/` + `docs/v2/` (vision + lịch sử milestone đã xong).

## Quyết định GỐC (vì sao v3 tồn tại) — KHÔNG được đảo ngược nếu không hỏi chủ dự án

**Bối cảnh:** Chủ dự án từng cân nhắc **bỏ lõi LangGraph, viết lại trên OpenClaw + Pi.dev (TS)** — kiểu AICoworker (xem reference-aicoworker/). Sau phân tích, **CHỐT KHÔNG đổi lõi**, lý do:

1. **LangGraph CHÍNH LÀ inner harness tốt rồi** — loop/tool/checkpointer/multi-provider/memory. Đổi sang OpenClaw = thay 1 inner harness đang chạy bằng cái khác, KHÔNG thêm năng lực, chỉ đổi Python→TS.
2. **Tài sản độc nhất = Action Gateway 2-lớp** (Lớp A hard-deny / Lớp B approve) + audit bất biến + budget cap + dedup. OpenClaw/AICoworker là agent cá nhân, KHÔNG có lớp guardrail enterprise này. Port = viết lại phần khó+giá trị nhất trong môi trường lạ.
3. **OpenClaw không sở hữu được tại chỗ** — là npm package vendored (AICoworker phải pin `pi-ai@0.70.2` cứng). Đổi = cưới dependency bên thứ ba cho lõi.

**→ Hướng v3:** domain (PM/HR/Admin) = **outer harness** (pack cắm vào lõi), KHÔNG phải inner. Lõi LangGraph + Action Gateway GIỮ NGUYÊN.

> ⚠️ Nếu trong lúc cook bạn nghĩ "sao không dùng OpenClaw/viết lại lõi cho gọn?" — câu trả lời đã có ở trên. Hỏi chủ dự án trước khi đi ngược.

## THE INVARIANT (bất khả xâm phạm — xuyên mọi milestone)

Mọi write qua **Action Gateway**: Lớp A hard-deny (red line: mất-data/credential/security) + allowlist **default-DENY** + Lớp B approve. `classify()`/`needs_interrupt()` ngữ nghĩa GIỮ NGUYÊN. Khi abstraction hóa allowlist (M5 seam 2), **KHÔNG được nới lỏng** red line. Pack chỉ *đóng góp* tool được phép, KHÔNG ghi đè Lớp A.

## Gate quan trọng — KHÔNG phải nice-to-have

**M6 gate: `git diff src/` = rỗng khi thêm hr-pack.** Đây là *cơ chế tự-kiểm-chứng* abstraction. Nếu thêm HR mà phải sửa lõi → M5 thiếu seam → QUAY LẠI vá M5. **KHÔNG "lách" bằng cách nhét HR-logic vào src/** — làm vậy là phá chính mục tiêu v3.

## Quyết định BLOCKING — ✅ ĐÃ CHỐT (chủ dự án, 2026-06-30)

| # | Câu hỏi | CHỐT |
|---|---|---|
| 1 | M5 — pack location | **Thư mục in-repo** `domain-packs/<pack>/` (không plugin entry-point — YAGNI) |
| 2 | M6 — HR đọc nguồn nào | **Confluence + Google Sheet**. Confluence có `confluence_read` sẵn; **Google Sheet cần tool adapter MỚI trong hr-pack** (đúng tinh thần "pack tự mang tool" — đây là bài test thật cho ToolProvider) |
| 3 | M6 — HR report kind đầu | **Headcount** (đếm/nhóm nhân sự theo trạng thái/phòng ban — đơn giản nhất) |
| 4 | M6 — HR ghi đi đâu | **Slack (HR channel)** — tái dùng `slack_write`, channel khác. Không email/Confluence-write ở v3 |
| 5 | M10 — local backend | **Ollama (HTTP local, localhost:11434)** — OpenAI-compatible, không build native |
| 6 | M10 — local model | **Gemma 4** (qua Ollama) |

→ Không còn câu BLOCKING nào. Agent cook thẳng, không cần dừng hỏi (trừ khi phát sinh mới).

## Phạm vi ĐÃ defer (chủ dự án chốt CHƯA cần — đừng tự thêm vào v3/v4)
- OAuth subscription auth, multi-user/RBAC, production deploy → **chưa cần** (giữ local-first single-operator).
- Secret store (SOPS/Vault) cho token-via-UI → defer; M7 chỉ làm "hiển thị .env template để copy", KHÔNG để web ghi secret.
- AICoworker patterns khác (CDP browser, doc conversion, desktop Electron) → KHÔNG nằm trong v3/v4.

## Con trỏ tài liệu (tất cả self-contained trong repo này)
- Research domain-coupling: `../reports/researcher-260630-2115-domain-coupling-generic-vs-pm-hardcoded-report.md`
- Research runtime/UI: `../reports/researcher-260630-2115-runtime-multiagent-ui-state-report.md`
- AICoworker RE (tham khảo cho v4 "mượn pattern"): `../260630-2125-v4-resilient-llm-local-first/reference-aicoworker/`
- Vision sản phẩm: `docs/v1/project-overview-pdr.md` (đặc biệt §7 guardrail, §7.9 Lớp A/B)
- Lịch sử milestone đã xong: `docs/v2/` (M1-M4 multi-agent + web SPA + Postgres + skills + automation)

## Nguyên tắc cook (giữ từ v1/v2)
- Mỗi milestone/slice **chạy được + giá trị thật** trước cái sau (không big-bang).
- Backward-compat: feature mới không khai báo → byte-identical hành vi cũ. `default` profile = lưới an toàn.
- Số liệu render **deterministic** (KHÔNG để LLM bịa số); LLM chỉ viết prose. Bài học Phase 1.
- Test xanh trước khi sang slice sau; KHÔNG sửa test để pass — sửa code.
- Mượn PATTERN AICoworker, KHÔNG port code (TS≠Python).
