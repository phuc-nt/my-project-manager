# v7 M18b — Knowledge form (SOUL/PROJECT ↔ markdown) + skills picker

2026-07-04 · ✅ Done

CEO nuôi "kiến thức" agent không cần biết markdown: SOUL/PROJECT thành FORM vài ô, skills tick chọn. Backend giữ nguyên file .md/profile.yaml — UI chỉ là mặt tiền form ↔ file.

## Làm gì
- **knowledge_template.py** (mới): `render(doc, fields)` → markdown bọc marker `<!-- field:KEY -->…<!-- /field:KEY -->`; `parse(doc, text)` → `ParsedKnowledge{raw_mode, fields, raw}`. File mất/thiếu marker (sửa tay) → `raw_mode=True` → UI hiện editor raw, KHÔNG bao giờ ghi đè prose viết tay bằng form. File rỗng → form rỗng (agent mới), không phải raw.
- **routes** (`routes_agent_knowledge.py`): `GET/PUT /api/agents/{id}/knowledge/{doc}` (doc ∈ soul/project) + `GET/PUT /api/agents/{id}/skills`. PUT knowledge: có `raw` → lưu verbatim; có `fields` → render. put_skills: chỉ nhận tên trong catalog domain (`load_skills(domain=…)`), tên lạ → 400 không ghi; ghi `skills:` list vào profile.yaml qua `save_profile_yaml` (validate-then-atomic, giữ nguyên `domain:`/`telegram:`/key khác).
- **UI** (`AgentKnowledgeTab.tsx`): tab Kiến thức — form SOUL + form PROJECT (mỗi ô 1 trường, raw fallback) + skills picker (checkbox). Nhãn trường MIRROR `_FIELDS` bên Python.

## Review 1 CRITICAL + hardening → vá server-side
- **C1 (CRITICAL) marker-injection phá round-trip**: value chứa `<!-- /field:role -->` (hoặc bất kỳ marker) → regex non-greedy khớp close-tag chèn → **mất phần sau, raw_mode vẫn False → hỏng IM LẶNG**. CEO paste tài liệu có nhắc cú pháp marker là dính. Vá: `render` raise `MarkerInValueError` khi value khớp `<!--\s*/?\s*field:` (IGNORECASE), + **self-check render→parse** raise nếu không round-trip lossless. Comment HTML thường + dòng `##` trong value vẫn OK.
- **H1 ghi đè file raw_mode qua PUT form**: UI chọn form/raw theo raw_mode, nhưng endpoint không tự kiểm → tab cũ / caller trực tiếp gửi fields cho file đang raw → render đè prose. Vá: PUT form re-parse file HIỆN TẠI, raw_mode → **409** (kiểm "form biểu diễn được không" nằm server-side, không chỉ UI).
- **H2 PUT rỗng blank file**: `fields` default None; None+None → 400. Reviewer bắt tiếp edge `{"fields": {}}` (dict rỗng ≠ None) render form trắng đè file. Vá: đòi ≥1 key nhận diện (`FIELD_KEYS[doc]`) — form xóa-thật vẫn gửi đủ key với "" nên phân biệt được với client hỏng.
- **M1 agent lạ**: knowledge route id regex-hợp-lệ nhưng không tồn tại → `save_markdown` tạo file mới (materialize profile rác). Vá: `_require_agent` kiểm `profiles/<id>/profile.yaml` → 404 (khớp skills route).

## Modularize
`routes_agent_knowledge.py` gộp M18a telegram + M18b knowledge = 261 LOC. Tách: `routes_agent_studio_shared.py` (router chung prefix `/api/agents` + `_AGENT_ID_RE`), `routes_agent_telegram.py` (M18a), `routes_agent_knowledge.py` (M18b) — mỗi file <150 LOC, 2 module gắn endpoint vào 1 router chung, app.py import cả hai (chạy decorator) rồi mount 1 lần. `AgentPage.tsx` 384 LOC → tách tab Kiến thức ra `AgentKnowledgeTab.tsx` (185 LOC).

## Verified
1100 pytest (+20: template roundtrip/raw-mode/partial-marker/marker-inject-reject/comment-allow, routes form-roundtrip/raw-verbatim/409-over-raw/400-empty/400-empty-dict/404-ghost/skills-valid+unknown) + 47 vitest (+3 AgentPage: form save, raw fallback, skills toggle) + ruff + tsc + build. **E2E LIVE agent `hr` thật** (non-destructive, restore sau): SOUL viết tay → raw_mode đúng; PUT form → round-trip; PUT raw → verbatim; catalog hr-pack (`flag-understaffed-team`); skill hợp lệ ghi profile.yaml, tên lạ 400; guard form-over-raw→409, marker-inject→400, empty→400, ghost→404.

## Bài học
- **Round-trip form↔text: value có thể chứa chính cú pháp delimiter** — không escape thì phải cấm + self-check fail-loud. "Hỏng im lặng" (raw_mode=False mà mất data) nguy hơn crash. Reviewer tái tạo bằng value thật, không phải giả định.
- **Invariant "file này form biểu diễn được không" phải ở server, không chỉ UI**: UI đọc raw_mode rồi chọn path là TOCTOU — tab cũ / API trực tiếp lách được. Guard 409 server-side đóng cửa đó.
- **Phân biệt "thiếu tham số" vs "tham số rỗng cố ý"**: None (không gửi) vs `{}` (gửi rỗng) vs đủ-key-giá-trị-rỗng (xóa thật) — ba nghĩa khác nhau, guard phải tách để không vừa chặn nhầm xóa-thật vừa cho lọt blank-đè.

## Unresolved / next
1. M19: Company Knowledge Base — kho tài liệu chung, agent opt-in inject qua cơ chế skills (internal-only, mutation-test external=0).
