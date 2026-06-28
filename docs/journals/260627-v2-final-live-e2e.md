# v2 — Final live E2E (toàn surface) + 1 bug fix

**Ngày:** 2026-06-27 · **Trạng thái:** ✅ Done · **Commit:** fix `<this>`

## Mục tiêu

E2E live lần cuối toàn bộ v2 (M1→M3) trước khi đóng: 1 lượt end-to-end qua mỗi feature
chính với data + post THẬT (Jira/Slack/Confluence + Postgres throwaway), không mock.

## Cách chạy

Agent throwaway `e2e-final` (`dry_run: false`, `store/checkpointer: postgres`) trỏ vào
target seeded thật (.env): Jira SCRUM, Confluence space MPM, Slack `<SLACK_CHANNEL_ID>`. Chạy qua
per-agent worker (đúng đường v2, không đụng profile `default`). Postgres Docker throwaway
(port 55432). Dọn sạch sau (profile + container + data + registry entry).

## Verify được (live, không mock)

| Mảng | Kết quả live |
|---|---|
| M1 read | Jira SCRUM: 21 issue thật qua MCP server (`phucnt0.atlassian.net`) |
| M1/M2 compose+deliver | Daily report LLM thật → **Confluence page THẬT** (id `2064385`, V2 API 200) |
| M2-P5/P7 approve→post | Slack queue Lớp B → `mpm agent approve` → **post Slack THẬT** (ts `1782532805`); message mang link Confluence thật (checkpoint flow P5↔P6) |
| M2-P8 Postgres | checkpointer + store chạy trên Postgres thật (8 checkpoint/thread) |
| M2-P8 memory | extractor LLM thật → **20 fact PM thật** ghi Postgres Store ns `(e2e-final,"memory")` |
| M3-P12 B4 tracing | OFF → invoke config byte-identical; ON (flag+env) → callbacks len 1 (no flush) |
| M3-P12 B3 replay | list 8 checkpoint Postgres (replayable/needs-earlier-data đúng); replay `approval_gate` → re-vào gateway, `confluence=deduplicated` (dedup_hint chặn trùng); unsafe `next=perceive` → **từ chối** đúng |
| M3-P12 D3 automate | dry-run (read+LLM thật, 0 enqueue) · propose external channel → `pending_approval` (Lớp B) · propose non-external → `skipped` (no-op, KHÔNG auto-execute) |

## Lằn ranh đỏ (giữ vững, verify live)

- Mọi post outward (Slack/Confluence) qua Action Gateway; channel external → Lớp B duyệt
  trước khi post. Không có đường auto-post vòng gateway.
- D3 workflow chỉ ENQUEUE hoặc no-op — KHÔNG bao giờ tự thực thi write (xác nhận live:
  `skipped` cho non-Lớp-B, `pending_approval` cho Lớp B).
- B3 replay re-vào đúng gateway chain (dedup giữ), không bypass.

## Vấp & học được

- **Bug live bắt được (offline test che mất):** `mpm_automate_cmd._analyze` đọc
  `LlmResult.text` — attribute thật là `.content`. Offline test inject fake `analyze_fn`
  nên không chạm shape thật → D3 live `--dry-run` đầu tiên crash `AttributeError`. Vá:
  `.text`→`.content` + regression test chạy `_build_analyze_fn` với fake client trả
  `LlmResult` thật (test FAIL nếu thiếu vá). Bài học cũ lặp lại: injectable collaborator
  giúp offline nhưng phải có ÍT NHẤT 1 test chạm shape thật của dependency.
- **dry_run precedence:** profile.yaml `dry_run: true` THẮNG env `DRY_RUN=false` (đúng
  thiết kế loader). Muốn post live phải đổi profile, không phải env → dùng agent throwaway.
- **Channel test trùng vai:** `SLACK_REPORT_CHANNEL == SLACK_EXTERNAL_CHANNELS` → cả
  internal report cũng routed Lớp B. Không phải bug — guardrail đúng (post tới channel
  external luôn cần duyệt).

## Dọn sạch

Xóa profile `e2e-final` (chứa DSN), kill container, xóa data dir, revert registry entry.
`git grep` xác nhận DSN/password/throwaway-id KHÔNG vào file tracked nào.

## Kết quả

776 test xanh (775 + 1 regression mới), ruff sạch. v2 (M1+M2+M3) verified live toàn
surface. 1 bug vá. Đóng v2.
