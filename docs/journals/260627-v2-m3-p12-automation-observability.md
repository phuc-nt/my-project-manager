# v2 M3-P12 — Automation + observability
2026-06-27 · ✅ Done

## Làm gì

Hoàn tất milestone M3 (cuối cùng của v2) với 3 slice chuyên biệt: observability (B4 LangSmith tracing opt-in), replay (B3 time-travel từ checkpoint đóng băng), workflow automation (D3 READ-ONLY+PROPOSE via gateway). Tất cả 775 test xanh.

## Mục tiêu

**B4 — Observability**: Cho phép LLM runtime dump live trace sang LangSmith nếu đặt flag + env (default OFF = zero perf/behavior delta vs pre-P12).

**B3 — Replay**: Thay vì re-fetch live Jira/GitHub, replay từ checkpoint lưu => re-run graph trên state đóng băng, safe để chạy lại trước approval_gate hoặc terminal.

**D3 — Automation**: Read dữ liệu công khai (Jira/GitHub/Linear/Confluence), analyze bằng LLM, propose action (Slack post / Linear comment) => enqueue qua gateway như Lớp B, không bao giờ tự thực thi.

## Quyết định & vì sao

| Quyết định | Vì sao | Đánh đổi |
|---|---|---|
| B4 tracing DEFAULT OFF | Zero perf/behavior khi OFF; lazy import (không load langsmith); chỉ bật khi user + env setup | Phải check 2 điều kiện (flag + env) để lên trace |
| B3 replay = đóng băng state, không re-fetch | Closure-local fetch box không checkpointed ⇒ earlier node sẽ KeyError hoặc degenerate; replay-safe = chỉ deliver/approval_gate/terminal | Defer re-fetch + state edits sang sau; giới hạn replay window |
| D3 = PROPOSE qua gateway, không auto-exec | Giữ red line: mỗi write vẫn qua Lớp A/B gate, operator duyệt | Automation không "chạy được ngay"; phải approve trước post |
| D3 yaml = fail-closed (không boolean `when`) | Schema hẹp ⇒ easy validate, safe default; mở sau nếu user yêu cầu | Kém linh hoạt; chỉ field == value |

## Vấp & học được

- **B4 LangSmith span bridge**: `LangChainTracer` cần `project_name` + `api_key` ⇒ chỉ init khi cả 2 có; nếu đặt flag nhưng ENV thiếu, không lỗi (chỉ skip, log warning).
- **B3 safe-replay guard logic**: Bắt phải check `metadata['next']` từ checkpoint history, đối với `perceive`/`analyze`/`compose` node, từ chối vì closure box mất. Nếu nhầm logic, user lỗi KeyError.
- **D3 automation.yaml schema**: Ban đầu muốn cho boolean `when` (VD: `when: assigned_to == "Alice" AND priority == "high"`), nhưng KISS + fail-closed ⇒ giới hạn `field == value` + đơn. Mở sau là option.

## Mở / sang sau

- **B4 live-key LangSmith trace**: Deferred — cần real LangSmith project key (private); P12 chỉ verify logic (logic test + fake LlmClient).
- **B3 re-fetch + time-travel state edits**: Enqueued cho phase sau; checkpoint structure sẵn sàng, chỉ cần `--refetch` flag + time-travel arg.
- **D3 boolean `when` + schedule trigger**: Automation hiện chạy on-demand (`mpm agent automate`); schedule-triggered (cron/event) + richer `when` logic (AND/OR) defer.
- **D3 multi-step read-analyze chains**: Hiện `analyze` mỗi propose riêng; có thể optimize shared context sau.

## Lằn ranh đỏ (giữ nguyên)

- **Tracing**: observability-only, chỉ write logs => LangSmith, không touch guardrail hoặc write authority.
- **Replay**: re-run existing graph ⇒ write vẫn qua gateway (Lớp A/B + dedup), không bypass.
- **Automation**: PROPOSE qua gateway = Lớp B enqueue (nếu destructive action) hoặc Lớp A deny (nếu không allowlist), không bao giờ auto-execute.
- **Backward-compat**: Tracing OFF + không invoke automation ⇒ byte-identical pre-P12 (khác với M3-P10/P9 "opt-in" logic).

## Kết quả

✅ **M3-P12 HOÀN TẤT** — 4 slices M3 toàn (P10 skills, P9 cross-agent memory, P11 integrations, P12 automation+observability) xong.

✅ **v2 platform HOÀN TOÀN** — M1 (config+profile+worker+cli) + M2 (web dashboard+Postgres+streaming+memory) + M3 (skills+cross-agent+integrations+automation+observability) đều shipped, 775 test xanh, red line giữ vững.

✅ **Backward-compat OK** — tracing DEFAULT OFF, no automation invoked, skip extra integrations/smtp ⇒ byte-identical pre-P12.

**Không có CRITICAL vấp**. B4/B3/D3 logic verify offline (fake LlmClient, test checkpoint, YAML schema) + integration test tất. Chỉ deferred: live LangSmith + re-fetch + schedule automation.
