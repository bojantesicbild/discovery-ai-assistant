"""
Real Discovery MCP Server — proxies to the FastAPI backend.
Swap this for mock_server.py when the backend is running.

Usage:
  python real_server.py

Configure in .claude/settings.json:
  "discovery": {
    "command": "python",
    "args": ["/path/to/mcp-server/real_server.py"],
    "env": {
      "DISCOVERY_API_URL": "http://localhost:8000",
      "DISCOVERY_PROJECT_ID": "your-project-uuid"
    }
  }
"""

import os
import json
import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

API_URL = os.environ.get("DISCOVERY_API_URL", "http://localhost:8000")
PROJECT_ID = os.environ.get("DISCOVERY_PROJECT_ID", "")
API_TOKEN = os.environ.get("DISCOVERY_API_TOKEN", "")

server = Server("discovery")


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if API_TOKEN:
        h["Authorization"] = f"Bearer {API_TOKEN}"
    return h


async def _get(path: str, params: dict = None) -> list[TextContent]:
    async with httpx.AsyncClient(base_url=API_URL, headers=_headers(), timeout=30) as client:
        resp = await client.get(path, params=params)
        return [TextContent(type="text", text=resp.text)]


async def _post(path: str, data: dict = None) -> list[TextContent]:
    async with httpx.AsyncClient(base_url=API_URL, headers=_headers(), timeout=30) as client:
        resp = await client.post(path, json=data)
        return [TextContent(type="text", text=resp.text)]


@server.list_tools()
async def list_tools() -> list[Tool]:
    # Same tool definitions as mock_server.py — ensures compatibility
    from mock_server import list_tools as mock_list
    return await mock_list()


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    pid = arguments.get("project_id", PROJECT_ID)
    base = f"/api/projects/{pid}"

    # ── READ tools → GET endpoints ──

    if name == "search_documents":
        return await _get(f"{base}/documents", {"search": arguments.get("query", "")})

    if name == "search_requirements":
        params = {}
        if q := arguments.get("query"):
            params["search"] = q
        if p := arguments.get("priority"):
            params["priority"] = p
        if s := arguments.get("status"):
            params["status"] = s
        return await _get(f"{base}/requirements", params)

    if name == "get_readiness":
        return await _get(f"{base}/readiness")

    if name == "get_gaps":
        return await _post(f"{base}/gaps")

    if name == "get_contradictions":
        return await _get(f"{base}/contradictions", {"resolved": "false"})

    if name == "get_stakeholders":
        return await _get(f"{base}/stakeholders")

    if name == "get_decisions":
        return await _get(f"{base}/decisions")

    if name == "get_assumptions":
        return await _get(f"{base}/assumptions")

    if name == "get_scope":
        return await _get(f"{base}/scope")

    if name == "get_constraints":
        return await _get(f"{base}/constraints")

    if name == "get_control_points":
        return await _get(f"{base}/readiness")

    if name == "get_project_context":
        return await _get(f"{base}/dashboard")

    # ── STORE tools → POST endpoints ──
    # These would need dedicated backend endpoints
    # For now, proxy to the chat endpoint as findings

    if name.startswith("store_"):
        return await _post(f"{base}/chat", {
            "text": f"[STORE] {name}: {json.dumps(arguments)}"
        })

    if name == "update_requirement_status":
        return [TextContent(type="text", text=json.dumps({"status": "not_implemented_yet"}))]

    if name == "generate_handoff":
        return await _post(f"{base}/generate")

    if name == "web_research":
        return [TextContent(type="text", text=json.dumps({
            "message": "Web research via real backend not yet implemented. Use WebSearch tool directly."
        }))]

    return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
