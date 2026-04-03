# 20 — Revised Architecture Decision

> **Date:** 2026-03-31
> **Purpose:** Final architecture based on all research (documents 00-19)
> **Status:** APPROVED — replaces research/12-architecture-decision.md
> **Key Change:** 7 agents → automated pipeline + 5 on-demand skills

---

## 1. Why We Changed

The original architecture (research/12) designed 7 persistent agents orchestrated via a custom framework. After researching Superpowers, gstack, Mem0, RAGFlow, LangGraph/CrewAI, and Instructor, we discovered:

1. **Mem0 + Instructor already do what 3 agents were supposed to do** — fact extraction, deduplication, contradiction detection, entity/relationship mapping
2. **RAGFlow already does what the Intake Agent was supposed to do** — document parsing, chunking, metadata extraction
3. **Agent orchestration frameworks (LangGraph, CrewAI) are overkill** — our workflow is a linear pipeline + independent skills, not a DAG
4. **gstack's model is better** — on-demand skills (SKILL.md) invoked when needed, not persistent agents waiting around

**The intelligence is in the pipeline and knowledge layers, not in the agents.**

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                  │
│  Next.js — Dashboard + Chat + Document Viewer + Settings          │
└────────────────────────────┬─────────────────────────────────────┘
                             │ REST API
┌────────────────────────────▼─────────────────────────────────────┐
│                      BACKEND (FastAPI)                             │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │  Pipeline     │  │  Skills      │  │  Application Layer      │ │
│  │  Service      │  │  Service     │  │                         │ │
│  │               │  │              │  │  Project management     │ │
│  │  • parse      │  │  • /gaps     │  │  Control point templates│ │
│  │  • extract    │  │  • /prep     │  │  User management        │ │
│  │  • store      │  │  • /generate │  │  Settings               │ │
│  │  • evaluate   │  │  • /simulate │  │  Dashboard data         │ │
│  │               │  │  • /analyze  │  │                         │ │
│  └───────┬───────┘  └──────┬───────┘  └─────────────────────────┘ │
│          │                 │                                       │
│  ┌───────▼─────────────────▼─────────────────────────────────┐   │
│  │                  Shared Services                            │   │
│  │                                                            │   │
│  │  InstructorClient — structured extraction + validation     │   │
│  │  Mem0Client — fact store + entity graph                    │   │
│  │  RAGFlowClient — document search + parsing                │   │
│  │  PreambleBuilder — context assembly for skills             │   │
│  │  LearningStore — per-matter + cross-matter JSONL           │   │
│  │  ControlPointEvaluator — readiness scoring                 │   │
│  └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
  ┌──────▼──────┐    ┌──────▼──────┐     ┌──────▼──────┐
  │   RAGFlow   │    │    Mem0     │     │  PostgreSQL │
  │   (Docker)  │    │  (Docker)   │     │             │
  │             │    │             │     │  projects   │
  │  ES         │    │  Qdrant     │     │  users      │
  │  MinIO      │    │  Neo4j      │     │  templates  │
  │  MySQL      │    │             │     │  settings   │
  └─────────────┘    └─────────────┘     │  learnings  │
                                         └─────────────┘
         + Redis (task queue for async pipeline processing)
```

---

## 3. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Backend** | Python 3.12 + FastAPI | Async, Pydantic-native, great for API-heavy apps |
| **LLM** | Claude API (Anthropic SDK) | Best reasoning, long context (200K), tool use |
| **Extraction** | Instructor | Pydantic validation + retry + citation verification |
| **Fact Store + Graph** | Mem0 (self-hosted) | ADD/UPDATE/DELETE dedup + Neo4j graph |
| **Document Search** | RAGFlow (self-hosted) | DeepDoc parsing + 14 chunking templates |
| **Database** | PostgreSQL | Projects, users, templates, settings |
| **Queue** | Redis (via arq or celery) | Async pipeline processing on upload |
| **Frontend** | Next.js + React | Dashboard + chat interface |
| **Deploy** | Docker Compose | All services in one stack |

### Model Tiering

| Task | Model | Cost/Quality |
|------|-------|-------------|
| Document classification | `claude-haiku` | Cheap, fast |
| Fact extraction | `claude-sonnet` | Quality extraction |
| Entity/relationship extraction | `claude-sonnet` | Quality extraction |
| Contradiction detection | `claude-sonnet` | Needs careful reasoning |
| Control point coverage | `claude-sonnet` | Needs judgment |
| Skills (/gaps, /prep, /generate, /simulate, /analyze) | `claude-sonnet` | Best reasoning |
| Complex analysis (deep contradictions, role simulation) | `claude-opus` | When quality is critical |

---

## 4. The Automated Pipeline

Triggered on every document upload. Fully automated, no PO interaction needed.

### Pipeline Stages

```
Document Upload
       │
       ▼
┌─── Stage 1: Parse ─────────────────────────────────────────────┐
│  RAGFlow API: upload document, parse (DeepDoc), chunk           │
│  Template selection based on file type:                         │
│    .eml → email | .pdf meeting → book | .pdf spec → manual     │
│    .pptx → presentation | .xlsx → table | .docx → naive        │
│  Result: searchable chunks in Elasticsearch                     │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                                   ▼
┌─── Stage 2: Extract ────────────────────────────────────────────┐
│  Instructor: 6-stage extraction pipeline                        │
│                                                                 │
│  2a. Classify document (haiku)                                  │
│  2b. Extract facts with source quotes (sonnet)                  │
│  2c. Extract entities (sonnet)           ┐                      │
│  2d. Extract relationships (sonnet)      ┘ parallel             │
│  2e. Detect contradictions vs existing facts (sonnet)           │
│  2f. Assess control point coverage (sonnet)                     │
│                                                                 │
│  All outputs validated via Pydantic + citation verification     │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                                   ▼
┌─── Stage 3: Store ──────────────────────────────────────────────┐
│  Mem0: store facts (infer=False) with custom metadata           │
│    - matter_id, category, confidence, source_quote              │
│    - control_points, fact_status (new)                          │
│  Mem0 Graph: entities + relationships auto-stored               │
│  PostgreSQL: document record, processing status                 │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                                   ▼
┌─── Stage 4: Evaluate ───────────────────────────────────────────┐
│  Control Point Evaluator:                                       │
│    - Re-score all control points against updated fact store     │
│    - Calculate readiness percentage (weighted by priority)      │
│    - Identify status changes (improved, degraded, new gaps)     │
│  Dashboard: update readiness score, flag contradictions,        │
│             highlight new gaps, show what changed                │
└─────────────────────────────────────────────────────────────────┘
```

### Pipeline Implementation

```python
# pipeline/service.py

class PipelineService:
    def __init__(self, ragflow: RAGFlowClient, instructor: InstructorClient,
                 mem0: Mem0Client, evaluator: ControlPointEvaluator, db: Database):
        self.ragflow = ragflow
        self.instructor = instructor
        self.mem0 = mem0
        self.evaluator = evaluator
        self.db = db

    async def process_document(self, project_id: str, file: UploadFile) -> PipelineResult:
        # Stage 1: Parse
        doc_id = await self.ragflow.upload_and_parse(project_id, file)
        text = await self.ragflow.get_parsed_text(doc_id)

        # Stage 2: Extract
        existing_facts = await self.mem0.get_all_facts(project_id)
        control_points = await self.db.get_control_points(project_id)

        extraction = await self.instructor.extract_from_document(
            text=text,
            existing_facts=[f.statement for f in existing_facts],
            control_points=[cp.description for cp in control_points],
        )

        # Stage 3: Store
        await self.mem0.store_facts(project_id, extraction.facts)
        await self.mem0.store_entities(project_id, extraction.entities)
        await self.mem0.store_relationships(project_id, extraction.relationships)

        # Stage 4: Evaluate
        readiness = await self.evaluator.evaluate(project_id)

        # Record result
        result = PipelineResult(
            document_id=doc_id,
            classification=extraction.classification,
            facts_extracted=len(extraction.facts),
            entities_extracted=len(extraction.entities),
            contradictions=extraction.contradictions,
            coverage=extraction.coverage,
            readiness=readiness,
        )
        await self.db.save_pipeline_result(project_id, result)

        return result
```

### LLM Calls Per Document

| Stage | Calls | Model | Estimated Cost |
|-------|-------|-------|---------------|
| 2a. Classification | 1 | haiku | ~$0.001 |
| 2b. Fact extraction | 1-3 | sonnet | ~$0.02 |
| 2c. Entity extraction | 1-2 | sonnet | ~$0.01 |
| 2d. Relationship extraction | 1-2 | sonnet | ~$0.01 |
| 2e. Contradiction detection | 1-2 | sonnet | ~$0.02 |
| 2f. Control point coverage | 1-2 | sonnet | ~$0.02 |
| Mem0 graph (3 calls) | 3 | sonnet | ~$0.03 |
| **Total** | **10-17** | — | **~$0.10-0.15** |

Per document cost: approximately $0.10-0.15. A typical discovery project (20-30 documents) = $2-5 total pipeline cost.

---

## 5. The Five On-Demand Skills

### Skill Architecture

Each skill follows the same pattern:

```python
# skills/base.py

class SkillRunner:
    def __init__(self, instructor: InstructorClient, mem0: Mem0Client,
                 ragflow: RAGFlowClient, preamble: PreambleBuilder,
                 learnings: LearningStore):
        self.instructor = instructor
        self.mem0 = mem0
        self.ragflow = ragflow
        self.preamble = preamble
        self.learnings = learnings

    async def run(self, project_id: str, skill_name: str,
                  user_input: str = None) -> SkillResult:
        # 1. Build context
        context = await self.preamble.build(project_id, skill_name)

        # 2. Search learnings
        relevant_learnings = await self.learnings.search(project_id, skill_name)

        # 3. Load skill prompt (SKILL.md)
        skill_prompt = load_skill_prompt(skill_name)

        # 4. Assemble messages
        messages = [
            {"role": "system", "content": skill_prompt},
            {"role": "user", "content": context + relevant_learnings + (user_input or "")},
        ]

        # 5. Call LLM with structured output
        result = self.instructor.client.chat.completions.create(
            response_model=SKILL_OUTPUT_MODELS[skill_name],
            messages=messages,
            max_retries=2,
        )

        # 6. Log learnings
        if result.learnings:
            await self.learnings.log(project_id, skill_name, result.learnings)

        return result
```

### Skill Definitions

#### /gaps — Gap Analysis

```
ROLE: Paranoid project manager who has seen projects fail from missing info.
IRON LAW: NO GAP MARKED "RESOLVED" WITHOUT EXPLICIT EVIDENCE IN MEM0

Process:
1. Load control points for project type
2. Query Mem0 facts + RAGFlow for each control point
3. Classify each gap:
   - AUTO-RESOLVE: fillable from existing data → fill + present for confirmation
   - ASK-CLIENT: needs client input → generate specific question + priority
   - ASK-PO: needs internal judgment → present decision + recommendation
4. Calculate readiness score
5. Present via AskUserQuestion format

Output: GapAnalysisResult (readiness score, auto-resolved items,
        client questions with priority, PO decisions with recommendations)
```

#### /prep-meeting — Meeting Preparation

```
ROLE: Senior consultant preparing a client meeting.
IRON LAW: NO AGENDA WITHOUT CURRENT GAP ANALYSIS (< 24 HOURS OLD)

Process:
1. Read latest /gaps output (re-run if stale)
2. Read unresolved contradictions from Mem0
3. Select scope mode:
   - EXPANSION: early discovery, < 40% readiness
   - SELECTIVE EXPANSION: mid-discovery, 40-70%
   - HOLD SCOPE: late discovery, 70-90%
   - REDUCTION: time-constrained
4. Generate agenda sections:
   - Confirm from last meeting
   - Critical gaps (blocking development)
   - Contradictions to resolve
   - Next steps
5. Per-question talking points with interpretation confirmation prompts

Output: MeetingAgenda (scope mode, sections with prioritized questions,
        talking points, recommended duration)
```

#### /generate-docs — Document Generation

```
ROLE: Technical writer producing self-contained discovery deliverables.
IRON LAW: NO DOCUMENT SECTION WITHOUT SOURCE ATTRIBUTION

Process:
1. Check readiness score — warn if < 70%
2. For each document section:
   a. RAGFlow: retrieve full paragraphs (need actual content)
   b. Mem0 facts: confirmed information
   c. Mem0 graph: entity relationships
   d. Compose section, mark each claim CONFIRMED/ASSUMED/INFERRED
   e. Add source attribution (doc name + date + page)
3. Self-review: sources present, assumptions marked, glossary complete
4. Present to PO for review

Output: Three documents — Discovery Brief, MVP Scope Freeze,
        Functional Requirements. Each with source citations.
```

#### /simulate — Multi-Perspective Analysis

```
ROLE: Adversarial reviewer challenging findings from 5 perspectives.
IRON LAW: NO SIMULATION WITHOUT NAMING THE PERSPECTIVE AND ITS BIASES

Process:
1. Read current discovery state
2. For each perspective:
   - END USER: Is this usable? Flows clear? Edge cases covered?
   - DEVELOPER: Is this buildable? Requirements specific enough?
   - BUSINESS OWNER: Does ROI work? Costs justified? Timeline realistic?
   - ADMIN: Is this manageable? Operational burden?
   - UX DESIGNER: Does the flow work? Usability concerns?
3. Cross-perspective analysis:
   - Where do perspectives conflict?
   - Where do all agree there's a gap?
   - What trade-offs need PO decisions?

Output: SimulationResult (per-perspective findings,
        cross-perspective conflicts, recommended trade-offs)
```

#### /analyze — Deep Analysis

```
ROLE: Senior analyst cross-referencing intelligence from multiple sources.
IRON LAW: NO CLAIM WITHOUT EVIDENCE FROM AT LEAST TWO KNOWLEDGE LAYERS

Process:
1. Receive topic or question from PO
2. Query all 3 layers:
   - Mem0 facts: structured knowledge
   - Mem0 graph: entity relationships, who decided what
   - RAGFlow: full-text search across all documents
3. Cross-reference findings
4. Identify: evolution over time, implicit dependencies,
   unasked questions, pattern matches from learnings
5. Present findings with evidence chains

Output: AnalysisResult (findings with dual-source evidence,
        timeline of how this topic evolved, open questions)
```

---

## 6. Preamble System

Every skill invocation gets a preamble injected (gstack pattern):

```python
# services/preamble.py

class PreambleBuilder:
    async def build(self, project_id: str, skill_name: str) -> str:
        project = await self.db.get_project(project_id)
        readiness = await self.evaluator.get_latest(project_id)
        control_points = await self.db.get_control_points_summary(project_id)
        contradictions = await self.mem0.get_contradictions(project_id)

        return f"""
## SESSION CONTEXT
- Project: {project.name} ({project.project_type})
- Client: {project.client_name}
- Discovery started: {project.created_at}
- Documents ingested: {project.document_count}
- Meetings completed: {project.meeting_count}
- Current readiness: {readiness.score}% (was {readiness.previous_score}%)

## CONTROL POINTS SUMMARY
{format_control_points_table(control_points)}

## UNRESOLVED CONTRADICTIONS ({len(contradictions)})
{format_contradictions(contradictions)}

## KNOWLEDGE LAYER ROUTING
1. Check Mem0 facts FIRST (structured, fastest)
2. Check Mem0 graph SECOND (relationships)
3. Check RAGFlow THIRD (full paragraphs)

Never claim "covered" without layers 1 + 3.
Never claim "missing" without checking ALL three.

## QUESTION FORMAT
When you need PO input:
CONTEXT: [what you found]
QUESTION: [specific decision needed]
RECOMMENDATION: Choose [X] because [evidence]. Confidence: [N/10].
A) [Option] — [trade-off]
B) [Option] — [trade-off]
C) [Option] — [trade-off]
"""
```

---

## 7. Persistent Learning System

```python
# services/learnings.py

class LearningStore:
    """Per-matter and cross-matter learning storage."""

    async def search(self, project_id: str, skill_name: str) -> str:
        """Search relevant learnings before skill invocation."""
        matter_learnings = self._search_matter(project_id, skill_name)
        cross_learnings = self._search_cross_matter(project_type)
        return format_learnings(matter_learnings + cross_learnings)

    async def log(self, project_id: str, skill_name: str, learnings: list):
        """Append learnings after skill completion."""
        for learning in learnings:
            self._append({
                "agent": skill_name,
                "type": learning.type,       # pattern|pitfall|preference|domain
                "key": learning.key,          # kebab-case identifier
                "insight": learning.insight,
                "confidence": learning.confidence,
                "source": "observed",
                "matter_id": project_id,
                "ts": datetime.utcnow().isoformat(),
            })
```

---

## 8. Data Models

### PostgreSQL Schema

```sql
-- Projects
CREATE TABLE projects (
    id UUID PRIMARY KEY,
    name VARCHAR NOT NULL,
    client_name VARCHAR NOT NULL,
    project_type VARCHAR NOT NULL,  -- greenfield, addon, feature, api, mobile
    status VARCHAR DEFAULT 'active', -- active, completed, archived
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Control Point Templates
CREATE TABLE control_point_templates (
    id UUID PRIMARY KEY,
    project_type VARCHAR NOT NULL,
    category VARCHAR NOT NULL,      -- business, functional, technical, scope
    description TEXT NOT NULL,
    priority VARCHAR NOT NULL,      -- critical, important, nice_to_have
    weight FLOAT DEFAULT 1.0
);

-- Project Control Points (customized per project)
CREATE TABLE project_control_points (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    template_id UUID REFERENCES control_point_templates(id),
    status VARCHAR DEFAULT 'missing',  -- covered, partial, missing, not_applicable
    confidence INT DEFAULT 0,          -- 1-10
    evidence_fact_ids TEXT[],          -- Mem0 fact IDs
    evidence_chunk_ids TEXT[],         -- RAGFlow chunk IDs
    last_evaluated TIMESTAMP,
    custom_description TEXT            -- PO override
);

-- Documents
CREATE TABLE documents (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    filename VARCHAR NOT NULL,
    file_type VARCHAR NOT NULL,
    ragflow_doc_id VARCHAR,
    classification JSONB,             -- Instructor classification result
    pipeline_status VARCHAR DEFAULT 'pending', -- pending, processing, completed, failed
    facts_extracted INT DEFAULT 0,
    entities_extracted INT DEFAULT 0,
    contradictions_found INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Readiness History
CREATE TABLE readiness_history (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    score FLOAT NOT NULL,
    covered INT NOT NULL,
    partial INT NOT NULL,
    missing INT NOT NULL,
    not_applicable INT NOT NULL,
    triggered_by VARCHAR,             -- document upload, manual evaluation
    created_at TIMESTAMP DEFAULT NOW()
);

-- Learnings
CREATE TABLE learnings (
    id UUID PRIMARY KEY,
    project_id UUID,                  -- NULL for cross-project
    skill VARCHAR NOT NULL,
    type VARCHAR NOT NULL,            -- pattern, pitfall, preference, domain
    key VARCHAR NOT NULL,
    insight TEXT NOT NULL,
    confidence INT NOT NULL,
    source VARCHAR NOT NULL,          -- observed, po-stated, cross-matter
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, key, type)     -- dedup by key+type per project
);
```

### Pydantic Models (Shared)

```python
# models/extraction.py — used by Instructor pipeline
# (defined in research/19-structured-extraction-deep-dive.md)

FactExtractionResult
EntityExtractionResult
RelationshipExtractionResult
ContradictionAnalysis
ControlPointCoverageResult
DocumentClassification

# models/skills.py — skill output models

GapAnalysisResult
MeetingAgenda
DiscoveryDocuments
SimulationResult
AnalysisResult

# models/pipeline.py — pipeline models

PipelineResult
ReadinessScore
```

---

## 9. Project Structure

```
discovery-ai-assistant/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI app, routes
│   │   ├── config.py                  # Settings, env vars
│   │   ├── dependencies.py            # Dependency injection
│   │   │
│   │   ├── api/                       # REST endpoints
│   │   │   ├── projects.py
│   │   │   ├── documents.py
│   │   │   ├── skills.py
│   │   │   ├── control_points.py
│   │   │   └── dashboard.py
│   │   │
│   │   ├── pipeline/                  # Automated document pipeline
│   │   │   ├── service.py             # PipelineService (orchestrates stages)
│   │   │   ├── stages/
│   │   │   │   ├── parse.py           # RAGFlow integration
│   │   │   │   ├── extract.py         # Instructor 6-stage extraction
│   │   │   │   ├── store.py           # Mem0 storage
│   │   │   │   └── evaluate.py        # Control point evaluation
│   │   │   └── worker.py             # Redis queue worker
│   │   │
│   │   ├── skills/                    # On-demand skill definitions
│   │   │   ├── runner.py              # SkillRunner (shared execution)
│   │   │   ├── prompts/               # SKILL.md files
│   │   │   │   ├── gaps.md
│   │   │   │   ├── prep_meeting.md
│   │   │   │   ├── generate_docs.md
│   │   │   │   ├── simulate.md
│   │   │   │   └── analyze.md
│   │   │   └── models.py             # Skill output Pydantic models
│   │   │
│   │   ├── services/                  # Shared services
│   │   │   ├── instructor_client.py   # Instructor wrapper
│   │   │   ├── mem0_client.py         # Mem0 wrapper
│   │   │   ├── ragflow_client.py      # RAGFlow wrapper
│   │   │   ├── preamble.py            # Context assembly
│   │   │   ├── learnings.py           # Learning store
│   │   │   └── control_points.py      # Evaluation logic
│   │   │
│   │   ├── models/                    # Pydantic models
│   │   │   ├── extraction.py          # Instructor extraction schemas
│   │   │   ├── skills.py              # Skill output schemas
│   │   │   ├── pipeline.py            # Pipeline result schemas
│   │   │   └── database.py            # DB models (SQLAlchemy)
│   │   │
│   │   └── db/                        # Database
│   │       ├── session.py
│   │       └── migrations/
│   │
│   ├── tests/
│   │   ├── test_pipeline/
│   │   ├── test_skills/
│   │   └── test_services/
│   │
│   ├── pyproject.toml
│   ├── Dockerfile
│   └── .env.example
│
├── frontend/                          # Next.js app
│   ├── src/
│   │   ├── app/                       # Pages
│   │   │   ├── dashboard/
│   │   │   ├── documents/
│   │   │   ├── skills/
│   │   │   └── settings/
│   │   ├── components/
│   │   └── lib/                       # API client
│   ├── package.json
│   └── Dockerfile
│
├── docker-compose.yml                 # Full stack
├── research/                          # All research docs (00-20)
└── CLAUDE.md                          # Dev instructions
```

---

## 10. Docker Compose Stack

```yaml
services:
  # Our application
  backend:
    build: ./backend
    ports: ["8000:8000"]
    depends_on: [postgres, redis, ragflow, mem0]
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - DATABASE_URL=postgresql://...
      - REDIS_URL=redis://redis:6379
      - RAGFLOW_URL=http://ragflow:9380
      - MEM0_QDRANT_URL=http://qdrant:6333
      - MEM0_NEO4J_URL=bolt://neo4j:7687

  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    depends_on: [backend]

  # Pipeline worker (async document processing)
  worker:
    build: ./backend
    command: python -m app.pipeline.worker
    depends_on: [postgres, redis, ragflow, mem0]

  # Infrastructure
  postgres:
    image: postgres:16
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine

  # RAGFlow (document search layer)
  ragflow:
    image: infiniflow/ragflow:latest
    ports: ["9380:9380"]
    depends_on: [elasticsearch, minio, ragflow-mysql]

  elasticsearch:
    image: elasticsearch:8.11.3
    environment: ["discovery.type=single-node", "xpack.security.enabled=false"]

  minio:
    image: minio/minio
    command: server /data

  ragflow-mysql:
    image: mysql:8.0

  # Mem0 (fact store + graph layer)
  qdrant:
    image: qdrant/qdrant:latest
    ports: ["6333:6333"]

  neo4j:
    image: neo4j:5
    ports: ["7687:7687"]
    environment: ["NEO4J_AUTH=neo4j/password"]

volumes:
  pgdata:
```

---

## 11. What We Build vs What We Use

| Component | Build or Use | Technology | Effort |
|-----------|-------------|-----------|--------|
| Document parsing | **Use** | RAGFlow (DeepDoc) | Config |
| Chunking | **Use** | RAGFlow (14 templates) | Config |
| Vector + keyword search | **Use** | RAGFlow (ES) | Config |
| Fact extraction | **Use** | Instructor + Claude API | Prompt engineering |
| Fact dedup + lifecycle | **Use** | Mem0 | Config + custom metadata |
| Entity graph | **Use** | Mem0 + Neo4j | Config + custom prompts |
| Pipeline orchestration | **Build** | FastAPI + Redis | ~500 lines |
| Skills system | **Build** | FastAPI + Instructor + SKILL.md | ~200 lines/skill |
| Preamble builder | **Build** | Python | ~100 lines |
| Control point evaluator | **Build** | Python + Mem0 queries | ~300 lines |
| Learning store | **Build** | PostgreSQL | ~200 lines |
| Dashboard API | **Build** | FastAPI | ~400 lines |
| Frontend | **Build** | Next.js | Full app |

**Estimated backend code:** ~3,000-4,000 lines of Python (excluding tests)
**Estimated frontend code:** ~5,000-8,000 lines (dashboard, chat, doc viewer)

---

## 12. Migration Path from Original Architecture

| Original (research/12) | Revised (this document) |
|------------------------|------------------------|
| 7 persistent agents | Automated pipeline + 5 on-demand skills |
| Custom agent framework | FastAPI + Instructor |
| Agent-to-agent orchestration (DAG) | Linear pipeline + independent skills |
| Complex state management | PostgreSQL + Pydantic models |
| Human-in-the-loop via interrupts | Skills always return to PO via API |
| RAGFlow for search only | RAGFlow for parsing + chunking + search |
| Mem0 for facts + graph only | Mem0 for facts + graph + contradiction storage |
| No structured extraction | Instructor with citation validation |
| No learning system | Per-matter + cross-matter JSONL/PostgreSQL |
| No anti-rationalization | SKILL.md with anti-rationalization tables |

---

## 13. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Claude API cost | Model tiering (haiku/sonnet/opus). ~$0.10-0.15/doc, ~$2-5/project. |
| Claude API downtime | Instructor supports 40+ providers. Can fail over to GPT-4o. |
| RAGFlow complexity | We only use its API. Can replace with Unstructured + Qdrant. |
| Mem0 limitations | We only use its API. Can replace with custom pipeline + Postgres + Neo4j. |
| Instructor validation retries increase cost | Max 2-3 retries. Cost increase ~2x worst case. Still < $0.50/doc. |
| Prompt drift as we iterate | SKILL.md files versioned in git. Pressure-test with scenarios (Superpowers TDD pattern). |
| Frontend complexity | Start with dashboard MVP. Chat can come later. |
