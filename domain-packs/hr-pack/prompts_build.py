"""hr-pack prompt builder (v3 M6 S3).

Builds the LLM messages for the headcount narrative. The system prompt is a pack asset
(`prompts/headcount-narrative-system.md`, loaded via the same `load_pack_prompt` the PM
pack uses); the builder logic lives here in the pack. The LLM writes ONLY the qualitative
narrative — every count is rendered deterministically by the analyzer (Phase-1 lesson).

Persona/project/memory are injected on the INTERNAL path exactly as PM does, reusing the
core `prepend_persona` / `build_context_block` (so the external PII red line is identical).
"""

from __future__ import annotations

from src.packs.registry import load_pack_prompt
from src.profile.context import build_context_block, prepend_persona

_SYSTEM = load_pack_prompt("hr", "headcount-narrative-system")


def build_headcount_narrative_messages(
    report, *, report_date: str, persona: str = "", project: str = "", memory: str = ""
) -> list[dict]:
    """Messages for the headcount narrative (internal audience).

    Feeds the model the DETERMINISTIC counts as context and asks for a short qualitative
    summary — it must not invent numbers. Persona goes to the system message; project+
    memory prepend the user message (internal only).
    """
    status_lines = "\n".join(f"- {g.label}: {g.count}" for g in report.by_status)
    dept_lines = "\n".join(f"- {g.label}: {g.count}" for g in report.by_department)
    facts = (
        f"Ngày báo cáo: {report_date}\n"
        f"Tổng nhân sự: {report.total}\n\n"
        f"Theo trạng thái:\n{status_lines or '- (không có)'}\n\n"
        f"Theo phòng ban:\n{dept_lines or '- (không có)'}"
    )
    context_block = build_context_block(project, memory)
    user = (
        f"{context_block}Dưới đây là số liệu nhân sự đã tính sẵn. Viết MỘT đoạn tóm tắt "
        f"định tính ngắn (2-4 câu) về tình hình nhân sự — KHÔNG lặp lại con số cụ thể "
        f"(bảng đã có riêng), chỉ nêu xu hướng/điểm đáng chú ý.\n\n{facts}"
    )
    return [
        {"role": "system", "content": prepend_persona(_SYSTEM, persona)},
        {"role": "user", "content": user},
    ]
