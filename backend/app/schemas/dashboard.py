from pydantic import BaseModel


class ReadinessComponent(BaseModel):
    score: float
    label: str
    summary: str
    details: dict = {}


class ReadinessResponse(BaseModel):
    score: float
    status: str  # ready, conditional, not_ready
    components: dict[str, ReadinessComponent] = {}


class DashboardResponse(BaseModel):
    readiness: ReadinessResponse
    requirements_count: int = 0
    requirements_confirmed: int = 0
    constraints_count: int = 0
    stakeholders_count: int = 0
    gaps_open: int = 0
    contradictions_unresolved: int = 0
    documents_count: int = 0
    documents_processing: int = 0
    recent_activity: list[dict] = []
