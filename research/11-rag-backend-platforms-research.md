# RAG Backend Platforms Research

## Context

We need a pluggable RAG backend for our multi-agent discovery assistant.
Our orchestration layer is Rowboat (multi-agent IDE using OpenAI Agents SDK).
The RAG backend must serve as the knowledge layer that agents call via API.

## Our Requirements Checklist

| # | Requirement | Notes |
|---|-------------|-------|
| 1 | Document ingestion (PDF, DOCX, meeting notes, emails) | Must handle diverse discovery artifacts |
| 2 | Smart chunking (different strategies per document type) | Meeting notes vs specs vs emails need different treatment |
| 3 | Hybrid search (vector + keyword/BM25) | Exact terms like product names + semantic meaning |
| 4 | Metadata filtering (date, source type, author) | Temporal awareness, source attribution |
| 5 | Reranking | Cross-encoder reranking for messy discovery docs |
| 6 | Entity extraction / knowledge graph | Stakeholder mapping, decision tracking, relationship traversal |
| 7 | Per-project data isolation | Multi-tenancy: each discovery project is isolated |
| 8 | API that agents can call | RESTful or SDK — Rowboat agents need programmatic access |
| 9 | Self-hostable (open source) | No vendor lock-in, data stays on our infra |
| 10 | Works alongside Rowboat | Must function as a backend service, not replace our orchestration |

---

## Platform Evaluations

---

### 1. R2R (Retrieval to Riches) by SciPhi-AI

**GitHub:** https://github.com/SciPhi-AI/R2R
**Stars:** ~7,700 | **License:** MIT | **Last Release:** v3.6.5 (June 2025) | **Commits:** 2,096 | **Releases:** 83

#### What It Does
R2R is a production-ready RAG system designed from the ground up as an API-first
retrieval backend. It is NOT an agent framework or a workflow builder — it is
purely a RAG engine with a RESTful API. This makes it the most architecturally
aligned option for our use case of "pluggable RAG backend that agents call."

#### Feature Coverage Against Our Requirements

| Requirement | R2R Support | Details |
|---|---|---|
| Document ingestion | YES | PDF, DOCX, TXT, JSON, PNG, MP3, and more. Multimodal. |
| Smart chunking | PARTIAL | Configurable chunking but not per-document-type strategies out of the box. Uses Unstructured under the hood for parsing. |
| Hybrid search | YES | Semantic + keyword search with reciprocal rank fusion built in. |
| Metadata filtering | YES | Documents carry user-defined metadata, filterable at query time. |
| Reranking | YES | Built-in reranking pipeline step. |
| Entity extraction / KG | YES | Automatic entity and relationship extraction. Knowledge graphs built per collection. Dedicated extraction API. |
| Per-project isolation | YES | Collections with user-level permissions. Documents scoped to collections. Access control built in. |
| API for agents | YES | Full RESTful API + Python SDK + JavaScript SDK. API-first design. |
| Self-hostable | YES | Docker Compose deployment. Full self-hosting docs. |
| Works with Rowboat | YES | Clean separation — R2R is the RAG service, Rowboat is the orchestration. Agents call R2R API. |

#### Key Strengths
- **Purpose-built as a RAG backend API** — not a UI platform, not an agent framework.
  This is exactly what we need: a service that agents call.
- **Knowledge graph built in** — entity extraction and relationship mapping are
  first-class features, not plugins. Documents can be extracted into graphs
  without re-processing.
- **Collection-based isolation** — maps directly to our per-project model.
- **Agentic RAG** — has a built-in reasoning agent that can do multi-step
  retrieval, plus a "Deep Research API" for complex queries.
- **User authentication** — built-in user management and access control.

#### What It's Missing
- **Per-document-type chunking strategies** — chunking is configurable but you
  would need to implement document-type routing yourself.
- **Smaller community** — 7.7k stars vs 131k for Dify. Fewer tutorials,
  less community support.
- **UI is basic** — the dashboard exists but is secondary to the API.
  Not an issue for us (we build our own UI) but means less visual tooling
  for debugging RAG pipelines.

#### Integration Pattern with Our System
```
Rowboat Agents → R2R REST API → search/ingest/extract
                                ↓
                    R2R manages: vector store (Postgres+pgvector),
                                knowledge graphs,
                                document storage,
                                user/collection permissions
```
Rowboat agents would call R2R endpoints for:
- `POST /documents` — ingest new project documents
- `POST /search` — hybrid search with metadata filters
- `POST /rag` — full RAG (search + generate)
- `POST /collections/{id}/extract` — build knowledge graph for a project
- `GET /graphs/{id}/entities` — query extracted entities

#### Verdict: STRONG CONTENDER — Best fit for "pluggable RAG backend" role.

---

### 2. Dify

**GitHub:** https://github.com/langgenius/dify
**Stars:** ~131,000 | **License:** Dify Open Source License (Apache 2.0 based with additional conditions) | **Commits:** 9,137 | **Contributors:** 400+

#### What It Does
Dify is a full-stack LLM application platform with a visual workflow builder,
agent framework, RAG pipeline, model management, and observability. It is an
entire AI application development platform, not just a RAG backend.

#### Feature Coverage Against Our Requirements

| Requirement | Dify Support | Details |
|---|---|---|
| Document ingestion | YES | PDF, PPT, DOCX, TXT, and more. Out-of-box text extraction. |
| Smart chunking | PARTIAL | Automatic and custom chunking. Knowledge Pipeline (new) adds LLM-powered processing. Not per-document-type by default. |
| Hybrid search | YES | Vector search + full-text search + hybrid mode built in. |
| Metadata filtering | YES | Document metadata supported, filterable during retrieval. |
| Reranking | YES | Built-in rerank model integration (Cohere, etc.). Hybrid + rerank is a documented best practice. |
| Entity extraction / KG | NO (native) | Knowledge Pipeline can do entity extraction via LLM nodes, but NO native Graph RAG. No knowledge graph traversal. Community discussions requesting it. |
| Per-project isolation | PARTIAL | Workspaces and datasets provide some isolation. Not true per-tenant multi-tenancy at the data layer. |
| API for agents | YES | "All of Dify's offerings come with corresponding APIs." Full REST API. |
| Self-hostable | YES | Docker Compose. Very mature deployment. |
| Works with Rowboat | AWKWARD | Dify has its OWN agent framework and workflow engine. Using it purely as a RAG backend means ignoring 70% of the platform. Overlap and complexity. |

#### Key Strengths
- **Massive community** — 131k stars, very active development, frequent releases.
- **Visual workflow builder** — great for non-developers to prototype RAG pipelines.
- **Plugin ecosystem** — bidirectional plugin system for extending capabilities.
- **Upcoming Visual RAG Pipeline** — planned feature for v1.9+ that will let
  you visually design document processing pipelines.
- **Multimodal Knowledge Base** — unifies text and images in a single semantic space.
- **MCP integration** — can expose Dify resources to external agents via MCP protocol.

#### What It's Missing
- **No native knowledge graph / Graph RAG** — this is a significant gap for our
  entity extraction and relationship tracking needs.
- **Architectural overlap with Rowboat** — Dify wants to BE your agent platform.
  Using it as just a RAG backend creates redundancy and confusion about which
  system orchestrates what.
- **License concerns** — not pure Apache 2.0. Additional conditions on the
  Dify Open Source License.
- **Per-project isolation is not first-class** — datasets and workspaces exist
  but multi-tenancy requires careful configuration.

#### Integration Pattern with Our System
```
Option A: Rowboat Agents → Dify API (knowledge base endpoints only)
          Ignore Dify's agent/workflow features entirely.
          Complex — Dify not designed for this pattern.

Option B: Rowboat Agents → Dify via MCP protocol
          Use Dify as an MCP server exposing knowledge bases.
          Possible but adds protocol complexity.
```

#### Verdict: POOR FIT — Too much platform, not enough backend. Knowledge graph gap is critical. Architectural overlap with Rowboat creates friction.

---

### 3. RAGFlow

**GitHub:** https://github.com/infiniflow/ragflow
**Stars:** ~74,000 | **License:** Apache 2.0 | **Commits:** 5,354 | **Last Update:** Dec 2025

#### What It Does
RAGFlow is a dedicated RAG engine focused on deep document understanding and
high-quality retrieval. It sits between a pure library (LlamaIndex) and a full
platform (Dify) — it is a self-contained RAG service with a web UI and API.

#### Feature Coverage Against Our Requirements

| Requirement | RAGFlow Support | Details |
|---|---|---|
| Document ingestion | YES (excellent) | Deep document understanding with layout detection. Word, PDF, slides, Excel, images, web pages. Uses DeepDoc for intelligent parsing. |
| Smart chunking | YES (best in class) | Template-based intelligent chunking with visualization. Different templates for different document types. Visual chunk inspection. |
| Hybrid search | YES | Vector + BM25 + custom scoring with re-ranking. Uses Elasticsearch or Infinity as backend. |
| Metadata filtering | YES | Document metadata supported in search. |
| Reranking | YES | Advanced re-ranking built into the retrieval pipeline. |
| Entity extraction / KG | YES | GraphRAG support (since v0.9). Knowledge graph construction during preprocessing. Entity-relationship extraction for sophisticated QA. |
| Per-project isolation | PARTIAL | Datasets (knowledge bases) provide logical separation. Multi-user with separate knowledge bases. Not enterprise-grade multi-tenancy. |
| API for agents | YES | REST API + Python SDK. API documented for external integration. |
| Self-hostable | YES | Docker Compose. Requires Elasticsearch/Infinity + MinIO + MySQL/PostgreSQL. |
| Works with Rowboat | GOOD | RAGFlow is primarily a RAG engine. Less agent-framework overlap than Dify. Can function as a backend service. |

#### Key Strengths
- **Best document parsing** — DeepDoc provides layout-aware parsing that understands
  tables, headers, reading order. Far better than naive text extraction for complex
  PDFs with charts and tables.
- **Template-based chunking** — you can define chunking templates per document type.
  This directly addresses our "smart chunking per doc type" requirement.
- **Visual chunk inspection** — you can see exactly how documents were chunked,
  which is invaluable for debugging retrieval quality.
- **GraphRAG built in** — knowledge graph construction from documents, enabling
  entity-relationship based retrieval alongside vector search.
- **Grounded citations** — responses include source citations, reducing hallucination.
- **Agent capabilities** — has its own agent system with memory and tool use,
  but it is lighter weight than Dify's full workflow engine.

#### What It's Missing
- **Agent framework overlap** — less than Dify, but RAGFlow still has its own
  agent/chatbot layer that we would not use.
- **Entity extraction control** — GraphRAG is available but the level of control
  over entity types, schemas, and extraction prompts is less documented than R2R.
- **Per-project isolation not first-class** — knowledge bases provide separation
  but no built-in tenant management or access control system.
- **Heavier infrastructure** — requires Elasticsearch or Infinity in addition to
  vector storage, plus MinIO for file storage.

#### Integration Pattern with Our System
```
Rowboat Agents → RAGFlow REST API → search/ingest
                                   ↓
                    RAGFlow manages: Elasticsearch (hybrid search),
                                    vector storage,
                                    knowledge graphs,
                                    document parsing (DeepDoc)
```

#### Verdict: STRONG CONTENDER — Best document parsing and chunking. GraphRAG support. Good balance between capability and focus.

---

### 4. LlamaIndex

**GitHub:** https://github.com/run-llama/llama_index
**Stars:** ~47,300 | **License:** MIT | **Commits:** 7,564 | **Contributors:** many | **Integrations:** 300+

#### What It Does
LlamaIndex is a developer framework (Python library) for building RAG
applications. It is NOT a deployable service — it is a toolkit you use
to BUILD your own RAG service. This is a fundamentally different category
from R2R, Dify, or RAGFlow.

#### Feature Coverage Against Our Requirements

| Requirement | LlamaIndex Support | Details |
|---|---|---|
| Document ingestion | YES | 130+ format support via LlamaParse. Connectors for APIs, databases, files. |
| Smart chunking | YES | Multiple chunking strategies. SentenceSplitter, SemanticSplitter, custom splitters. Per-document-type routing possible. |
| Hybrid search | YES | QueryFusionRetriever for combining vector + keyword. BM25Retriever available. |
| Metadata filtering | YES | Rich metadata support. MetadataFilters with exact/contains/range operators. |
| Reranking | YES | Multiple reranker integrations (Cohere, cross-encoder, LLM-based). |
| Entity extraction / KG | YES (excellent) | PropertyGraphIndex — schema-guided or free-form entity extraction. Neo4j integration. Full knowledge graph construction and querying. |
| Per-project isolation | POSSIBLE | Multi-tenancy via metadata filtering (tenant_id pattern). Not built-in — you implement it. |
| API for agents | NO (you build it) | LlamaIndex is a library, not a service. You must wrap it in FastAPI/Flask yourself to create an API. |
| Self-hostable | YES (you deploy it) | It is your code — you deploy however you want. |
| Works with Rowboat | POSSIBLE (with work) | You would build a custom RAG microservice using LlamaIndex, then expose it as an API for Rowboat agents to call. |

#### Key Strengths
- **Most flexible** — complete control over every aspect of the RAG pipeline.
- **PropertyGraphIndex** — the most sophisticated knowledge graph integration
  in any RAG framework. Schema-guided extraction, multiple extractors per
  pipeline, Neo4j/Memgraph integration, custom retrieval strategies.
- **300+ integrations** — any vector store, any LLM, any embedding model.
- **LlamaParse** — enterprise-grade document parser (130+ formats, agentic OCR).
  Note: LlamaParse is a managed service, not fully open source.
- **Mature ecosystem** — MIT licensed, massive community, excellent documentation.
- **Workflows engine** — event-driven async orchestration for complex pipelines.

#### What It's Missing
- **Not a deployable service** — the biggest gap. You get a library, not a
  running system. You must build the API layer, deployment, authentication,
  document management, and infrastructure yourself.
- **No built-in UI** — no dashboard for managing documents, inspecting chunks,
  or monitoring queries.
- **No built-in auth/multi-tenancy** — you implement tenant isolation yourself.
- **LlamaParse is managed** — the best document parsing (LlamaParse) is a
  cloud service, not fully self-hostable. The open-source parsers are less capable.
- **Significant development effort** — turning LlamaIndex into a production
  RAG service requires weeks of engineering.

#### Integration Pattern with Our System
```
Rowboat Agents → Custom FastAPI Service (you build this)
                        ↓
                 LlamaIndex library
                        ↓
                 Vector DB (Qdrant/Chroma/Weaviate)
                 + Neo4j (for knowledge graphs)
                 + Document storage (S3/MinIO)
```

#### Verdict: BEST LIBRARY, NOT A BACKEND — Maximum flexibility but maximum effort. Consider using LlamaIndex as the engine INSIDE a custom RAG service, or use R2R which already wraps similar capabilities in a deployable API.

---

### 5. Haystack (by deepset)

**GitHub:** https://github.com/deepset-ai/haystack
**Stars:** ~24,400 | **License:** Apache 2.0 | **Commits:** many | **Contributors:** 335 | **Latest:** v2.25.1 (Feb 2026)

#### What It Does
Haystack is an open-source AI orchestration framework for building production-ready
LLM applications. Like LlamaIndex, it is a framework/library, not a deployable
service. It emphasizes "context engineering" — explicit control over how information
flows through retrieval, ranking, filtering, and generation.

#### Feature Coverage Against Our Requirements

| Requirement | Haystack Support | Details |
|---|---|---|
| Document ingestion | YES | Multiple converters for PDF, DOCX, HTML, etc. Extensible with custom converters. |
| Smart chunking | YES | DocumentSplitter with multiple strategies. Custom splitters supported. |
| Hybrid search | YES (excellent) | First-class hybrid retrieval. BM25Retriever + EmbeddingRetriever combined with reciprocal rank fusion or other merging strategies. Well-documented. |
| Metadata filtering | YES | Rich metadata filtering at retrieval time. Native support across document stores. |
| Reranking | YES (excellent) | TransformersSimilarityRanker, CohereRanker, and others. Cross-encoder reranking is a documented best practice. |
| Entity extraction / KG | PARTIAL | EntityExtractor node for NER. Neo4j integration available. But no built-in PropertyGraph or GraphRAG — knowledge graph support is still developing. |
| Per-project isolation | POSSIBLE | Via document store configuration. Not built-in multi-tenancy. |
| API for agents | NO (you build it) | Like LlamaIndex — it is a library. You wrap it in an API. Hayhooks exists for basic pipeline serving. |
| Self-hostable | YES (you deploy it) | Your code, your deployment. |
| Works with Rowboat | POSSIBLE (with work) | Same pattern as LlamaIndex — build a custom service. |

#### Key Strengths
- **Enterprise proven** — used by Apple, Netflix, Airbus, European Commission.
  Most battle-tested framework.
- **Pipeline architecture** — explicit, debuggable pipelines with typed inputs/outputs.
  Very clean for production systems.
- **Best hybrid search implementation** — hybrid retrieval with reranking is a
  first-class, well-documented pattern in Haystack.
- **Modular and typed** — every component has a clear interface. Easy to swap parts.
- **Apache 2.0** — clean open-source license.

#### What It's Missing
- **Not a deployable service** — same gap as LlamaIndex.
- **Knowledge graph support is immature** — entity extraction exists, Neo4j
  integration exists, but no integrated GraphRAG pipeline. KG query generators
  are planned but not shipped.
- **Smaller ecosystem than LlamaIndex** — fewer integrations, though the ones
  that exist are higher quality.
- **Less RAG-specific than LlamaIndex** — Haystack is broader (agents, chat,
  search) while LlamaIndex is more RAG-focused.

#### Integration Pattern with Our System
```
Rowboat Agents → Custom API Service (you build this)
                        ↓
                 Haystack pipelines
                        ↓
                 Elasticsearch/OpenSearch (hybrid search)
                 + Document store
```

#### Verdict: EXCELLENT FRAMEWORK, WRONG CATEGORY — Best for teams that want to build a custom RAG service from scratch with maximum production quality. But we would need to build the entire service layer ourselves.

---

### 6. Langchain-Chatchat

**GitHub:** https://github.com/chatchat-space/Langchain-Chatchat
**Stars:** ~37,400 | **License:** Apache 2.0 | **Commits:** 2,471

#### What It Does
Langchain-Chatchat is a Chinese-language-focused local knowledge base Q&A system
built on top of LangChain. It supports offline private deployment with local
LLMs (ChatGLM, Qwen, Llama).

#### Feature Coverage Against Our Requirements

| Requirement | Support | Details |
|---|---|---|
| Document ingestion | YES | Standard document types supported. |
| Smart chunking | PARTIAL | Uses LangChain's splitters. Not per-document-type by default. |
| Hybrid search | PARTIAL | Vector search primary. Keyword search possible via LangChain. |
| Metadata filtering | PARTIAL | Basic metadata support through LangChain. |
| Reranking | PARTIAL | Available through LangChain integrations. |
| Entity extraction / KG | NO | No knowledge graph capability. |
| Per-project isolation | NO | Designed as a single-user local system. |
| API for agents | PARTIAL | Has an API but primarily designed as a standalone chat application. |
| Self-hostable | YES | Designed for local/offline deployment. |
| Works with Rowboat | POOR | Designed as a complete chatbot, not a backend service. |

#### Key Strengths
- **Local/offline focus** — runs entirely locally with open-source LLMs.
- **Chinese language ecosystem** — excellent for Chinese-language document processing.
- **Simple deployment** — straightforward Docker setup.

#### What It's Missing
- **Not a RAG backend** — it is a complete chatbot application.
- **No knowledge graph** — no entity extraction capabilities.
- **No multi-tenancy** — single-user, single-project design.
- **Limited API-first design** — not built to be called by external agents.
- **Chinese-centric** — most documentation and community discussion is in Chinese.
- **Activity concerns** — last significant version update (0.3.x) was June 2024.
  Community large but development pace has slowed compared to alternatives.

#### Verdict: NOT A FIT — Wrong architecture (chatbot, not backend), missing key features (KG, multi-tenancy), language ecosystem mismatch.

---

### 7. Unstructured

**GitHub:** https://github.com/Unstructured-IO/unstructured
**Stars:** ~14,100 | **License:** Apache 2.0 | **Commits:** 1,857

#### What It Does
Unstructured is a document parsing and preprocessing library. It is NOT a RAG
system — it is the document ETL layer that sits BEFORE the RAG pipeline.
It converts PDFs, DOCX, HTML, emails, images, and 25+ other formats into
clean, structured text elements.

#### Feature Coverage Against Our Requirements

| Requirement | Support | Details |
|---|---|---|
| Document ingestion | YES (excellent) | 25+ file types. Layout detection, OCR, table extraction. Best-in-class document parsing. |
| Smart chunking | YES | Basic, by_title, by_page strategies. Enterprise adds by_similarity. |
| Hybrid search | NO | Not a search system. |
| Metadata filtering | NO | Not a retrieval system. |
| Reranking | NO | Not a retrieval system. |
| Entity extraction / KG | NO | Not in scope. |
| Per-project isolation | NO | Not in scope. |
| API for agents | PARTIAL | Has an API for document processing. Not for search/retrieval. |
| Self-hostable | YES | Open-source library + self-hostable API container. |
| Works with Rowboat | AS A COMPONENT | Not a standalone RAG backend. Used inside other systems. |

#### Key Strengths
- **Best document parsing** — industry standard for converting unstructured
  documents into clean text elements.
- **Layout-aware** — understands document structure (headings, tables, lists, images).
- **Wide format support** — 25+ document types including emails.
- **Used by other RAG platforms** — R2R uses Unstructured under the hood.

#### What It's Missing
- **Not a RAG system** — it only handles the parsing/chunking phase. No search,
  no retrieval, no knowledge graphs, no API for agents.
- **Open source vs Enterprise gap** — the open-source version has significantly
  decreased performance compared to the enterprise API. No access to the latest
  VLM-based parsing, no by-similarity chunking, no embeddings.

#### Role in Our Architecture
Unstructured is not an alternative to the other platforms — it is a **component**
that sits inside them. R2R already uses it. If we build a custom service with
LlamaIndex or Haystack, we would use Unstructured for document parsing.

#### Verdict: EXCELLENT COMPONENT, NOT A PLATFORM — Use it inside whichever RAG backend we choose, not as a standalone solution.

---

### 8. Additional Notable Platforms

#### Cognita (by TrueFoundry)

**GitHub:** https://github.com/truefoundry/cognita
**Stars:** ~4,300 | **License:** Apache 2.0

A modular RAG framework built on top of LangChain and LlamaIndex. Designed for
production with swappable components (data loaders, chunkers, embedders, retrievers).
Has a UI for experimentation. Supports reranking, query decomposition, incremental
indexing. However: smaller community, last significant update September 2024,
and it is still fundamentally a framework you deploy, not a service with an API.

**Verdict:** Interesting architecture but too small and not active enough for production use.

#### LightRAG

A graph-based RAG approach from academic research that builds knowledge graphs
from documents. Promising for entity-relationship retrieval. However: purely
a library, no API, no document management, no multi-tenancy. Research-grade,
not production-grade.

**Verdict:** Worth watching for GraphRAG techniques, not ready as a backend.

#### txtai

An all-in-one embeddings database and RAG framework. Lightweight, self-contained,
privacy-focused. Good for edge deployments. However: no knowledge graph support,
limited document parsing, no multi-tenancy, designed for simpler use cases.

**Verdict:** Too lightweight for our needs.

---

## Comparison Matrix

| Capability | R2R | RAGFlow | Dify | LlamaIndex | Haystack | Chatchat |
|---|---|---|---|---|---|---|
| **Deployable Service** | YES | YES | YES | NO (library) | NO (library) | YES (chatbot) |
| **API-First Design** | YES | YES | YES | NO | NO | PARTIAL |
| **Document Parsing Quality** | Good (uses Unstructured) | Excellent (DeepDoc) | Good | Good (LlamaParse is cloud) | Good | Basic |
| **Smart Chunking per Doc Type** | Configurable | YES (templates) | Partial | YES (manual) | YES (manual) | Basic |
| **Hybrid Search** | YES | YES | YES | YES | YES (best) | PARTIAL |
| **Reranking** | YES | YES | YES | YES | YES (best) | PARTIAL |
| **Knowledge Graph / GraphRAG** | YES (built-in) | YES (built-in) | NO | YES (best, PropertyGraphIndex) | PARTIAL (developing) | NO |
| **Entity Extraction** | YES (auto) | YES (auto) | Via pipeline | YES (most flexible) | YES (NER) | NO |
| **Per-Project Isolation** | YES (collections + auth) | PARTIAL (datasets) | PARTIAL (workspaces) | DIY (metadata) | DIY (metadata) | NO |
| **Multi-Tenancy Auth** | YES (built-in) | NO | PARTIAL | NO | NO | NO |
| **Self-Hostable** | YES | YES | YES | YES | YES | YES |
| **Architectural Fit with Rowboat** | EXCELLENT | GOOD | POOR (overlap) | OK (must build service) | OK (must build service) | POOR |
| **GitHub Stars** | 7.7k | 74k | 131k | 47k | 24k | 37k |
| **Community/Maturity** | Growing | Large | Massive | Very Large | Enterprise-proven | Large (Chinese) |
| **License** | MIT | Apache 2.0 | Custom (Apache-based) | MIT | Apache 2.0 | Apache 2.0 |

---

## Architectural Fit Analysis

### What We Actually Need

Our architecture is:
```
Users → Dashboard UI → Rowboat (agent orchestration) → RAG Backend (THE THING WE'RE CHOOSING)
                                                      → LLM APIs (OpenAI, etc.)
```

The RAG backend must:
1. **Be a service** — running independently, callable via API
2. **Not be an agent framework** — Rowboat handles orchestration
3. **Handle the full RAG pipeline** — ingest, chunk, embed, store, search, retrieve
4. **Support knowledge graphs** — entity extraction and relationship tracking
5. **Support per-project isolation** — each discovery project gets its own data silo

### Platform Categories

**Category A: Deployable RAG Services (best fit)**
- R2R — purpose-built RAG API service
- RAGFlow — RAG engine with API + UI

**Category B: Full AI Platforms (architectural overlap)**
- Dify — complete AI application platform (too much)

**Category C: Developer Frameworks (requires building a service)**
- LlamaIndex — RAG framework (most flexible, most work)
- Haystack — AI orchestration framework (most enterprise-ready, most work)

**Category D: Components (not standalone)**
- Unstructured — document parsing only
- Langchain-Chatchat — chatbot application, not a backend

---

## Recommendations

### Primary Recommendation: R2R

**Why R2R is the best fit:**

1. **Architecturally correct** — it IS a RAG backend API. That is exactly what we need.
   No agent framework overlap. No UI platform overhead. Just a service that
   accepts documents, builds knowledge, and answers queries via REST API.

2. **Knowledge graph built in** — entity extraction and relationship mapping are
   core features, not add-ons. The extraction API lets you control entity types
   and prompts. Documents can be added to multiple graphs. This maps directly
   to our entity tracking needs (stakeholders, decisions, features, integrations).

3. **Collection-based multi-tenancy** — each discovery project becomes an R2R
   collection with its own documents, graph, and access controls. Built-in
   user authentication handles per-project isolation.

4. **Hybrid search + reranking** — semantic + keyword with reciprocal rank
   fusion and reranking are built-in, not configuration you have to assemble.

5. **Clean integration with Rowboat** — Rowboat agents make HTTP calls to R2R.
   R2R does not try to orchestrate agents. Clean separation of concerns.

**Risks with R2R:**
- Smaller community (7.7k stars) — less battle-tested than alternatives.
- Less control over document parsing than RAGFlow's DeepDoc.
- If the project loses momentum, we are dependent on a smaller team.

### Secondary Recommendation: RAGFlow

**Why RAGFlow as the backup:**

1. **Best document parsing** — DeepDoc is significantly better than basic
   text extraction for complex PDFs with tables, charts, and mixed layouts.
   For discovery documents (client specs, contracts, technical docs), this matters.

2. **Template-based chunking** — the only platform with built-in visual
   chunking templates per document type. This is a gap in R2R.

3. **GraphRAG** — knowledge graph construction and entity-relationship retrieval.

4. **Large community** — 74k stars, very active development, Apache 2.0 licensed.

**Risks with RAGFlow:**
- Has its own agent/chat layer (less overlap than Dify, but still some).
- Per-project isolation is not as clean as R2R's collection + auth model.
- Heavier infrastructure (needs Elasticsearch/Infinity + MinIO + MySQL/PostgreSQL).

### Hybrid Approach: R2R + Unstructured (Enhanced Parsing)

If we choose R2R and find its document parsing insufficient for complex PDFs:
- R2R already uses Unstructured under the hood
- We can enhance the parsing pipeline by using Unstructured's more advanced
  features or routing complex documents through additional preprocessing
- This gives us R2R's API + auth + KG with better document handling

### If Maximum Flexibility is Needed: LlamaIndex Custom Service

If neither R2R nor RAGFlow meets our needs and we want full control:
- Build a custom RAG microservice using LlamaIndex
- Use PropertyGraphIndex for knowledge graphs (best-in-class)
- Deploy as a FastAPI service
- Implement our own multi-tenancy, authentication, document management
- **Estimated additional effort: 4-8 weeks** vs deploying R2R (1-2 weeks)

---

## Integration Architecture with Rowboat

### Recommended Architecture (R2R)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     DISCOVERY ASSISTANT                              │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  FRONTEND (Dashboard)                                         │  │
│  │  Project management, document upload, chat, readiness view    │  │
│  └───────────────────────────┬──────────────────────────────────┘  │
│                               │                                     │
│  ┌───────────────────────────▼──────────────────────────────────┐  │
│  │  ROWBOAT (Agent Orchestration)                                │  │
│  │                                                               │  │
│  │  Gap Detection Agent ──┐                                      │  │
│  │  Meeting Prep Agent ───┤                                      │  │
│  │  Document Gen Agent ───┼──→ Tool calls to R2R API             │  │
│  │  Control Point Agent ──┤                                      │  │
│  │  Intake Agent ─────────┘                                      │  │
│  │                                                               │  │
│  │  Each agent has MCP tools that wrap R2R API endpoints:        │  │
│  │  - search_project_knowledge(query, filters)                   │  │
│  │  - get_project_entities(project_id, entity_type)              │  │
│  │  - ingest_document(project_id, file, metadata)                │  │
│  │  - get_project_graph(project_id)                              │  │
│  └───────────────────────────┬──────────────────────────────────┘  │
│                               │                                     │
│  ┌───────────────────────────▼──────────────────────────────────┐  │
│  │  R2R (RAG Backend)                                            │  │
│  │                                                               │  │
│  │  Per Project:                                                 │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │  Collection: "project-acme-nacxwan"                      │ │  │
│  │  │                                                         │ │  │
│  │  │  Documents: meeting notes, emails, specs, website       │ │  │
│  │  │  Vectors: embedded chunks with metadata                 │ │  │
│  │  │  Graph: entities (people, orgs, decisions, features)    │ │  │
│  │  │         relationships (decided_by, works_at, depends_on)│ │  │
│  │  └─────────────────────────────────────────────────────────┘ │  │
│  │                                                               │  │
│  │  Services:                                                    │  │
│  │  - Ingestion pipeline (parse → chunk → embed → store)         │  │
│  │  - Hybrid search (semantic + keyword + metadata filter)       │  │
│  │  - Knowledge graph (entity extraction + relationship mapping) │  │
│  │  - Reranking (cross-encoder scoring)                          │  │
│  │  - Authentication + access control                            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Infrastructure: PostgreSQL (pgvector) + R2R containers             │
└─────────────────────────────────────────────────────────────────────┘
```

### How Rowboat Agents Would Call R2R

Each Rowboat agent would have MCP tools or HTTP-based tools that wrap R2R API calls:

```
Agent: Gap Detection Agent
Task: "Find what's missing about authentication"
  1. Call R2R search: POST /search
     {collection: "project-acme", query: "authentication method", search_mode: "hybrid"}
  2. Call R2R graph: GET /collections/project-acme/entities?type=decision&topic=auth
  3. Compare: search results show discussion, but no "decision" entity exists
  4. Report: "Authentication has been discussed but no decision is recorded"

Agent: Meeting Prep Agent
Task: "Prepare agenda for meeting 4"
  1. Call R2R search: POST /search
     {collection: "project-acme", query: "open questions unanswered",
      filters: {doc_type: ["meeting_notes", "email"]}}
  2. Call R2R graph: GET /collections/project-acme/entities?type=open_question&status=unanswered
  3. Compile: list of unresolved topics sorted by priority
  4. Generate: structured meeting agenda
```

---

## Next Steps

1. **Deploy R2R locally** — Docker Compose setup, verify API endpoints work
2. **Test document ingestion** — upload sample discovery documents (PDFs, DOCX, meeting notes)
3. **Evaluate chunking quality** — inspect how R2R chunks different document types
4. **Test knowledge graph extraction** — verify entity extraction quality on discovery docs
5. **Test hybrid search** — verify search quality with real project queries
6. **Prototype Rowboat integration** — create MCP tools that wrap R2R API calls
7. **Evaluate RAGFlow as backup** — if R2R's parsing or chunking is insufficient,
   test RAGFlow's DeepDoc against the same documents
8. **Benchmark** — compare retrieval quality between R2R and RAGFlow on
   real discovery queries

---

## Sources

### Platform Repositories
- [Dify](https://github.com/langgenius/dify) — 131k stars, LLM application platform
- [LlamaIndex](https://github.com/run-llama/llama_index) — 47k stars, RAG framework
- [Langchain-Chatchat](https://github.com/chatchat-space/Langchain-Chatchat) — 37k stars, local knowledge base QA
- [Unstructured](https://github.com/Unstructured-IO/unstructured) — 14k stars, document parsing
- [R2R](https://github.com/SciPhi-AI/R2R) — 7.7k stars, production RAG API
- [RAGFlow](https://github.com/infiniflow/ragflow) — 74k stars, RAG engine
- [Haystack](https://github.com/deepset-ai/haystack) — 24k stars, AI orchestration framework
- [Cognita](https://github.com/truefoundry/cognita) — 4.3k stars, modular RAG framework

### Key Articles and Documentation
- [Dify Hybrid Search and Rerank](https://dify.ai/blog/hybrid-search-rerank-rag-improvement)
- [Dify Knowledge Pipeline](https://dify.ai/blog/introducing-knowledge-pipeline)
- [R2R Knowledge Graphs Documentation](https://r2r-docs.sciphi.ai/cookbooks/graphs)
- [R2R Entity Extraction API](https://r2r-docs.sciphi.ai/api-and-sdks/collections/extract)
- [LlamaIndex PropertyGraphIndex](https://www.llamaindex.ai/blog/introducing-the-property-graph-index-a-powerful-new-way-to-build-knowledge-graphs-with-llms)
- [LlamaIndex Multi-Tenancy RAG](https://www.llamaindex.ai/blog/building-multi-tenancy-rag-system-with-llamaindex-0d6ab4e0c44b)
- [Haystack Hybrid Retrieval Tutorial](https://haystack.deepset.ai/tutorials/33_hybrid_retrieval)
- [RAGFlow GraphRAG Support](https://ragflow.io/blog/ragflow-support-graphrag)
- [Unstructured Chunking Best Practices](https://unstructured.io/blog/chunking-for-rag-best-practices)
- [Deploying RAG with R2R and Unstructured](https://unstructured.io/blog/production-rag-with-r2r-and-unstructured)
- [Rowboat Multi-Agent IDE](https://github.com/rowboatlabs/rowboat)
- [15 Best Open-Source RAG Frameworks in 2026](https://www.firecrawl.dev/blog/best-open-source-rag-frameworks)
- [Production RAG in 2026: LangChain vs LlamaIndex](https://rahulkolekar.com/production-rag-in-2026-langchain-vs-llamaindex/)
- [Firecrawl RAG Framework Comparison](https://www.firecrawl.dev/blog/best-open-source-rag-frameworks)
