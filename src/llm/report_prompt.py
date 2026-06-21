"""Prompt for composing the progress report (kept out of graph code).

Provider-agnostic: builds a plain message list for `llm.complete`. Follows the
design guidelines — Vietnamese, lead-with-signal (risks first), actionable,
no raw data dumps.

Output targets Slack **mrkdwn** (NOT GitHub markdown): `*bold*` with single
asterisks, `_italic_`, `•` bullets, no `#` headings and no `**`. The caller
passes the real report date so the model never invents a date placeholder.
"""

from __future__ import annotations

from src.tools.models import Risk

_SYSTEM = (
    "Bạn là một PM/SM giỏi, viết báo cáo tiến độ ngắn gọn, thực dụng, bằng tiếng Việt. "
    "Mở đầu bằng rủi ro quan trọng nhất (lead with the signal), mỗi rủi ro kèm hành động "
    "cần làm (ai/cái gì). Không dump dữ liệu thô. Dựa hoàn toàn vào dữ liệu được cung cấp, "
    "không bịa số liệu. Nếu không có rủi ro, nói rõ tiến độ ổn.\n\n"
    "ĐỊNH DẠNG: chỉ dùng Slack mrkdwn — *đậm* (một dấu sao), _nghiêng_, `code`, và "
    "bullet bằng ký tự •. TUYỆT ĐỐI KHÔNG dùng cú pháp Markdown của GitHub: không có "
    "# hay ## heading, không có ** (hai sao), không có gạch đầu dòng bằng '-'. "
    "Không tự chèn placeholder ngày/giờ (vd $(date) hay [Hôm nay]) — dùng đúng ngày được cung cấp."
)


def _format_risks(risks: list[Risk]) -> str:
    if not risks:
        return "Không phát hiện rủi ro từ dữ liệu Jira/GitHub."
    lines = []
    for r in risks:
        lines.append(
            f"- [{r.severity.upper()}] {r.kind} · {r.subject}: {r.detail} "
            f"→ Gợi ý: {r.suggested_action}"
        )
    return "\n".join(lines)


def build_report_messages(risks: list[Risk], *, report_date: str) -> list[dict[str, str]]:
    """Build the chat messages for the report-composing LLM call.

    `report_date` is the real date string (e.g. '2026-06-21'); it is embedded so
    the model uses it verbatim instead of inventing a placeholder.
    """
    user = (
        f"Viết báo cáo tiến độ cho team ngày {report_date}, dựa trên các tín hiệu rủi ro sau "
        f"(đã sắp xếp theo mức độ):\n\n{_format_risks(risks)}\n\n"
        "Yêu cầu: ngắn gọn, mở đầu bằng rủi ro nghiêm trọng nhất, mỗi mục có hành động đề xuất. "
        "Tiêu đề báo cáo in đậm bằng *một dấu sao*. Bullet bằng •. "
        "Nhớ: KHÔNG dùng #, ##, ** hay '-'."
    )
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]
