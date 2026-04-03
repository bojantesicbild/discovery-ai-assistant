"""
Discovery MCP Server — connects directly to PostgreSQL.
Gives Claude Code (chat or local) access to all extracted project data.

Usage:
  python db_server.py

Environment:
  DATABASE_URL=postgresql://discovery_user:discovery_pass@localhost:5432/discovery_db
  DISCOVERY_PROJECT_ID=your-project-uuid  (optional, defaults to most recent)

Configure in .claude/settings.json:
  "discovery": {
    "command": "python",
    "args": ["/path/to/mcp-server/db_server.py"],
    "env": {
      "DATABASE_URL": "postgresql://discovery_user:discovery_pass@localhost:5432/discovery_db",
      "DISCOVERY_PROJECT_ID": ""
    }
  }
"""

import os
import sys
import json
import asyncio
import asyncpg
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://discovery_user:discovery_pass@localhost:5432/discovery_db")
PROJECT_ID = os.environ.get("DISCOVERY_PROJECT_ID", "")

server = Server("discovery-db")
_pool = None


async def get_pool():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=3)
    return _pool


async def get_project_id():
    """Get project ID — from env or most recent project."""
    if PROJECT_ID:
        return PROJECT_ID
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id FROM projects WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1")
        return str(row["id"]) if row else None


def _json_result(data) -> list[TextContent]:
    return [TextContent(type="text", text=json.dumps(data, indent=2, default=str))]


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(name="get_project_context", description="Get project overview: name, client, type, readiness score, document count, and per-area breakdown. Use at the start of any analysis.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_requirements", description="Get all business requirements with ID, title, priority (must/should/could), status (proposed/discussed/confirmed/dropped), description, and source quote. Filter by priority or status.", inputSchema={"type": "object", "properties": {"priority": {"type": "string", "description": "Filter: must, should, could, wont"}, "status": {"type": "string", "description": "Filter: proposed, discussed, confirmed, changed, dropped"}}, "required": []}),
        Tool(name="get_constraints", description="Get all project constraints: budget, timeline, technology, regulatory, organizational. Each has description, impact, and status.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_decisions", description="Get all decisions made during discovery: what was decided, by whom, rationale, alternatives considered, and status.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_stakeholders", description="Get all identified stakeholders: name, role, organization, decision authority (final/recommender/informed), and interests.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_assumptions", description="Get all assumptions: what we believe, basis for believing it, risk if wrong, and whether it's been validated.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_scope", description="Get all scope items: what's explicitly in or out of MVP, with rationale.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_contradictions", description="Get all contradictions/conflicts between items, with resolution status.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_readiness", description="Get discovery readiness score and per-area breakdown (business, functional, technical, scope).", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="get_documents", description="Get all uploaded documents with processing status and extraction counts.", inputSchema={"type": "object", "properties": {}, "required": []}),
        Tool(name="search", description="Search across all extracted data (requirements, constraints, decisions, stakeholders) by keyword.", inputSchema={"type": "object", "properties": {"query": {"type": "string", "description": "Search term"}}, "required": ["query"]}),
        Tool(name="get_activity", description="Get recent activity log: uploads, status changes, extractions.", inputSchema={"type": "object", "properties": {"limit": {"type": "integer", "description": "Number of entries (default 20)"}}, "required": []}),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    pool = await get_pool()
    pid = await get_project_id()

    if not pid:
        return _json_result({"error": "No active project found. Set DISCOVERY_PROJECT_ID env var."})

    async with pool.acquire() as conn:

        if name == "get_project_context":
            project = await conn.fetchrow("SELECT name, client_name, project_type, status FROM projects WHERE id = $1", pid)
            doc_count = await conn.fetchval("SELECT COUNT(*) FROM documents WHERE project_id = $1", pid)
            req_count = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1", pid)
            req_confirmed = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1 AND status = 'confirmed'", pid)
            contradictions = await conn.fetchval("SELECT COUNT(*) FROM contradictions WHERE project_id = $1 AND resolved = false", pid)
            readiness = await conn.fetchrow("SELECT score, breakdown FROM readiness_history WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1", pid)

            return _json_result({
                "project": dict(project) if project else {},
                "documents": doc_count,
                "requirements": {"total": req_count, "confirmed": req_confirmed},
                "unresolved_contradictions": contradictions,
                "readiness": {"score": readiness["score"], "breakdown": json.loads(readiness["breakdown"]) if readiness and readiness["breakdown"] else {}} if readiness else {"score": 0, "breakdown": {}},
            })

        if name == "get_requirements":
            query = "SELECT req_id, title, type, priority, description, user_perspective, business_rules, edge_cases, source_quote, status, confidence FROM requirements WHERE project_id = $1"
            params = [pid]
            if p := arguments.get("priority"):
                query += " AND priority = $2"
                params.append(p)
            elif s := arguments.get("status"):
                query += " AND status = $2"
                params.append(s)
            query += " ORDER BY req_id"
            rows = await conn.fetch(query, *params)
            return _json_result([dict(r) for r in rows])

        if name == "get_constraints":
            rows = await conn.fetch("SELECT type, description, impact, source_quote, status FROM constraints WHERE project_id = $1", pid)
            return _json_result([dict(r) for r in rows])

        if name == "get_decisions":
            rows = await conn.fetch("SELECT title, decided_by, rationale, alternatives, status FROM decisions WHERE project_id = $1", pid)
            return _json_result([dict(r) for r in rows])

        if name == "get_stakeholders":
            rows = await conn.fetch("SELECT name, role, organization, decision_authority, interests FROM stakeholders WHERE project_id = $1", pid)
            return _json_result([dict(r) for r in rows])

        if name == "get_assumptions":
            rows = await conn.fetch("SELECT statement, basis, risk_if_wrong, needs_validation_by, validated FROM assumptions WHERE project_id = $1", pid)
            return _json_result([dict(r) for r in rows])

        if name == "get_scope":
            rows = await conn.fetch("SELECT description, in_scope, rationale FROM scope_items WHERE project_id = $1 ORDER BY in_scope DESC", pid)
            return _json_result([dict(r) for r in rows])

        if name == "get_contradictions":
            rows = await conn.fetch("SELECT item_a_type, item_b_type, explanation, resolved, resolution_note FROM contradictions WHERE project_id = $1", pid)
            return _json_result([dict(r) for r in rows])

        if name == "get_readiness":
            row = await conn.fetchrow("SELECT score, breakdown FROM readiness_history WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1", pid)
            if not row:
                return _json_result({"score": 0, "status": "no data"})
            score = row["score"]
            return _json_result({
                "score": score,
                "status": "ready" if score >= 85 else "conditional" if score >= 65 else "not_ready",
                "breakdown": json.loads(row["breakdown"]) if row["breakdown"] else {},
            })

        if name == "get_documents":
            rows = await conn.fetch("SELECT filename, file_type, pipeline_stage, items_extracted, contradictions_found, created_at FROM documents WHERE project_id = $1 ORDER BY created_at DESC", pid)
            return _json_result([dict(r) for r in rows])

        if name == "search":
            q = arguments.get("query", "")
            pattern = f"%{q}%"
            results = []

            reqs = await conn.fetch("SELECT req_id, title, priority, status FROM requirements WHERE project_id = $1 AND (title ILIKE $2 OR description ILIKE $2) LIMIT 10", pid, pattern)
            for r in reqs:
                results.append({"type": "requirement", "id": r["req_id"], "title": r["title"], "priority": r["priority"], "status": r["status"]})

            cons = await conn.fetch("SELECT type, description, status FROM constraints WHERE project_id = $1 AND description ILIKE $2 LIMIT 5", pid, pattern)
            for c in cons:
                results.append({"type": "constraint", "title": f"{c['type']}: {c['description'][:60]}", "status": c["status"]})

            decs = await conn.fetch("SELECT title, status FROM decisions WHERE project_id = $1 AND (title ILIKE $2 OR rationale ILIKE $2) LIMIT 5", pid, pattern)
            for d in decs:
                results.append({"type": "decision", "title": d["title"], "status": d["status"]})

            return _json_result({"query": q, "results": results, "total": len(results)})

        if name == "get_activity":
            limit = arguments.get("limit", 20)
            rows = await conn.fetch("SELECT action, summary, created_at FROM activity_log WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2", pid, limit)
            return _json_result([dict(r) for r in rows])

    return _json_result({"error": f"Unknown tool: {name}"})


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
