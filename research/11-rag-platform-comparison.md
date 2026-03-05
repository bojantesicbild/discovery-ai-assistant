# RAG Platform Comparison for Discovery Assistant

## Our Requirements

| # | Requirement | Why |
|---|-------------|-----|
| 1 | Document ingestion (PDF, DOCX, meeting notes, emails) | Core input — client docs |
| 2 | Smart chunking per document type | Meeting notes ≠ specs ≠ emails |
| 3 | Hybrid search (vector + keyword) | Catch both meaning and exact terms |
| 4 | Metadata filtering (date, source, author, type) | Temporal awareness, source filtering |
| 5 | Reranking | Better retrieval quality for messy docs |
| 6 | Entity extraction / knowledge graph | Stakeholders, decisions, features tracking |
| 7 | Per-project data isolation | One project per client engagement |
| 8 | API for agent integration | Rowboat agents call RAG backend |
| 9 | Self-hosted, open source | Company requirement |
| 10 | Works alongside Rowboat (no agent overlap) | Rowboat = agents, RAG platform = knowledge |

---

## Three Candidates

### RAGFlow (infiniflow/ragflow)
**What it is:** Full RAG engine with deep document understanding.
**Stars:** ~74k | **License:** Apache 2.0 | **Language:** Python

### Mem0 (mem0ai/mem0)
**What it is:** Intelligent memory layer — extracts facts from conversations,
deduplicates, and actively manages them over time.
**Stars:** ~48k | **License:** Apache 2.0 | **Language:** Python

### R2R (SciPhi-AI/R2R)
**What it is:** Purpose-built RAG backend API with knowledge graph.
**Stars:** ~7.7k | **License:** Apache 2.0 | **Language:** Python

---

## Feature Comparison

| Requirement | RAGFlow | Mem0 | R2R |
|-------------|---------|------|-----|
| **Document ingestion** | ✅ Excellent — PDF (4 parsers incl. OCR), DOCX, Excel, PPT, images | ⚠️ Limited — PDF, TXT, images. No DOCX. | ✅ Good — PDF, DOCX, TXT, HTML, CSV |
| **Smart chunking** | ✅ Best — 12 built-in templates (General, Q&A, Manual, Table, Presentation, etc.) + parent-child + RAPTOR | ❌ Different approach — extracts facts, not chunks | ✅ Good — configurable chunking strategies |
| **Hybrid search** | ✅ Default — keyword (0.7) + vector (0.3), configurable weights | ⚠️ Vector only + optional graph traversal | ✅ Yes — semantic + keyword with rank fusion |
| **Metadata filtering** | ✅ Excellent — auto, semi-auto, manual modes. LLM-powered auto-extraction | ✅ Good — comprehensive filter operators (eq, gt, lt, in, contains, AND/OR/NOT) | ✅ Yes — collection and document-level filters |
| **Reranking** | ✅ 13+ providers (Cohere, Jina, NVIDIA, etc.) | ✅ 5 providers (Cohere, HuggingFace, LLM-based, etc.) | ✅ Built-in |
| **Knowledge graph** | ✅ GraphRAG + LightRAG methods. Entity types: Org, Person, Event, Category | ✅ Real graph DB (Neo4j, Memgraph, Kuzu). Entity extraction + relationship tracking | ✅ Built-in entity extraction + relationship mapping |
| **Per-project isolation** | ⚠️ Team-based — not strict project isolation | ✅ Strong — user_id, agent_id, run_id, project_id, org_id | ✅ Good — collection-based isolation |
| **API** | ✅ REST + Python SDK + OpenAI-compatible endpoints + MCP server | ✅ REST + Python SDK + TypeScript SDK + MCP server | ✅ REST + Python SDK + JS SDK |
| **Self-hosted** | ✅ Docker Compose (Elasticsearch + MySQL + MinIO + Redis) | ✅ Docker Compose (PGVector + Neo4j) or library-only | ✅ Docker Compose |
| **Agent overlap with Rowboat** | ⚠️ Has its own agent system (19 components, visual editor) — some overlap | ✅ No agent system — pure memory/knowledge layer | ✅ Minimal — focused on RAG backend |
| **LLM providers** | ✅ 54 providers | ✅ 20+ providers | ✅ Multiple providers |
| **Maturity** | ✅ 74k stars, 466 contributors, releases every 2-4 weeks | ✅ 48k stars, YC-backed, v1.0 released Oct 2025 | ⚠️ 7.7k stars, smaller community |

---

## What Each Does Best

### RAGFlow — Best at: Document Understanding
- 4 PDF parsers including OCR + table structure recognition + layout analysis
- 12 chunking templates — the only platform with visual per-document-type chunking
- Handles complex documents (scanned PDFs, tables, slides) that others can't
- Auto-generates keywords and questions per chunk for better retrieval
- Parent-child chunking solves the "precision vs context" tradeoff

### Mem0 — Best at: Fact Management Over Time
- Doesn't store document chunks — **extracts discrete facts** via LLM
- Actively manages facts: deduplicates, updates when info changes, deletes outdated
- "Sarah's role is CTO" replaces "Sarah was VP" automatically
- 90% fewer tokens per query (facts are concise, not chunks)
- Knowledge graph with real graph database (Neo4j) for entity relationships
- Per-user/per-project memory isolation built in

### R2R — Best at: Clean RAG Backend API
- Purpose-built as a backend service — no UI/agent overlap
- Knowledge graph with entity extraction
- Collection-based multi-tenancy maps cleanly to our project structure
- Smallest footprint, cleanest integration point

---

## The Key Architectural Insight

These platforms solve **different problems** and can be **complementary**:

```
RAGFlow / R2R                    Mem0
═══════════════                  ═══════════════
Stores DOCUMENT CHUNKS           Stores EXTRACTED FACTS
"Here's a paragraph about auth"  "Auth method: Microsoft SSO"

Good for:                        Good for:
- "Find everything about auth"   - "What do we KNOW about auth?"
- Document generation            - Contradiction detection
- General exploration            - Tracking decisions over time
- Full-text answers              - Entity relationships

Retrieval:                       Retrieval:
Returns text chunks              Returns concise facts
(verbose, needs context)         (precise, deduplicated)
```

For discovery, we actually need BOTH:
- **Chunks** for document generation (MVP Scope needs full paragraphs)
- **Facts** for control points, gap detection, contradiction tracking

---

## Three Architecture Options

### Option A: RAGFlow Only
Use RAGFlow as the complete RAG backend. Use its built-in knowledge graph
for entity tracking. Skip Mem0.

```
Rowboat (agents) ←→ RAGFlow (documents + chunks + knowledge graph)
```

**Pros:**
- Single system to deploy and maintain
- Best document parsing in the market
- Knowledge graph covers entity extraction
- 12 chunking templates = smart chunking out of the box

**Cons:**
- RAGFlow's knowledge graph doesn't deduplicate/manage facts over time
- Has its own agent system (overlap with Rowboat — can ignore it)
- Heavier infrastructure (Elasticsearch + MySQL + MinIO + Redis)
- Knowledge graph doesn't auto-update when docs are removed

---

### Option B: R2R + Mem0
Use R2R for document RAG. Use Mem0 for fact extraction and entity tracking.

```
Rowboat (agents) ←→ R2R (documents + chunks + search)
                 ←→ Mem0 (facts + entities + memory management)
```

**Pros:**
- Clean separation: R2R = document search, Mem0 = structured knowledge
- Mem0's fact deduplication is perfect for tracking evolving client requirements
- Mem0's graph (Neo4j) gives real entity-relationship queries
- No agent overlap with either
- Both have clean APIs

**Cons:**
- Two systems to deploy and maintain
- R2R has smaller community (7.7k stars)
- R2R's document parsing is less sophisticated than RAGFlow
- More integration work

---

### Option C: RAGFlow + Mem0 (Recommended)
Use RAGFlow for document ingestion, chunking, and search.
Use Mem0 for fact extraction, entity tracking, and memory management.

```
                    ┌──────────────────────────┐
                    │      ROWBOAT (Agents)     │
                    │  Gap Detection, Meeting   │
                    │  Prep, Doc Generator...   │
                    └─────────┬────────────────┘
                              │
                    ┌─────────▼────────────────┐
                    │    QUERY ROUTER           │
                    │    Agent decides which    │
                    │    backend to query       │
                    └────┬───────────────┬──────┘
                         │               │
              ┌──────────▼──────┐  ┌─────▼──────────┐
              │    RAGFlow      │  │     Mem0        │
              │                 │  │                 │
              │ Document chunks │  │ Extracted facts │
              │ Hybrid search   │  │ Entity graph    │
              │ Smart chunking  │  │ Fact dedup      │
              │ Metadata filter │  │ Memory mgmt     │
              │ Reranking       │  │ Neo4j graph     │
              │ OCR / tables    │  │ Per-project     │
              │                 │  │                 │
              │ "Find relevant  │  │ "What do we     │
              │  text about X"  │  │  know about X?" │
              └─────────────────┘  └─────────────────┘
```

**How they work together:**

1. **Document Upload:**
   PO uploads meeting notes →
   - RAGFlow: parses, chunks (using meeting template), embeds, stores
   - Mem0: LLM extracts facts ("Auth: SSO decided", "Sarah: CTO at Acme"),
     deduplicates against existing facts, updates/adds to memory + graph

2. **Gap Detection Agent asks: "Is auth method covered?"**
   → Queries **Mem0**: checks for a fact about auth method
   → Mem0 returns: `{fact: "Auth method: Microsoft SSO", source: "Meeting 3", status: confirmed}`
   → Deterministic answer: ✅ Covered

3. **Document Generator asks: "Write the auth section of MVP Scope"**
   → Queries **RAGFlow**: gets full text chunks about auth from all meetings
   → RAGFlow returns: 5 relevant paragraphs with metadata (which meeting, which date)
   → Agent composes a full section from the chunks

4. **Control Point Agent asks: "What contradictions exist?"**
   → Queries **Mem0**: finds facts that were updated (old value → new value)
   → Mem0 returns: `{fact: "Deployment: single-tenant", updated_from: "multi-tenant", source_old: "Email Feb 3", source_new: "Meeting 4"}`
   → Agent flags the resolved contradiction

5. **Meeting Prep Agent asks: "What open questions do we have?"**
   → Queries **Mem0**: gets all facts with status "assumed" or "unconfirmed"
   → Returns structured list with who to ask and when it was first raised

**Pros:**
- Best of both worlds: RAGFlow's document understanding + Mem0's fact management
- Each system does what it's best at
- Control points become deterministic (check Mem0 facts) not probabilistic (search RAG chunks)
- Contradiction detection is built into Mem0's update mechanism
- Stakeholder/decision/feature tracking lives in Mem0's graph (Neo4j)
- Smart chunking (RAGFlow templates) + fact extraction (Mem0 LLM) = comprehensive coverage

**Cons:**
- Two systems to deploy (Docker Compose can combine them)
- More integration work upfront
- Higher LLM costs (Mem0 needs LLM calls during ingestion for fact extraction)
- Need to keep both systems in sync on document events

---

## Comparison Summary

| Criteria | Option A (RAGFlow) | Option B (R2R + Mem0) | Option C (RAGFlow + Mem0) |
|----------|-------------------|----------------------|--------------------------|
| Document parsing | ⭐⭐⭐ Best | ⭐⭐ Good | ⭐⭐⭐ Best |
| Smart chunking | ⭐⭐⭐ 12 templates | ⭐⭐ Configurable | ⭐⭐⭐ 12 templates |
| Hybrid search | ⭐⭐⭐ Default | ⭐⭐⭐ Built-in | ⭐⭐⭐ Default |
| Entity tracking | ⭐⭐ Graph only | ⭐⭐⭐ Graph + facts | ⭐⭐⭐ Graph + facts |
| Fact management | ⭐ No dedup/update | ⭐⭐⭐ Core feature | ⭐⭐⭐ Core feature |
| Control point accuracy | ⭐⭐ Probabilistic | ⭐⭐⭐ Deterministic | ⭐⭐⭐ Deterministic |
| Contradiction detection | ⭐ Manual via search | ⭐⭐⭐ Built into updates | ⭐⭐⭐ Built into updates |
| Infra complexity | ⭐⭐ One system | ⭐⭐ Two systems | ⭐ Two systems (heaviest) |
| Community / maturity | ⭐⭐⭐ 74k stars | ⭐⭐ Mixed (7.7k + 48k) | ⭐⭐⭐ 74k + 48k |
| Integration effort | ⭐⭐⭐ Lowest | ⭐⭐ Medium | ⭐⭐ Medium |

---

## Recommendation

**Option C: RAGFlow + Mem0** is the strongest fit for discovery because:

1. **RAGFlow** solves our hardest technical problem — parsing messy client docs
   (scanned PDFs, tables, slides) with proper chunking per document type.

2. **Mem0** solves our hardest product problem — knowing what we know vs. don't
   know, tracking how information evolves over time, and making control points
   deterministic instead of probabilistic.

3. Together they map cleanly to our two-layer architecture:
   - RAGFlow = "find relevant text" (Layer 1: Vector RAG)
   - Mem0 = "what do we know structurally" (Layer 2: Entity/Fact Tracking)

4. Both are Apache 2.0, both can be self-hosted, both have REST APIs that
   Rowboat agents can call.

### MVP Simplification

If Option C is too heavy for MVP, start with **Option A (RAGFlow only)** and
add Mem0 later. RAGFlow's knowledge graph gives us basic entity extraction,
and we can do fact tracking manually in MongoDB initially.

### Full Stack with Both

```
┌─────────────────────────────────────────────────────┐
│                    DOCKER COMPOSE                    │
│                                                     │
│  Rowboat stack:                                     │
│  ├── Next.js app (agents, UI, API)                  │
│  ├── MongoDB (projects, conversations)              │
│  ├── Redis (cache, queue)                           │
│  └── Workers (jobs, background tasks)               │
│                                                     │
│  RAGFlow stack:                                     │
│  ├── RAGFlow server (document processing, search)   │
│  ├── Elasticsearch (full-text + vector index)       │
│  ├── MySQL (RAGFlow metadata)                       │
│  └── MinIO (document storage)                       │
│                                                     │
│  Mem0 stack:                                        │
│  ├── Mem0 server (fact extraction, memory API)      │
│  ├── PGVector (fact embeddings)                     │
│  └── Neo4j (entity graph)                           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Discarded Alternatives

| Platform | Why Not |
|----------|---------|
| **Dify** (131k stars) | Too much platform — its agent/workflow system overlaps heavily with Rowboat. Not a clean RAG backend. |
| **LlamaIndex** | Library, not a service. Would need 4-8 weeks to build what RAGFlow provides out of the box. |
| **Haystack** | Same — great library but you build the service yourself. |
| **Langchain-Chatchat** | Chinese-centric chatbot app. No knowledge graph, no multi-tenancy. Wrong architecture. |
| **Unstructured** | Document parsing only, not a RAG system. RAGFlow's DeepDoc does the same job built-in. |
