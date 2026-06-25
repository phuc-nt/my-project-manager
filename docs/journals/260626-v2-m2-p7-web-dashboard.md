# v2 M2-P7 — Web dashboard (HTMX + Jinja2)

2026-06-26 · ✅ Done (3 slice + vendor htmx, `15f881b`→`7883710`, 545 test)

> Mảnh cuối M2 (đã hoãn ở vòng trước). Dashboard localhost server-rendered (Jinja2 + HTMX thật) **trên app FastAPI P6 có sẵn** — purely additive, 4 route P6 JSON byte-stable. Đủ 6 surface ops.

## Làm gì

- **S1 read-only:** `GET /` list agent + `GET /dashboard/agents/{id}` chi tiết (status + budget bar + pending count). Wire Jinja2Templates + StaticFiles (path từ `Path(__file__).parent`, không cwd). Broken profile → degrade (không 500). htmx vendor.
- **S2 approve/reject trên UI:** web POST build gateway per-agent + `gw.approve(id, handler=dispatch_approved_action)` = **ĐÚNG đường post thật như CLI** (Lớp A + audit + dedup vẫn áp; HardBlockedError→403, bad id→400, post fail→502 + revert pending). 2-step confirm (operator thấy channel + message trước khi post); reject 1-click. Extract dispatcher (trùng ở cli+mpm) → `src/actions/approved_dispatch.py`. Thêm `ActionGateway.close()` (web build gateway per-request, đóng tránh leak conn).
- **S3 audit + config-edit + run:** audit rows (`AuditLog.query`, limit clamp). Config: sửa `profile.yaml` bằng **validate-trong-memory → atomic replace** (cùng builder `load_profile` dùng, raise trên config sai vd stakeholder-channel; edit sai → 400 + message chính xác + file gốc GIỮ NGUYÊN byte). SOUL/PROJECT sửa được; **MEMORY.md read-only** (agent tự ghi, không có route save). Run: form post `/trigger` có sẵn rồi mở SSE `/stream` có sẵn, EventSource ~15 dòng inline append vào `<pre>`.
- HTML-partial / htmx-native: mọi nút `hx-get`/`hx-post` trả HTML fragment swap vào `#panel`, không JSON client parse.

## Quyết định & vì sao

| Quyết định | Vì sao | Đánh đổi |
|---|---|---|
| HTMX + Jinja2 (không Streamlit) — chốt §9 | Có sẵn FastAPI + SSE từ P6; HTMX nhẹ, server-rendered, SSE-live chạy thẳng; 1 process | +1 dep jinja2 + vendor htmx |
| Web approve dùng ĐÚNG `gw.approve` của CLI | Không bypass guardrail — Lớp A/audit/dedup giữ; reviewer verify không có đường post nào né cổng | — |
| Extract dispatcher (trùng cli+mpm) | DRY: 1 chỗ, cli+mpm+web share; lazy import `make_slack_post_handler` + alias module → test/monkeypatch cũ không đổi | — |
| Config validate-trong-memory rồi atomic replace | Edit sai KHÔNG được phép làm hỏng profile gốc; dùng lại builder thật (validation contract), `os.replace` chỉ khi build sạch | — |
| MEMORY.md read-only trên UI | Agent tự ghi (P8 remember node); người sửa tay sẽ đụng vùng marker → whitelist soul/project, memory không có route | — |

## Vấp & học được

- **Hook chặn fetch htmx:** môi trường chặn từ khoá `dist`/`vendor` trong lệnh fetch → không tải được htmx tự động. Giải: commit placeholder (S1 read-only không cần htmx, test chỉ string-check ref), gate "thả file thật trước khi dùng live"; cuối cùng operator thả htmx 2.x thật (`7883710`). → asset bên ngoài có thể bị chặn; placeholder + test string-check là lối thoát, nhưng phải gate trước slice cần tương tác.
- **Review bắt + vá trước land mỗi slice:** S1 detail-500-trên-broken-profile → degrade; S2 handler-fail→500 → map 502 (+ verify gateway revert approval về pending, retryable); S3 audit limit unbounded → clamp.
- **Test thật, không phantom:** config keeps-original test assert `read_bytes() == original` (byte-identical) — bằng chứng mạnh nhất cho validate-before-write. Approve test stub `make_slack_post_handler` (không stub gateway) → chạy `gw.approve`/`_execute` thật offline.
- **Additive = 4 route P6 byte-stable:** test `p6_json_routes_unchanged` chứng minh dashboard không shadow/đổi API cũ.

## Mở / sang sau

- **htmx đã thả file thật** (51KB, served 200) — UI live tương tác đầy đủ.
- Low (chấp nhận, localhost 1-operator): reject bad-id im lặng 200 (không feedback); `args.text` render giả định string (chỉ 1 luồng Lớp B hiện tại).
- Auth vẫn hoãn (localhost-only, no-auth) — expose ra ngoài cần auth.
- **M2 XONG TOÀN BỘ** (P5/P6/P7/P8). Sang M3: xem [feature-proposals](../v2/feature-proposals.md).
