"""Tool label / type helpers shared by web chat and reminder prep so both
surfaces show the same human-friendly labels ('Read foo.md', 'get gaps').

Originally inline in `app/api/chat.py`; extracted here when the reminder
prep pipeline needed to emit the same segments/toolCalls shape so the web
chat renderer's expand badge ('1 action · 2 thinking') lights up for
reminder-sourced messages as well.
"""

from __future__ import annotations


def tool_label(tool_name: str, tool_input: dict) -> str:
    """Build a human-friendly tool label like Claude Code shows."""
    name = tool_name.replace("mcp__discovery__", "")

    if tool_name == "Read":
        path = tool_input.get("file_path", "")
        short = path.rsplit("/", 1)[-1] if "/" in path else path
        return f"Read {short}" if short else "Read file"
    if tool_name == "Grep":
        pattern = tool_input.get("pattern", "")
        return f"Grep '{pattern[:30]}'" if pattern else "Grep"
    if tool_name == "Glob":
        pattern = tool_input.get("pattern", "")
        return f"Glob {pattern[:30]}" if pattern else "Glob"
    if tool_name == "Bash":
        cmd = tool_input.get("command", "")
        return f"Bash: {cmd[:35]}" if cmd else "Bash"
    if tool_name == "Edit":
        path = tool_input.get("file_path", "")
        short = path.rsplit("/", 1)[-1] if "/" in path else path
        return f"Edit {short}" if short else "Edit file"
    if tool_name == "Write":
        path = tool_input.get("file_path", "")
        short = path.rsplit("/", 1)[-1] if "/" in path else path
        return f"Write {short}" if short else "Write file"
    if tool_name == "ToolSearch":
        return "searching tools"
    return name.replace("_", " ")


def tool_type(tool_name: str) -> str:
    """Classify tool into a type for UI badge coloring."""
    if tool_name.startswith("mcp__"):
        return "mcp"
    if tool_name in ("Read", "Grep", "Glob"):
        return "read"
    if tool_name in ("Edit", "Write"):
        return "write"
    if tool_name == "Bash":
        return "bash"
    if tool_name == "ToolSearch":
        return "search"
    return "other"
