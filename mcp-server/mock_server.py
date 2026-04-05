"""
Mock Discovery MCP Server
Returns dummy data for the NacXwan project so discovery agents
can be tested end-to-end without a real backend.

Usage:
  pip install mcp pydantic
  python mock_server.py

Configure in .claude/settings.json:
  "discovery": {
    "command": "python",
    "args": ["/path/to/mock_server.py"]
  }
"""

import json
import sys
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from mock_data import (
    PROJECT_CONTEXT, REQUIREMENTS, CONSTRAINTS, DECISIONS,
    STAKEHOLDERS, ASSUMPTIONS, SCOPE_ITEMS, CONTRADICTIONS,
    GAPS, READINESS, CONTROL_POINTS, DOCUMENTS, search_passages,
)

server = Server("discovery-mock")


# ── Helper ────────────────────────────────────────────

def _json(data) -> list[TextContent]:
    return [TextContent(type="text", text=json.dumps(data, indent=2, default=str))]


def _success(msg: str) -> list[TextContent]:
    print(f"[MOCK STORE] {msg}", file=sys.stderr)
    return [TextContent(type="text", text=json.dumps({"status": "success", "message": msg}))]


# ── READ tools ────────────────────────────────────────

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(name="search_documents", description="Search client documents (meetings, emails, specs). Returns passages with source citations. Use when you need actual paragraphs from client communications.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}, "query": {"type": "string"}, "top_n": {"type": "integer", "default": 5}}, "required": ["project_id", "query"]}),
        Tool(name="search_requirements", description="Search extracted requirements. Filter by priority (must/should/could/wont) or status (proposed/discussed/confirmed). Use when you need to know the STATUS of a feature or requirement.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}, "query": {"type": "string"}, "priority": {"type": "string"}, "status": {"type": "string"}}, "required": ["project_id"]}),
        Tool(name="get_readiness", description="Get discovery readiness score and per-area breakdown (Business, Functional, Technical, Scope). Use to understand overall discovery completeness.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}),
        Tool(name="get_gaps", description="Get all identified gaps with priority and classification (auto_resolve/ask_client/ask_po). Use when user asks about what's missing or wants gap analysis.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}),
        Tool(name="get_contradictions", description="Get unresolved contradictions between requirements, decisions, or other items. Use when checking for conflicts in client communications.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}),
        Tool(name="get_stakeholders", description="Get all identified people with roles and decision authority (final/recommender/informed). Use when you need to know who to ask about what.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}),
        Tool(name="get_decisions", description="Get all decisions with who decided, when, why, and alternatives considered. Use when you need the rationale behind a choice.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}),
        Tool(name="get_assumptions", description="Get unvalidated assumptions with risk assessment and who should validate them. Use when checking what's assumed vs confirmed.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}),
        Tool(name="get_scope", description="Get scope items — what's explicitly in and out of MVP. Use when checking scope boundaries.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}),
        Tool(name="get_constraints", description="Get all constraints (budget, timeline, technology, regulatory). Use when checking project boundaries.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}),
        Tool(name="get_control_points", description="Get all control points with current status (covered/partial/missing) and confidence scores. Use for readiness evaluation.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}),
        Tool(name="get_project_context", description="Get full project context: name, client, type, readiness, document count, meeting count. Use at the start of any analysis to understand current state.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}),

        # STORE tools
        Tool(name="store_requirement", description="Store a newly extracted requirement. Must include source quote (≥10 chars). Status defaults to 'proposed'.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}, "title": {"type": "string"}, "type": {"type": "string", "enum": ["functional", "non_functional"]}, "priority": {"type": "string", "enum": ["must", "should", "could", "wont"]}, "description": {"type": "string"}, "source_doc": {"type": "string"}, "source_quote": {"type": "string"}, "user_perspective": {"type": "string"}, "business_rules": {"type": "array", "items": {"type": "string"}}, "edge_cases": {"type": "array", "items": {"type": "string"}}}, "required": ["project_id", "title", "type", "priority", "description", "source_doc", "source_quote"]}),
        Tool(name="store_constraint", description="Store a newly extracted constraint (budget, timeline, technology, regulatory, organizational).", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}, "type": {"type": "string", "enum": ["budget", "timeline", "technology", "regulatory", "organizational"]}, "description": {"type": "string"}, "impact": {"type": "string"}, "source_doc": {"type": "string"}, "source_quote": {"type": "string"}}, "required": ["project_id", "type", "description", "impact", "source_doc", "source_quote"]}),
        Tool(name="store_decision", description="Store a decision made during discovery (who decided, rationale, alternatives).", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}, "title": {"type": "string"}, "decided_by": {"type": "string"}, "rationale": {"type": "string"}, "source_doc": {"type": "string"}, "alternatives_considered": {"type": "array", "items": {"type": "string"}}}, "required": ["project_id", "title", "decided_by", "rationale", "source_doc"]}),
        Tool(name="store_stakeholder", description="Store a person (name, role, organization, decision authority).", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}, "name": {"type": "string"}, "role": {"type": "string"}, "organization": {"type": "string"}, "decision_authority": {"type": "string", "enum": ["final", "recommender", "informed"]}, "interests": {"type": "array", "items": {"type": "string"}}}, "required": ["project_id", "name", "role", "organization"]}),
        Tool(name="store_assumption", description="Store an assumption (what we believe + risk if wrong + who should validate).", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}, "statement": {"type": "string"}, "basis": {"type": "string"}, "risk_if_wrong": {"type": "string"}, "needs_validation_by": {"type": "string"}}, "required": ["project_id", "statement", "basis", "risk_if_wrong"]}),
        Tool(name="store_scope_item", description="Store a scope decision (in or out of MVP, with rationale).", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}, "description": {"type": "string"}, "in_scope": {"type": "boolean"}, "rationale": {"type": "string"}, "source_doc": {"type": "string"}}, "required": ["project_id", "description", "in_scope", "rationale", "source_doc"]}),
        Tool(name="store_contradiction", description="Flag a contradiction between two items that need resolution.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}, "item_a": {"type": "string"}, "item_b": {"type": "string"}, "explanation": {"type": "string"}}, "required": ["project_id", "item_a", "item_b", "explanation"]}),
        Tool(name="update_requirement_status", description="Update a requirement's status (proposed/discussed/confirmed/changed/dropped).", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}, "requirement_id": {"type": "string"}, "status": {"type": "string", "enum": ["proposed", "discussed", "confirmed", "changed", "dropped"]}}, "required": ["project_id", "requirement_id", "status"]}),
        Tool(name="generate_handoff", description="Generate the 3 handoff documents (Discovery Brief, MVP Scope Freeze, Functional Requirements). Returns document paths.", inputSchema={"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]}),
        Tool(name="web_research", description="Research a topic online (company info, competitors, industry trends). Returns structured research results.", inputSchema={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:

    # ── READ tools ──

    if name == "search_documents":
        passages = search_passages(arguments.get("query", ""))
        return _json({"results": passages, "total": len(passages)})

    if name == "search_requirements":
        reqs = REQUIREMENTS
        if q := arguments.get("query"):
            reqs = [r for r in reqs if q.lower() in r["title"].lower() or q.lower() in r["description"].lower()]
        if p := arguments.get("priority"):
            reqs = [r for r in reqs if r["priority"] == p]
        if s := arguments.get("status"):
            reqs = [r for r in reqs if r["status"] == s]
        return _json(reqs)

    if name == "get_readiness":
        return _json(READINESS)

    if name == "get_gaps":
        return _json(GAPS)

    if name == "get_contradictions":
        return _json(CONTRADICTIONS)

    if name == "get_stakeholders":
        return _json(STAKEHOLDERS)

    if name == "get_decisions":
        return _json(DECISIONS)

    if name == "get_assumptions":
        return _json(ASSUMPTIONS)

    if name == "get_scope":
        return _json(SCOPE_ITEMS)

    if name == "get_constraints":
        return _json(CONSTRAINTS)

    if name == "get_control_points":
        return _json(CONTROL_POINTS)

    if name == "get_project_context":
        return _json(PROJECT_CONTEXT)

    # ── STORE tools ──

    if name == "store_requirement":
        req_id = f"FR-{len(REQUIREMENTS) + 1:03d}"
        return _success(f"Requirement stored: {req_id} — {arguments.get('title', 'untitled')}")

    if name == "store_constraint":
        return _success(f"Constraint stored: {arguments.get('type', 'unknown')} — {arguments.get('description', '')[:60]}")

    if name == "store_decision":
        return _success(f"Decision stored: {arguments.get('title', 'untitled')} — decided by {arguments.get('decided_by', 'unknown')}")

    if name == "store_stakeholder":
        return _success(f"Stakeholder stored: {arguments.get('name', 'unknown')} ({arguments.get('role', '')})")

    if name == "store_assumption":
        return _success(f"Assumption stored: {arguments.get('statement', '')[:60]}")

    if name == "store_scope_item":
        scope = "IN scope" if arguments.get("in_scope", True) else "OUT of scope"
        return _success(f"Scope item stored: {arguments.get('description', '')[:60]} — {scope}")

    if name == "store_contradiction":
        return _success(f"Contradiction flagged: {arguments.get('item_a', '')[:40]} vs {arguments.get('item_b', '')[:40]}")

    if name == "update_requirement_status":
        return _success(f"Requirement {arguments.get('requirement_id', '?')} status → {arguments.get('status', '?')}")

    if name == "generate_handoff":
        return _json({
            "status": "success",
            "documents": [
                {"type": "discovery_brief", "path": ".memory-bank/docs/discovery/discovery-brief.md"},
                {"type": "mvp_scope_freeze", "path": ".memory-bank/docs/discovery/mvp-scope-freeze.md"},
                {"type": "functional_requirements", "path": ".memory-bank/docs/discovery/functional-requirements.md"},
            ],
            "message": "Handoff documents generated (mock). In production, these would be written to the project repo."
        })

    if name == "web_research":
        return _json({
            "query": arguments.get("query", ""),
            "results": [
                {"title": f"Research result for: {arguments.get('query', '')}", "url": "https://example.com/research", "summary": f"Mock research summary about {arguments.get('query', '')}. In production, this would use Tavily or DuckDuckGo for real web search."},
            ],
            "message": "Mock web research. Real backend will use Tavily/DuckDuckGo APIs."
        })

    return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
