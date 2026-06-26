# v2 M3-P9 — A3 cross-agent (sibling) memory share

**Ngày:** 2026-06-26 · **Trạng thái:** ✅ Done · **Commits:** S1 `10a60f1` · S2 `ba046af` · S3 `1512e5a`

## Mục tiêu

Hai agent cùng `project:` đọc fact đã nhớ của nhau (chính fact node `remember` A2 ghi). Đọc-chéo READ-only sibling, WRITE-only self, inject vào prompt INTERNAL — không bao giờ external, không qua Action Gateway (cùng lằn ranh đỏ P5 với persona/project/memory/skills).

## Đã làm (3 slice)

- **S1** — Field `project:` → `LoadedProfile.project_group` (không khai ⇒ None ⇒ không sibling). `sibling_memory.py`: `enumerate_siblings` (lọc cùng group, trừ self, sibling load lỗi → warn+skip) + `read_sibling_facts` (đọc Store namespace `(sibling_id, "memory")` qua `store.search` namespace-scoped, cap 40) + `build_sibling_context` (no-op `((), None)` không dựng LlmClient). Mirror `skill_pool.build_skill_context`.
- **S2** — `SiblingFactSelector` inject được (LLM rank fact theo kind, lỗi→`[]`, lọc về input set chống bịa). `ProfileContext` +3 field. Chèn `sibling_facts=` vào nhánh INTERNAL của 4 builder (rename `_skill_block`→`_text_block` generic). WO-self: `_assert_self_namespace` raise nếu ghi namespace khác.
- **S3** — `build_sibling_context` ghép selector thật trên nhánh non-empty. Wire qua worker/cron/cli — mỗi entry point thread MỘT store instance để sibling READ + remember WRITE dùng chung. Server (M2-P6) thừa hưởng qua worker. 9 e2e offline.

## Lằn ranh đỏ (giữ vững)

Sibling facts INTERNAL-only. Phòng thủ 2 lớp: `select_sibling_text` trả `""` cho external + mỗi builder fold sibling text SAU external early-return. E2E external assert vắng CẢ marker LẪN label `project: <slug>`. Review S3 xác nhận store-sharing invariant + red line qua real deps.

## Kết quả

628 test xanh (593 baseline + 35 mới), ruff sạch. Code-reviewer DONE mỗi slice — S1 bắt 1 HIGH (sibling YAML hỏng làm crash reader → vá bằng catch rộng + test); S2/S3 không CRITICAL/HIGH/MEDIUM. No-project byte-identical + allocation-free.

## Threat-model widening (R6)

A3 MỞ RỘNG phạm vi lộ — B đọc fact thô của A; memory không secret-scan (accepted residual risk từ P8). Mitigation = ranh giới internal-only (không tạo bề mặt external mới). Ghi rõ trong architecture §6.2.

## Còn lại / mở

- **Hiệu lực runtime cần Postgres**: `store: memory` (default) mỗi process 1 store → B không thấy fact A khi chạy multi-process thật; A3 degrade sạch về "no siblings". Đọc-chéo thật chỉ khi `store: postgres` (shared). E2E chứng minh logic bằng InMemoryStore chung 1 process.
- **Live-key E2E chưa chạy** — toàn bộ proof offline (fake selector + recording LLM). `_assert_self_namespace` hiện là scaffolding (call site duy nhất luôn self) — fail-loud cho invariant, sẽ load-bearing nếu sau này có path namespace từ caller.
