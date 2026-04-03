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


async def _recalculate_readiness(conn, pid: str):
    """Recalculate readiness score after a write operation."""
    # Business (20%)
    has_authority = await conn.fetchval("SELECT COUNT(*) FROM stakeholders WHERE project_id = $1 AND decision_authority = 'final'", pid) or 0
    has_budget = await conn.fetchval("SELECT COUNT(*) FROM constraints WHERE project_id = $1 AND type = 'budget' AND status = 'confirmed'", pid) or 0
    has_timeline = await conn.fetchval("SELECT COUNT(*) FROM constraints WHERE project_id = $1 AND type = 'timeline'", pid) or 0
    has_stakeholders = await conn.fetchval("SELECT COUNT(*) FROM stakeholders WHERE project_id = $1", pid) or 0
    has_must = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1 AND priority = 'must'", pid) or 0
    biz_checks = [
        1.0 if has_authority > 0 else 0.0,
        1.0 if has_budget > 0 else 0.0,
        1.0 if has_timeline > 0 else 0.0,
        1.0 if has_stakeholders >= 2 else 0.5 if has_stakeholders >= 1 else 0.0,
        1.0 if has_must >= 2 else 0.5 if has_must >= 1 else 0.0,
    ]
    business = (sum(biz_checks) / len(biz_checks)) * 100

    # Functional (35%)
    total_reqs = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1", pid) or 0
    confirmed_reqs = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1 AND status = 'confirmed'", pid) or 0
    nfr = await conn.fetchval("SELECT COUNT(*) FROM requirements WHERE project_id = $1 AND type = 'non_functional'", pid) or 0
    func_checks = [
        1.0 if total_reqs >= 5 else 0.5 if total_reqs >= 2 else 0.0,
        confirmed_reqs / total_reqs if total_reqs > 0 else 0.0,
        1.0 if has_must >= 3 else 0.5 if has_must >= 1 else 0.0,
        1.0 if nfr >= 1 else 0.0,
    ]
    functional = (sum(func_checks) / len(func_checks)) * 100

    # Technical (20%)
    tech_decisions = await conn.fetchval("SELECT COUNT(*) FROM decisions WHERE project_id = $1", pid) or 0
    tech_constraints = await conn.fetchval("SELECT COUNT(*) FROM constraints WHERE project_id = $1 AND type = 'technology'", pid) or 0
    confirmed_decisions = await conn.fetchval("SELECT COUNT(*) FROM decisions WHERE project_id = $1 AND status = 'confirmed'", pid) or 0
    tech_checks = [
        1.0 if tech_decisions >= 2 else 0.5 if tech_decisions >= 1 else 0.0,
        1.0 if tech_constraints >= 1 else 0.0,
        1.0 if confirmed_decisions >= 1 else 0.0,
    ]
    technical = (sum(tech_checks) / len(tech_checks)) * 100

    # Scope (25%)
    in_scope = await conn.fetchval("SELECT COUNT(*) FROM scope_items WHERE project_id = $1 AND in_scope = true", pid) or 0
    out_scope = await conn.fetchval("SELECT COUNT(*) FROM scope_items WHERE project_id = $1 AND in_scope = false", pid) or 0
    unresolved = await conn.fetchval("SELECT COUNT(*) FROM contradictions WHERE project_id = $1 AND resolved = false", pid) or 0
    total_assumptions = await conn.fetchval("SELECT COUNT(*) FROM assumptions WHERE project_id = $1", pid) or 0
    validated_assumptions = await conn.fetchval("SELECT COUNT(*) FROM assumptions WHERE project_id = $1 AND validated = true", pid) or 0
    scope_checks = [
        1.0 if in_scope >= 3 else 0.5 if in_scope >= 1 else 0.0,
        1.0 if out_scope >= 1 else 0.0,
        1.0 if unresolved == 0 else 0.0,
        validated_assumptions / total_assumptions if total_assumptions > 0 else 0.5,
    ]
    scope = (sum(scope_checks) / len(scope_checks)) * 100

    # Overall
    overall = business * 0.20 + functional * 0.35 + technical * 0.20 + scope * 0.25
    overall = round(overall, 1)

    breakdown = json.dumps({"business": round(business, 1), "functional": round(functional, 1), "technical": round(technical, 1), "scope": round(scope, 1)})
    await conn.execute(
        "INSERT INTO readiness_history (id, project_id, score, breakdown, triggered_by) VALUES (gen_random_uuid(), $1, $2, $3, $4)",
        pid, overall, breakdown, "mcp_write"
    )
    return overall


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
        # Write tools
        Tool(name="update_requirement_status", description="Update a business requirement's status. Use when PO asks to confirm, discuss, change, or drop a requirement.", inputSchema={"type": "object", "properties": {"req_id": {"type": "string", "description": "Requirement ID (e.g. BR-001)"}, "status": {"type": "string", "enum": ["proposed", "discussed", "confirmed", "changed", "dropped"], "description": "New status"}}, "required": ["req_id", "status"]}),
        Tool(name="update_requirement_priority", description="Update a business requirement's priority.", inputSchema={"type": "object", "properties": {"req_id": {"type": "string", "description": "Requirement ID (e.g. BR-001)"}, "priority": {"type": "string", "enum": ["must", "should", "could", "wont"], "description": "New priority"}}, "required": ["req_id", "priority"]}),
        Tool(name="validate_assumption", description="Mark an assumption as validated or unvalidated.", inputSchema={"type": "object", "properties": {"statement_fragment": {"type": "string", "description": "Part of the assumption text to find it"}, "validated": {"type": "boolean", "description": "true = validated, false = unvalidated"}}, "required": ["statement_fragment", "validated"]}),
        Tool(name="resolve_contradiction", description="Resolve a contradiction with a resolution note.", inputSchema={"type": "object", "properties": {"explanation_fragment": {"type": "string", "description": "Part of the contradiction explanation to find it"}, "resolution_note": {"type": "string", "description": "How it was resolved"}}, "required": ["explanation_fragment", "resolution_note"]}),
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

        # ── Write tools ──

        if name == "update_requirement_status":
            req_id = arguments["req_id"]
            new_status = arguments["status"]
            old = await conn.fetchrow("SELECT status FROM requirements WHERE project_id = $1 AND req_id = $2", pid, req_id)
            if not old:
                return _json_result({"error": f"Requirement {req_id} not found"})
            await conn.execute("UPDATE requirements SET status = $1 WHERE project_id = $2 AND req_id = $3", new_status, pid, req_id)
            await conn.execute("INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'requirement_updated', $2, $3)", pid, f"Updated {req_id}: status {old['status']} → {new_status}", json.dumps({"req_id": req_id, "old_status": old["status"], "new_status": new_status}))
            new_score = await _recalculate_readiness(conn, pid)
            return _json_result({"success": True, "req_id": req_id, "old_status": old["status"], "new_status": new_status, "readiness": new_score})

        if name == "update_requirement_priority":
            req_id = arguments["req_id"]
            new_priority = arguments["priority"]
            old = await conn.fetchrow("SELECT priority FROM requirements WHERE project_id = $1 AND req_id = $2", pid, req_id)
            if not old:
                return _json_result({"error": f"Requirement {req_id} not found"})
            await conn.execute("UPDATE requirements SET priority = $1 WHERE project_id = $2 AND req_id = $3", new_priority, pid, req_id)
            await conn.execute("INSERT INTO activity_log (id, project_id, action, summary, details) VALUES (gen_random_uuid(), $1, 'requirement_updated', $2, $3)", pid, f"Updated {req_id}: priority {old['priority']} → {new_priority}", json.dumps({"req_id": req_id, "change": "priority"}))
            new_score = await _recalculate_readiness(conn, pid)
            return _json_result({"success": True, "req_id": req_id, "old_priority": old["priority"], "new_priority": new_priority, "readiness": new_score})

        if name == "validate_assumption":
            fragment = arguments["statement_fragment"]
            validated = arguments["validated"]
            row = await conn.fetchrow("SELECT id, statement FROM assumptions WHERE project_id = $1 AND statement ILIKE $2 LIMIT 1", pid, f"%{fragment}%")
            if not row:
                return _json_result({"error": f"Assumption containing '{fragment}' not found"})
            await conn.execute("UPDATE assumptions SET validated = $1 WHERE id = $2", validated, row["id"])
            new_score = await _recalculate_readiness(conn, pid)
            return _json_result({"success": True, "assumption": row["statement"][:60], "validated": validated, "readiness": new_score})

        if name == "resolve_contradiction":
            fragment = arguments["explanation_fragment"]
            note = arguments["resolution_note"]
            row = await conn.fetchrow("SELECT id, explanation FROM contradictions WHERE project_id = $1 AND explanation ILIKE $2 LIMIT 1", pid, f"%{fragment}%")
            if not row:
                return _json_result({"error": f"Contradiction containing '{fragment}' not found"})
            await conn.execute("UPDATE contradictions SET resolved = true, resolution_note = $1 WHERE id = $2", note, row["id"])
            new_score = await _recalculate_readiness(conn, pid)
            return _json_result({"success": True, "contradiction": row["explanation"][:60], "resolved": True, "readiness": new_score})

    return _json_result({"error": f"Unknown tool: {name}"})


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
