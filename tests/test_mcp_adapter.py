"""MCP adapter: result coercion + tool-by-name lookup (no real subprocess)."""

from __future__ import annotations

from src.adapters.mcp_adapter import _coerce_result


def test_coerce_json_string():
    assert _coerce_result('{"a": 1}') == {"a": 1}


def test_coerce_plain_string_passthrough():
    assert _coerce_result("hello") == "hello"


def test_coerce_message_content():
    class Msg:
        content = '{"x": 2}'

    assert _coerce_result(Msg()) == {"x": 2}


def test_coerce_message_plain_content():
    class Msg:
        content = "plain"

    assert _coerce_result(Msg()) == "plain"


def test_coerce_already_dict():
    assert _coerce_result({"k": "v"}) == {"k": "v"}
