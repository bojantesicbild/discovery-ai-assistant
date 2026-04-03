"""Seed control point templates for all 6 project types."""

import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.control import ControlPointTemplate

TEMPLATES = {
    "Default": [
        ("Business Understanding", "Business problem clearly stated", "critical"),
        ("Business Understanding", "Business goals / success metrics defined", "critical"),
        ("Business Understanding", "Target market / users identified", "important"),
        ("Business Understanding", "Budget and timeline constraints known", "critical"),
        ("Business Understanding", "Key stakeholders identified and interviewed", "critical"),
        ("Functional Requirements", "Core user personas defined", "important"),
        ("Functional Requirements", "Primary user flows mapped", "important"),
        ("Functional Requirements", "Feature list prioritized (MoSCoW)", "critical"),
        ("Functional Requirements", "Acceptance criteria for key features defined", "important"),
        ("Functional Requirements", "Non-functional requirements specified", "important"),
        ("Technical Context", "Existing systems / integrations identified", "important"),
        ("Technical Context", "Technical constraints documented", "important"),
        ("Technical Context", "Hosting / deployment requirements known", "important"),
        ("Scope Freeze", "MVP scope agreed with client", "critical"),
        ("Scope Freeze", "Out-of-scope items explicitly listed", "critical"),
        ("Scope Freeze", "Assumptions documented and validated", "important"),
        ("Scope Freeze", "Sign-off path identified", "important"),
    ],
    "Greenfield": [
        ("Business Understanding", "Competitive landscape understood", "important"),
        ("Business Understanding", "User research conducted", "important"),
        ("Technical Context", "Data model / entities sketched", "important"),
        ("Technical Context", "API design approach agreed", "important"),
        ("Technical Context", "Hosting / infrastructure provider decided", "critical"),
        ("Technical Context", "Compliance / regulatory requirements identified", "important"),
        ("Technical Context", "Scalability targets defined", "important"),
    ],
    "Add-on": [
        ("Technical Context", "Host platform version / API compatibility confirmed", "critical"),
        ("Technical Context", "Platform-specific limitations documented", "important"),
        ("Technical Context", "Auth integration method decided", "critical"),
        ("Technical Context", "Deployment / distribution method defined", "important"),
        ("Technical Context", "Platform review / approval requirements understood", "important"),
        ("Technical Context", "Existing platform data access points mapped", "important"),
    ],
    "Feature Extension": [
        ("Technical Context", "Impact on existing features assessed", "critical"),
        ("Technical Context", "Migration / backward compatibility considered", "important"),
        ("Technical Context", "Existing codebase constraints documented", "important"),
    ],
    "API": [
        ("Technical Context", "All external API docs collected and reviewed", "critical"),
        ("Technical Context", "API authentication methods confirmed", "critical"),
        ("Technical Context", "Data mapping between systems defined", "important"),
        ("Technical Context", "Error handling / retry strategy agreed", "important"),
        ("Technical Context", "Rate limits and quotas documented", "important"),
        ("Technical Context", "Data format / schema compatibility verified", "important"),
        ("Technical Context", "Monitoring / alerting requirements defined", "important"),
    ],
    "Mobile": [
        ("Technical Context", "Target platforms decided (iOS, Android, both)", "critical"),
        ("Technical Context", "Minimum OS versions defined", "important"),
        ("Technical Context", "Offline capability requirements known", "important"),
        ("Technical Context", "Push notification requirements defined", "important"),
        ("Technical Context", "App store submission requirements understood", "important"),
        ("Technical Context", "Device-specific constraints documented", "important"),
    ],
}


async def seed_control_points(db: AsyncSession):
    """Seed all control point templates. Idempotent — skips if already seeded."""
    existing = await db.scalar(select(ControlPointTemplate).limit(1))
    if existing:
        return  # Already seeded

    for project_type, points in TEMPLATES.items():
        for category, description, priority in points:
            template = ControlPointTemplate(
                project_type=project_type,
                category=category,
                description=description,
                priority=priority,
                weight=1.0,
            )
            db.add(template)

    await db.flush()
    await db.commit()
