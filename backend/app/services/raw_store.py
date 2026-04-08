"""Raw source storage for the in-vault `.raw/` directory.

When a document arrives via Gmail / Drive / upload / Slack, we save the
ORIGINAL payload to `.memory-bank/.raw/{source}/` so the human reading
the discovery wiki in Obsidian can always click back to the source.

Two writers:

- `save_gmail_raw(...)` — writes a structured markdown envelope of an
  email message (headers + body + raw JSON payload) so the file is
  human-readable in Obsidian instead of opaque base64.
- `save_binary_raw(...)` — writes file bytes as-is (PDFs, DOCXs, Drive
  exports). Used by Drive imports and manual uploads.

Both return the path to the written file. The pipeline writer reads
this path from the Document.classification and turns it into a
`source_raw:` frontmatter line on every derived requirement/gap/etc.,
so backlinks resolve inside Obsidian.
"""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any


def safe_filename(name: str, max_len: int = 80) -> str:
    """Sanitize a string into something safe for a filesystem name."""
    cleaned = re.sub(r"[^\w\-.\s]+", "_", name).strip()
    cleaned = re.sub(r"\s+", "_", cleaned)
    return cleaned[:max_len] or "untitled"


def save_gmail_raw(
    project_id: uuid.UUID,
    message: dict[str, Any],
    body_text: str,
) -> Path:
    """Write a Gmail message to `.raw/gmail/{message_id}.md`.

    Format: YAML frontmatter with headers, then the parsed body, then
    the full raw JSON payload as a code block. Idempotent — overwrites
    if the file already exists (latest fetch wins)."""
    from app.agent.claude_runner import claude_runner

    raw_dir = claude_runner.get_raw_dir(project_id, "gmail")
    mid = message.get("id", "unknown")
    headers_map = {h["name"]: h["value"] for h in message.get("payload", {}).get("headers", [])}
    subject = headers_map.get("Subject", "(no subject)")

    fm_lines = [
        "---",
        "source: gmail",
        f"message_id: {mid}",
        f"thread_id: {message.get('threadId', '')}",
        f'from: "{_escape(headers_map.get("From", ""))}"',
        f'to: "{_escape(headers_map.get("To", ""))}"',
        f'cc: "{_escape(headers_map.get("Cc", ""))}"',
        f'date: "{headers_map.get("Date", "")}"',
        f'subject: "{_escape(subject)}"',
        f"label_ids: {message.get('labelIds', [])}",
        "category: raw-source",
        "tags: [raw, gmail]",
        "---",
        "",
        f"# {subject}",
        "",
        f"**From:** {headers_map.get('From', '')}  ",
        f"**To:** {headers_map.get('To', '')}  ",
        f"**Date:** {headers_map.get('Date', '')}",
        "",
        "---",
        "",
        "## Body",
        "",
        body_text or "(no body)",
        "",
        "---",
        "",
        "## Headers",
        "",
    ]
    for h in message.get("payload", {}).get("headers", []):
        fm_lines.append(f"- **{h['name']}**: {h.get('value', '')}")
    fm_lines.extend([
        "",
        "## Raw payload",
        "",
        "```json",
        json.dumps(_strip_b64_data(message), indent=2)[:50_000],
        "```",
    ])

    out = raw_dir / f"{safe_filename(mid)}.md"
    out.write_text("\n".join(fm_lines), encoding="utf-8")
    return out


def save_binary_raw(
    project_id: uuid.UUID,
    source: str,
    name: str,
    content: bytes,
    extra_id: str | None = None,
) -> Path:
    """Write file bytes to `.raw/{source}/[id__]name`.

    Used by Drive imports (PDFs, DOCXs, exported markdown) and manual
    uploads. `extra_id` is prepended when present (Drive file IDs make
    duplicates impossible). Returns the written path.
    """
    from app.agent.claude_runner import claude_runner

    raw_dir = claude_runner.get_raw_dir(project_id, source)
    safe = safe_filename(name)
    if extra_id:
        out = raw_dir / f"{safe_filename(extra_id, 32)}__{safe}"
    else:
        out = raw_dir / safe
    out.write_bytes(content)
    return out


def relative_source_raw(raw_path: Path, derived_dir: Path) -> str:
    """Compute a relative path from a derived note's directory to a .raw
    file, suitable for an Obsidian-clickable `source_raw:` frontmatter
    backlink. Returns POSIX-style with no leading dot."""
    import os
    try:
        rel = os.path.relpath(raw_path, derived_dir)
    except ValueError:
        # Different drives on Windows — fall back to absolute
        return str(raw_path)
    return Path(rel).as_posix()


def _escape(s: str) -> str:
    return s.replace('"', '\\"')


def _strip_b64_data(message: dict[str, Any]) -> dict[str, Any]:
    """Recursively replace `body.data` (base64 blobs) with a marker so
    the JSON dump in the raw file stays readable."""
    def walk(node):
        if isinstance(node, dict):
            return {
                k: ("<base64 omitted>" if k == "data" and isinstance(v, str) and len(v) > 200 else walk(v))
                for k, v in node.items()
            }
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node
    return walk(message)
