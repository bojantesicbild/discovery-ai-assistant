# 19 — Structured LLM Output Extraction: Instructor, Marvin, Outlines

> **Date:** 2026-03-31
> **Purpose:** Determine the best approach for extracting structured facts, entities, and classifications from client documents
> **Repos:** [instructor-ai/instructor](https://github.com/instructor-ai/instructor), [prefecthq/marvin](https://github.com/prefecthq/marvin), [dottxt-ai/outlines](https://github.com/dottxt-ai/outlines)

---

## 1. The Three Approaches

| Approach | Tool | When Enforcement Happens | Best For |
|----------|------|-------------------------|----------|
| **Post-hoc validation + retry** | Instructor | After full LLM response | API models (Claude, GPT-4), semantic validation |
| **High-level semantic functions** | Marvin | Internally via Task execution | Quick prototyping, simple extractions |
| **Constrained token generation** | Outlines | During token generation (FSM) | Local models, guaranteed structure |

---

## 2. Instructor — The Recommended Choice

### How It Works

```
Pydantic model → JSON schema → injected into LLM call → response parsed → validated → retry if invalid
```

1. Define a Pydantic `BaseModel` describing desired output
2. Instructor converts to JSON schema, injects into LLM call (as tool/function schema, JSON mode, or structured output depending on provider)
3. LLM returns JSON conforming to schema
4. Instructor validates against Pydantic model
5. If validation fails → error message appended to conversation → LLM re-queried (up to `max_retries`)
6. User receives a typed Python object

### Provider Support (40+ Modes)

| Provider | Modes |
|----------|-------|
| **OpenAI** | TOOLS, TOOLS_STRICT, JSON, JSON_SCHEMA, MD_JSON, PARALLEL_TOOLS |
| **Anthropic** | ANTHROPIC_TOOLS, ANTHROPIC_JSON, ANTHROPIC_REASONING_TOOLS, ANTHROPIC_PARALLEL_TOOLS |
| **Google** | GEMINI_TOOLS, GEMINI_JSON, VERTEXAI_TOOLS, GENAI_STRUCTURED_OUTPUTS |
| **Others** | MISTRAL_TOOLS, COHERE_TOOLS, CEREBRAS_TOOLS, FIREWORKS_TOOLS, BEDROCK_TOOLS, XAI_TOOLS, etc. |

```python
# Auto-detection
client = instructor.from_provider("anthropic/claude-sonnet-4-20250514")
client = instructor.from_provider("openai/gpt-4o")
```

### Validation & Retry — The Key Differentiator

Under the hood uses **tenacity** for retries:
1. Response parsed and validated against Pydantic model
2. If `ValidationError` → error details appended to conversation in provider-specific format
3. Error re-raised → tenacity retries
4. Failed attempts accumulated with attempt number, exception, raw response
5. Token usage tracked across all attempts

```python
response = client.chat.completions.create(
    response_model=MyModel,
    messages=[...],
    max_retries=3,  # or tenacity Retrying object for advanced control
)
```

### Citation Validation Pattern (Critical for Discovery)

```python
class Statement(BaseModel):
    body: str
    substring_quote: str

    @model_validator(mode='wrap')
    @classmethod
    def validate_quote_exists(cls, values, handler, info):
        result = handler(values)
        context = info.context.get('text_chunks', [])
        for chunk in context:
            if result.substring_quote in chunk:
                return result
        raise ValueError(f"Quote '{result.substring_quote}' not found in source text")
```

This pattern ensures extracted facts include a **verifiable quote** from the source document. If the LLM hallucinates a quote, validation fails and retries with the error.

### Streaming Structured Output

```python
from instructor import Partial

for partial_fact in client.chat.completions.create(
    response_model=Partial[Fact],
    stream=True,
    messages=[...],
):
    # Progressive display as fields fill in
    print(partial_fact)
```

`Partial[T]` makes all fields Optional during streaming. Final object is fully validated.

### Iterable Mode (Extract Multiple Objects)

```python
facts = client.chat.completions.create(
    response_model=Iterable[Fact],
    messages=[...],
)
# Returns list of Fact objects
```

---

## 3. Marvin — For Quick Prototyping

Marvin v3.0 provides high-level extraction primitives:

```python
import marvin

# Extract typed entities
entities = marvin.extract(text, Entity)

# Cast unstructured to structured
config = marvin.cast("Azure, single region", HostingConfig)

# Classify into categories
doc_type = marvin.classify(text, DocumentType)

# Generate synthetic data
test_facts = marvin.generate(Fact, 10, "sample discovery facts")
```

**Compared to Instructor:**
- Higher-level abstraction (less control over prompts)
- Default prompts with optional instructions (vs full prompt control)
- Built on Pydantic AI for model support
- Better for simple, quick extractions — not ideal for production pipelines needing fine-grained validation

---

## 4. Outlines — For Local Model Guarantees

Outlines prevents invalid output at the token level via FSM (finite state machine):

```
Pydantic model → JSON schema → regex → FSM → token masking during generation
```

Each FSM state maps to valid next tokens. Invalid tokens get logits set to **negative infinity** — the model literally cannot produce non-conforming output.

**Critical limitation:** Guarantees **structural validity** (JSON parses, fields exist, types match) but NOT **semantic validity** (facts correct, confidence scores accurate). For API models (Claude, GPT-4), falls back to provider's native structured output.

**Our use case:** Not directly applicable since we use API models. Could be useful if we deploy local models for high-volume classification (document type on thousands of docs).

---

## 5. Extraction Schemas for Discovery AI Assistant

### Fact Extraction

```python
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from enum import Enum

class ConfidenceLevel(str, Enum):
    HIGH = "high"       # Explicitly stated by client
    MEDIUM = "medium"   # Implied from context
    LOW = "low"         # Inferred, not directly stated

class Fact(BaseModel):
    statement: str = Field(description="Structured factual claim, e.g. 'Hosting: Azure, single region'")
    category: str = Field(description="One of: infrastructure, security, compliance, integration, process, decision, scope, timeline, budget")
    value: Optional[str] = Field(None, description="Extracted value if applicable")
    confidence: ConfidenceLevel
    source_quote: str = Field(description="Exact substring from source text supporting this fact")
    control_points: List[str] = Field(default_factory=list, description="Control point IDs this fact addresses")

    @field_validator('source_quote')
    @classmethod
    def quote_must_be_substantial(cls, v):
        if len(v.strip()) < 10:
            raise ValueError('Source quote must be at least 10 characters for traceability')
        return v

class FactExtractionResult(BaseModel):
    facts: List[Fact]
    document_summary: str = Field(description="One-sentence summary of source document")
```

### Entity Extraction

```python
class EntityType(str, Enum):
    PERSON = "person"
    ORGANIZATION = "organization"
    FEATURE = "feature"
    INTEGRATION = "integration"
    DECISION = "decision"
    TECHNOLOGY = "technology"
    REQUIREMENT = "requirement"

class Entity(BaseModel):
    name: str
    entity_type: EntityType
    description: Optional[str] = None
    aliases: List[str] = Field(default_factory=list, description="Alternative names/references")

class EntityExtractionResult(BaseModel):
    entities: List[Entity]
```

### Relationship Extraction

```python
class RelationType(str, Enum):
    DECIDED = "decided"
    DEPENDS_ON = "depends_on"
    OWNS = "owns"
    IMPLEMENTS = "implements"
    BLOCKS = "blocks"
    RELATED_TO = "related_to"
    REQUESTED = "requested"
    APPROVED = "approved"

class Relationship(BaseModel):
    source_entity: str
    relation: RelationType
    target_entity: str
    evidence: str = Field(description="Quote supporting this relationship")

class RelationshipExtractionResult(BaseModel):
    relationships: List[Relationship]
```

### Document Classification

```python
class DocumentType(str, Enum):
    MEETING_NOTES = "meeting_notes"
    TECHNICAL_SPEC = "technical_spec"
    EMAIL_THREAD = "email_thread"
    ARCHITECTURE_DECISION = "architecture_decision"
    REQUIREMENTS_DOC = "requirements_doc"
    VENDOR_PROPOSAL = "vendor_proposal"
    STATUS_REPORT = "status_report"

class TopicCategory(str, Enum):
    INFRASTRUCTURE = "infrastructure"
    SECURITY = "security"
    COMPLIANCE = "compliance"
    INTEGRATION = "integration"
    MIGRATION = "migration"
    PERFORMANCE = "performance"
    COST = "cost"

class PriorityLevel(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class DocumentClassification(BaseModel):
    document_type: DocumentType
    primary_topics: List[TopicCategory] = Field(max_length=3)
    priority: PriorityLevel
    confidence: ConfidenceLevel
```

### Contradiction Detection

```python
from typing import Literal

class Contradiction(BaseModel):
    new_fact: str
    existing_fact: str
    contradiction_type: Literal["direct_conflict", "partial_conflict", "supersedes", "narrows_scope"]
    explanation: str
    recommended_resolution: Literal["keep_new", "keep_existing", "merge", "flag_for_review"]

class ContradictionAnalysis(BaseModel):
    contradictions: List[Contradiction]
    no_conflicts: List[str] = Field(default_factory=list, description="New facts with no conflicts")
```

### Control Point Coverage Assessment

```python
class CoverageLevel(str, Enum):
    YES = "yes"
    PARTIAL = "partial"
    NO = "no"

class ControlPointAssessment(BaseModel):
    control_point_id: str
    control_point_description: str
    coverage: CoverageLevel
    evidence: Optional[str] = Field(None, description="Quote addressing this control point")
    gaps: Optional[str] = Field(None, description="What's missing if partial/no")

class ControlPointCoverageResult(BaseModel):
    assessments: List[ControlPointAssessment]
    overall_coverage_pct: float = Field(ge=0, le=100)

    @field_validator('overall_coverage_pct')
    @classmethod
    def validate_coverage(cls, v):
        return round(v, 1)
```

---

## 6. The Complete Extraction Pipeline

### Sequential 6-Stage Pipeline

```python
def extract_from_document(text: str, existing_facts: list = None, control_points: list = None):
    """Full extraction pipeline for a client document."""

    # Stage 1: Classify (cheapest — use fast model)
    classification = client.chat.completions.create(
        response_model=DocumentClassification,
        messages=[
            {"role": "system", "content": "Classify this client discovery document."},
            {"role": "user", "content": text}
        ],
        max_retries=2,
    )

    # Stage 2: Extract facts (core — use capable model)
    fact_result = client.chat.completions.create(
        response_model=FactExtractionResult,
        messages=[
            {"role": "system", "content": f"""Extract all structured facts from this {classification.document_type.value}.
Focus on: infrastructure decisions, technical choices, requirements, constraints, scope, timeline, budget.
For each fact, provide the exact source quote and confidence level.
HIGH = explicitly stated. MEDIUM = implied. LOW = inferred."""},
            {"role": "user", "content": text}
        ],
        max_retries=3,
    )

    # Stage 3: Extract entities (uses fact context as anchors)
    entity_result = client.chat.completions.create(
        response_model=EntityExtractionResult,
        messages=[
            {"role": "system", "content": "Extract all named entities: people, organizations, features, integrations, decisions, technologies."},
            {"role": "user", "content": text},
            {"role": "assistant", "content": f"Previously extracted facts: {[f.statement for f in fact_result.facts]}"},
        ],
        max_retries=2,
    )

    # Stage 4: Extract relationships (uses entities as nodes)
    entity_names = [e.name for e in entity_result.entities]
    relationship_result = client.chat.completions.create(
        response_model=RelationshipExtractionResult,
        messages=[
            {"role": "system", "content": f"Extract relationships between: {entity_names}. Focus on: decided, depends_on, owns, implements, blocks."},
            {"role": "user", "content": text}
        ],
        max_retries=2,
    )

    # Stage 5: Contradiction detection (if existing facts provided)
    contradictions = None
    if existing_facts:
        contradictions = client.chat.completions.create(
            response_model=ContradictionAnalysis,
            messages=[
                {"role": "system", "content": "Compare new facts against existing. Identify conflicts, supersessions, scope narrowing."},
                {"role": "user", "content": f"Existing:\n{chr(10).join(existing_facts)}\n\nNew:\n{chr(10).join(f.statement for f in fact_result.facts)}"}
            ],
            max_retries=2,
        )

    # Stage 6: Control point coverage (if control points provided)
    coverage = None
    if control_points:
        coverage = client.chat.completions.create(
            response_model=ControlPointCoverageResult,
            messages=[
                {"role": "system", "content": "Assess whether the document addresses each control point. Be strict — PARTIAL means vague mentions, YES means explicit coverage."},
                {"role": "user", "content": f"Document:\n{text}\n\nControl points:\n{chr(10).join(f'- {cp}' for cp in control_points)}"}
            ],
            max_retries=2,
        )

    return {
        "classification": classification,
        "facts": fact_result,
        "entities": entity_result,
        "relationships": relationship_result,
        "contradictions": contradictions,
        "coverage": coverage,
    }
```

### Performance Optimization

| Strategy | Detail |
|----------|--------|
| **Model tiering** | Classification: `claude-haiku` / `gpt-4o-mini`. Fact extraction: `claude-sonnet` / `gpt-4o`. Contradiction detection: `claude-sonnet` (needs quality). |
| **Parallel stages** | Stages 3+4 (entities+relationships) can run in parallel with `asyncio.gather()` using `AsyncInstructor` |
| **Caching** | Instructor built-in cache avoids re-extraction of unchanged documents |
| **Token efficiency** | Tool/function modes use fewer tokens than JSON modes (schema in tool definition, not system prompt) |
| **Batch classification** | Use `Iterable[DocumentClassification]` for multiple docs in one call |

### Estimated LLM Calls Per Document

| Stage | Calls (success) | Calls (with retries) | Model Tier |
|-------|-----------------|---------------------|------------|
| Classification | 1 | 1-2 | Cheap |
| Fact extraction | 1 | 1-3 | Standard |
| Entity extraction | 1 | 1-2 | Standard |
| Relationship extraction | 1 | 1-2 | Standard |
| Contradiction detection | 1 | 1-2 | Standard |
| Control point coverage | 1 | 1-2 | Standard |
| **Total** | **6** | **6-13** | — |

Add Mem0's 5 calls (fact dedup + graph) = **11-18 LLM calls per document total**.

---

## 7. Key Insights

### 7.1 Instructor Is the Right Tool

- Full prompt control for each extraction type
- Semantic validation via Pydantic validators (not just structural)
- Citation validation pattern ensures extracted quotes exist in source text
- Retry logic feeds validation errors back to LLM for self-correction
- 40+ provider modes — works with Claude, GPT-4, Gemini, etc.

### 7.2 The Citation Validation Pattern Is Critical

For our discovery system, every extracted fact MUST include a verifiable source quote. Instructor's `@model_validator` with context injection lets us validate that the quote actually exists in the source document. If the LLM hallucinates a quote, the retry mechanism forces it to find a real one.

This directly implements the **verification-before-completion** pattern from Superpowers research.

### 7.3 Contradiction Detection as a Separate Stage

Running contradiction detection as a separate extraction (Stage 5) rather than trying to do it during fact extraction (Stage 2) is better because:
- The LLM has access to ALL existing facts for comparison
- A fresh prompt focused solely on contradiction detection produces better results
- We can use a more capable model for this critical stage

### 7.4 Integration with Mem0

Our pipeline has two layers of extraction:
1. **Instructor** (our code) — extracts typed, validated facts with source quotes and confidence
2. **Mem0** — receives those facts and handles ADD/UPDATE/DELETE deduplication + graph

We can either:
- **Option A:** Use Instructor for extraction, then feed results to Mem0 as pre-extracted facts (bypass Mem0's extraction)
- **Option B:** Use Mem0's extraction prompts (customized) and only use Instructor for contradiction detection + control point coverage

**Recommendation: Option A** — we get better extraction quality with Instructor's validation + retry, and we still get Mem0's dedup + graph for free.

```python
# Extract with Instructor (validated, with source quotes)
result = extract_from_document(text, existing_facts, control_points)

# Feed validated facts to Mem0 (skip Mem0's extraction, use infer=False)
for fact in result["facts"].facts:
    mem0.add(
        fact.statement,
        user_id=po_id,
        metadata={
            "matter_id": matter_id,
            "category": fact.category,
            "confidence": fact.confidence.value,
            "source_quote": fact.source_quote,
            "control_points": fact.control_points,
        },
        infer=False,  # Don't re-extract — we already did
    )
```

### 7.5 The `infer=False` Flag in Mem0

Mem0 supports `infer=False` which stores the memory as-is without running the extraction LLM call. This means we can:
1. Extract with Instructor (high quality, validated)
2. Store in Mem0 with `infer=False` (skip redundant extraction)
3. Still get Mem0's search, dedup on subsequent adds, and graph integration

This reduces per-document LLM calls from 11-18 to **6-13** (Instructor only) + Mem0 graph calls.
