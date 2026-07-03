---
title: "Triển khai production (v6 M16)"
description: "Cài đặt 1 lệnh, bật auth, backup — đưa hệ thống từ máy dev thành công ty dùng thật."
status: stable
created: 2026-07-04
---

# Triển khai production

> Đưa hệ thống từ "chạy trên máy dev" thành "công ty dùng thật": 1 lệnh cài, có đăng nhập, có backup. Target mặc định: **Mac / Mac mini + launchd**. (Linux/docker: xem cuối trang.)

## Mô hình an toàn

1 CEO, chạy trong LAN công ty. Nút **Duyệt** trên web mở khóa hành động Lớp B (tạo ticket, post external…) — nên **auth chính là lớp bảo vệ Lớp B**, không phải trang trí. Single-user session login là đủ (không cần SSO/multi-tenant).

## Cài đặt (1 lệnh)

```bash
git clone <repo> && cd my-project-manager
cp config.example.env .env        # rồi điền các key (xem bên dưới)
./deploy/install.sh
```

`install.sh` làm: `uv sync` → build web SPA → kiểm tra `.env` thiếu key gì → cài 2 launchd service (coordinator chạy agent theo lịch + web dashboard) → in checklist.

## Bật đăng nhập (BẮT BUỘC trước khi mở ra LAN)

```bash
# 1. Tạo hash mật khẩu (nhập ẩn, không vào shell history):
uv run python -m src.entrypoints.mpm web hash-password
# → dán WEB_AUTH_PASSWORD_HASH=... và WEB_SESSION_SECRET=... vào .env

# 2. (tuỳ chọn) đổi tên đăng nhập:
#    WEB_AUTH_USERNAME=ceo    trong .env
```

Khi `WEB_AUTH_PASSWORD_HASH` chưa đặt → dashboard **không có auth** (chỉ dùng localhost dev). Cơ chế bảo vệ: nếu đặt `BIND_HOST` khác `127.0.0.1` mà auth chưa bật → **dịch vụ từ chối khởi động** (fail loud), tránh vô tình phơi dashboard không mật khẩu ra mạng.

## Truy cập từ máy khác trong công ty

```bash
# trong .env, CHỈ sau khi đã bật auth ở trên:
BIND_HOST=0.0.0.0
PORT=8765
```

Rồi mở `http://<ip-máy-chủ>:8765` từ máy khác trong LAN. Truy cập từ xa (ngoài công ty): dùng **Tailscale** hoặc VPN — không mở thẳng ra internet (chưa có HTTPS; TLS là việc của reverse proxy nếu cần).

## Backup / Restore

```bash
# Backup thủ công (KHÔNG gồm .env — secrets phục hồi từ password manager):
./deploy/backup.sh                 # → backups/mpm-backup-<timestamp>.tar.gz

# Cron backup hằng ngày 2h sáng (crontab -e):
0 2 * * *  /đường-dẫn/deploy/backup.sh /đường-dẫn/backups

# Restore (dừng service trước):
launchctl unload ~/Library/LaunchAgents/com.mpm.{web,service}.plist
./deploy/restore.sh backups/mpm-backup-<timestamp>.tar.gz
launchctl kickstart -k gui/$(id -u)/com.mpm.service
launchctl kickstart -k gui/$(id -u)/com.mpm.web
```

Backup gồm `.data/` (sqlite + audit + tasks) + `profiles/` + `registry.yaml`. Restore đưa agent chạy tiếp đúng chỗ dừng — approval/audit/task còn nguyên.

## Vận hành

| Việc | Lệnh |
|---|---|
| Xem log web | `tail -f .data/web.log` |
| Xem log agent (scheduler) | `tail -f .data/service.log` |
| Khởi động lại web | `launchctl kickstart -k gui/$(id -u)/com.mpm.web` |
| Dừng tất cả | `launchctl unload ~/Library/LaunchAgents/com.mpm.{web,service}.plist` |
| Nghiệm thu | Đi hết [uat-checklist.md](uat-checklist.md) |

## Linux / Docker (chưa build sẵn)

Target chính là Mac + launchd. Trên Linux: chạy `uv run python -m src.server.app` (web) + `uv run python -m src.runtime.service` (scheduler) dưới systemd/supervisor với đúng biến môi trường `.env`. Docker compose có thể thêm sau khi có máy Linux thật — không nằm trong M16 (YAGNI).

## Unresolved

- HTTPS trong LAN thuần: chưa cần; thêm reverse proxy (Caddy/nginx) khi truy cập từ xa.
