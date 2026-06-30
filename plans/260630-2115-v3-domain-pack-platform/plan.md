# v3 Plan — Domain-Pack Platform + Low-Tech UI

> **⚠️ Đọc [CONTEXT-HANDOFF.md](CONTEXT-HANDOFF.md) TRƯỚC TIÊN** — bối cảnh quyết định gốc, THE INVARIANT, gate, các câu hỏi BLOCKING phải chốt với chủ dự án.
> Sau đó đọc [project-overview-pdr](../../docs/v1/project-overview-pdr.md) + [v2 architecture](../../docs/v2/architecture.md).
> Research nền: [domain-coupling](../reports/researcher-260630-2115-domain-coupling-generic-vs-pm-hardcoded-report.md) · [runtime/UI](../reports/researcher-260630-2115-runtime-multiagent-ui-state-report.md).
> Status: **PLANNED (2026-06-30)**. Chưa code. Người viết plan ≠ người cook.

## North Star v3

Biến my-project-manager từ **một PM-agent platform** (domain PM code-cứng trong lõi) thành **multi-domain agent platform**: lõi chung + **domain pack** cắm vào (PM / HR / Admin), thêm domain mới = thêm 1 pack, KHÔNG sửa lõi. Cộng lớp **UI low-tech** để người không rành kỹ thuật tự tạo + vận hành agent.

**Quyết định nền (2026-06-30):**
- GIỮ lõi LangGraph + Action Gateway (KHÔNG đổi sang OpenClaw/Pi.dev). Lõi đã là inner harness tốt; Action Gateway 2-lớp là tài sản độc nhất.
- Domain = **outer harness** (pack), không phải inner.
- Xây **HR pack song song** PM pack để ép abstraction đúng ngay.
- AICoworker patterns (local model / OAuth / multi-provider fallback): **defer** (chưa cần v3).
- UI = **mở rộng React SPA M4 có sẵn** (KHÔNG Electron).

## Bối cảnh kỹ thuật (research 2026-06-30)

Core **60% generic / 40% PM-hardcoded**. Generic 100%: web UI, Action Gateway, profile loader, memory, skill system. Hardcoded ở **3 seam**:
1. **Report-kind enum + graph dispatch** (`runtime/worker.py`) — graph builder hardcode `jira_read`/`github_read` import. *HARD nhất* → cần `ToolProvider` abstraction.
2. **Allowlist + write dispatch** (`actions/hard_block.py:_MCP_ALLOWLIST`, `actions/approved_dispatch.py`) — server/tool enumerated by name. *MEDIUM*.
3. **Prompts + analyzers + data models** (`llm/*_prompt.py`, `tools/models.py` Issue/PR shape). *HARD* cho data model.

## Milestones

| MS | Tên | Trạng thái | Mục tiêu | Phase file |
|----|-----|-----------|----------|------------|
| **M5** | Domain-pack abstraction + pm-pack | ✅ DONE (2026-06-30) | Tách 3 seam; PM hiện tại thành `pm-pack` chạy byte-identical | [phase-m5](phase-m5-domain-pack-abstraction.md) |
| **M6** | hr-pack (ép abstraction) | ⬜ Planned | Pack thứ 2 (HR) chạy thật trên cùng lõi — chứng minh abstraction đúng | [phase-m6](phase-m6-hr-pack-proof.md) |
| **M7** | UI low-tech (create + onboard) | ⬜ Planned | Wizard tạo agent + chọn domain + setup token/schedule qua web, không sửa YAML/CLI | [phase-m7](phase-m7-low-tech-ui.md) |
| **M8** | admin-pack + đa-agent team view | ⬜ Planned (defer-able) | Pack thứ 3 (Admin) + all-agents dashboard | [phase-m8](phase-m8-admin-pack-team-view.md) |

## Thứ tự + lý do

M5 trước (nền — không có abstraction thì HR vẫn hardcode). M6 ngay sau, **song song M5 ở mức thiết kế**: HR là bài kiểm tra abstraction — nếu HR cần sửa lõi → M5 sai, quay lại. M7 chỉ làm khi đã có ≥2 pack (wizard phải có domain để chọn). M8 defer-able (admin = nice-to-have, demo đa-domain đã đạt ở M6).

## Nguyên tắc xuyên suốt (giữ từ v1/v2)

- **THE INVARIANT bất khả xâm phạm:** mọi write qua Action Gateway (Lớp A hard-deny + allowlist default-DENY + Lớp B approve). Abstraction hóa allowlist KHÔNG được nới lỏng red line. `classify()`/`needs_interrupt()` ngữ nghĩa giữ nguyên.
- Mỗi MS **chạy được + giá trị thật** trước MS sau (không big-bang).
- **Backward-compat:** `default` profile (PM, không khai báo `domain:`) chạy byte-identical pre-v3.
- Mỗi phase có exit criteria đo được + test xanh trước khi sang phase.

## Rủi ro lớn nhất

1. **ToolProvider abstraction (M5)** đụng graph builders — phần coupling sâu nhất. Mitigation: refactor từng builder một, giữ test xanh sau mỗi bước, pm-pack phải byte-identical.
2. **Red line regression** khi allowlist thành config-driven. Mitigation: test red line (Lớp A) chạy trên cả pm-pack lẫn hr-pack; default-DENY giữ.
3. **Over-abstraction** (YAGNI): chỉ trừu tượng đúng cái HR cần. Đó là lý do xây HR song song — abstraction điều khiển bởi nhu cầu thật, không phải tưởng tượng.

## Quyết định đã chốt (2026-06-30) — xem [CONTEXT-HANDOFF](CONTEXT-HANDOFF.md)

1. **Pack location:** `domain-packs/` in-repo (không plugin).
2. **HR đọc:** Confluence (tool sẵn) + Google Sheet (adapter MỚI trong hr-pack).
3. **HR report kind đầu:** Headcount.
4. **HR ghi:** Slack HR channel (tái dùng slack_write).

Không còn Unresolved BLOCKING cho v3.
