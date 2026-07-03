"""CEO chat-ops command catalog (v6 M14). The hard ceiling of what chat can administer.

Like the M12 chat-command catalog, this is CODE, not prompt: the LLM only fills slots,
CODE validates them and calls the existing admin primitives. The catalog here is fixed
in core (not pack-contributed) — administering the fleet is a platform concern, not a
domain one. NO destructive command is declared (no delete-agent via chat — M14 decision),
so a prompt-injected "xóa hết agent" has no catalog entry to hit.

Each command:
- `description`: shown to the CEO when listing / when a command is unsupported.
- `slots`: ordered {name: {prompt, required, ...}} — the engine asks for each missing
  required slot one at a time (slot-filling). A slot rule mirrors M12's arg schema
  (required / max_len / pattern / choices).
- `run(slots)`: CODE that performs the admin write AFTER the CEO confirms. Returns a
  human summary string. Raises ValueError with a user-facing message on a bad slot value
  the schema could not catch (e.g. unknown domain).
- `preview(slots)`: the confirmation text shown before `run` — the CEO sees exactly what
  will change.
- `readonly`: True for status/cost queries — these skip the confirm step (no write).
"""

from __future__ import annotations

from typing import Any


def _run_create_agent(slots: dict[str, str]) -> str:
    """Create an agent via the SAME primitive the web wizard uses (agent_create)."""
    from src.server import agent_create

    spec: dict[str, Any] = {
        "id": slots["id"],
        "name": slots.get("name") or slots["id"],
        "domain": slots["domain"],
        "reports": [r.strip() for r in slots["reports"].split(",") if r.strip()],
    }
    jira_key = slots.get("jira_project_key")
    if jira_key:
        spec["bindings"] = {"jira": {"project_key": jira_key}}
    try:
        created = agent_create.create_agent(spec)
    except agent_create.ValidationError as exc:
        raise ValueError(f"cấu hình chưa hợp lệ: {exc}") from None
    except agent_create.ConflictError as exc:
        raise ValueError(f"trùng agent: {exc}") from None
    return (
        f"Đã tạo agent '{created['id']}' (domain {created['domain']}, "
        f"báo cáo: {', '.join(created['reports'])}). Nhớ điền token vào .env trước khi bật chạy."
    )


def _preview_create_agent(slots: dict[str, str]) -> str:
    lines = [
        "Mình sẽ TẠO một agent mới:",
        f"- Mã (id): {slots['id']}",
        f"- Tên: {slots.get('name') or slots['id']}",
        f"- Vai trò (domain): {slots['domain']}",
        f"- Báo cáo: {slots['reports']}",
    ]
    if slots.get("jira_project_key"):
        lines.append(f"- Jira project: {slots['jira_project_key']}")
    lines.append("\nXác nhận tạo? (trả lời: xác nhận / huỷ)")
    return "\n".join(lines)


def _state_is_on(state: str) -> bool:
    """The `state` slot is normalized to 'on'/'off' by the choices map before it reaches here."""
    return state.strip().lower() == "on"


def _run_set_enabled(slots: dict[str, str]) -> str:
    from src.runtime.registry_edit import UnknownRegistryAgentError, set_registry_enabled

    on = _state_is_on(slots["state"])
    try:
        set_registry_enabled(None, slots["agent_id"], on)
    except UnknownRegistryAgentError:
        raise ValueError(f"không có agent '{slots['agent_id']}' trong registry") from None
    return f"Đã {'BẬT' if on else 'TẮT'} agent '{slots['agent_id']}'."


def _preview_set_enabled(slots: dict[str, str]) -> str:
    on = _state_is_on(slots["state"])
    return (f"Mình sẽ {'BẬT' if on else 'TẮT'} agent '{slots['agent_id']}'.\n"
            "Xác nhận? (trả lời: xác nhận / huỷ)")


def _run_get_cost(slots: dict[str, str]) -> str:
    """Read-only fleet cost rollup from the generic accessor (M8 data — plain dicts)."""
    from src.runtime.agent_state_reader import read_all_agent_states

    states = read_all_agent_states()
    if not states:
        return "Chưa có agent nào để tính chi phí."
    lines = ["Chi phí LLM tháng này theo agent:"]
    total = 0.0
    for st in states:
        spent = float(st.get("budget_spent_usd") or 0.0)
        total += spent
        cap = st.get("budget_cap_usd") or 0.0
        cap_txt = f"/${cap:.0f}" if cap else ""
        lines.append(f"- {st.get('agent_id', '?')}: ${spent:.4f}{cap_txt}")
    lines.append(f"Tổng: ${total:.4f}")
    return "\n".join(lines)


def _run_get_status(slots: dict[str, str]) -> str:
    """Read-only fleet status: agent count, enabled, pending approvals, alerts."""
    from src.runtime.agent_state_reader import read_all_agent_states, team_alerts

    states = read_all_agent_states()
    if not states:
        return "Chưa có agent nào."
    lines = [f"Đội hiện có {len(states)} agent:"]
    for st in states:
        pend = len(st.get("pending_approvals") or [])
        pend_txt = f", {pend} việc chờ duyệt" if pend else ""
        on = "bật" if st.get("enabled") else "tắt"
        lines.append(f"- {st.get('agent_id', '?')} ({on}){pend_txt}")
    alerts = team_alerts(states)
    if alerts:
        lines.append(f"\n⚠️ {len(alerts)} cảnh báo — xem /approvals & dashboard.")
    return "\n".join(lines)


#: command_id → spec. slots = ordered {name: {prompt, required, max_len?, pattern?}}.
OPS_COMMANDS: dict[str, dict] = {
    "create_agent": {
        "description": "Tạo một nhân sự ảo (agent) mới cho đội",
        "readonly": False,
        "slots": {
            "id": {"prompt": "Mã định danh agent (chữ thường/số/gạch, vd 'sales-team')?",
                   "required": True, "max_len": 40, "pattern": r"[a-z0-9][a-z0-9_-]*",
                   "lower": True,
                   "hint": "một mã kỹ thuật viết thường, không dấu, không khoảng trắng "
                           "(vd 'sales-pm')"},
            "domain": {"prompt": "Vai trò của agent? (pm = quản lý dự án, hr = nhân sự, "
                                 "admin = giám sát đội)", "required": True, "max_len": 20,
                       "choices": {
                           "pm": ("quản lý dự án", "quan ly du an", "project", "dự án", "du an"),
                           "hr": ("nhân sự", "nhan su", "human resources", "tuyển dụng"),
                           "admin": ("giám sát", "giam sat", "vận hành", "van hanh", "quản trị"),
                       },
                       "hint": "đúng MỘT mã: pm, hr, hoặc admin"},
            "reports": {"prompt": "Loại báo cáo agent sẽ làm (vd 'daily' cho pm, "
                                  "'headcount' cho hr)? Nhiều loại cách nhau bởi dấu phẩy.",
                        "required": True, "max_len": 100, "lower": True,
                        "hint": "mã báo cáo VIẾT THƯỜNG cách nhau bởi dấu phẩy (vd 'daily' "
                                "hoặc 'daily,weekly')"},
            "name": {"prompt": "Tên hiển thị (tuỳ chọn, bỏ qua để dùng mã)?",
                     "required": False, "max_len": 60},
            "jira_project_key": {"prompt": "Mã Jira project (tuỳ chọn, vd 'SCRUM')?",
                                 "required": False, "max_len": 20},
        },
        "run": _run_create_agent,
        "preview": _preview_create_agent,
    },
    "set_enabled": {
        "description": "Bật hoặc tắt một agent",
        "readonly": False,
        "slots": {
            "agent_id": {"prompt": "Bật/tắt agent nào (mã agent)?", "required": True,
                         "max_len": 40, "lower": True},
            "state": {"prompt": "Bật hay tắt?", "required": True, "max_len": 10,
                      "choices": {"on": ("bật", "bat", "mở", "mo", "enable", "chạy", "chay"),
                                  "off": ("tắt", "tat", "dừng", "dung", "disable", "ngừng")},
                      "hint": "đúng MỘT mã: on hoặc off"},
        },
        "run": _run_set_enabled,
        "preview": _preview_set_enabled,
    },
    "get_status": {
        "description": "Xem trạng thái cả đội (số agent, việc chờ duyệt, cảnh báo)",
        "readonly": True,
        "slots": {},
        "run": _run_get_status,
    },
    "get_cost": {
        "description": "Xem chi phí LLM của cả đội tháng này",
        "readonly": True,
        "slots": {},
        "run": _run_get_cost,
    },
}


def command_listing() -> str:
    """One-line catalog for the CEO when a request is unsupported."""
    return "; ".join(f"`{cid}` — {spec['description']}" for cid, spec in OPS_COMMANDS.items())


def get_command(command_id: str) -> dict | None:
    return OPS_COMMANDS.get(command_id)
