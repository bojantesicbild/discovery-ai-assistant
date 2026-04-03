"""Discovery Coordinator Agent — Pydantic AI with tools and subagents."""

from pydantic_ai import Agent, RunContext
from app.agent.deps import AgentDeps
from app.agent.prompt_loader import load_skill_prompt
from app.agent.tools.search import search_documents, search_items, search_pipeline
from app.agent.tools.query import (
    get_project_context, get_readiness, get_requirements,
    get_contradictions, get_stakeholders, get_decisions,
    get_assumptions, get_scope, get_constraints,
)
from app.agent.tools.store import (
    store_requirement, store_constraint, store_decision,
    store_stakeholder, store_assumption, store_scope_item,
    store_contradiction,
)

# Load the coordinator system prompt from shared assistants/
COORDINATOR_SYSTEM_PROMPT = """You are the Discovery AI Assistant — you help Product Owners run structured client discovery for software projects.

You have tools to search client documents, query extracted requirements/decisions/constraints, check readiness, and store new findings.

## RULES
- Always cite sources (document name, quote)
- Research findings are PENDING PO REVIEW — never auto-confirm
- When uncertain, say so. Never fabricate.
- Present options with recommendations: CONTEXT → QUESTION → RECOMMENDATION → A/B/C
- Use get_project_context at the start of complex tasks

## AVAILABLE TOOLS
- search_documents: raw passages from client docs
- search_items: extracted requirements, decisions, etc.
- get_project_context: readiness score, contradictions, gaps summary
- get_readiness: readiness score and breakdown
- get_requirements: list/filter requirements by priority or status
- get_contradictions: unresolved conflicts
- get_stakeholders: people with roles and authority
- get_decisions: who decided what and why
- get_assumptions: unvalidated beliefs with risk
- get_scope: in/out of MVP items
- get_constraints: budget, timeline, tech constraints
- store_requirement, store_constraint, store_decision, etc.: save new findings

## HOW TO HANDLE REQUESTS
- "What are the gaps?" → call get_project_context + get_readiness, analyze what's missing
- "What did client say about X?" → call search_documents
- "Is X confirmed?" → call get_requirements with status filter
- "Prepare meeting" → call get_project_context + get_contradictions + get_assumptions, generate agenda
- "Generate docs" → call all query tools, compose handoff documents
- "Research X online" → use web search tools if available
"""

# Create the coordinator agent
# Use test model if no API key set (allows app to start without Anthropic key)
import os
_model = "anthropic:claude-sonnet-4-20250514" if os.environ.get("ANTHROPIC_API_KEY") else "test"
coordinator = Agent(
    _model,
    deps_type=AgentDeps,
    system_prompt=COORDINATOR_SYSTEM_PROMPT,
)

# Register all tools
coordinator.tool(search_documents)
coordinator.tool(search_items)
coordinator.tool(search_pipeline)
coordinator.tool(get_project_context)
coordinator.tool(get_readiness)
coordinator.tool(get_requirements)
coordinator.tool(get_contradictions)
coordinator.tool(get_stakeholders)
coordinator.tool(get_decisions)
coordinator.tool(get_assumptions)
coordinator.tool(get_scope)
coordinator.tool(get_constraints)
coordinator.tool(store_requirement)
coordinator.tool(store_constraint)
coordinator.tool(store_decision)
coordinator.tool(store_stakeholder)
coordinator.tool(store_assumption)
coordinator.tool(store_scope_item)
coordinator.tool(store_contradiction)


# ── Subagent dispatch tools ──────────────────────────

@coordinator.tool
async def run_gap_analysis(ctx: RunContext[AgentDeps]) -> str:
    """Run structured gap analysis on all control points.
    Use when user asks about gaps, readiness, or what's missing.
    Returns: readiness score, auto-resolved items, questions for client, decisions for PO."""
    from app.agent.subagents.gap_analyzer import gap_analyzer
    result = await gap_analyzer.run("Analyze all gaps for this project.", deps=ctx.deps)
    return result.output.model_dump_json(indent=2) if hasattr(result, 'output') else str(result.data)


@coordinator.tool
async def run_doc_generation(ctx: RunContext[AgentDeps]) -> str:
    """Generate the 3 handoff documents (Discovery Brief, MVP Scope Freeze, Functional Requirements).
    Use when user asks to generate docs, create handoff, or produce deliverables.
    Returns: 3 markdown documents with source attribution."""
    from app.agent.subagents.doc_generator import doc_generator
    result = await doc_generator.run("Generate all 3 handoff documents.", deps=ctx.deps)
    return result.output.model_dump_json(indent=2) if hasattr(result, 'output') else str(result.data)


@coordinator.tool
async def run_meeting_prep(ctx: RunContext[AgentDeps]) -> str:
    """Prepare a client meeting agenda based on current gaps and contradictions.
    Use when user asks to prepare meeting, create agenda, or plan next client call.
    Returns: scope mode, prioritized questions, talking points."""
    from app.agent.subagents.meeting_prep import meeting_prep
    result = await meeting_prep.run("Prepare meeting agenda based on current gaps.", deps=ctx.deps)
    return result.output.model_dump_json(indent=2) if hasattr(result, 'output') else str(result.data)
