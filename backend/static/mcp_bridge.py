#!/usr/bin/env python3
"""discovery-mcp-bridge: stdio ↔ HTTP MCP shim.

Why this exists: Claude Code's MCP SDK enforces OAuth 2.1 discovery
on streamable-HTTP transports. With our PAT-only auth model the
OAuth dance fails before bearer headers ever apply. Wrapping the
HTTP endpoint in stdio sidesteps the entire OAuth flow — Claude Code
spawns this as a local process, talks JSON-RPC over stdin/stdout,
and we forward each request to the backend with the PAT in the
Authorization header.

Env (set in .mcp.json):
  DISCOVERY_MCP_URL   — full URL to /mcp/{project_id}
  DISCOVERY_PAT       — dsc_… token from /bootstrap

Distributed by the backend at /mcp-bridge.py. The discovery CLI
downloads it to ~/.local/share/discovery/mcp-bridge.py during setup.

Limitations:
  - Server-initiated notifications (tools/list-changed, etc.) aren't
    delivered. Tool call request/response works fully.
  - One blocking POST per stdin message; no parallel inflight calls.
    Fine for the discovery agent's serial tool-call loop.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _err(msg: str) -> None:
    sys.stderr.write(f"discovery-mcp-bridge: {msg}\n")
    sys.stderr.flush()


def _parse_response(body: str) -> str | None:
    """Body may be plain JSON or SSE-framed (one or more
    `data: <json>\\n\\n` blocks). Return the first JSON payload."""
    body = body.strip()
    if not body:
        return None
    if body.startswith("{") or body.startswith("["):
        return body
    for line in body.splitlines():
        if line.startswith("data: "):
            return line[6:].strip()
    return None


def _forward(url: str, token: str, request_line: str) -> dict | None:
    req = urllib.request.Request(
        url,
        data=request_line.encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "User-Agent": "discovery-mcp-bridge/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        _err(f"HTTP {e.code} on POST: {body[:200]}")
        # Pass the response through if it's a JSON-RPC error envelope
    except Exception as e:
        _err(f"upstream error: {e}")
        return None

    parsed = _parse_response(body)
    if parsed is None:
        return None
    try:
        return json.loads(parsed)
    except json.JSONDecodeError as e:
        _err(f"could not parse upstream response as JSON: {e}; body: {body[:200]}")
        return None


def main() -> int:
    url = os.environ.get("DISCOVERY_MCP_URL")
    token = os.environ.get("DISCOVERY_PAT")
    if not url or not token:
        _err("DISCOVERY_MCP_URL and DISCOVERY_PAT must both be set in env")
        return 2

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        # Only forward request messages; emit JSON-RPC error envelopes
        # locally for malformed input rather than ferrying noise to the
        # backend.
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            _err(f"ignoring non-JSON input: {line[:80]}")
            continue
        msg_id = msg.get("id")
        # Notifications (no id) — forward and discard response.
        # Requests — forward and emit the response.
        result = _forward(url, token, line)
        if msg_id is None:
            continue
        if result is None:
            _emit({
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32603, "message": "bridge: upstream returned no parseable response"},
            })
            continue
        _emit(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
