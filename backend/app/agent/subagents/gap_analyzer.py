import os
"""Gap analyzer subagent — structured gap analysis with typed output."""

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from app.agent.deps import AgentDeps
from app.agent.prompt_loader import load_agent_prompt
from app.agent.tools.query import (
    get_project_context, get_readiness, get_requirements,
    get_contradictions, get_stakeholders, get_assumptions,
    get_scope, get_constraints,
)
from app.agent.tools.search import search_documents


class GapItem(BaseModel):
    control_point: str
    status: str  # covered, partial, missing
    classification: str  # auto_resolve, ask_client, ask_po
    resolution: str | None = None
    question: str | None = None
    priority: str | None = None  # critical, high, medium
    suggested_stakeholder: str | None = None


class GapAnalysisResult(BaseModel):
    readiness_score: float
    readiness_status: str
    breakdown: dict = Field(default_factory=dict)
    auto_resolved: list[GapItem] = Field(default_factory=list)
    ask_client: list[GapItem] = Field(default_factory=list)
    ask_po: list[GapItem] = Field(default_factory=list)
    contradictions: list[dict] = Field(default_factory=list)
    summary: str = ""


# Load prompt from shared assistants/
prompt = load_agent_prompt("discovery-gap-agent")

gap_analyzer = Agent(
    "anthropic:claude-sonnet-4-20250514" if os.environ.get("ANTHROPIC_API_KEY") else "test",
    deps_type=AgentDeps,
    system_prompt=prompt,
    output_type=GapAnalysisResult,
)

# Register tools
gap_analyzer.tool(get_project_context)
gap_analyzer.tool(get_readiness)
gap_analyzer.tool(get_requirements)
gap_analyzer.tool(get_contradictions)
gap_analyzer.tool(get_stakeholders)
gap_analyzer.tool(get_assumptions)
gap_analyzer.tool(get_scope)
gap_analyzer.tool(get_constraints)
gap_analyzer.tool(search_documents)
