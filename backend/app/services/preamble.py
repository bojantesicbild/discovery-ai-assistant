"""Preamble builder — assembles context for the coordinator agent."""

import uuid
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.document import Document
from app.models.extraction import Requirement, Contradiction, Assumption
from app.models.control import ReadinessHistory


class PreambleBuilder:
    async def build(self, project_id: uuid.UUID, db: AsyncSession) -> str:
        """Build the context preamble injected into the coordinator system prompt."""

        # Project info
        project = await db.scalar(select(Project).where(Project.id == project_id))
        if not project:
            return "Project not found."

        # Readiness
        readiness = await db.scalar(
            select(ReadinessHistory)
            .where(ReadinessHistory.project_id == project_id)
            .order_by(ReadinessHistory.created_at.desc())
            .limit(1)
        )
        score = readiness.score if readiness else 0
        breakdown = readiness.breakdown if readiness else {}

        # Counts
        doc_count = await db.scalar(select(func.count()).where(Document.project_id == project_id)) or 0
        req_count = await db.scalar(select(func.count()).where(Requirement.project_id == project_id)) or 0
        req_confirmed = await db.scalar(
            select(func.count()).where(Requirement.project_id == project_id, Requirement.status == "confirmed")
        ) or 0
        contradictions = await db.scalar(
            select(func.count()).where(Contradiction.project_id == project_id, Contradiction.resolved == False)
        ) or 0
        unvalidated = await db.scalar(
            select(func.count()).where(Assumption.project_id == project_id, Assumption.validated == False)
        ) or 0

        status = "Ready" if score >= 85 else "Conditional" if score >= 65 else "Not Ready"

        return f"""## PROJECT CONTEXT
- Project: {project.name} ({project.project_type})
- Client: {project.client_name}
- Status: {project.status}
- Readiness: {score}% ({status})
- Documents: {doc_count}
- Requirements: {req_count} ({req_confirmed} confirmed)
- Unresolved contradictions: {contradictions}
- Unvalidated assumptions: {unvalidated}
- Breakdown: Business {breakdown.get('business', 0):.0f}% | Functional {breakdown.get('functional', 0):.0f}% | Technical {breakdown.get('technical', 0):.0f}% | Scope {breakdown.get('scope', 0):.0f}%

## KNOWLEDGE ROUTING
1. Use search_items for: "Is X confirmed?" "What requirements exist for Y?"
2. Use search_documents for: "What did client say about X?" (raw passages)
3. Use get_control_points for: readiness evaluation
4. Never claim "covered" without checking items. Never claim "missing" without checking documents too.
"""


preamble_builder = PreambleBuilder()
