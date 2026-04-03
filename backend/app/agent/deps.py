"""Agent dependencies — injected into every tool via RunContext."""

import uuid
from dataclasses import dataclass
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.ragflow import RAGFlowClient


@dataclass
class AgentDeps:
    project_id: uuid.UUID
    ragflow: RAGFlowClient
    db: AsyncSession
    user_id: uuid.UUID | None = None
