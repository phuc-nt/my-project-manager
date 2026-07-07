# v10 M24 — Theme light/dark + diện mạo (2026-07-07)

Frontend-only. Không đụng backend (1205 test nguyên).

## Đã làm

- **Token 2 lớp, tách vai trò**: `web/src/App.css` `:root` (light) + `[data-theme="dark"]`. Status color (danger/ok/warn) tách 3 vai — `--color-<s>` (text/border), `--color-<s>-solid` (nền đặc dưới chữ trắng), `--color-<s>-bg` (nền nhạt) + `--color-on-<s>`. Lý do (red-team F2): `--color-danger` cũ dùng CẢ cho text (`.chip-alert`) LẪN nền đặc (`.nav-badge`) — 1 giá trị đảo cho dark không thể đạt AA cả 2 vai.
- **0 literal màu** ngoài 2 block token trong toàn `web/src` (grep gate hex+rgb) — 47 literal App.css + `index.css` body + 10 màu 2 chart đều về token.
- **`color-scheme: light/dark`** (red-team F3) → select/input/scrollbar native theo theme.
- **theme-context.tsx**: `light|dark|auto`, resolve → `<html data-theme>`, `auto` theo `prefers-color-scheme` (listen live), persist `localStorage['theme']`. Anti-FOUC: script inline trong `index.html` set data-theme + `theme-color` meta TRƯỚC React mount (mirror `applyTheme`, giữ đồng bộ).
- **Toggle 3-trạng-thái** (Sáng/Tối/Tự động) ở header (`ThemeToggle.tsx`).
- **Font Be Vietnam Pro (OFL) self-host**: 8 file woff2 subset vietnamese+latin (4 weight), vendored `web/src/assets/fonts/` — KHÔNG CDN (CSP/offline OK). Tổng 96KB (≤400KB target). `unicode-range` → chỉ tải vietnamese khi cần.
- **Motion**: transition 120–180ms (nav/tab/chip/btn hover) + `.confirm-dialog` fade-in, gate sau `prefers-reduced-motion: no-preference`; `reduce` strip toàn bộ.
- **Charts theme-aware (dataset)**: `chart-theme.ts` đọc token qua `getComputedStyle`; Cost/VerdictChart bỏ hardcode + label VN. (Remount-on-theme-flip để M25.)
- **F1 (red-team, chủ dự án duyệt)**: 3 màu light fail AA sẵn có → sửa đạt AA. verdict-pending `#b8860b`(3.25:1)→`#8a6d00`; warn `#b26a00`(4.24:1)→`#9a5b00`; agent-pending `#b60`(4.19:1)→dùng `--color-warn`.

## Verified

- Web vitest **91/91** (5 test mới theme-context: default/auto-dark/persist/read/live-OS) + tsc -b clean + build clean; backend **1205 pass** nguyên.
- **E2E live 23/23** (puppeteer, server thật :8099, 2 theme): data-theme + color-scheme đúng; AA ≥4.5:1 CẢ light+dark trên body/muted + mọi trạng thái đặc biệt (chip-alert, confirm-external, nav-badge, badge-on, agent-pending, verdict-pending). Font loaded; toggle persist qua reload. Ví dụ dark: confirm-external 6.59, nav-badge 5.80; light: verdict-pending 4.71 (trước fix 3.25 = fail).
- Code-review: DONE_WITH_CONCERNS → chỉ 1 MINOR (comment trỏ file `use-theme.ts` không tồn tại) đã vá thành `theme-context.tsx`.

## Bài học

- **1 hue không phục vụ 2 vai màu qua 2 theme**: text-on-bg và white-on-fill cùng token thì đảo cho dark chắc chắn hỏng 1 trong 2. Tách token theo VAI TRÒ trước khi thêm dark là điều kiện tiên quyết, không phải tối ưu.
- **Anti-FOUC = nguồn thứ 2 phải đồng bộ tay**: script inline `index.html` và `applyTheme` là 2 bản sao logic resolve — comment phải trỏ đúng file giữ đồng bộ (review bắt trỏ sai).
- **Dark-mode debt đo được trước = plan chính xác**: scout đếm đúng 47 literal + 10 chart trước khi code → không sót, không phình.

## Unresolved / next (M25)

1. Chart remount `key={resolvedTheme}` khi đổi theme (M24 mới token-đọc, chưa re-render runtime).
2. L1 (NIT, defer): chart `reject` slice dùng `--color-danger-strong`, text `.verdict-reject` dùng `--color-danger` — lệch nhẹ dark, cả 2 AA.
3. M25: toggle "Chế độ nâng cao" + promote 7 view v2 (i18n VN + token) + additive field `report_kinds` (F4).
