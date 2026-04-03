import os
"""Document generator subagent — produces 3 handoff documents."""

from pydantic import BaseModel
from pydantic_ai import Agent
from app.agent.deps import AgentDeps
from app.agent.prompt_loader import load_agent_prompt
from app.agent.tools.query import (
    get_project_context, get_readiness, get_requirements,
    get_contradictions, get_stakeholders, get_decisions,
    get_assumptions, get_scope, get_constraints,
)
from app.agent.tools.search import search_documents, search_items


class DiscoveryDocuments(BaseModel):
    discovery_brief: str  # markdown
    mvp_scope_freeze: str  # markdown
    functional_requirements: str  # markdown
    warnings: list[str] = []


prompt = load_agent_prompt("discovery-docs-agent")

doc_generator = Agent(
    "anthropic:claude-sonnet-4-20250514" if os.environ.get("ANTHROPIC_API_KEY") else "test",
    deps_type=AgentDeps,
    system_prompt=prompt,
    output_type=DiscoveryDocuments,
)

doc_generator.tool(get_project_context)
doc_generator.tool(get_readiness)
doc_generator.tool(get_requirements)
doc_generator.tool(get_contradictions)
doc_generator.tool(get_stakeholders)
doc_generator.tool(get_decisions)
doc_generator.tool(get_assumptions)
doc_generator.tool(get_scope)
doc_generator.tool(get_constraints)
doc_generator.tool(search_documents)
doc_generator.tool(search_items)
