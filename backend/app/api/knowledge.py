"""Knowledge graph API -- serves graph data from markdown wikilinks."""

import uuid
from fastapi import APIRouter, Depends
from app.deps import get_current_user
from app.models.auth import User
from app.agent.claude_runner import claude_runner
from app.services.graph_parser import parse_knowledge_graph

router = APIRouter(prefix="/api/projects/{project_id}", tags=["knowledge"])


@router.get("/knowledge-graph")
async def get_knowledge_graph(
    project_id: uuid.UUID,
    user: User = Depends(get_current_user),
):
    project_dir = claude_runner.get_project_dir(project_id)
    discovery_dir = project_dir / ".memory-bank" / "docs" / "discovery"

    if not discovery_dir.exists():
        return {"nodes": [], "edges": []}

    graph = parse_knowledge_graph(discovery_dir)
    return graph
