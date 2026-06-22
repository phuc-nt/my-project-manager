# Phase 3 — OKR / Objective Tracking

2026-06-22 · ✅ Done (202 UT, reviewed, E2E thật + write thật)

## Làm gì
- **OKR ngoài Jira → map xuống epic**: định nghĩa Objective→Key Result trên 1 **bảng Confluence** (cột Objective | Key Result | Epic Key(s) | Weight), mỗi KR map ≥1 epic Jira. Đọc page (`confluence_read.get_page_content` + `parse_okr_table` qua stdlib html.parser).
- **Epic progress tính bằng Python** (`okr_read`): Jira MCP đang chạy KHÔNG có tool epic-progress → query child issue (`parent = <epic>`, fallback `"Epic Link"`) rồi done/total. Không phụ thuộc story point.
- **Rollup có trọng số** (`okr_analyzer.build_objectives`): Objective% = Σ(KR%×w)/Σw; blank ⇒ equal; multi-epic KR gộp theo **child-count** (Σdone/Σtotal, không phải mean %); phát hiện at-risk (<ngưỡng); dòng lỗi (epic sai / weight sai) → "OKR có vấn đề", không abort.
- **2 đường giao**: `cli report --okr` (page "OKR Status" + Slack short, qua Action Gateway, dedup `okr-<date>`) VÀ section OKR nhúng vào **weekly** (`okr_weekly_section`, fault-isolated). Số render deterministic; LLM chỉ viết 1 đoạn narrative, không chạm số.
- **KHÔNG mở write authority mới**: tái dùng `confluence:createPage` + `slack:post_message` (đã allowlist, Auto). Không đổi Lớp A/B.

## Quyết định & vì sao
| Quyết định | Vì sao | Đánh đổi |
|---|---|---|
| Spike MCP thật TRƯỚC khi code Slice A | Plan giả định `epicSearchAgile`/`getPage` (đọc source repo) — server chạy thật khác hẳn | Tốn 1 vòng spike, nhưng tránh code sai cả slice |
| Epic progress = child-count (done/total) | Server không có story point; child-count phản ánh volume thật | 1 epic >100 child bị cap (đã log cảnh báo) |
| Số deterministic, LLM chỉ viết prose | Chống bịa số liệu OKR | Narrative chung chung hơn |
| OKR analyzer TÁCH khỏi risk_analyzer | Data shape khác (Objective vs Issue/PR) | 1 module nữa, nhưng single-responsibility |

## Vấp & học được
- **Training data lệch (lần nữa)**: planner scout đọc *source repo* MCP, nhưng *build đang chạy* khác — không có `epicSearchAgile`, tool đọc page là `getPageContent` (không phải `getPage`), trả list text-block (body ở block cuối, XHTML storage nguyên vẹn → bảng parse được). Spike thật mới lộ. Bài học: verify integration bằng spike trước mỗi slice đụng MCP.
- **Code review bắt 3 lỗi trust-boundary** mà happy-path test bỏ sót, vì OKR đọc nội dung người gõ trên Confluence: (H1) exception chưa escape chèn vào page body → đổi sang note generic + log; (H2) epic key chưa validate → interpolate thẳng vào JQL (injection) → thêm regex `PROJECT-123`, token rác bị drop; (M1) nested `<table>` trong cell làm mất dòng OKR thật → thêm depth-guard parser. + M2/L1/L2. Vá hết + regression test.
- **Bug Phase 1 THẬT lộ ra khi seed data thật**: `enhancedSearchIssues` (mà daily dùng) **cắt mất field `duedate`** trong response → `overdue_task` risk KHÔNG BAO GIỜ bắn (lỗi im lặng — agent báo "không có rủi ro quá hạn" trong khi có). `getIssue`/`getSprintIssues` thì có duedate. Fix ở MCP server repo (`jira-cloud-mcp-server@41a6a30`: thêm `duedate` vào defaultFields + mapper), rebuild + push. Sau fix: daily bắt đúng 6 task quá hạn kèm số ngày. → Mock không bao giờ tìm ra lỗi này; chỉ data thật mới lộ.
- **Quirk Jira team-managed**: `epicKey` lúc createIssue KHÔNG link; phải `updateIssue parentKey` (và nó biến issue thành Sub-task, mất duedate). JQL đúng là `parent = <epic>`. Phải tách 2 set issue: con-của-epic (rollup) vs standalone-overdue (risk).

## Mở / sang sau
- Stale PR pattern chưa E2E được (PR seed age 0, ngưỡng 7 ngày) — đã có UT.
- Epic >100 child: hiện chỉ log cảnh báo, chưa paginate.
- Test data seed (Jira SCRUM-5..21, OKR page 98466, PR #1/#2) đang GIỮ — dọn sau nếu cần.
- Sang Phase 4 (Resource+Cost) hoặc theo ưu tiên chủ dự án.
