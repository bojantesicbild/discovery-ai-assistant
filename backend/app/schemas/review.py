"""Pydantic schemas for the client review portal."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


# ─── PM-facing request/response ───

class ReviewTokenCreate(BaseModel):
    label: Optional[str] = None
    client_name: Optional[str] = None
    client_email: Optional[str] = None
    expires_in_days: int = Field(default=7, ge=1, le=90)


class ReviewTokenResponse(BaseModel):
    id: str
    token: str
    label: Optional[str]
    client_name: Optional[str]
    client_email: Optional[str]
    expires_at: datetime
    revoked_at: Optional[datetime]
    submitted_at: Optional[datetime]
    round_number: int
    created_at: Optional[datetime]
    shareable_url: str

    class Config:
        from_attributes = True


class ReviewTokenListResponse(BaseModel):
    tokens: list[ReviewTokenResponse]


class ReviewSubmissionSummaryResponse(BaseModel):
    id: str
    round_number: int
    client_name: Optional[str]
    submitted_at: Optional[datetime]
    confirmed: int
    discussed: int
    gaps_answered: int
    requirement_actions: list
    gap_actions: list


# ─── Public client-facing ───

class ClientRequirementView(BaseModel):
    """Subset of requirement fields safe to show a client."""
    req_id: str
    title: str
    priority: str
    description: str
    user_perspective: Optional[str] = None
    business_rules: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)
    edge_cases: list[str] = Field(default_factory=list)
    source_quote: Optional[str] = None
    source_doc: Optional[str] = None
    status: str


class ClientGapView(BaseModel):
    """Subset of gap fields safe to show a client."""
    gap_id: str
    question: str
    severity: str
    area: str
    blocked_reqs: list[str] = Field(default_factory=list)
    suggested_action: Optional[str] = None
    source_quote: Optional[str] = None
    source_doc: Optional[str] = None


class ClientReviewData(BaseModel):
    """What the client sees when they open the review link."""
    project_name: str
    client_name: Optional[str]
    round_number: int
    already_submitted: bool = False
    requirements: dict[str, list[ClientRequirementView]]  # grouped by priority
    gaps: list[ClientGapView]


class RequirementAction(BaseModel):
    req_id: str
    action: Literal["confirm", "discuss", "skip"]
    note: Optional[str] = None


class GapAction(BaseModel):
    gap_id: str
    action: Literal["answer", "skip"]
    answer: Optional[str] = None


class ReviewSubmitRequest(BaseModel):
    requirement_actions: list[RequirementAction] = Field(default_factory=list)
    gap_actions: list[GapAction] = Field(default_factory=list)


class ReviewSubmitResponse(BaseModel):
    status: str = "submitted"
    confirmed: int = 0
    discussed: int = 0
    gaps_answered: int = 0
    readiness_score: Optional[float] = None
