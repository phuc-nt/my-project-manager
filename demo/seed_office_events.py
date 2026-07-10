"""Seed the DEMO office timeline — run by `scripts/demo-mode.sh on` AFTER the demo
fixtures are swapped in (fresh office_room.sqlite3).

Every event goes through the PRODUCTION writer (`append_office_event` → projection
allowlist → store → SSE), and follows the real emit order the ticker/step-runner use
(a dispatch `step_status` WITHOUT attempt_id precedes any phase event that carries one
— otherwise the FE's zombie-attempt guard rightly drops the phase). The story leaves
the 3D office in a LIVING end-state for a demo walk-in:

  - nghien-cuu: done (handoff xanh lá) — nghiên cứu thị trường đã bàn giao
  - phan-tich: working + đang tham vấn nghien-cuu (💬 hai phía, avatar đi lại gần nhau)
  - noi-dung: working, phase "đang sửa" (bị kiểm định trả về 2 lỗi)
  - kiem-dinh: done (vừa soát chéo xong, verdict cần sửa)
  - thiet-ke: vừa được điều phối giao bước (bàn cam "đang làm", chưa có phase)
"""

from src.runtime.office_room_append import append_office_event

TASK_ID = "demo-ra-mat-tro-ly-ai"
TASK = "Chuẩn bị bộ tài liệu ra mắt sản phẩm Trợ lý AI Văn Phòng"


def _ev(author: str, kind: str, body: dict) -> None:
    append_office_event(TASK_ID, author=author, kind=kind, body=body, also_office=True)


def _dispatch(agent: str, step: str) -> None:
    _ev("coordinator", "step_status",
        {"task_title": TASK, "step_title": step, "status": "started", "assigned_to": agent})


def _phase(agent: str, step: str, phase: str, attempt: str) -> None:
    _ev(agent, "step_status",
        {"task_title": TASK, "step_title": step, "status": "started",
         "assigned_to": agent, "phase": phase, "attempt_id": attempt})


def main() -> None:
    _ev("ceo", "ceo", {"text": "Giao đội: chuẩn bị bộ tài liệu ra mắt Trợ lý AI Văn Phòng "
                               "— nghiên cứu thị trường, phân tích đối thủ, viết nội dung, "
                               "kiểm định trước khi công bố."})
    _ev("coordinator", "assignment",
        {"task_title": TASK, "step_count": 5,
         "summary": "5 bước: nghiên cứu → phân tích ∥ nội dung → kiểm định → thiết kế"})

    # nghien-cuu: làm xong, bàn giao (desk xanh lá)
    _dispatch("nghien-cuu", "Nghiên cứu thị trường trợ lý AI")
    _phase("nghien-cuu", "Nghiên cứu thị trường trợ lý AI", "dang-lam", "demo-nc-1")
    _phase("nghien-cuu", "Nghiên cứu thị trường trợ lý AI", "tu-soat", "demo-nc-1")
    _ev("nghien-cuu", "handoff",
        {"task_title": TASK, "step_title": "Nghiên cứu thị trường trợ lý AI",
         "assigned_to": "nghien-cuu",
         "message": "[Nghiên cứu thị trường] Thị trường trợ lý AI văn phòng tăng ~40%/năm; "
                    "3 đối thủ chính; nhu cầu mạnh nhất ở doanh nghiệp 1-20 người."})

    # noi-dung: viết nội dung → kiểm định soát chéo trả về 2 lỗi → đang sửa
    _dispatch("noi-dung", "Viết nội dung giới thiệu sản phẩm")
    _phase("noi-dung", "Viết nội dung giới thiệu sản phẩm", "dang-lam", "demo-nd-1")
    _phase("noi-dung", "Viết nội dung giới thiệu sản phẩm", "tu-soat", "demo-nd-1")
    _ev("noi-dung", "handoff",
        {"task_title": TASK, "step_title": "Viết nội dung giới thiệu sản phẩm",
         "assigned_to": "noi-dung",
         "message": "[Nội dung giới thiệu] Bản nháp 1: thông điệp chính, 3 lợi ích, lời kêu gọi."})
    _dispatch("kiem-dinh", "Soát chéo: Viết nội dung giới thiệu sản phẩm")
    _ev("kiem-dinh", "review",
        {"task_title": TASK, "step_title": "Soát chéo: Viết nội dung giới thiệu sản phẩm",
         "verdict": "needs_rework", "failure_count": 2, "assigned_to": "kiem-dinh"})
    _dispatch("noi-dung", "Sửa theo soát chéo: nội dung giới thiệu")
    _phase("noi-dung", "Sửa theo soát chéo: nội dung giới thiệu", "dang-sua", "demo-nd-2")

    # thiet-ke: mới được điều phối giao bước (chưa chạy phase nào)
    _ev("coordinator", "assignment",
        {"task_title": TASK, "step_count": 1,
         "summary": "Bước kế: thiết kế bố cục tài liệu (chờ nội dung chốt)"})
    _dispatch("thiet-ke", "Thiết kế bố cục tài liệu ra mắt")

    _ev("coordinator", "milestone",
        {"task_id": TASK_ID, "task_title": TASK, "milestone": "2/5 bước hoàn thành",
         "message": "Nghiên cứu + phân tích số liệu gốc đã xong; nội dung đang sửa vòng 1."})

    # phan-tich: đang làm + THAM VẤN nghien-cuu — để CUỐI CÙNG (không event nào của 2
    # desk này theo sau) nên bubble 💬 + avatar đi-lại-gần-nhau còn sống khi mở demo.
    _dispatch("phan-tich", "Phân tích đối thủ cạnh tranh")
    _phase("phan-tich", "Phân tích đối thủ cạnh tranh", "dang-lam", "demo-pt-1")
    _ev("phan-tich", "consult",
        {"from": "phan-tich", "to": "nghien-cuu",
         "question_summary": "Số liệu thị phần 3 đối thủ lấy từ nguồn nào để trích dẫn?",
         "answer_summary": "Dùng báo cáo Q2 ngành + trang pricing công khai của từng bên.",
         "attempt_id": "demo-pt-1"})

    print(f"Seeded demo office timeline (room {TASK_ID} + office).")


if __name__ == "__main__":
    main()
