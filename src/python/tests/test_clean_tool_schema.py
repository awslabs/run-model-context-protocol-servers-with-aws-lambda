"""Tests for the repo-root ``scripts/clean-tool-schema.py`` utility.

The script lives at the repository root (outside the Python package) and has a
hyphenated filename, so it is loaded here via ``importlib`` to exercise its
``clean()`` function directly. The script strips schema constructs that
AgentCore Gateway rejects with strict validation: ``"items": {}``,
``"default": null``, and ``anyOf`` entries of ``{"type": "null"}``.
"""

import copy
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

# scripts/clean-tool-schema.py is at <repo-root>/scripts/, four levels up from
# this file: tests/ -> python/ -> src/ -> <repo-root>.
SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "clean-tool-schema.py"


def _load_clean():
    spec = importlib.util.spec_from_file_location("clean_tool_schema", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.clean


clean = _load_clean()


def _walk(obj):
    """Yield every dict node in a nested JSON structure."""
    if isinstance(obj, dict):
        yield obj
        for value in obj.values():
            yield from _walk(value)
    elif isinstance(obj, list):
        for item in obj:
            yield from _walk(item)


def _has_bare_items(obj) -> bool:
    return any(node.get("items") == {} for node in _walk(obj))


def _has_null_type(obj) -> bool:
    return any(node.get("type") == "null" for node in _walk(obj))


def test_optional_array_flattened_items_are_not_left_bare():
    """An optional array (anyOf array|null) must not leave ``items: {}``.

    This is the most common real case: an optional array param. Flattening the
    anyOf surfaces ``{"type": "array", "items": {}}`` into the parent dict, and
    the surfaced ``items: {}`` must still be normalized to a typed schema.
    """
    schema = {
        "anyOf": [
            {"type": "array", "items": {}},
            {"type": "null"},
        ],
        "default": None,
    }
    clean(schema)

    assert not _has_bare_items(schema), f"bare items survived: {schema}"
    assert schema.get("type") == "array"
    assert schema["items"] == {"type": "string"}
    assert "anyOf" not in schema
    assert "default" not in schema


def test_nested_anyof_leaves_no_residual_null_type():
    """anyOf nested inside anyOf must be fully resolved, leaving no null type."""
    schema = {
        "anyOf": [
            {
                "anyOf": [
                    {"type": "array", "items": {}},
                    {"type": "null"},
                ]
            },
            {"type": "null"},
        ]
    }
    clean(schema)

    assert not _has_null_type(schema), f"residual null type survived: {schema}"
    assert not _has_bare_items(schema), f"bare items survived: {schema}"


def test_plain_default_null_is_removed():
    schema = {"type": "string", "default": None}
    clean(schema)
    assert "default" not in schema
    assert schema == {"type": "string"}


def test_bare_items_normalized_to_string():
    schema = {"type": "array", "items": {}}
    clean(schema)
    assert schema == {"type": "array", "items": {"type": "string"}}


def test_anyof_with_two_real_members_keeps_anyof():
    """When more than one non-null member remains, anyOf is preserved."""
    schema = {
        "anyOf": [
            {"type": "string"},
            {"type": "integer"},
            {"type": "null"},
        ]
    }
    clean(schema)
    assert "anyOf" in schema
    assert {"type": "string"} in schema["anyOf"]
    assert {"type": "integer"} in schema["anyOf"]
    assert not _has_null_type(schema)


def test_idempotent_on_already_clean_schema():
    """A schema with no offending constructs must be returned unchanged."""
    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["name"],
    }
    original = copy.deepcopy(schema)
    clean(schema)
    assert schema == original

    # And cleaning a cleaned result is a no-op (fixed point reached).
    once = {
        "anyOf": [{"type": "array", "items": {}}, {"type": "null"}],
        "default": None,
    }
    clean(once)
    twice = copy.deepcopy(once)
    clean(twice)
    assert once == twice


def _run_cli(tmp_path, payload):
    """Run the script's CLI against ``payload`` and return the rewritten JSON."""
    target = tmp_path / "tool-schema.json"
    target.write_text(json.dumps(payload))
    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), str(target)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "Cleaned" in result.stdout
    return json.loads(target.read_text())


def test_cli_unwraps_tools_object_to_array(tmp_path):
    """The ``{"tools": [...]}`` wrapper is unwrapped to a bare tools array."""
    payload = {
        "tools": [
            {
                "name": "list_items",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "tags": {
                            "anyOf": [{"type": "array", "items": {}}, {"type": "null"}],
                            "default": None,
                        }
                    },
                },
            }
        ]
    }
    out = _run_cli(tmp_path, payload)
    assert isinstance(out, list)
    assert out[0]["inputSchema"]["properties"]["tags"] == {
        "type": "array",
        "items": {"type": "string"},
    }


def test_cli_handles_bare_array_input(tmp_path):
    """A top-level array (not wrapped in ``{"tools": ...}``) is cleaned in place.

    Exercises the ``isinstance(data, dict)`` guard: a list has no ``"tools"``
    key, and ``"tools" in [list]`` would raise without the guard.
    """
    payload = [
        {
            "name": "list_items",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tags": {
                        "anyOf": [{"type": "array", "items": {}}, {"type": "null"}],
                    }
                },
            },
        }
    ]
    out = _run_cli(tmp_path, payload)
    assert isinstance(out, list)
    assert out[0]["inputSchema"]["properties"]["tags"] == {
        "type": "array",
        "items": {"type": "string"},
    }
