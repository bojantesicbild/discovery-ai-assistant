# 32 — Simplification: Are We Extracting the Right Things?

> **Date:** 2026-04-03
> **Purpose:** Pressure-test our extraction model and agent design from first principles
> **The question:** Are we overcomplicated? Are we getting the right data?

---

## 1. What Discovery Actually Needs to Produce

The ENTIRE purpose of discovery is to produce 3 documents for Phase 2:

| Document | Core Content | What Phase 2 Uses It For |
|----------|-------------|-------------------------|
| **Discovery Brief** | Client overview, business context, users, market | Big picture understanding |
| **MVP Scope Freeze** | Features in/out, platforms, integrations, deployment | Boundaries and constraints |
| **Functional Requirements** | FR-001, FR-002... with priority, user stories, business rules | Story breakdown + tech doc generation |

**Phase 2's tech-agent needs REQUIREMENTS, not facts.**

A "fact" like `"Hosting: Azure"` is useful context. But what Phase 2 needs is:

```
FR-007: Cloud Hosting
  Priority: Must
  Description: System shall be deployed on Microsoft Azure, single region
  Constraints: Client's IT policy mandates Azure for all new projects
  Source: Meeting 3, CTO decision
  Status: Confirmed
```

---

## 2. What We're Currently Extracting vs What We Need

### Current: Generic "Facts"

```python
class Fact(BaseModel):
    statement: str       # "Hosting: Azure, single region"
    category: str        # infrastructure
    value: str           # "Azure"
    confidence: str      # high
    source_quote: str    # "We'll deploy everything on Azure"
```

**Problem:** This is a flat key-value. It doesn't distinguish between:
- A requirement ("System SHALL support SSO")
- A constraint ("Budget is $50K")
- A decision ("CTO chose Azure")
- A preference ("Client prefers dark mode")
- Context ("Company has 200 employees")
- An assumption ("We assume 500 concurrent users")

All of these are currently stored as generic "facts" with a category tag. But they have
fundamentally different structures, priorities, and uses.

### What We Should Extract Instead

```python
# The core discovery data types — what POs actually need

class Requirement(BaseModel):
    """A functional or non-functional requirement."""
    id: str                    # FR-001, NFR-001 (auto-generated)
    title: str                 # "SSO Authentication"
    type: Literal["functional", "non_functional"]
    priority: Literal["must", "should", "could", "wont"]  # MoSCoW
    description: str           # "System shall authenticate via Microsoft SSO"
    user_perspective: Optional[str]  # "As an admin, I want SSO so that..."
    business_rules: list[str]  # ["Only company email domains", ...]
    edge_cases: list[str]      # ["SSO provider down", ...]
    source_doc: str            # "Meeting 3 notes"
    source_quote: str          # Exact quote
    status: Literal["proposed", "discussed", "confirmed", "changed", "dropped"]
    confidence: Literal["high", "medium", "low"]
    control_points: list[str]  # Which control points this addresses

class Constraint(BaseModel):
    """A business, technical, or organizational constraint."""
    type: Literal["budget", "timeline", "technology", "regulatory", "organizational"]
    description: str           # "Budget capped at $50K for MVP"
    impact: str                # "Limits technology choices and team size"
    source_doc: str
    source_quote: str
    status: Literal["confirmed", "assumed", "negotiable"]

class Decision(BaseModel):
    """A decision made during discovery."""
    title: str                 # "Azure for hosting"
    decided_by: str            # "Sarah Chen (CTO)"
    date: str                  # "2026-03-15"
    rationale: str             # "Company IT policy mandates Azure"
    alternatives_considered: list[str]  # ["AWS", "GCP"]
    impacts: list[str]         # ["FR-007", "NFR-003"]
    source_doc: str
    status: Literal["confirmed", "tentative", "reversed"]

class Stakeholder(BaseModel):
    """A person involved in the project."""
    name: str
    role: str                  # "CTO", "Product Manager", "End User"
    organization: str
    decision_authority: Literal["final", "recommender", "informed"]
    interests: list[str]       # ["Security", "Cost optimization"]
    contact: Optional[str]

class Assumption(BaseModel):
    """Something we believe is true but hasn't been confirmed."""
    statement: str             # "500 concurrent users max"
    basis: str                 # "PO estimate based on similar projects"
    risk_if_wrong: str         # "Architecture may not scale"
    source_doc: Optional[str]
    needs_validation_by: Optional[str]  # "Client CTO"

class ScopeItem(BaseModel):
    """Something explicitly in or out of MVP scope."""
    description: str           # "Real-time notifications"
    in_scope: bool             # True = in MVP, False = explicitly excluded
    rationale: str             # "Client says this is critical for launch"
    source_doc: str
```

### The Difference

| Current ("Facts") | Proposed (Typed Extraction) |
|-------------------|---------------------------|
| Everything is a flat "fact" | Requirements, Constraints, Decisions, Stakeholders, Assumptions, Scope Items |
| Generic category tag | Typed structure with fields relevant to each type |
| No priority | Requirements have MoSCoW priority |
| No user perspective | Requirements have "As a [role], I want..." |
| No business rules | Requirements list business rules and edge cases |
| No decision tracking | Decisions track who, when, why, alternatives |
| No assumption risk | Assumptions track risk-if-wrong |
| No scope classification | Scope items are explicit in/out |

---

## 3. Does This Change the Pipeline?

**The pipeline stays the same.** Only the extraction stage changes:

```
Current Stage 2:
  2a. Classify document
  2b. Extract facts (generic)
  2c. Extract entities
  2d. Extract relationships
  2e. Detect contradictions
  2f. Control point coverage

Proposed Stage 2:
  2a. Classify document (same)
  2b. Extract TYPED items:
      → Requirements (functional + non-functional)
      → Constraints (budget, timeline, tech, regulatory)
      → Decisions (who decided what, when, why)
      → Stakeholders (people, roles, authority)
      → Assumptions (unvalidated beliefs)
      → Scope items (in/out of MVP)
  2c. Extract entities + relationships (same, but informed by typed items)
  2d. Detect contradictions (same, but across typed items)
  2e. Control point coverage (same, but mapped from typed items)
```

The difference: instead of one generic `FactExtractionResult`, we extract a
`DiscoveryExtraction` with typed fields. The LLM does the same work — it just
produces structured output that matches what Phase 2 actually needs.

---

## 4. Do We Need 6 Subagents? Let's Simplify.

Current 6 subagents:
1. gap-analyzer
2. meeting-prep
3. doc-generator
4. deep-analyzer
5. company-researcher
6. code-analyst

**Honest assessment:**

| Subagent | Actually Needed? | Why |
|----------|-----------------|-----|
| **gap-analyzer** | YES | Core feature — checks what's missing, classifies AUTO-RESOLVE/ASK |
| **meeting-prep** | YES but... | This is really gap-analyzer + formatting. Could be a mode of gap-analyzer, not a separate agent. |
| **doc-generator** | YES | Core feature — produces the 3 handoff documents |
| **deep-analyzer** | NO as separate agent | The coordinator agent can do deep search with tools. This is just "search harder." |
| **company-researcher** | MAYBE | Web search is a TOOL, not an agent. The coordinator can use DuckDuckGo/Tavily directly. |
| **code-analyst** | MAYBE | Specialized, but only needed for some projects. Could be an on-demand tool set. |

### Simplified: 3 Core Subagents + Tool-Based Capabilities

```
SUBAGENTS (separate Agent instances with own prompts + output types):
  1. gap-analyzer     — structured gap analysis with typed output (GapAnalysisResult)
  2. doc-generator    — produces 3 handoff documents with source attribution
  3. meeting-prep     — generates meeting agendas (could be mode of gap-analyzer)

TOOL-BASED CAPABILITIES (coordinator uses these directly, no subagent needed):
  - Web research     → DuckDuckGoSearchTool + TavilySearchTool + WebFetchTool
  - Code analysis    → Custom bash/read/grep tools (enabled per project)
  - Deep analysis    → search_all + search_graph tools with more context
```

**Why this is simpler:**
- 3 subagents instead of 6
- Web research and code analysis are TOOLS the coordinator uses, not separate agents
- "Deep analysis" is just the coordinator using its tools more thoroughly
- Meeting prep could even be a mode of gap-analyzer ("analyze gaps + format as agenda")

**Why subagents exist at all:**
- They need DIFFERENT system prompts (different personas, anti-rationalization tables)
- They need STRUCTURED output types (GapAnalysisResult, MeetingAgenda, DiscoveryDocuments)
- They need ISOLATED context (don't inherit the full chat history)

The coordinator handles everything else with tools.

---

## 5. Simplified Architecture

```
PO types in chat
       │
       ▼
┌─ Coordinator Agent (Pydantic AI) ──────────────────────┐
│                                                          │
│  Has TOOLS for:                                          │
│  • search_documents (RAGFlow)                           │
│  • search_requirements (RAGFlow facts + PostgreSQL)     │
│  • search_graph (RAGFlow GraphRAG)                      │
│  • search_all (cross-phase: all 3 datasets)             │
│  • get_control_points (PostgreSQL)                      │
│  • get_project_context (preamble)                       │
│  • store_finding (PostgreSQL + RAGFlow)                 │
│  • web_search (DuckDuckGo/Tavily)                       │
│  • web_fetch (httpx)                                    │
│  • generate_report (HTML)                               │
│  • sync_pipeline (.memory-bank/ from git)               │
│                                                          │
│  Dispatches SUBAGENTS for complex structured tasks:     │
│  • gap-analyzer → GapAnalysisResult (typed)             │
│  • doc-generator → DiscoveryDocuments (typed)           │
│  • meeting-prep → MeetingAgenda (typed)                 │
│                                                          │
│  The coordinator handles everything else directly:      │
│  • "Research ACME Corp" → uses web_search + web_fetch   │
│  • "Analyze this repo" → uses bash + read + grep tools  │
│  • "What did client say about auth?" → uses search_docs │
│  • "Who decided on SSO?" → uses search_graph            │
│  • "Show me project health" → uses search_all           │
└──────────────────────────────────────────────────────────┘
```

---

## 6. Revised Extraction Models

### The Core Types

```python
from pydantic import BaseModel, Field
from typing import Optional, Literal
from enum import Enum

# ── REQUIREMENTS (the primary discovery output) ──────────

class RequirementType(str, Enum):
    FUNCTIONAL = "functional"
    NON_FUNCTIONAL = "non_functional"

class Priority(str, Enum):
    MUST = "must"
    SHOULD = "should"
    COULD = "could"
    WONT = "wont"

class Requirement(BaseModel):
    """A functional or non-functional requirement extracted from client communication."""
    id: str = Field(description="Auto-generated: FR-001, NFR-001")
    title: str = Field(description="Short title: 'SSO Authentication'")
    type: RequirementType
    priority: Priority = Field(description="MoSCoW: must/should/could/won't")
    description: str = Field(description="What the system shall do")
    user_perspective: Optional[str] = Field(None, description="As a [role], I want [X], so that [Y]")
    business_rules: list[str] = Field(default_factory=list)
    edge_cases: list[str] = Field(default_factory=list)
    source_doc: str
    source_quote: str
    status: Literal["proposed", "discussed", "confirmed", "changed", "dropped"] = "proposed"
    confidence: Literal["high", "medium", "low"] = "medium"

# ── CONSTRAINTS ──────────────────────────────────────────

class Constraint(BaseModel):
    """A budget, timeline, technology, or regulatory constraint."""
    type: Literal["budget", "timeline", "technology", "regulatory", "organizational"]
    description: str
    impact: str = Field(description="How this constrains the project")
    source_doc: str
    source_quote: str
    status: Literal["confirmed", "assumed", "negotiable"] = "assumed"

# ── DECISIONS ────────────────────────────────────────────

class Decision(BaseModel):
    """A decision made during discovery."""
    title: str
    decided_by: str
    date: Optional[str] = None
    rationale: str
    alternatives_considered: list[str] = Field(default_factory=list)
    impacts: list[str] = Field(default_factory=list, description="Requirement IDs affected")
    source_doc: str
    status: Literal["confirmed", "tentative", "reversed"] = "tentative"

# ── STAKEHOLDERS ─────────────────────────────────────────

class Stakeholder(BaseModel):
    """A person involved in the project."""
    name: str
    role: str
    organization: str
    decision_authority: Literal["final", "recommender", "informed"] = "informed"
    interests: list[str] = Field(default_factory=list)

# ── ASSUMPTIONS ──────────────────────────────────────────

class Assumption(BaseModel):
    """Something we believe but haven't confirmed with the client."""
    statement: str
    basis: str = Field(description="Why we assume this")
    risk_if_wrong: str = Field(description="What breaks if this assumption is wrong")
    needs_validation_by: Optional[str] = Field(None, description="Who should confirm this")

# ── SCOPE ────────────────────────────────────────────────

class ScopeItem(BaseModel):
    """Something explicitly in or out of MVP scope."""
    description: str
    in_scope: bool
    rationale: str
    source_doc: str

# ── THE COMPLETE EXTRACTION ──────────────────────────────

class DiscoveryExtraction(BaseModel):
    """Everything extracted from a single document."""
    requirements: list[Requirement] = Field(default_factory=list)
    constraints: list[Constraint] = Field(default_factory=list)
    decisions: list[Decision] = Field(default_factory=list)
    stakeholders: list[Stakeholder] = Field(default_factory=list)
    assumptions: list[Assumption] = Field(default_factory=list)
    scope_items: list[ScopeItem] = Field(default_factory=list)
    contradictions: list[Contradiction] = Field(default_factory=list)
    document_summary: str
```

### What Changed from the Generic "Fact" Model

| Before | After | Why |
|--------|-------|-----|
| Everything is a `Fact` | 6 typed categories | Phase 2 needs structured requirements, not flat facts |
| Generic `category: str` | Typed models with specific fields | Each type has different fields that matter |
| No priority | `Priority` enum (MoSCoW) | Phase 2 needs to know what's must vs should |
| No user perspective | `user_perspective` on requirements | Tech-agent uses this for story generation |
| No business rules | `business_rules` list | Tech-agent needs this for acceptance criteria |
| No edge cases | `edge_cases` list | Prevents Phase 2 from missing them |
| No decision tracking | `Decision` with who/when/why/alternatives | Audit trail for architectural decisions |
| No assumption risk | `Assumption` with risk_if_wrong | Phase 2 knows what to validate |
| No scope classification | `ScopeItem` with in/out + rationale | Prevents scope creep |

---

## 7. Does This Simplify Control Points?

**Yes, significantly.**

Control points are essentially: "Do we have enough requirements, constraints, decisions,
stakeholders, and assumptions to start Phase 2?"

Instead of 40 individual control point checks, we can derive readiness from the
extracted data:

```
Business Understanding:
  ✅ = stakeholders extracted + business constraints confirmed
  ⚠️ = stakeholders mentioned but authority unclear
  ❌ = no stakeholder information

Functional Requirements:
  ✅ = requirements with priority + user perspective + business rules
  ⚠️ = requirements exist but priority or rules missing
  ❌ = no requirements extracted

Technical Context:
  ✅ = technology decisions confirmed + constraints documented
  ⚠️ = decisions tentative or constraints assumed
  ❌ = no technical decisions

Scope Freeze:
  ✅ = explicit in-scope AND out-of-scope items
  ⚠️ = in-scope listed but out-of-scope missing
  ❌ = no scope definition
```

**Control points become a VIEW on the extracted data, not a separate evaluation.**

We still keep the control point templates (they tell the system WHAT to check).
But evaluation is: "do we have the right typed data for each checkpoint?"
— not an LLM call per checkpoint.

---

## 8. The Simplified Stack

```
EXTRACTION (typed, not generic):
  Document → Instructor → DiscoveryExtraction
    (requirements, constraints, decisions, stakeholders, assumptions, scope)

STORAGE:
  Requirements → PostgreSQL requirements table + RAGFlow facts dataset
  Constraints → PostgreSQL constraints table
  Decisions → PostgreSQL decisions table
  Stakeholders → PostgreSQL stakeholders table
  Assumptions → PostgreSQL assumptions table
  Scope items → PostgreSQL scope_items table
  Raw documents → RAGFlow client-docs dataset

EVALUATION (derived, not LLM-called):
  Control points → SQL queries against typed tables
    "Do we have confirmed requirements with priority for each feature area?"
    "Do we have stakeholders with decision authority?"
    "Do we have explicit out-of-scope items?"

AGENT (3 subagents, not 6):
  gap-analyzer → queries typed tables, identifies what's missing/weak
  doc-generator → queries typed tables + RAGFlow, produces 3 documents
  meeting-prep → queries gaps, formats as agenda

COORDINATOR (tools, not subagents, for):
  web research, code analysis, deep search, graph queries
```

---

## 9. What This Means for the Database

### Replace generic `facts` table with typed tables:

```sql
-- Requirements (the core output)
CREATE TABLE requirements (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    req_id VARCHAR NOT NULL,          -- FR-001, NFR-001
    title VARCHAR NOT NULL,
    type VARCHAR NOT NULL,            -- functional, non_functional
    priority VARCHAR NOT NULL,        -- must, should, could, wont
    description TEXT NOT NULL,
    user_perspective TEXT,
    business_rules JSONB DEFAULT '[]',
    edge_cases JSONB DEFAULT '[]',
    source_doc_id UUID REFERENCES documents(id),
    source_quote TEXT NOT NULL,
    status VARCHAR DEFAULT 'proposed',
    confidence VARCHAR DEFAULT 'medium',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Constraints
CREATE TABLE constraints (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    type VARCHAR NOT NULL,
    description TEXT NOT NULL,
    impact TEXT NOT NULL,
    source_doc_id UUID REFERENCES documents(id),
    source_quote TEXT NOT NULL,
    status VARCHAR DEFAULT 'assumed',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Decisions
CREATE TABLE decisions (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    title VARCHAR NOT NULL,
    decided_by VARCHAR,
    decided_date DATE,
    rationale TEXT NOT NULL,
    alternatives JSONB DEFAULT '[]',
    impacts JSONB DEFAULT '[]',     -- requirement IDs affected
    source_doc_id UUID REFERENCES documents(id),
    status VARCHAR DEFAULT 'tentative',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Stakeholders
CREATE TABLE stakeholders (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    name VARCHAR NOT NULL,
    role VARCHAR NOT NULL,
    organization VARCHAR NOT NULL,
    decision_authority VARCHAR DEFAULT 'informed',
    interests JSONB DEFAULT '[]',
    contact VARCHAR,
    source_doc_id UUID REFERENCES documents(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Assumptions
CREATE TABLE assumptions (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    statement TEXT NOT NULL,
    basis TEXT NOT NULL,
    risk_if_wrong TEXT NOT NULL,
    needs_validation_by VARCHAR,
    validated BOOLEAN DEFAULT FALSE,
    source_doc_id UUID REFERENCES documents(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Scope items
CREATE TABLE scope_items (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    description TEXT NOT NULL,
    in_scope BOOLEAN NOT NULL,
    rationale TEXT NOT NULL,
    source_doc_id UUID REFERENCES documents(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Keep contradictions (cross-type)
CREATE TABLE contradictions (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    item_a_type VARCHAR NOT NULL,     -- requirement, constraint, decision, etc.
    item_a_id UUID NOT NULL,
    item_b_type VARCHAR NOT NULL,
    item_b_id UUID NOT NULL,
    explanation TEXT NOT NULL,
    resolution_type VARCHAR,          -- keep_a, keep_b, merge, flag
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Keep change history (audit trail for any item type)
CREATE TABLE change_history (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    item_type VARCHAR NOT NULL,       -- requirement, constraint, decision, etc.
    item_id UUID NOT NULL,
    action VARCHAR NOT NULL,          -- created, updated, status_changed, deleted
    old_value JSONB,
    new_value JSONB,
    triggered_by VARCHAR,             -- pipeline, po-manual
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 10. Summary: What Changed

| Dimension | Before | After |
|-----------|--------|-------|
| **Extraction model** | Generic `Fact` (flat key-value) | 6 typed models: Requirement, Constraint, Decision, Stakeholder, Assumption, ScopeItem |
| **Subagents** | 6 (gap-analyzer, meeting-prep, doc-generator, deep-analyzer, company-researcher, code-analyst) | 3 subagents (gap, docs, meeting) + tools for everything else |
| **Control points** | Separate LLM evaluation per checkpoint | SQL queries on typed tables (derived, not LLM-called) |
| **Database** | One generic `facts` table | 6 typed tables + contradictions + change history |
| **Pipeline** | Extract generic facts | Extract typed DiscoveryExtraction |
| **Phase 2 handoff** | Flat facts → PO manually organizes into templates | Typed requirements with priority, user stories, business rules → direct template fill |
| **Cost** | LLM call per control point evaluation | SQL queries (free) + LLM only for initial extraction |
