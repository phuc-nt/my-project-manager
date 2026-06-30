# v3 M5 — Domain-pack abstraction
2026-06-30 · ✅ Done

Mốc đầu v3. Lõi PM-cứng → multi-domain platform: domain = **pack cắm vào** (`domain-packs/<domain>-pack/`), thêm domain = thêm pack, KHÔNG sửa lõi. PM hiện tại đóng gói thành `pm-pack`, chạy **byte-identical** pre-v3.

## Làm gì (6 slice, test xanh sau mỗi cái)
- **S1 Scaffold**: `src/packs/{registry,tool_provider}.py` (Pack dataclass, PackRegistry importlib-load pack module từ dir gạch-ngang, ToolProvider Protocol). Profile thêm `domain:` (vắng/blank → "pm" → profile pre-v3 không đổi).
- **S2 Report-kind dispatch**: `worker.py:build_graph_for` if/elif kind → `pack.report_kinds[kind]` (chokepoint duy nhất, mọi caller worker/resume/server/replay không đổi). `pm-pack/graphs.py` đăng ký daily/weekly/okr/resource — adapter mỏng gọi cùng `build_*_graph`.
- **S3 ToolProvider**: report graph đọc qua `pack.tools` thay `import jira_read/github_read`. `pm-pack/tools.py` (`PmToolProvider`) wrap reads. Interface transport-agnostic (chỉ giả định "read→records") — để M6 cắm Google Sheets adapter mà lõi không biết GSheet là gì.
- **S4 Allowlist config-driven**: `classify(action, allowlist=...)` + `ActionGateway(mcp_allowlist=...)`. `pm-pack/write_handlers.py` đóng góp `ALLOWLIST` (== core default). **RED LINE gate** (`test_pack_allowlist_redline.py`).
- **S5 Pack assets**: skill `skills/*.md` → `pm-pack/skills/` (git-mv, history giữ); 8 system-prompt string → `pm-pack/prompts/*.md` (sinh TỪ live constant → byte-exact), builder đọc qua `load_pack_prompt("pm",...)`. Builder LOGIC giữ ở `src/llm/`.
- **S6 Generic model**: `Task`/`Event` ở `src/tools/models.py`; `pm-pack/models.py` map `Issue↔Task` round-trip lossless = PROOF generic model đủ phủ PM.

## Lằn ranh đỏ (The Invariant) — VERIFIED
Allowlist thành pack-driven NHƯNG Lớp A red-line markers (data-loss/credential/security) GIỮ trong lõi `hard_block.py`, check TRƯỚC allowlist, pack KHÔNG override được. Adversarial-proven: pack thử allowlist `deletePage`/`setRestriction` → vẫn DENY (DATA_LOSS/SECURITY). default-DENY giữ (tool ngoài allowlist → deny). PM allowlist classify y hệt core default. `classify()`/`needs_interrupt()` ngữ nghĩa không đổi. Code-review (adversarial) xác nhận: 0 CRITICAL/HIGH, byte-compare 8 prompt + allowlist == git HEAD.

## Quyết định scope (cho M6)

| Quyết định | Vì sao | Đánh đổi |
|---|---|---|
| Write-handler DISPATCH giữ ở lõi (`approved_dispatch.py`), chỉ allowlist pack-driven | slack/linear/email là shared primitive M6 HR tái dùng (không phải PM-only) | Dispatch chưa "pack lookup" như plan literal — nhưng đúng DRY, M6 thêm handler riêng nếu cần |
| PM analyzer (risk/resource) GIỮ consume `Issue` | byte-identical; `Issue↔Task` round-trip đã chứng minh model đủ | M6 HR viết headcount analyzer RIÊNG trên `Task` (không ép PM analyzer sang Task) |
| Pack module load qua importlib (dir gạch-ngang) | `pm-pack`/`hr-pack` không import được như package thường; YAGNI (in-repo folder, không plugin entry-point) | `load()` re-exec module mỗi lần (side-effect-free; memoize hoãn — perf-only) |

## Số liệu
816 test xanh (was ~775; +31 pack test), ruff clean. Exit criteria đạt: pm-pack byte-identical (62 e2e/report + 198 prompt test), lõi KHÔNG còn import read-tool/prompt-literal trực tiếp, RED LINE suite (107 test) xanh. Review fix MEDIUM/LOW: bỏ dead `write_handlers` field, sync `pack.yaml servers`, `ImportError` cho missing module, document PM-lock okr/resource.

## Next
M6 hr-pack (ép abstraction): thêm `domain-packs/hr-pack/` với GSheet adapter + headcount → `git diff src/` PHẢI rỗng. Nếu phải sửa lõi → M5 thiếu seam, quay lại.
