# v6 M16 — Production hardening & go-live (auth + deploy + backup)

2026-07-04 · ✅ Done (ĐÓNG v6 — hệ thống sẵn sàng công ty dùng thật)

Chốt hạ v6: từ "chạy trên máy dev" thành "công ty dùng thật". Web dashboard giờ có đăng nhập (bảo vệ nút Duyệt = Lớp B), serve 1 process từ FastAPI, cài 1 lệnh, backup được, có UAT checklist tiếng Việt cho CEO tự nghiệm thu.

## Làm gì
- **Single-user session auth** (`auth.py`): login/logout + `AuthMiddleware` chặn MỌI route trừ /health + login + /api/me + SPA assets; bcrypt hash password (`mpm web hash-password`), itsdangerous ký session cookie (SameSite=lax). Rate-limit 5 lần/phút/IP. **Auth OFF khi chưa đặt `WEB_AUTH_PASSWORD_HASH`** → localhost dev byte-identical pre-M16.
- **Fail-loud guards** (R2/R3): `assert_bind_safe` từ chối khởi động khi (a) bind non-loopback + auth OFF (phơi dashboard không mật khẩu ra LAN), (b) auth ON nhưng `WEB_SESSION_SECRET` rỗng/dùng hằng dev công khai (forge cookie được → bypass auth). Crypto chỉ bcrypt + starlette SessionMiddleware, không tự chế.
- **Serve 1 process**: FastAPI serve SPA build (SPA fallback sẵn có) + `/health` public → bỏ phụ thuộc Vite khi production. `BIND_HOST`/`PORT` env.
- **Deploy 1 lệnh** (`deploy/install.sh`): uv sync → build web → env preflight (cảnh báo key thiếu) → cài 2 launchd (coordinator agent + web) → in checklist. Plist web mới `com.mpm.web.plist`.
- **Backup/restore** (`deploy/backup.sh`/`restore.sh`): tar `.data`+`profiles`+`registry.yaml`, **loại .env mọi cấp** (R4 — secrets phục hồi từ password manager, KHÔNG từ archive); restore từ chối archive lỡ chứa .env.
- **UAT checklist tiếng Việt** (`docs/v2/uat-checklist.md`): 8 mục cho CEO tự nghiệm thu (login → tạo agent qua chat → hỏi đáp → giao lệnh+duyệt → giao việc → logout → backup) + `deployment-production.md`.

## An toàn = bảo vệ Lớp B
Nút Duyệt trên web mở khóa hành động Lớp B (tạo ticket, post external). Nên auth ở đây KHÔNG phải trang trí — nó CHÍNH là lớp bảo vệ Lớp B trên web. E2E chứng minh: chưa login → /api/agents, /api/approvals, /api/tasks/*/cancel đều 401.

## Review (DONE_WITH_CONCERNS, 0 CRITICAL, ship-blocker: none — reviewer verify live mọi /api/* 401 pre-login) → vá weak-secret + M1 + H1 + M2
- **`WEB_SESSION_SECRET` fallback công khai** (tự bắt trước review): app dùng hằng `dev-insecure-session-secret` khi env rỗng — operator bật auth mà quên set secret → session ký bằng hằng công khai → ai cũng forge cookie → auth vô hiệu im lặng. Vá: refuse khởi động khi auth ON + secret rỗng/hằng-dev.
- **M1 (reviewer)**: refuse đó ban đầu CHỈ ở `main()`, đường docstring quảng cáo `uvicorn src.server.app:app` bỏ qua main() → vẫn chạy được với secret yếu. Vá: tách `assert_session_secret_safe()` gọi ở `create_app()` (app-build time) → MỌI đường vào đều guarded. Verify: import create_app trực tiếp cũng refuse.
- **H1 (reviewer)**: test SSE overclaim "stream survives auth" nhưng chỉ hit path non-stream. Vá: sửa test hit ĐÚNG route stream thật (`/api/runs/*/stream`) — chứng minh routing qua middleware (401 pre-login, reaches handler post-login); drain stream end-to-end đã có ở test_server_stream.py; sửa docstring cho đúng điều thật sự assert.
- **M2 (reviewer)**: restore.sh traversal dựa bsdtar (Mac an toàn, GNU tar Linux không chặn `..` mặc định). Vá: `--no-absolute-names` (fallback bsdtar). Chấp nhận LOW: cookie không Secure flag (HTTP LAN), rate-limit dict unbounded (LAN nhỏ).

## Verified
1053 pytest (auth: login flow, 401 mọi route, /api/me public, rate-limit, bind guard 2 nhánh, SSE-sau-auth, secret-forge guard; deploy: backup loại .env + không leak token thật, restore refuse leaky, roundtrip) + 39 vitest (Login flow) + ruff + build. **E2E live server thật (auth ON)**: SPA serve từ FastAPI 1 process (không Vite) → chưa login /api/agents=401, /health=200, /api/me=authenticated:false → login sai=401, đúng=cookie → mọi route 200 → bind guard live refuse `0.0.0.0`+auth-off.

## Bài học
- **Fallback secret là bẫy im lặng nguy hiểm nhất trong auth**: `os.getenv(X, "default")` cho session secret nghĩa là quên-set = auth giả (trông có bảo vệ, thực ra forge cookie được). Phải fail-loud khi auth ON mà secret là hằng công khai — không bao giờ để "chạy được nhưng không an toàn".
- **Auth = bảo vệ đúng thứ nhạy cảm, không phải mọi thứ**: xác định /api/me PHẢI public (SPA cần biết có nên hiện login không) nhưng chỉ lộ authenticated+username, không gì khác. Public-list phải đủ hẹp: mỗi entry là một quyết định "cái này an toàn cho người chưa đăng nhập".
- **Guard phải fail-loud lúc START, không lúc dùng**: bind non-loopback + auth off, hay auth on + secret yếu — đều refuse ở `main()` trước `uvicorn.run`, không đợi request đầu tiên mới lộ. Cấu hình sai không được phép "chạy tạm".

## v6 HOÀN TẤT
Thang trách nhiệm đủ 4 bậc (báo cáo → trả lời → nhờ được → giao việc nhiều ngày), 3 domain (PM/HR/Admin), danh tính Telegram riêng, CEO quản đội bằng chat tiếng Việt (Telegram + web), và giờ đóng gói production: 1 lệnh cài, có login, backup được, UAT checklist. Sẵn sàng giao công ty.
