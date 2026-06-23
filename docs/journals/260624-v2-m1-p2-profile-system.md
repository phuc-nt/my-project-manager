# v2 M1-P2 — Profile system (thư mục 4 file + persona/project/memory)

2026-06-24 · ✅ Done (3 slice 1→2→3, commit 37433be / 0b4f3a2 / dd04271)

## Làm gì

- **Agent = thư mục `profiles/<id>/`** gồm 4 file: `profile.yaml` (config) + `SOUL.md` (persona) + `PROJECT.md` (context dự án) + `MEMORY.md` (bộ nhớ). `src/profile/loader.py` + `loader_mapping.py` parse → `Settings` + `ReportingConfig` (P1's `from_dict`) + `ProfileContext`.
- **Env-fallback 3 tầng:** `profile.yaml (set & non-empty) → env var → P1 from_dict default`. Field rỗng trong template **defer** về `.env` (không ghi đè) → `profiles/default/` tái tạo v1 byte-exact cho user hiện tại (golden test pin).
- **token_env = TÊN env var** (không phải token); resolve `os.environ` lúc load; thiếu token KHÔNG fail load (validate lazy lúc spawn MCP, như v1). Atlassian 1 token chung; Slack đọc 2 tên env cố định.
- **Inject persona/project/memory vào prompt** (tham số `build_*_messages`, default `""` ⇒ byte-identical v1). Internal: persona → system, project+memory → user. **External: KHÔNG lấy gì từ profile** (drop cả persona lẫn project/memory) — SOUL.md độc hại không tới được stakeholder.
- **Entrypoint `--profile <id>`** (default `default` = v1). cli/cron load profile thay `build_*_from_env`; inject config + context. Profile sai/thiếu ⇒ lỗi 1 dòng, exit ≠ 0, không traceback.
- `profiles/` gitignore trừ `profiles/default/` (template, chỉ chứa token_env NAMES). Thêm PyYAML. MEMORY.md M1 đọc-only (agent tự ghi = M2-P8). 317 test xanh, ruff sạch.
- **E2E (dry-run + thật):** `cli report --daily --profile default` chạy qua loader thật, đọc Jira/LLM thật, tạo Confluence + Slack (Lớp B) — giống hệt v1.

## Quyết định & vì sao

| Quyết định | Vì sao | Đánh đổi |
|---|---|---|
| Map `profile.yaml → dict → P1 from_dict` | Tái dùng toàn bộ default + validate Phase-5 của P1; không đẻ scheme cấu hình thứ 2 | loader phải biết key của from_dict (1 contract) |
| Empty yaml scalar = UNSET → defer env | template commit field rỗng KHÔNG được ghi đè `.env` của user → "default == v1" mới đúng | phải tránh bẫy `0`-is-falsy cho threshold số |
| Numeric/bool dùng key-presence (`_explicit`), không `or`-chain | `labor_cost_per_issue: 0` / `dry_run: false` là giá trị HỢP LỆ, `or` coi `0/False` là unset | 2 nhánh resolve (string vs numeric) |
| **External path lấy KHÔNG GÌ từ profile** (sửa sau review) | persona độc hại prepend lên external system = 2 lệnh mâu thuẫn ("nêu tên X" vs "KHÔNG tên"); unit test không chứng minh model nghe lệnh nào. Drop sạch = đóng vector, 0 chi phí UX (external tone đã đủ trong external system) | khác plan gốc ("persona prepend cả 2") |
| Profile sai ⇒ catch `(FileNotFoundError, RuntimeError)` ở entrypoint | giữ hợp đồng Slice-D: lệnh chẩn đoán (`audit`) phải sống qua misconfig, không crash traceback | catch rộng hơn 1 chút (nhưng vẫn hẹp, không bare Exception) |

## Vấp & học được

- **Loader quên `load_dotenv`** → đọc `os.environ` nhưng KHÔNG nạp `.env` → user có key trong `.env` bị báo "key not set". **Unit test che mất** (inject fake profile / clear env); chỉ **smoke thật** bắt được. Bài học: smoke E2E bắt lỗi mà mock không thấy. Fix: `load_dotenv(REPO_ROOT/.env)` đầu `load_profile` (không override env có sẵn). 3 test no-key phải block thêm loader's `load_dotenv`.
- **Review bắt vector PII external** (persona-on-external-system): đây đúng bài học Phase 5 user chốt non-negotiable. Chọn siết (drop persona external) thay vì ghi chú hoãn — guardrail mạnh hơn, đơn giản hơn (KISS).
- **Review bắt regression audit-tolerance:** load full profile (build cả config, validate) làm `audit` chết khi profile misconfig. Vá: catch RuntimeError ở entrypoint + test thật profile sai → audit exit sạch.
- **report_prompt.py vượt 200 LOC** sau khi thêm param → tách `build_slack_short` + `REPORT_TITLES` ra `report_slack_short.py` (re-export giữ import path).

## Mở / sang sau

- **P3** (registry + worker + isolation): `registry.yaml`, worker `--agent-id`, per-agent `.data/agents/<id>/`, per-agent gateway/budget/audit, `thread_id` prefix agent_id. `schedule`/`reports`/`enabled` (P2 parse-only) được P3 consume. Slack dual-token per-agent (`token_env_xoxc/xoxd`) cũng P3.
- **P4**: multi-agent CLI (`mpm agent list/register/run`).
- **M2-P8**: agent tự ghi MEMORY.md qua Store + top-K ranking (A1 nâng cấp).
- File >200 LOC tồn từ trước (cli 278, resource_report_prompt 250…) — modularize hoãn.
