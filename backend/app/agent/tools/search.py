"""Search tools — bridge between Pydantic AI agent and RAGFlow."""

import json
from pydantic_ai import RunContext
from app.agent.deps import AgentDeps


async def search_documents(ctx: RunContext[AgentDeps], query: str, top_n: int = 5) -> str:
    """Search raw client document chunks (meetings, emails, specs).
    Returns passages with source citations.
    Use when you need actual paragraphs: 'what did client say about X?'"""
    results = await ctx.deps.ragflow.search(
        f"project-{ctx.deps.project_id}-documents", query, top_n=top_n
    )
    if not results:
        return "No matching passages found in client documents."
    return json.dumps([{
        "content": r.get("content", ""),
        "source": r.get("document_name", "unknown"),
        "score": r.get("similarity", 0),
    } for r in results], indent=2)


async def search_items(ctx: RunContext[AgentDeps], query: str, top_n: int = 10) -> str:
    """Search extracted requirements, decisions, constraints.
    Use when you need to know the STATUS of a requirement or decision.
    For example: 'is hosting confirmed?' or 'find requirements about auth'."""
    results = await ctx.deps.ragflow.search(
        f"project-{ctx.deps.project_id}-items", query, top_n=top_n
    )
    if not results:
        return "No matching extracted items found."
    return json.dumps([{
        "content": r.get("content", ""),
        "source": r.get("document_name", "unknown"),
        "score": r.get("similarity", 0),
    } for r in results], indent=2)


async def search_pipeline(ctx: RunContext[AgentDeps], query: str, top_n: int = 5) -> str:
    """Search Phase 2-4 output: tech docs, user stories, test reports, defects.
    Use for cross-phase questions: 'is auth implemented and tested?'
    Note: Requires v1.5 pipeline sync to be set up."""
    results = await ctx.deps.ragflow.search(
        f"project-{ctx.deps.project_id}-memory-bank", query, top_n=top_n
    )
    if not results:
        return "No pipeline data available. Pipeline sync may not be configured for this project."
    return json.dumps([{
        "content": r.get("content", ""),
        "source": r.get("document_name", "unknown"),
        "score": r.get("similarity", 0),
    } for r in results], indent=2)
