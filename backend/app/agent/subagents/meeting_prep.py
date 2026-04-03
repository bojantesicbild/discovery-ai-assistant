import os
"""Meeting prep subagent — generates client meeting agendas."""

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from app.agent.deps import AgentDeps
from app.agent.prompt_loader import load_agent_prompt
from app.agent.tools.query import (
    get_project_context, get_readiness, get_requirements,
    get_contradictions, get_assumptions, get_stakeholders,
)
from app.agent.tools.search import search_documents


class AgendaItem(BaseModel):
    topic: str
    why: str
    we_know: str
    question: str
    ask_who: str | None = None
    priority: str = "medium"


class MeetingAgenda(BaseModel):
    scope_mode: str  # expansion, selective, hold, reduction
    recommended_duration: str = "60 minutes"
    confirm_items: list[str] = Field(default_factory=list)
    critical_gaps: list[AgendaItem] = Field(default_factory=list)
    contradictions: list[AgendaItem] = Field(default_factory=list)
    assumptions_to_validate: list[AgendaItem] = Field(default_factory=list)
    next_steps: str = ""


prompt = load_agent_prompt("discovery-prep-agent")

meeting_prep = Agent(
    "anthropic:claude-sonnet-4-20250514" if os.environ.get("ANTHROPIC_API_KEY") else "test",
    deps_type=AgentDeps,
    system_prompt=prompt,
    output_type=MeetingAgenda,
)

meeting_prep.tool(get_project_context)
meeting_prep.tool(get_readiness)
meeting_prep.tool(get_requirements)
meeting_prep.tool(get_contradictions)
meeting_prep.tool(get_assumptions)
meeting_prep.tool(get_stakeholders)
meeting_prep.tool(search_documents)
