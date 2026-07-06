# v9 P2 — nav-flow: tạo agent qua chat, chống dead-end

**Ngày:** 2026-07-07 · **Scope:** frontend-only (backend py 0 đổi)

## Mục tiêu

Chặn cú "bait-and-switch": nút thân thiện "+ Tạo nhân sự ảo" ở Đội dẫn thẳng vào wizard 5 bước kỹ thuật. Chuyển sang flow chat (M14 chat-ops), wizard giữ ở Nâng cao — NHƯNG không được dead-end CEO mới (chat-ops cần admin-agent + telegram ops_operator_id).

## Đã làm

- **Team "+ Tạo nhân sự ảo"** (`Team.tsx`): `<Link>` → `<button>` gọi `opsChatAvailable()` rồi điều hướng: available → `/chat?intent=create-agent`, **KHÔNG available HOẶC check lỗi → `/create` (wizard)**. `creating` guard chống double-click. Bao trọn red-team B3: nút KHÔNG BAO GIỜ dead-end — CEO mới luôn tạo được agent đầu tiên.
- **Chat prefill** (`Chat.tsx`): đọc `?intent=create-agent` qua **lazy `useState` initializer** (đọc param 1 LẦN lúc mount, không clobber CEO gõ sau — vá đề xuất reviewer thay vì effect với `[searchParams]`). Màn "Chưa dùng được" thêm link "tạo nhân sự ảo bằng biểu mẫu → /create" (không còn thông báo chết).
- **Unsaved-warning tab Kiến thức** (`AgentKnowledgeTab.tsx`): 4 section độc lập (SOUL/PROJECT/kỹ năng/tài liệu) — mỗi cái track `dirty` riêng, hiện "● Chưa lưu" khi sửa, clear khi load/save thành công. Save lỗi → GIỮ dirty (đúng: việc chưa lưu vẫn được đánh dấu). Raw-mode textarea cũng mark dirty.

## Kết quả

- **86 vitest xanh** (thêm: Team 3 nhánh nút, Chat prefill + fallback link, AgentKnowledgeTab.test.tsx mới) + tsc + build sạch. Backend py 0 đổi.
- Code-review: **Status DONE** — B3 invariant giữ (3 nhánh test-covered không assumed), dirty-tracking đúng cả case save-lỗi, 0 regression. Vá thêm 1 latent trap (prefill clobber nếu tương lai thêm searchParams mutation) bằng lazy-init.

## Bài học

- **Nút thân thiện phải luôn có đường ra**: chuyển flow "đúng đắn hơn" (chat) mà không giữ fallback = dead-end cho persona chưa đủ điều kiện. Test CẢ nhánh unavailable + nhánh throw, không chỉ happy path.
- **Đọc query-param: lazy init > effect** khi chỉ cần lúc mount — effect với `[searchParams]` là trap clobber im lặng khi param ref đổi.
- **Save lỗi giữ dirty bằng OMISSION** (catch không clear) là instinct đúng — không cần code thêm.
