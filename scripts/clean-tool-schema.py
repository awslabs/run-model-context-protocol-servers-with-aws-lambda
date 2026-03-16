#!/usr/bin/env python3
"""Clean MCP tool schema for AgentCore Gateway compatibility.

Some MCP servers generate tool schemas with features that AgentCore Gateway
doesn't support. This script cleans up:
- "default": null -> removed
- "items": {} -> {"type": "string"}
- anyOf with {"type": "null"} -> removed, flattened if single item remains

Usage:
    python3 scripts/clean-tool-schema.py tool-schema.json
"""

import json
import sys


def clean(obj):
    if isinstance(obj, dict):
        if "default" in obj and obj["default"] is None:
            del obj["default"]
        if "items" in obj and obj["items"] == {}:
            obj["items"] = {"type": "string"}
        if "anyOf" in obj:
            obj["anyOf"] = [i for i in obj["anyOf"] if not (isinstance(i, dict) and i.get("type") == "null")]
            if len(obj["anyOf"]) == 1:
                item = obj["anyOf"].pop()
                del obj["anyOf"]
                obj.update(item)
        for v in obj.values():
            clean(v)
    elif isinstance(obj, list):
        for i in obj:
            clean(i)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <tool-schema.json>", file=sys.stderr)
        sys.exit(1)

    filepath = sys.argv[1]
    with open(filepath) as f:
        data = json.load(f)

    clean(data)

    # Extract just the tools array if wrapped
    if "tools" in data:
        data = data["tools"]

    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)

    print(f"Cleaned {filepath}")
