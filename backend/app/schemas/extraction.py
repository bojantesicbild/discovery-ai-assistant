"""
The 6 typed business models — the core of the product.
Used for both API responses AND Instructor extraction targets.
"""

from pydantic import BaseModel, Field, field_validator
from typing import Optional, Literal


class Requirement(BaseModel):
    id: str = Field(description="Auto-generated: BR-001, BR-002")
    title: str = Field(description="Short title: 'SSO Authentication'")
    type: str = Field(description="functional, non_functional, organizational, etc.")
    priority: Literal["must", "should", "could", "wont"]
    description: str = Field(description="What the system shall do")
    user_perspective: Optional[str] = Field(None, description="As a [role], I want [X], so that [Y]")
    business_rules: list[str] = Field(default_factory=list)
    edge_cases: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(
        default_factory=list,
        description="Testable AC blocks in GIVEN/WHEN/THEN form, one string per AC. Extract when the source describes observable behavior clear enough to write a test for; skip when the source is too abstract.",
    )
    source_doc: str = Field(description="Source document name")
    source_quote: str = Field(description="Exact quote from source, minimum 10 chars")
    status: Literal["proposed", "discussed", "confirmed", "changed", "dropped"] = "proposed"
    confidence: Literal["high", "medium", "low"] = "medium"

    @field_validator("source_quote")
    @classmethod
    def quote_must_be_substantial(cls, v: str) -> str:
        if len(v.strip()) < 10:
            raise ValueError("Source quote must be at least 10 characters for traceability")
        return v


class Constraint(BaseModel):
    type: Literal["budget", "timeline", "technology", "regulatory", "organizational"]
    description: str
    impact: str = Field(description="How this constrains the project")
    source_doc: str
    source_quote: str
    status: Literal["confirmed", "assumed", "negotiable"] = "assumed"

    @field_validator("source_quote")
    @classmethod
    def quote_must_be_substantial(cls, v: str) -> str:
        if len(v.strip()) < 10:
            raise ValueError("Source quote must be at least 10 characters")
        return v


class Decision(BaseModel):
    title: str
    decided_by: str
    date: Optional[str] = None
    rationale: str
    alternatives_considered: list[str] = Field(default_factory=list)
    impacts: list[str] = Field(default_factory=list, description="Requirement IDs affected")
    source_doc: str
    status: Literal["confirmed", "tentative", "reversed"] = "tentative"


class Stakeholder(BaseModel):
    name: str
    role: str
    organization: str
    decision_authority: Literal["final", "recommender", "informed"] = "informed"
    interests: list[str] = Field(default_factory=list)


class Assumption(BaseModel):
    statement: str
    basis: str = Field(description="Why we assume this")
    risk_if_wrong: str = Field(description="What breaks if this assumption is wrong")
    needs_validation_by: Optional[str] = None


class ScopeItem(BaseModel):
    description: str
    in_scope: bool
    rationale: str
    source_doc: str


class Contradiction(BaseModel):
    item_a: str
    item_b: str
    type: Literal["direct_conflict", "partial_conflict", "supersedes", "narrows_scope"]
    explanation: str
    recommended_resolution: Literal["keep_a", "keep_b", "merge", "flag_for_review"]


class GapItem(BaseModel):
    """An open question or undefined area — NOT a requirement."""
    id: str = Field(description="GAP-001, GAP-002")
    question: str
    severity: str = "medium"
    area: str = "general"
    source_doc: str = ""
    source_quote: str = ""
    source_person: str = "unknown"
    blocked_reqs: list[str] = Field(default_factory=list)
    suggested_action: str = ""


class DiscoveryExtraction(BaseModel):
    """Everything extracted from a single client document."""
    requirements: list[Requirement] = Field(default_factory=list)
    gaps: list[GapItem] = Field(default_factory=list)
    constraints: list[Constraint] = Field(default_factory=list)
    decisions: list[Decision] = Field(default_factory=list)
    stakeholders: list[Stakeholder] = Field(default_factory=list)
    assumptions: list[Assumption] = Field(default_factory=list)
    scope_items: list[ScopeItem] = Field(default_factory=list)
    contradictions: list[Contradiction] = Field(default_factory=list)
    document_summary: str = ""
