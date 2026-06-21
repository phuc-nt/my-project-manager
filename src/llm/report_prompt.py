"""Prompt for composing the progress report (kept out of graph code).

Provider-agnostic: builds a plain message list for `llm.complete`. Follows the
design guidelines — Vietnamese, lead-with-signal (risks first), actionable,
no raw data dumps.
"""

from __future__ import annotations

from src.tools.models import Risk

_SYSTEM = (
    "Bạn là một PM/SM giỏi, viết báo cáo tiến độ ngắn gọn, thực dụng, bằng tiếng Việt. "
    "Mở đầu bằng rủi ro quan trọng nhất (lead with the signal), mỗi rủi ro kèm hành động "
    "cần làm (ai/cái gì). Không dump dữ liệu thô. Dựa hoàn toàn vào dữ liệu được cung cấp, "
    "không bịa số liệu. Nếu không có rủi ro, nói rõ tiến độ ổn."
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


def build_report_messages(risks: list[Risk], *, period_label: str) -> list[dict[str, str]]:
    """Build the chat messages for the report-composing LLM call."""
    user = (
        f"Viết báo cáo tiến độ ({period_label}) cho team, dựa trên các tín hiệu rủi ro sau "
        f"(đã sắp xếp theo mức độ):\n\n{_format_risks(risks)}\n\n"
        "Yêu cầu: ngắn gọn, mở đầu bằng rủi ro nghiêm trọng nhất, mỗi mục có hành động đề xuất. "
        "Định dạng Slack markdown đơn giản (gạch đầu dòng, *đậm* cho tiêu đề)."
    )
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]
