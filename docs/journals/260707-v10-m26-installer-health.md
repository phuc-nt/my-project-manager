# v10 M26 — Installer hardening + first-run health (2026-07-07)

Shell + frontend. KHÔNG đụng backend (1206 test nguyên). Kết thúc v10.

## Đã làm

- **`deploy/install.sh` gia cố** (không viết mới — script đã tồn tại làm ~80%). Đóng 6 gap red-team đo:
  - **Preflight fail-loud**: thiếu `uv`/`node`/`npm`/`git` → in đúng lệnh `brew install` + exit 1 (không tự cài — máy người dùng). `gh` là warning (login tương tác, không chặn cài — health-gate cuối báo).
  - **F6 restart-only-on-change (hazard lớn nhất)**: cũ ghi đè plist + `launchctl unload/load` VÔ ĐIỀU KIỆN mỗi lần → giết agent run + rớt session. Nay so plist render vs đã cài (`cmp` bằng `=`), chỉ reload khi khác. Re-run không-đổi = 0 restart.
  - **SPA build temp + swap**: cũ `vite build` ghi thẳng dir đang serve (`emptyOutDir` xoá trước, ghi sau → client thấy 404/bundle dở). Nay build vào `mktemp -d` (override `--outDir`), `rsync --delete` vào dir serve CHỈ khi khác. Web reload chỉ khi SPA đổi.
  - **MCP_DIST-aware**: đọc lại `*_MCP_DIST` từ `.env` trước khi clone (tôn trọng vị trí custom); `MCP_BASE` ≠ default → ghi `*_MCP_DIST` vào `.env` (chỉ khi thiếu key).
  - **Health-gate cuối**: kiểm 3 MCP dist + `gh auth` + dashboard-auth presence → bảng ✓/✗ trước khi tuyên bố xong.
  - **HTTPS clone** (khớp docs, bỏ SSH `git@`).
  - **bash 3.2 compat**: macOS default bash không có `declare -A` → map repo→env-var bằng `case` function.
- **First-run health = tái dùng `IntegrationHealthPanel`** (DRY): Settings bỏ bản inline riêng, dùng chung component (đang trên Team view). Panel thêm dòng tóm tắt (✓ sẵn sàng / N cần khắc phục) + render lệnh trong `` `backtick` `` của hint thành `<code>` copy-paste được (guard backtick lẻ → không runaway).
- **Docs**: `getting-started.md` thêm mục "One-command install" (1 lệnh `./deploy/install.sh`, giải thích preflight/temp-swap/health-gate/re-run no-op), sửa SSH→HTTPS.

## Verified

- Web vitest **98/98** (thêm 2 panel: summary + backtick→code) + tsc + build clean; backend **1206 nguyên** (không đụng); `bash -n` OK dưới /bin/bash 3.2.
- **F6 logic test**: plist unchanged → không restart; changed → restart. **SPA fingerprint** path-independent (nội dung giống ở path khác → cùng hash → skip restart) — sửa bug tôi tự tạo: bản đầu hash cả path prefix nên temp vs served LUÔN khác → restart mọi lần; strip base-dir mới đúng.
- **E2E live 6/6** (puppeteer, server thật): Settings "Sức khỏe hệ thống" render 8 check + tóm tắt + refresh + 0 console error.
- Code-review 2 vòng DONE_WITH_CONCERNS → vá hết:
  - **M1 (MAJOR)**: comment nói "atomic temp-dir swap" nhưng code build in-place (`emptyOutDir` xoá live dir). Chọn SỬA CODE cho khớp comment (temp build + rsync) thay vì hạ comment — được luôn an toàn thật.
  - **m2**: `gh` hard-fail → warning. **n1**: renderHint guard backtick lẻ.
  - Verified sạch: secret không rò (không `set -x`, chỉ presence-check), F6 idempotent, .env parse đúng, XSS an toàn (React escape).

## Bài học

- **Comment hứa điều code không làm = nợ nguy hiểm**: "atomic swap" trong comment nhưng vite `emptyOutDir` xoá-rồi-ghi tại chỗ. Review bắt. Sửa code cho đúng comment tốt hơn hạ comment — vì tính chất an toàn đó THẬT sự đáng có.
- **Đổi cách hash phải nghĩ lại bất biến**: chuyển sang temp-dir làm fingerprint (gồm path prefix) khác nhau → F6 vô hiệu (restart mọi lần). Fingerprint phải bất biến theo vị trí (strip base). Thay đổi tưởng nhỏ (đổi outDir) phá giả định của đoạn khác.
- **macOS = bash 3.2**: `declare -A`/mapfile không có. Script deploy phải test dưới `/bin/bash` thật, không phải bash 5 của brew.
- **DRY health panel**: 2 surface (Team + Settings) từng có 2 bản render → gom 1 component, sửa 1 chỗ.

## Unresolved / next

- Docker Compose trọn gói + Linux/systemd: defer (macOS-only, ghi rõ) đến khi có người dùng ngoài thật.
- Installer chưa tự `gh auth login` (tương tác) — vẫn là bước tay có hướng dẫn.
- v10 HOÀN TẤT: M24 theme + M25 dual-mode + M26 installer.
