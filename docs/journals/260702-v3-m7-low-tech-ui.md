# v3 M7 — UI low-tech (create + onboard + lifecycle)
2026-07-02 · ✅ Done

Người không rành kỹ thuật giờ TẠO + QUẢN LÝ VÒNG ĐỜI agent hoàn toàn qua web: wizard 5 bước (domain → identity → reports/schedule → bindings → review), pause/resume/delete từng agent, panel sức khỏe kết nối. Không chạm terminal/YAML/.env. Trước khi cook, plan v3/v4 được đánh giá lại theo mục tiêu "đội agent thay human hành chính" → M7 mở rộng (+lifecycle +health) và thêm milestone mới M11 ask-agent (xem plan).

## Định vị chốt (2026-07-02)
**2 vai**: *setup hạ tầng* (uv/MCP build/.env token) = việc kỹ thuật 1 lần; *vận hành hằng ngày* = low-tech 100% qua web. M7 phục vụ vai 2; installer trọn gói defer (YAGNI local-first). Health panel là cầu nối: low-tech thấy "cái gì đứt" + hint để gọi người kỹ thuật.

## Làm gì
- **Backend** (4 module mới, ~450 LOC): `runtime/registry_edit.py` (mutations registry.yaml DÙNG CHUNG CLI+API — scaffold/append/toggle/remove, validate-before-replace + lock); `server/agent_create.py` (list packs từ pack.yaml — không import module, pack hỏng không 500 picker; create build profile.yaml từ default template rồi validate bằng CHÍNH các config builder của `load_profile` TRƯỚC khi ghi); `server/integration_health.py` (env presence [không lộ giá trị], MCP dist exists, `gh auth status`, `which gws`; cache 30s); `server/routes_agents_admin.py` (GET /api/packs · POST /api/agents/create [400/409, rollback] · PATCH enabled [trả `effective_enabled` = registry∧profile] · DELETE [giữ profile dir làm archive; 'default' không xóa] · GET /api/health/integrations).
- **Frontend** (wizard tách module `web/src/wizard/`): CreateAgent 5 bước; ScheduleBuilder (chọn thứ+giờ → cron 5-field, HIỆN cron string cho minh bạch); persona helper = template deterministic client-side (không LLM — as-built, rẻ + offline); Review có ô "Token setup" render .env template (chỉ TÊN biến — copy đưa người kỹ thuật, web không bao giờ cầm secret); Team view (bảng mọi agent: status/budget/pending + Pause/Resume/Delete + health panel).
- **CLI DRY**: `mpm agent register` giờ import scaffold/append từ `registry_edit` — UI và CLI tạo agent CÙNG một đường.

## Lằn ranh đỏ — không đổi
Các route admin chỉ mutate CONFIG cục bộ (profiles/ + registry.yaml), không gọi hệ ngoài → không qua Action Gateway (gateway guard mutation ra ngoài; ranh giới này ghi rõ trong docstring router). Mọi write config = validate-before-replace + atomic: request hỏng KHÔNG BAO GIỜ để lại registry/profile corrupt. Web không nhận/lưu/trả secret ở bất kỳ endpoint nào (health trả bool presence; test khẳng định token value vắng trong response). Localhost-only no-auth giữ nguyên posture M2.

## Review (DONE_WITH_CONCERNS → vá hết trong milestone)
- **H1** `append_registry` (kế thừa CLI cũ) append thẳng vào file rồi mới parse → registry indent lạ có thể bị corrupt VĨNH VIỄN → vá: build in-memory + `_replace_validated` (test: file 0-indent → raise, file byte-unchanged).
- **M1** wizard đổi pack giữ stale reports → 400 không lối thoát → vá: `selectPack` reset reports/schedule/bindings.
- **M2** Pause/Resume toggle registry nhưng UI hiển thị registry∧profile → resume "thành công giả" khi profile còn disable → vá: PATCH trả `effective_enabled`, Team re-fetch + notice "Profile still disabled — enable it in Config".
- **M3** race 2 write đồng thời (threadpool) → vá: `threading.Lock` quanh mọi mutation + FileExistsError→409.
- L1/L2/L3/L5 vá luôn (pack.yaml non-dict guard, ID regex FE=BE, personaEdited sống qua remount, health test stub `gh`).

## Verified
pytest **863** + vitest **30** + tsc + build xanh; ruff clean. E2E live qua app thật: POST create `m7-e2e-tmp` (hr, schedule, binding) → hiện trong GET /api/agents → PATCH pause → DELETE → registry.yaml **byte-identical** sau round-trip. SPA dist rebuild + serve OK.

## Bài học
- Refactor "extraction thuần" vẫn đáng review: tách `_append_registry` ra module chung đã NÂNG CẤP nó thành contract có docstring — reviewer bắt đúng chỗ docstring hứa mà code không giữ (H1).
- 2 cờ enabled (registry + profile) là thiết kế đúng cho service gate nhưng là bẫy UX — UI phải hiển thị trạng thái EFFECTIVE, không phải cờ vừa bấm.
- Wizard state machine: mọi lựa chọn phụ thuộc (reports theo pack) phải reset khi gốc đổi — bug loại này không có đường recover cho low-tech user.
