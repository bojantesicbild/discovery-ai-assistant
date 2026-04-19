"""Unit tests for proposal_agent.fallback_patch.

The LLM call itself is network-bound and not worth stubbing here, but
the fallback path IS pure and sits on the hot path of the submit flow
whenever Anthropic is unreachable. Worth pinning.
"""
from __future__ import annotations

from app.services.proposal_agent import fallback_patch


class TestFallbackPatch:
    def test_field_is_acceptance_criteria(self):
        # acceptance_criteria is the most additive — least risk of
        # clobbering the PM's curated description.
        patch = fallback_patch("We need SSO with Okta.")
        assert patch.field == "acceptance_criteria"

    def test_answer_wrapped_in_list(self):
        patch = fallback_patch("Max file size is 50MB.")
        assert isinstance(patch.new_value, list)
        assert len(patch.new_value) == 1
        assert "50MB" in patch.new_value[0]

    def test_answer_trimmed(self):
        patch = fallback_patch("  Answer with whitespace.   \n")
        assert patch.new_value == ["Client answer: Answer with whitespace."]

    def test_rationale_mentions_llm_unavailability(self):
        patch = fallback_patch("anything")
        assert patch.rationale
        assert "LLM" in patch.rationale
