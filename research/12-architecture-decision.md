# Architecture Decision — Knowledge System for Discovery AI Assistant

## Starting Point: What Does Our Product Actually Need?

Forget platforms for a moment. Let's look at what the Discovery Assistant does
and what kind of knowledge operations each feature requires.

### Feature → Knowledge Operation Mapping

| Product Feature | What the system needs to do | Knowledge operation |
|----------------|---------------------------|-------------------|
| Upload meeting notes | Parse PDF/DOCX, extract text, handle tables | **Document parsing** |
| "What did client say about auth?" | Find relevant passages across all docs | **Semantic search** |
| "Did the client contradict themselves?" | Compare statements across docs with timestamps, detect when fact A conflicts with fact B | **Fact tracking + temporal comparison** |
| "Is hosting requirements covered?" | Check if a specific piece of knowledge exists and is confirmed | **Structured fact lookup** (yes/no, not "find similar text") |
| Control points evaluation | For each checklist item, determine: covered/partial/missing | **Systematic knowledge inventory** |
| "Who made the auth decision?" | Find a person linked to a decision linked to a topic | **Entity relationships** |
| "If we change auth, what's affected?" | Trace dependencies between features, integrations, decisions | **Graph traversal** |
| Prepare meeting agenda from gaps | List what we don't know, prioritized, with suggested questions | **Absence detection** (what's NOT in the system) |
| Generate MVP Scope document | Pull full paragraphs about each topic, compose into structured doc | **Full-text retrieval** (need actual content, not just facts) |
| Track how requirements evolve | When client changes their mind, keep history: old → new | **Fact versioning** |
| Cross-project learning | "Similar project had these problems in discovery" | **Cross-project knowledge search** |
| "Show me all decisions still pending" | Query structured data for decisions where status ≠ confirmed | **Structured query on entities** |

### The Pattern

Three fundamentally different knowledge operations emerge:

```
1. SEARCH          "Find me relevant text about X"
                   → Needs: document chunks, semantic similarity, hybrid search
                   → Returns: paragraphs, passages, context

2. KNOW            "What do we know/not know about X?"
                   → Needs: structured facts, deduplication, versioning
                   → Returns: specific answers (yes/no, value, status)

3. CONNECT         "How is X related to Y? What depends on Z?"
                   → Needs: entities, relationships, graph traversal
                   → Returns: connections, impact chains, stakeholder maps
```

**No single system does all three well.** This isn't about "two RAGs" —
it's about three different types of knowledge representation that serve
different purposes in our product.

---

## The Three Knowledge Layers

### Layer 1: Document Search (SEARCH)

**Purpose:** Store and retrieve original document content.

**Used by:**
- Document Generator Agent — needs full paragraphs to compose discovery docs
- Meeting Prep Agent — needs to reference what was actually said
- PO browsing — "show me what the client said about deployment"

**What it needs:**
- Deep document parsing (OCR, tables, layout recognition)
- Smart chunking per document type (meeting notes ≠ specs ≠ emails)
- Hybrid search (vector + keyword)
- Metadata filtering (date, source, doc type, author)
- Reranking for quality
- Parent-child retrieval (chunk + surrounding context)

**This is traditional RAG.** It's a solved problem. RAGFlow does this better
than anything else open-source because of its document parsing (DeepDoc).

---

### Layer 2: Fact Store (KNOW)

**Purpose:** Extract, deduplicate, and maintain discrete knowledge about the project.

**Used by:**
- Control Point Agent — "is auth method covered?" → check fact store → yes/no
- Gap Detection Agent — "what facts are missing?" → query for empty/unconfirmed facts
- Contradiction Detection — when a new fact conflicts with an existing one, flag it
- Progress tracking — count confirmed facts vs required facts = readiness %

**What it needs:**
- LLM-powered fact extraction from documents
- Deduplication (same fact mentioned in 3 meetings → stored once)
- Fact lifecycle management (new → discussed → confirmed → changed)
- Versioning (old value → new value, with timestamps and sources)
- Structured queries (find all facts where status = "assumed")
- Per-project isolation

**This is what Mem0 does.** It's not RAG — it's a memory management system.
When you add a new meeting note, Mem0's LLM extracts facts, compares them
against what it already knows, and decides: add new fact, update existing
fact, delete outdated fact, or ignore (already known).

**Why this matters for discovery specifically:**

Traditional RAG: PO uploads Meeting 4 notes. System adds more chunks to the pile.
Agent searches for "hosting" → gets chunks from all 4 meetings, some contradictory,
some redundant. Agent has to figure out which is the latest.

With fact store: PO uploads Meeting 4 notes. System extracts facts. Finds that
"hosting: Azure" (from Meeting 4) contradicts "hosting: undecided" (from Meeting 2).
Updates the fact to "Azure" with source "Meeting 4". Logs the change. Control Point
Agent checks: hosting → ✅ confirmed. No ambiguity.

---

### Layer 3: Entity Graph (CONNECT)

**Purpose:** Track entities and their relationships to enable connected queries.

**Used by:**
- Stakeholder mapping — "who is involved in this project and what's their role?"
- Impact analysis — "if we change the auth approach, what features are affected?"
- Decision audit — "show me all decisions, who made them, and when"
- Dependency tracking — "Feature A depends on Integration B which requires API C"

**What it needs:**
- Entity extraction (people, organizations, features, integrations, decisions)
- Relationship extraction (works_at, decided, depends_on, requires)
- Graph traversal ("follow all connections from Feature X")
- Structured queries on entity properties

**Mem0 includes this** via Neo4j/Memgraph/Kuzu graph store. RAGFlow also has
GraphRAG but without the fact management layer.

---

## Why These Layers Are Not Redundant

```
PO uploads: "Meeting 4 notes - NacXwan project"

LAYER 1 (Document Search) stores:
  → 15 text chunks from the meeting notes, embedded and indexed
  → Searchable by content, date, meeting number
  → Used when generating documents (needs actual paragraphs)

LAYER 2 (Fact Store) extracts and stores:
  → "Auth method: Microsoft SSO" (confirmed, Meeting 4)
  → "Hosting: Azure, single region" (confirmed, Meeting 4)
  → "Budget: under $500/month" (updated from "TBD", Meeting 4)
  → "Timeline: Q2 2025 launch" (new fact, Meeting 4)
  → Used for control points (is auth covered? YES ✅)

LAYER 3 (Entity Graph) extracts and links:
  → Sarah Chen (CTO) --[decided]--> SSO Auth
  → SSO Auth --[requires]--> MSAL Library
  → NacXwan --[integrates_with]--> VisioConference API
  → John (IT Lead) --[raised_concern]--> Firewall Compatibility
  → Used for "who do I talk to about auth?" → Sarah + John
```

**If you only have Layer 1:** You can find text but you can't definitively say
what's covered and what's missing. Every control point check is a probabilistic
LLM interpretation of search results.

**If you only have Layer 2:** You know facts but can't generate full documents
(facts are too concise — you need actual paragraphs for a Scope doc).

**If you only have Layer 3:** You know relationships but can't search documents
or track fact status.

**All three together:** You have a complete knowledge system for discovery.

---

## Technology Choices

### For Layer 1 (Document Search): RAGFlow

**Why RAGFlow and not build our own:**

RAGFlow's document parsing (DeepDoc) would take **months to replicate**:
- OCR for scanned PDFs
- Table structure recognition
- Document layout analysis
- 12 chunking templates for different document types
- Parent-child chunking (RAPTOR)
- Auto-keyword and auto-question generation per chunk

We'd be rebuilding solved infrastructure instead of building our actual product.

RAGFlow gives us this out of the box, plus:
- Hybrid search (keyword 0.7 + vector 0.3, configurable)
- Built-in reranking (13+ providers)
- Metadata filtering (auto-extracted by LLM)
- REST API + Python SDK + OpenAI-compatible endpoints
- 54 LLM providers
- Apache 2.0

**We use RAGFlow as a service** — our agents call its API for document operations.
We ignore its agent system (we build our own).

### For Layer 2 + 3 (Fact Store + Entity Graph): Mem0

**Why Mem0 and not build our own:**

Mem0's fact lifecycle management is the hard part to replicate:
- LLM extracts facts from text (using carefully designed prompts)
- Compares new facts against existing ones
- Decides: ADD / UPDATE / DELETE / IGNORE
- Maintains version history
- Handles deduplication ("Sarah Chen" = "S. Chen" = "the CTO")

Building this ourselves means:
- Designing the extraction prompts (significant prompt engineering)
- Building the deduplication logic
- Building the update/delete decision pipeline
- Building the version history system
- Integrating a graph database
- All before we write a single line of discovery logic

Mem0 gives us this out of the box, plus:
- Neo4j graph for entity relationships
- Per-project isolation (user_id, project_id)
- Reranking on search
- Comprehensive metadata filtering
- REST API + Python SDK
- Apache 2.0

**We use Mem0 as a service** — our agents call its API for fact/entity operations.

### For Agent Orchestration: Custom (inspired by Rowboat patterns)

**Why custom and not Rowboat or RAGFlow's agents:**

The agent layer is WHERE OUR PRODUCT VALUE LIVES. This is what makes
Discovery AI Assistant a product, not just a RAG demo. We need full control over:
- Agent-to-agent communication patterns
- How agents decide which knowledge layer to query
- Control point evaluation logic
- Template-based document generation
- Discovery-specific workflows (ingestion → analysis → gap detection → readiness)
- The UX (dashboard + chat + document preview)

We take Rowboat's patterns (agent types, pipeline flows, project structure) as
inspiration but build our own orchestration tailored for discovery.

### Tech Stack

```
┌───────────────────────────────────────────────────────────────────┐
│                    DISCOVERY AI ASSISTANT                          │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              OUR CODE (the product)                         │   │
│  │                                                            │   │
│  │  Agent Framework (custom)                                  │   │
│  │  ├── Intake Agent                                          │   │
│  │  ├── Gap Detection Agent                                   │   │
│  │  ├── Meeting Prep Agent                                    │   │
│  │  ├── Document Generator Agent                              │   │
│  │  ├── Control Point Agent                                   │   │
│  │  └── Role Simulation Agent                                 │   │
│  │                                                            │   │
│  │  Application Layer                                         │   │
│  │  ├── Project management (create, configure, track)         │   │
│  │  ├── Control points system (templates, evaluation, scores) │   │
│  │  ├── Document templates & generation                       │   │
│  │  ├── Readiness & feedback system                           │   │
│  │  └── UI (dashboard + chat + document editor)               │   │
│  │                                                            │   │
│  │  Orchestration Layer                                       │   │
│  │  ├── Query router (which knowledge layer to ask)           │   │
│  │  ├── Ingestion pipeline (parse → chunk → extract → store)  │   │
│  │  └── Agent pipeline manager (chains, flows, triggers)      │   │
│  └──────────────────┬─────────────────┬───────────────────────┘   │
│                     │                 │                            │
│  ┌──────────────────▼──────┐  ┌───────▼────────────────────────┐  │
│  │     RAGFlow (service)    │  │      Mem0 (service)            │  │
│  │                         │  │                                │  │
│  │  Layer 1:               │  │  Layer 2:                      │  │
│  │  Document Search        │  │  Fact Store                    │  │
│  │  ─────────────────      │  │  ──────────                    │  │
│  │  • Document parsing     │  │  • Fact extraction (LLM)       │  │
│  │  • Smart chunking       │  │  • Deduplication               │  │
│  │  • Hybrid search        │  │  • Update/delete lifecycle     │  │
│  │  • Metadata filtering   │  │  • Version history             │  │
│  │  • Reranking            │  │  • Per-project isolation       │  │
│  │  • Parent-child chunks  │  │                                │  │
│  │                         │  │  Layer 3:                      │  │
│  │  Infra:                 │  │  Entity Graph                  │  │
│  │  Elasticsearch          │  │  ──────────────                │  │
│  │  MySQL                  │  │  • People, orgs, features      │  │
│  │  MinIO                  │  │  • Decisions, integrations     │  │
│  │                         │  │  • Relationship traversal      │  │
│  │                         │  │                                │  │
│  │                         │  │  Infra:                        │  │
│  │                         │  │  PGVector (facts)              │  │
│  │                         │  │  Neo4j (graph)                 │  │
│  └─────────────────────────┘  └────────────────────────────────┘  │
│                                                                   │
│  Shared Infrastructure:                                           │
│  ├── PostgreSQL (application data: projects, users, settings)     │
│  ├── Redis (cache, job queue)                                     │
│  ├── S3/MinIO (file storage)                                      │
│  └── LLM API (OpenAI / Claude — configurable)                     │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

## How the Three Layers Work Together

### Ingestion Flow (when PO uploads a document)

```
PO uploads "Meeting 4 notes.pdf"
       │
       ▼
┌──────────────────────────────────┐
│  ORCHESTRATION: Ingestion Pipeline│
│                                  │
│  1. Send to RAGFlow              │
│     → Parses PDF (DeepDoc)       │
│     → Chunks by meeting template │
│     → Embeds + indexes chunks    │
│     → Extracts metadata          │
│     Result: 15 searchable chunks │
│                                  │
│  2. Send to Mem0                 │
│     → LLM extracts facts         │
│     → Compares vs existing facts │
│     → ADDs new facts             │
│     → UPDATEs changed facts      │
│     → Extracts entities + rels   │
│     → Updates graph              │
│     Result: 6 facts, 4 entities  │
│                                  │
│  3. Trigger Control Point eval   │
│     → Runs against Mem0 facts    │
│     → Updates readiness score    │
│     Result: 72% → 78%           │
└──────────────────────────────────┘
```

### Query Examples: Which Layer Answers What

| Agent asks | Routed to | Why |
|-----------|-----------|-----|
| "Find everything about deployment" | **RAGFlow** | Semantic search across all docs |
| "Is hosting confirmed?" | **Mem0 facts** | Structured lookup: fact exists + status = confirmed |
| "Who is responsible for auth decisions?" | **Mem0 graph** | Entity query: Decision(auth) → decided_by → Person |
| "What changed since last meeting?" | **Mem0 facts** | Query: facts where updated_at > last_meeting_date |
| "Write the auth section of MVP Scope" | **RAGFlow** | Needs full paragraphs, not just facts |
| "What are we missing?" | **Mem0 facts** | Query: required facts where status ≠ confirmed |
| "If we change hosting, what's affected?" | **Mem0 graph** | Traverse: Hosting → depends_on → [features, decisions] |
| "What did Sarah say in Meeting 2?" | **RAGFlow** | Metadata filter: author=Sarah, meeting=2, then search |
| "How many stakeholders identified?" | **Mem0 graph** | Count: entities where type = Person and project = X |
| "Show me all unresolved contradictions" | **Mem0 facts** | Query: facts with conflict_flag = true |

---

## Why Not Just One System?

### "Can't RAGFlow do everything?"

RAGFlow has GraphRAG, so technically it has entity extraction. But:
- **No fact lifecycle management** — it doesn't deduplicate, update, or delete facts
- **No contradiction detection** — when new info conflicts with old, it just adds more chunks
- **No deterministic knowledge checks** — "is X covered?" requires searching and hoping
- **Graph doesn't auto-update** when source docs change — manual regeneration needed
- Its GraphRAG is designed for general knowledge extraction, not for tracking project
  requirements through a lifecycle

### "Can't Mem0 do everything?"

Mem0 extracts and manages facts, but:
- **No deep document parsing** — can't handle complex PDFs with tables, scanned docs
- **No smart chunking** — doesn't have per-document-type chunking templates
- **Facts are too concise for document generation** — you can't write an MVP Scope
  from facts alone; you need actual paragraphs with nuance and context
- **No hybrid search** — vector search on facts, but no keyword/BM25 search
- **Limited document type support** — PDF, TXT, images only; no DOCX, no spreadsheets

### "Isn't two services too complex?"

Both are Docker Compose deployments. Combined:
- RAGFlow: Elasticsearch + MySQL + MinIO (already mature, well-documented)
- Mem0: PGVector + Neo4j (small footprint)

Total: 5 infrastructure services + 2 application services. That's less than
a typical microservice deployment. And both are set-and-forget — we don't build
or maintain their internals, we just call their APIs.

The complexity is **at the integration layer** (our code that coordinates between them),
not at the infrastructure layer. And that integration is where our product
value lives anyway.

---

## What We Build vs What We Use

| Component | Build or Use | Why |
|-----------|-------------|-----|
| Document parsing | **Use** (RAGFlow) | Would take months to build. DeepDoc is best-in-class. |
| Chunking | **Use** (RAGFlow) | 12 templates already built. Configure, don't code. |
| Vector search | **Use** (RAGFlow) | Hybrid search, reranking — solved problem. |
| Fact extraction | **Use** (Mem0) | LLM pipeline + dedup + lifecycle — complex to build. |
| Entity graph | **Use** (Mem0 + Neo4j) | Graph DB + extraction — don't reinvent. |
| Agent framework | **Build** | This is our product differentiator. |
| Control points system | **Build** | Discovery-specific, no existing tool does this. |
| Ingestion pipeline | **Build** | Coordinates RAGFlow + Mem0 + triggers. |
| Query router | **Build** | Decides which layer to query per request. |
| Templates & doc generation | **Build** | Discovery-specific output format. |
| Readiness & feedback | **Build** | Our unique feature. |
| UI (dashboard + chat) | **Build** | Our product experience. |

**The principle:** Use commodity infrastructure (parsing, search, fact management).
Build the intelligence (agents, control points, discovery logic, UX).

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| RAGFlow project dies or changes direction | We only use its API. Can replace with Unstructured + Qdrant + custom search. |
| Mem0 project dies or changes direction | We only use its API. Can replace with custom fact pipeline + Postgres + Neo4j. |
| Integration between two systems is complex | Clear API boundaries. Each system is independent. Orchestration layer is ours. |
| LLM costs for Mem0 fact extraction | Batch processing, smaller models for extraction, cache common patterns. |
| Performance (two hops per query) | Query router determines single-hop for most queries. Both layers only for complex operations. |

---

## Summary

**RAGFlow** is not "a RAG." It's our **document understanding engine**.
**Mem0** is not "another RAG." It's our **knowledge management system**.

Together they give the Discovery Assistant two capabilities:
1. Find and retrieve relevant text from client documents (RAGFlow)
2. Know precisely what we know, don't know, and how it's changing (Mem0)

We build everything on top: the agents, the control points, the discovery
logic, the document generation, the UI. That's where the product lives.
