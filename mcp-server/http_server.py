"""HTTP transport for the Discovery MCP — wraps the same tool registry
as ``db_server.py`` so a remote (laptop) Claude Code can talk to it
over streamable-HTTP instead of installing a local stdio binary.

The single ``Server`` instance + ``@server.list_tools()`` /
``@server.call_tool()`` handlers live in ``db_server`` (~2900 LoC, not
worth refactoring just for this). We import them as a module — the
import is side-effect-free aside from registering tool handlers on the
shared ``Server`` object, which is exactly what we want.

Per-request project/user context is plumbed via ContextVars set on the
FastAPI side (``backend/app/api/mcp_proxy.py``); the tool handlers
already read those vars first via ``HTTP_PROJECT_ID`` and
``HTTP_TOKEN_IDENTITY`` in db_server.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the sibling db_server module importable when this file is loaded
# from the backend's process (different cwd, different sys.path). The
# stdio entry point (db_server.py __main__) is unaffected.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import db_server as _db  # noqa: E402  — must follow sys.path tweak

# Re-export the public surface the FastAPI wrapper needs.
server = _db.server
HTTP_PROJECT_ID = _db.HTTP_PROJECT_ID
HTTP_TOKEN_IDENTITY = _db.HTTP_TOKEN_IDENTITY


def make_streamable_manager(*, stateless: bool = True):
    """Construct one StreamableHTTPSessionManager wrapping the shared
    Server instance. Per the SDK docs, exactly ONE manager per process
    — the FastAPI app should cache it across requests.

    ``stateless=True`` matches the discovery use case: no client-side
    session state to resume, every tool call is short, and we can
    avoid the manager's session-tracking dict (which would otherwise
    accumulate one entry per Claude Code session and never GC).
    """
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
    return StreamableHTTPSessionManager(app=server, stateless=stateless)
