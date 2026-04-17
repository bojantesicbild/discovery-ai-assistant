"""Proposes field-level updates to requirements based on client gap answers.

Called from the review submit endpoint when a client answers a gap: for each
affected requirement (from gap.blocked_reqs), ask the LLM to turn the answer
into a concrete patch — either a revised description, new acceptance_criteria,
or new business_rules. The patch is staged in proposed_updates; never applied.

Best-effort. LLM failure should not break the submit flow; the fallback is a
"description append" proposal carrying the raw answer verbatim.
"""
from __future__ import annotations

import json
from typing import Literal, Optional

import structlog
from pydantic import BaseModel, Field

from anthropic import AsyncAnthropic
from app.config import settings
from app.models.extraction import Requirement

log = structlog.get_logger()


class ProposedPatch(BaseModel):
    """LLM-returned shape for a single proposed requirement update."""
    field: Literal["description", "acceptance_criteria", "business_rules"] = Field(
        description="Which field of the requirement to update."
    )
    new_value: str | list[str] = Field(
        description="For 'description', a string replacing the whole description. "
                    "For 'acceptance_criteria' or 'business_rules', the NEW items to ADD (list of strings)."
    )
    rationale: str = Field(description="One-sentence explanation of why this change resolves the gap.")


_PROMPT = """You are a business analyst helping a PM incorporate a client's answer into a requirement.

A client just answered an open question (gap) that blocked a specific requirement. Your job: propose a minimal, concrete patch to the requirement based on that answer.

You may patch ONE of these fields:
- `description` — replace the whole description (only if the client's answer fundamentally changes it)
- `acceptance_criteria` — ADD one or more concrete acceptance criteria (preferred — most additive)
- `business_rules` — ADD one or more new rules

Prefer `acceptance_criteria` when the answer adds a testable condition (e.g., "max 50MB", "must support Okta SSO").
Prefer `business_rules` when the answer adds a policy or constraint (e.g., "only admins can export").
Use `description` only when the answer contradicts or materially reshapes the current description.

Keep new items short (one sentence each). Do not duplicate what's already in the requirement.

Return JSON ONLY, matching this schema:
{
  "field": "acceptance_criteria" | "business_rules" | "description",
  "new_value": "<string>" | ["<item1>", "<item2>"],
  "rationale": "<one short sentence>"
}
"""


_client: Optional[AsyncAnthropic] = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


async def propose_req_update(
    gap_question: str,
    gap_answer: str,
    req: Requirement,
    model: str = "claude-haiku-4-5-20251001",
) -> ProposedPatch:
    """Call the LLM to turn a client gap answer into a proposed requirement patch.

    Raises on any LLM or parse failure so the caller can fall back. Deliberately
    no retry — the submit path is best-effort and we'd rather stage a raw-answer
    proposal than delay the submit response."""
    user_content = (
        f"GAP QUESTION:\n{gap_question}\n\n"
        f"CLIENT ANSWER:\n{gap_answer}\n\n"
        f"CURRENT REQUIREMENT ({req.req_id}):\n"
        f"Title: {req.title}\n"
        f"Description: {req.description}\n"
        f"Business rules: {json.dumps(req.business_rules or [])}\n"
        f"Acceptance criteria: {json.dumps(req.acceptance_criteria or [])}\n"
    )

    client = _get_client()
    response = await client.messages.create(
        model=model,
        max_tokens=600,
        system=_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )
    raw = response.content[0].text.strip()
    # Strip markdown fences if the model wrapped the JSON
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    data = json.loads(raw)
    return ProposedPatch(**data)


def fallback_patch(gap_answer: str) -> ProposedPatch:
    """Used when the LLM fails — stage the raw answer as an added criterion.

    Keeps the signal (the client DID answer) flowing into the proposals queue
    even when LLM synthesis is unavailable. The PM can rewrite on accept."""
    return ProposedPatch(
        field="acceptance_criteria",
        new_value=[f"Client answer: {gap_answer.strip()}"],
        rationale="LLM unavailable — staged raw client answer for PM review.",
    )
