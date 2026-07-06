# v9 P3 — design-token + visual polish (CSS thuần)

**Ngày:** 2026-07-07 · **Scope:** frontend CSS + class (backend py 0 đổi, 0 dependency)

## Mục tiêu

Nâng cảm giác "đẹp hiện đại đồng bộ" bằng design-token CSS thuần — KHÔNG UI kit (giữ triết lý no-UI-kit, không phá test, không thêm dependency). App.css trước: ~140 dòng, 0 CSS var, hex hard-code rải rác, contrast fail WCAG.

## Đã làm

- **`:root` design-token**: màu (text/muted/subtle/primary/danger/ok/warn/border/bg), spacing (--space-1..5), radius (--radius/-lg/-pill), shadow (--shadow-sm), **type scale** (--fs-h1..h4/body/sm/xs). Đổi hex hard-code → `var(--…)` — **112 var() usage**, giá trị tương đương (không đổi visual ngoài 3 màu contrast).
- **Sửa contrast WCAG AA**: `.muted` #777→#6b6b6b (5.74:1), th/chat-who #888→#707070 (5.13:1), chat-empty #999→muted. Mắt thường gần như không đổi, đạt 4.5:1 text nhỏ.
- **Type scale nhất quán**: h1 1.1rem (nhỏ hơn nav!) → 1.4rem dẫn đầu hierarchy; h1..h4 + section margin đều qua token.
- **Component-class dùng chung**: `.btn`/`.btn-primary`/`.btn-danger` (padding/radius/border/hover), `.card` (border+radius+shadow), `.badge` (pill). Áp vào view CEO (Team đã có; Work nút duyệt/từ chối; Chat nút gửi). Element `button` global GIỮ → view Nâng cao không vỡ.
- **CompanyDocs `.active`**: scout thấy gán class nhưng thiếu CSS → thêm selected state (nền xanh nhạt + viền + đậm) + hover.

## Kết quả

- **86 vitest xanh** (không thêm test — thay đổi visual; class thêm không phá query text/role) + tsc + build sạch. **0 dependency** (CSS thuần 1 file). Backend py 0 đổi.
- Risk visual regression: token thay giá trị tương đương + class additive (giữ class cũ) → không đổi layout; build compile CSS OK.

## Bài học

- **Design-token = 1 lần sửa re-theme cả app** mà không cần UI kit: token trong `:root` + `var()` đủ để nhất quán màu/spacing/type, giữ được triết lý no-UI-kit + 0 dependency.
- **Contrast fix gần như vô hình mắt thường** (#777→#6b6b6b) nhưng qua ngưỡng WCAG — rẻ, đáng làm.
- **Class visual additive không phá test** vì test query text/role, không query class → an toàn thêm `.btn` mà giữ class cũ.
