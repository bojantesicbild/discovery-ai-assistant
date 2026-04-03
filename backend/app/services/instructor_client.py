"""Instructor client — typed extraction with Pydantic validation + retry."""

import instructor
from anthropic import AsyncAnthropic
from app.config import settings
from app.schemas.extraction import DiscoveryExtraction


class InstructorClient:
    def __init__(self):
        self._anthropic = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self._client = instructor.from_anthropic(self._anthropic)

    async def extract(
        self,
        text: str,
        model: str = "claude-sonnet-4-20250514",
        max_retries: int = 2,
    ) -> DiscoveryExtraction:
        """Extract typed business data from a document.

        Returns DiscoveryExtraction with:
        - requirements (FR-001, NFR-001 with MoSCoW priority)
        - constraints (budget, timeline, tech)
        - decisions (who/when/why)
        - stakeholders (name/role/authority)
        - assumptions (risk if wrong)
        - scope items (in/out of MVP)
        - contradictions (auto-detected)
        """
        result = await self._client.chat.completions.create(
            model=model,
            response_model=DiscoveryExtraction,
            max_retries=max_retries,
            messages=[
                {
                    "role": "system",
                    "content": EXTRACTION_PROMPT,
                },
                {
                    "role": "user",
                    "content": f"Extract all structured business data from this document:\n\n{text}",
                },
            ],
            max_tokens=8192,
        )
        return result

    async def classify_document(
        self,
        text_sample: str,
        filename: str,
        model: str = "claude-haiku-4-5-20251001",
    ) -> str:
        """Classify a document to determine the RAGFlow chunking template.

        Returns one of: book, manual, email, laws, presentation, table, naive
        """
        response = await self._anthropic.messages.create(
            model=model,
            max_tokens=50,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Classify this document into ONE category for chunking.\n"
                        f"Filename: {filename}\n"
                        f"First 2000 chars:\n{text_sample[:2000]}\n\n"
                        f"Reply with ONLY one word: meeting, specification, contract, general\n"
                        f"- meeting = meeting notes, transcripts, call summaries\n"
                        f"- specification = technical specs, API docs, architecture docs\n"
                        f"- contract = legal docs, contracts, agreements\n"
                        f"- general = everything else"
                    ),
                }
            ],
        )
        classification = response.content[0].text.strip().lower()

        # Map to RAGFlow chunking templates
        template_map = {
            "meeting": "book",
            "specification": "manual",
            "contract": "laws",
            "general": "naive",
        }
        return template_map.get(classification, "naive")


EXTRACTION_PROMPT = """You are a business analyst extracting structured data from client communications for software project discovery.

Extract ALL of the following from the document:

1. REQUIREMENTS (functional and non-functional)
   - Assign IDs: FR-001, FR-002... for functional, NFR-001... for non-functional
   - Priority: must/should/could/wont (infer from language: "critical"=must, "nice to have"=could)
   - Include user perspective: "As a [role], I want [X], so that [Y]"
   - List business rules and edge cases mentioned
   - MUST include exact source quote (≥10 characters)
   - Status: proposed (default), discussed (mentioned multiple times), confirmed (explicitly agreed)

2. CONSTRAINTS (budget, timeline, technology, regulatory, organizational)
   - Include impact on the project
   - MUST include exact source quote

3. DECISIONS (what was decided, by whom, why)
   - Include alternatives that were considered
   - List impacted requirement IDs

4. STAKEHOLDERS (people mentioned with roles)
   - Decision authority: final (makes the call), recommender (influences), informed (kept in loop)
   - Interests: what they care about

5. ASSUMPTIONS (things implied but not explicitly confirmed)
   - Include the basis for the assumption
   - Include risk if the assumption is wrong
   - Who should validate this

6. SCOPE ITEMS (explicitly in or out of MVP)
   - in_scope: true for included, false for explicitly excluded
   - Include rationale

7. CONTRADICTIONS (conflicts with previous information)
   - Only flag if you detect conflicting statements within this document

RULES:
- Every extracted item MUST have a source_quote (exact text from the document, ≥10 chars)
- Do NOT invent information. Only extract what's in the document.
- Mark confidence as: high (explicitly stated), medium (implied), low (inferred)
- If unsure about priority, default to "should"
- If unsure about status, default to "proposed"
"""


# Singleton
instructor_client = InstructorClient()
