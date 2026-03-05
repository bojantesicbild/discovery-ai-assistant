# Architecture — Discovery AI Assistant

## Design Principle

Every product feature requires a specific type of knowledge operation.
We mapped each feature to what the system actually needs to do, and three
fundamentally different knowledge operations emerged:

| Product Feature | What the system does | Operation type |
|----------------|---------------------|----------------|
| Upload meeting notes / client docs | Parse PDF/DOCX, extract text, handle tables/scans | Document parsing |
| "What did client say about auth?" | Find relevant passages across all docs | Semantic search |
| Upload client repository | Analyze codebase for architecture, APIs, stack, debt | Code understanding |
| "Is hosting requirements covered?" | Check if a specific fact exists and is confirmed | Structured fact lookup |
| "Did the client contradict themselves?" | Compare statements across docs with timestamps | Fact tracking + temporal comparison |
| Control points evaluation | For each checklist item: covered / partial / missing | Systematic knowledge inventory |
| "Who made the auth decision?" | Find person linked to decision linked to topic | Entity relationships |
| "If we change auth, what's affected?" | Trace dependencies between features/decisions | Graph traversal |
| Prepare meeting agenda from gaps | List what we don't know, prioritized | Absence detection |
| Generate MVP Scope document | Pull full paragraphs per topic, compose structured doc | Full-text retrieval |
| Track how requirements evolve | When client changes their mind, keep history | Fact versioning |
| Cross-project learning | "Similar project had these problems in discovery" | Cross-project search |
| Ingest downstream decision/learning docs | Absorb knowledge artifacts from Phases 2-4 | Knowledge feedback |

### The Three Operations

```
1. SEARCH          "Find me relevant text about X"
                   → Needs: document chunks, semantic similarity, hybrid search
                   → Returns: paragraphs, passages, context

2. KNOW            "What do we know / not know about X?"
                   → Needs: structured facts, deduplication, versioning
                   → Returns: specific answers (yes/no, value, status)

3. CONNECT         "How is X related to Y? What depends on Z?"
                   → Needs: entities, relationships, graph traversal
                   → Returns: connections, impact chains, stakeholder maps
```

No single system does all three well. This is not "two RAGs" — it's three
different knowledge representations serving different product capabilities.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      DISCOVERY AI ASSISTANT                              │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    OUR CODE (the product)                          │  │
│  │                                                                   │  │
│  │  Agent Framework                                                  │  │
│  │  ├── Intake Agent            (document + repo ingestion)          │  │
│  │  ├── Analysis Agent          (entity + fact extraction)           │  │
│  │  ├── Gap Detection Agent     (what's missing?)                    │  │
│  │  ├── Meeting Prep Agent      (questions + agenda)                 │  │
│  │  ├── Document Generator      (produces deliverables)              │  │
│  │  ├── Control Point Agent     (readiness evaluation)               │  │
│  │  └── Role Simulation Agent   (multi-perspective analysis)         │  │
│  │                                                                   │  │
│  │  Application Layer                                                │  │
│  │  ├── Project management (create, configure, track)                │  │
│  │  ├── Control points system (templates, evaluation, scoring)       │  │
│  │  ├── Document templates & generation                              │  │
│  │  ├── Readiness & feedback system                                  │  │
│  │  └── UI (dashboard + chat + document editor)                      │  │
│  │                                                                   │  │
│  │  Orchestration Layer                                              │  │
│  │  ├── Query router (decides which knowledge layer to ask)          │  │
│  │  ├── Ingestion pipeline (parse → chunk → extract → store)         │  │
│  │  ├── Feedback ingestion (downstream decision/learning docs)       │  │
│  │  └── Agent pipeline manager (chains, flows, triggers)             │  │
│  │                                                                   │  │
│  └────────┬──────────────┬──────────────────┬────────────────────────┘  │
│           │              │                  │                            │
│  ┌────────▼────────┐  ┌─▼────────────┐  ┌──▼──────────────────────┐    │
│  │  RAGFlow         │  │  Mem0         │  │  Claude Code            │    │
│  │  (service)       │  │  (service)    │  │  (service / CLI)        │    │
│  │                  │  │              │  │                          │    │
│  │  LAYER 1:        │  │  LAYER 2:    │  │  LAYER 4:               │    │
│  │  Document Search │  │  Fact Store  │  │  Code Understanding     │    │
│  │  ──────────────  │  │  ──────────  │  │  ───────────────────    │    │
│  │  • Deep parsing  │  │  • Fact      │  │  • Repo analysis        │    │
│  │    (DeepDoc)     │  │    extraction│  │  • Architecture ID      │    │
│  │  • Smart chunk   │  │  • Dedup     │  │  • API surface mapping  │    │
│  │  • Hybrid search │  │  • Lifecycle │  │  • Tech debt assessment │    │
│  │  • Metadata      │  │  • Versioning│  │  • Dependency analysis  │    │
│  │    filtering     │  │  • Per-proj  │  │  • Doc extraction       │    │
│  │  • Reranking     │  │    isolation │  │                          │    │
│  │  • Parent-child  │  │              │  │  Outputs feed into      │    │
│  │    chunks        │  │  LAYER 3:    │  │  Layer 1 (as docs) and  │    │
│  │                  │  │  Entity Graph│  │  Layer 2 (as facts)     │    │
│  │  Infra:          │  │  ──────────  │  │                          │    │
│  │  Elasticsearch   │  │  • People    │  │  Aligns with existing   │    │
│  │  MySQL           │  │  • Orgs      │  │  Bild assistant stack   │    │
│  │  MinIO           │  │  • Features  │  │  (Phases 2-4 also use   │    │
│  │                  │  │  • Decisions │  │   Claude Code)           │    │
│  │                  │  │  • Relations │  │                          │    │
│  │                  │  │              │  │                          │    │
│  │                  │  │  Infra:      │  │                          │    │
│  │                  │  │  PGVector    │  │                          │    │
│  │                  │  │  Neo4j       │  │                          │    │
│  └──────────────────┘  └──────────────┘  └──────────────────────────┘    │
│                                                                         │
│  Shared Infrastructure:                                                 │
│  ├── PostgreSQL (application data: projects, users, settings)           │
│  ├── Redis (cache, job queue, session)                                  │
│  ├── S3 / MinIO (file storage — uploaded docs, generated docs)          │
│  └── LLM API (Anthropic Claude on Bild tenant — Opus/Sonnet/Haiku)      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## The Four Knowledge Layers

### Layer 1: Document Search — RAGFlow

**Purpose:** Store and retrieve original document content.

**What it does:**
When a PO uploads a meeting note, email, or client spec, RAGFlow:
1. Parses the document using DeepDoc (OCR, table recognition, layout analysis)
2. Applies smart chunking based on document type (12 built-in templates)
3. Embeds chunks and indexes them for hybrid search (vector + keyword)
4. Extracts metadata automatically via LLM (date, author, doc type)

**Why RAGFlow:**
RAGFlow's document parsing (DeepDoc) would take months to replicate:
- OCR for scanned PDFs
- Table structure recognition
- Document layout analysis
- 12 chunking templates (meeting notes, Q&A, manual, table, etc.)
- Parent-child chunking (RAPTOR) — retrieve a chunk + its surrounding context
- Auto-keyword and auto-question generation per chunk
- Hybrid search: keyword (0.7) + vector (0.3), configurable weights
- Built-in reranking (13+ providers including Cohere, Jina, NVIDIA)
- REST API + Python SDK + OpenAI-compatible endpoints
- 54 LLM providers supported
- Apache 2.0, 74k GitHub stars, active development

**We use RAGFlow as a service.** Our agents call its API for document
operations. We ignore its built-in agent system (we build our own).

**Used by:**
- Document Generator Agent — needs full paragraphs to compose discovery docs
- Meeting Prep Agent — needs to reference what was actually said
- PO browsing — "show me what the client said about deployment"

---

### Layer 2: Fact Store — Mem0

**Purpose:** Extract, deduplicate, and maintain discrete knowledge about
the project.

**What it does:**
When a document is ingested, Mem0's LLM pipeline:
1. Extracts discrete facts ("Auth method: Microsoft SSO", "Budget: under $500/month")
2. Compares each fact against what it already knows
3. Decides per fact: **ADD** (new) / **UPDATE** (changed) / **DELETE** (outdated) / **IGNORE** (already known)
4. Maintains version history (old value → new value, with timestamps and sources)
5. Handles deduplication ("Sarah Chen" = "S. Chen" = "the CTO")

**Why this matters for discovery:**

```
Without fact store (traditional RAG only):
  PO uploads Meeting 4 notes.
  System adds more chunks to the pile.
  Agent searches for "hosting" → gets chunks from all 4 meetings.
  Some contradictory, some redundant.
  Agent has to figure out which is the latest.
  Control point check: "is hosting covered?" → probabilistic (search + hope)

With fact store:
  PO uploads Meeting 4 notes.
  System extracts facts.
  Finds "hosting: Azure" (Meeting 4) contradicts "hosting: undecided" (Meeting 2).
  Updates fact to "Azure", source: Meeting 4. Logs the change.
  Control point check: "is hosting covered?" → deterministic (fact exists + confirmed ✅)
```

**Why Mem0:**
Mem0's fact lifecycle management is the hard part to replicate:
- LLM-powered fact extraction with carefully designed prompts
- Comparison logic against existing facts
- ADD / UPDATE / DELETE / IGNORE decision pipeline
- Version history with timestamps and sources
- Deduplication across different phrasings
- Per-project isolation (user_id, project_id, org_id)
- REST API + Python SDK + TypeScript SDK
- Comprehensive metadata filtering (eq, gt, lt, in, contains, AND/OR/NOT)
- Apache 2.0, 48k GitHub stars, YC-backed

**Used by:**
- Control Point Agent — "is auth method covered?" → check fact → yes/no
- Gap Detection Agent — "what facts are missing?" → query unconfirmed/empty facts
- Contradiction detection — new fact conflicts with existing → flag it
- Progress tracking — count confirmed facts / required facts = readiness %

---

### Layer 3: Entity Graph — Mem0 (Neo4j)

**Purpose:** Track entities and their relationships for connected queries.

**What it does:**
As facts are extracted, Mem0 also builds a graph:
- **Entities:** People, organizations, features, integrations, decisions
- **Relationships:** works_at, decided, depends_on, requires, raised_concern
- Stored in Neo4j (real graph database, supports traversal queries)

**Example graph after 3 meetings:**
```
Sarah Chen (CTO) ──[decided]──→ SSO Auth
SSO Auth ──[requires]──→ MSAL Library
NacXwan ──[integrates_with]──→ VisioConference API
John (IT Lead) ──[raised_concern]──→ Firewall Compatibility
Budget ($500/mo) ──[constrains]──→ Hosting (Azure)
```

**Used by:**
- Stakeholder mapping — "who is involved and what's their role?"
- Impact analysis — "if we change auth, what features are affected?"
- Decision audit — "show me all decisions, who made them, when"
- Dependency tracking — "Feature A depends on Integration B requires API C"

**Note:** Mem0 provides both Layer 2 and Layer 3. They're separate
conceptual layers (facts vs. relationships) but share the same service.

---

### Layer 4: Code Understanding — Claude Code

**Purpose:** Analyze client code repositories to extract technical context
before and during discovery.

**What it does:**
When a PO provides a client's repository URL, the system uses Claude Code to:
1. Identify architecture and technology stack
2. Map the API surface and integration points
3. Assess code quality and technical debt
4. Analyze dependencies and their versions
5. Extract existing documentation

**Why Claude Code:**
The existing Bild AI pipeline (Story/Tech Doc, Code, QA assistants) already
uses Claude Code as the foundation for code understanding. Using it in
Discovery means:
- Consistent architecture across all four pipeline phases
- The repo analysis done in Discovery carries forward — Phase 2 (Story/Tech Doc)
  and Phase 3 (Code) work with the same understanding
- Claude Code's deep comprehension of codebases (AST, dependencies,
  architecture patterns) is not something we'd want to build from scratch

**How it feeds into the other layers:**
Claude Code's analysis outputs are structured as documents and facts:
- Architecture summary → ingested into RAGFlow (Layer 1) as a searchable document
- Technical facts ("Stack: React + Node.js", "Auth: JWT-based") → ingested
  into Mem0 (Layer 2) as confirmed facts
- Entity relationships (Service A → calls → Service B) → added to Mem0 graph
  (Layer 3)

**Used by:**
- Intake Agent — triggers repo analysis when a repo URL is provided
- Gap Detection Agent — "we know the client uses JWT auth, but haven't
  discussed migration to SSO yet"
- Meeting Prep Agent — "the existing codebase has 3 undocumented APIs —
  ask the client about these"

---

## Why These Layers Are Not Redundant

```
PO uploads: "Meeting 4 notes - NacXwan project"
PO provides: client's GitHub repo URL

LAYER 1 (RAGFlow — Document Search) stores:
  → 15 text chunks from the meeting notes, embedded and indexed
  → Searchable by content, date, meeting number
  → Used when generating documents (needs actual paragraphs)

LAYER 2 (Mem0 — Fact Store) extracts and stores:
  → "Auth method: Microsoft SSO" (confirmed, Meeting 4)
  → "Hosting: Azure, single region" (confirmed, Meeting 4)
  → "Budget: under $500/month" (updated from "TBD", Meeting 4)
  → "Timeline: Q2 2025 launch" (new fact, Meeting 4)
  → Used for control points (is auth covered? → YES ✅)

LAYER 3 (Mem0 — Entity Graph) extracts and links:
  → Sarah Chen (CTO) --[decided]--> SSO Auth
  → SSO Auth --[requires]--> MSAL Library
  → NacXwan --[integrates_with]--> VisioConference API
  → John (IT Lead) --[raised_concern]--> Firewall Compatibility
  → Used for "who do I talk to about auth?" → Sarah + John

LAYER 4 (Claude Code — Repo Analysis) extracts:
  → "Existing stack: React 18, Express, PostgreSQL"
  → "Current auth: JWT with custom middleware"
  → "3 undocumented API endpoints in /api/internal/"
  → Architecture summary document added to Layer 1
  → Technical facts added to Layer 2
  → Service dependency graph added to Layer 3
```

**If you only have Layer 1:** You can find text but can't definitively say
what's covered or missing. Every control point is a probabilistic LLM guess.

**If you only have Layer 2:** You know facts but can't generate full documents
(facts are too concise — you need actual paragraphs for a Scope doc).

**If you only have Layer 3:** You know relationships but can't search documents
or track fact status.

**If you skip Layer 4:** You miss the entire existing codebase context.
Discovery starts from zero even when the client has a working product.

**All four together:** A complete knowledge system for discovery.

---

## How the Layers Work Together

### Ingestion Flow

```
PO uploads "Meeting 4 notes.pdf" + provides repo URL
       │
       ▼
┌───────────────────────────────────────────────────────┐
│  ORCHESTRATION: Ingestion Pipeline                     │
│                                                       │
│  1. Document → RAGFlow                                │
│     → DeepDoc parses PDF (OCR, tables, layout)        │
│     → Chunks by meeting notes template                │
│     → Embeds + indexes chunks                         │
│     → Extracts metadata (date, author, type)          │
│     Result: 15 searchable chunks with metadata        │
│                                                       │
│  2. Document text → Mem0                              │
│     → LLM extracts facts from text                    │
│     → Compares vs existing facts                      │
│     → ADDs new, UPDATEs changed, DELETEs outdated     │
│     → Extracts entities + relationships               │
│     → Updates Neo4j graph                             │
│     Result: 6 facts updated, 4 entities linked        │
│                                                       │
│  3. Repo URL → Claude Code                            │
│     → Analyzes codebase architecture                  │
│     → Maps API surface and integrations               │
│     → Extracts technical facts + dependencies         │
│     → Summary doc → RAGFlow (Layer 1)                 │
│     → Technical facts → Mem0 (Layer 2)                │
│     → Service graph → Mem0 (Layer 3)                  │
│     Result: repo context available across all layers  │
│                                                       │
│  4. Trigger Control Point evaluation                  │
│     → Runs against Mem0 facts (Layer 2)               │
│     → Updates readiness score                         │
│     Result: 72% → 78% ready                          │
│                                                       │
│  5. Notify PO                                         │
│     → "3 new facts confirmed, 1 contradiction found,  │
│        readiness improved from 72% to 78%"            │
└───────────────────────────────────────────────────────┘
```

### Feedback Ingestion Flow

The downstream assistants (Story/Tech Doc, Code, QA) produce decision logs
and learning documents as markdown files. These flow back into the knowledge
base:

```
Phase 2 produces: "decision-auth-migration.md"
       │
       ▼
┌───────────────────────────────────────────────────────┐
│  ORCHESTRATION: Feedback Ingestion                     │
│                                                       │
│  1. Document → RAGFlow (Layer 1)                      │
│     → Indexed as "downstream-decision" doc type       │
│     → Searchable in future discovery projects         │
│                                                       │
│  2. Facts → Mem0 (Layer 2)                            │
│     → "Auth migration from JWT to SSO took 3 sprints" │
│     → Tagged as cross-project learning                │
│                                                       │
│  Result: Future discovery for similar projects knows  │
│  that auth migration is a 3-sprint effort             │
└───────────────────────────────────────────────────────┘
```

### Query Routing — Which Layer Answers What

| Agent asks | Routed to | Why |
|-----------|-----------|-----|
| "Find everything about deployment" | **RAGFlow** | Semantic search across all docs |
| "Is hosting confirmed?" | **Mem0 facts** | Structured lookup: fact exists + status = confirmed |
| "Who is responsible for auth?" | **Mem0 graph** | Entity query: Decision(auth) → decided_by → Person |
| "What changed since last meeting?" | **Mem0 facts** | Query: facts where updated_at > last_meeting_date |
| "Write the auth section of MVP Scope" | **RAGFlow** | Needs full paragraphs, not just facts |
| "What are we missing?" | **Mem0 facts** | Query: required facts where status ≠ confirmed |
| "If we change hosting, what's affected?" | **Mem0 graph** | Traverse: Hosting → depends_on → [features, decisions] |
| "What did Sarah say in Meeting 2?" | **RAGFlow** | Metadata filter: author=Sarah, meeting=2, then search |
| "How many stakeholders identified?" | **Mem0 graph** | Count: entities where type = Person, project = X |
| "Show me all unresolved contradictions" | **Mem0 facts** | Query: facts with conflict_flag = true |
| "What's the client's current tech stack?" | **Claude Code** | Repo analysis results (also available in Layer 1+2) |
| "Are there undocumented APIs?" | **Claude Code** | Code analysis found endpoints without docs |
| "Similar projects had what issues?" | **RAGFlow** | Cross-project search on downstream learning docs |

---

## Why Not Just One System?

### "Can't RAGFlow do everything?"

RAGFlow has GraphRAG, so it has entity extraction. But:
- **No fact lifecycle management** — doesn't deduplicate, update, or delete facts
- **No contradiction detection** — new info conflicting with old just adds more chunks
- **No deterministic knowledge checks** — "is X covered?" requires searching and hoping
- **Graph doesn't auto-update** when source docs change
- Its GraphRAG is designed for general knowledge, not tracking project requirements
  through a lifecycle (new → discussed → confirmed → changed)

### "Can't Mem0 do everything?"

Mem0 extracts and manages facts, but:
- **No deep document parsing** — can't handle complex PDFs with tables, scanned docs
- **No smart chunking** — doesn't have per-document-type chunking templates
- **Facts are too concise for document generation** — you can't write an MVP Scope
  from facts alone; you need actual paragraphs with nuance and context
- **No hybrid search** — vector search on facts only, no keyword/BM25
- **Limited format support** — PDF, TXT, images. No DOCX, no spreadsheets.

### "Isn't two services too complex?"

Both are Docker Compose deployments. Combined infrastructure:
- RAGFlow: Elasticsearch + MySQL + MinIO
- Mem0: PGVector + Neo4j

Total: 5 infrastructure services + 2 application services. That's less than
a typical microservice deployment. Both are set-and-forget — we don't build
or maintain their internals, we call their APIs.

The complexity is at the **integration layer** (our code that coordinates
between them), and that integration is where our product value lives anyway.

---

## What We Build vs What We Use

| Component | Build or Use | Technology | Why |
|-----------|-------------|------------|-----|
| Document parsing | **Use** | RAGFlow (DeepDoc) | Months to replicate. Best-in-class open source. |
| Smart chunking | **Use** | RAGFlow | 12 templates built-in. Configure, don't code. |
| Hybrid search + reranking | **Use** | RAGFlow | Solved problem. 13+ reranking providers. |
| Fact extraction + lifecycle | **Use** | Mem0 | LLM pipeline + dedup + versioning. Complex to build. |
| Entity graph | **Use** | Mem0 + Neo4j | Graph DB + extraction. Don't reinvent. |
| Code understanding | **Use** | Claude Code | Already used across Bild pipeline. Deep repo analysis. |
| Agent framework | **Build** | Custom (Python) | **Our product differentiator.** Full control needed. |
| Control points system | **Build** | Custom | Discovery-specific. No existing tool does this. |
| Ingestion pipeline | **Build** | Custom | Coordinates RAGFlow + Mem0 + Claude Code + triggers. |
| Query router | **Build** | Custom | Decides which layer to query per request type. |
| Templates & doc generation | **Build** | Custom | Discovery-specific output format and structure. |
| Readiness & feedback | **Build** | Custom | Our unique feature. Scoring, thresholds, feedback. |
| UI (dashboard + chat) | **Build** | Custom | Our product experience. |

**The principle:** Use commodity infrastructure (parsing, search, fact management,
code analysis). Build the intelligence (agents, control points, discovery logic, UX).

---

## Alignment with Bild's Existing Pipeline

The Discovery AI Assistant is designed to fit into the existing Bild ecosystem:

| Aspect | Phases 2-4 (existing) | Phase 1 (Discovery) |
|--------|----------------------|---------------------|
| Code understanding | Claude Code | Claude Code |
| Atlassian | Read + update Jira/Confluence | Read (future: update) |
| Figma | Read designs for context | Not needed in discovery |
| Knowledge artifacts | Produce decision.md + learning.md | Consume these + produce discovery docs |
| LLM | Anthropic Claude (Bild tenant) | All AI ops on secure tenant. Client data never leaves Bild's environment. |
| Self-hosted | Yes | Yes |

The shared use of Claude Code across all phases means:
- Repository analysis done in Discovery carries forward to later phases
- Technical vocabulary and entity naming stay consistent
- The team works with familiar tooling throughout the pipeline

---

## Infrastructure Overview

```
┌───────────────────────────────────────────────────────────┐
│                     DOCKER COMPOSE                         │
│                                                           │
│  Discovery App:                                           │
│  ├── API server (Python / FastAPI)                        │
│  ├── Agent workers (background processing)                │
│  ├── Frontend (Next.js / React)                           │
│  └── Scheduler (ingestion triggers, periodic evaluation)  │
│                                                           │
│  RAGFlow Stack:                                           │
│  ├── RAGFlow server (document processing + search API)    │
│  ├── Elasticsearch (full-text + vector index)             │
│  ├── MySQL (RAGFlow metadata)                             │
│  └── MinIO (document storage)                             │
│                                                           │
│  Mem0 Stack:                                              │
│  ├── Mem0 server (fact extraction + memory API)           │
│  ├── PGVector (fact embeddings)                           │
│  └── Neo4j (entity relationship graph)                    │
│                                                           │
│  Shared:                                                  │
│  ├── PostgreSQL (app data: projects, users, settings)     │
│  ├── Redis (cache, job queue)                             │
│  └── S3 / MinIO (file uploads + generated documents)      │
│                                                           │
│  External:                                                │
│  ├── LLM API (Anthropic Claude on Bild tenant)            │
│  └── Claude Code (repo analysis — CLI or API)             │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| RAGFlow project dies or pivots | Lose document parsing service | We only use its API. Replace with Unstructured + Qdrant + custom search. |
| Mem0 project dies or pivots | Lose fact management service | We only use its API. Replace with custom fact pipeline + Postgres + Neo4j. |
| Integration complexity between services | Development overhead | Clear API boundaries. Each service is independent. Orchestration is ours. |
| LLM costs (Mem0 fact extraction) | Operational cost | Batch processing, smaller models for extraction, cache common patterns. |
| Performance (multi-hop queries) | Latency | Query router sends most queries to a single layer. Multi-layer only for complex operations. |
| Claude Code availability/changes | Repo analysis breaks | Isolate behind adapter interface. Core discovery works without repo analysis. |

---

## Summary

The Discovery AI Assistant has four knowledge layers, each solving a different
problem:

| Layer | Technology | Purpose | Example |
|-------|-----------|---------|---------|
| **SEARCH** | RAGFlow | Find relevant text | "Show me what client said about auth" |
| **KNOW** | Mem0 (facts) | Track what we know and don't know | "Is hosting confirmed?" → Yes ✅ |
| **CONNECT** | Mem0 (Neo4j) | Trace relationships and dependencies | "Who decided on SSO?" → Sarah Chen |
| **CODE** | Claude Code | Understand existing codebases | "Client uses JWT auth with custom middleware" |

We **use** commodity infrastructure (RAGFlow, Mem0, Claude Code) for parsing,
search, fact management, and code understanding.

We **build** the product intelligence on top: agents, control points, discovery
workflows, document generation, readiness scoring, and the user experience.

That separation means we spend our engineering time on what makes the product
unique — not on rebuilding document parsers or graph databases.
