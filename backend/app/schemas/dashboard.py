from pydantic import BaseModel
from typing import Optional


class ReadinessBreakdown(BaseModel):
    business: float = 0
    functional: float = 0
    technical: float = 0
    scope: float = 0


class ReadinessResponse(BaseModel):
    score: float
    status: str  # ready, conditional, not_ready
    breakdown: ReadinessBreakdown
    covered: int = 0
    partial: int = 0
    missing: int = 0
    not_applicable: int = 0


class DashboardResponse(BaseModel):
    readiness: ReadinessResponse
    requirements_count: int = 0
    requirements_confirmed: int = 0
    constraints_count: int = 0
    decisions_count: int = 0
    stakeholders_count: int = 0
    assumptions_count: int = 0
    assumptions_validated: int = 0
    scope_in: int = 0
    scope_out: int = 0
    contradictions_unresolved: int = 0
    documents_count: int = 0
    documents_processing: int = 0
    recent_activity: list[dict] = []
