# Infrastructure & Deployment

## Overview

The Discovery AI Assistant is composed of three service stacks plus shared
infrastructure, all managed via Docker Compose. Each stack is an independent
open-source project that we deploy as a service and call via API.

```
┌───────────────────────────────────────────────────────────────────┐
│                        DOCKER COMPOSE                              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  DISCOVERY APP (our code)                                    │  │
│  │  ├── API Server         (Python / FastAPI)                   │  │
│  │  ├── Agent Workers      (background job processors)          │  │
│  │  ├── Frontend           (Next.js / React)                    │  │
│  │  └── Scheduler          (cron: periodic evals, digests)      │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────┐  ┌────────────────────────────────┐ │
│  │  RAGFLOW STACK            │  │  MEM0 STACK                    │ │
│  │  ├── RAGFlow Server       │  │  ├── Mem0 Server               │ │
│  │  ├── Elasticsearch        │  │  ├── PGVector                  │ │
│  │  ├── MySQL                │  │  └── Neo4j                     │ │
│  │  └── MinIO                │  │                                │ │
│  └──────────────────────────┘  └────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  SHARED INFRASTRUCTURE                                       │  │
│  │  ├── PostgreSQL           (app data: projects, users, etc.)  │  │
│  │  ├── Redis                (cache, job queue, sessions)       │  │
│  │  └── S3 / MinIO           (file uploads, generated docs)     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  EXTERNAL SERVICES (not in Docker Compose)                        │
│  ├── LLM API                 (OpenAI / Anthropic Claude)         │
│  └── Claude Code             (repo analysis — CLI or API)        │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

## Service Breakdown

### Discovery App (our code)

| Service | Technology | Purpose |
|---------|-----------|---------|
| **API Server** | Python / FastAPI | REST API for frontend, agent orchestration, query routing, ingestion pipeline |
| **Agent Workers** | Python (Celery or similar) | Background processing: document ingestion, fact extraction triggers, control point evaluation, document generation |
| **Frontend** | Next.js / React | Dashboard, chat interface, document editor, project management UI |
| **Scheduler** | Cron / Celery Beat | Periodic tasks: weekly digests, stalling detection, scheduled evaluations |

### RAGFlow Stack

| Service | Purpose | Notes |
|---------|---------|-------|
| **RAGFlow Server** | Document parsing (DeepDoc), chunking, hybrid search, reranking, metadata extraction | Main API we call for Layer 1 operations |
| **Elasticsearch** | Full-text index + vector index for document chunks | RAGFlow's storage backend. Handles both keyword and vector search. |
| **MySQL** | RAGFlow metadata (document records, chunk metadata, configuration) | Internal to RAGFlow. We don't query it directly. |
| **MinIO** | Original document file storage within RAGFlow | Stores uploaded PDFs, DOCX, etc. for reprocessing if needed. |

**RAGFlow API endpoints we use:**
- Document upload and parsing
- Search (hybrid: keyword + vector, with metadata filters)
- Chunk retrieval (with parent-child context)
- Dataset management (one dataset per project for isolation)

**Configuration per project:**
- Chunking template selection (meeting notes, Q&A, general, table, etc.)
- Metadata fields (date, author, doc_type, meeting_number, source)
- Search weights (keyword vs. vector ratio)
- Reranking provider selection
- Top-K results per query

### Mem0 Stack

| Service | Purpose | Notes |
|---------|---------|-------|
| **Mem0 Server** | Fact extraction (LLM-powered), deduplication, lifecycle management, memory API | Main API for Layer 2 + Layer 3 operations |
| **PGVector** | Fact embeddings for semantic search over facts | Enables "find facts similar to X" queries |
| **Neo4j** | Entity relationship graph | Stores people, orgs, features, decisions, and their relationships |

**Mem0 API endpoints we use:**
- Add memory (triggers fact extraction from text)
- Search memories (find relevant facts)
- Get all memories (for a project/user scope)
- Memory history (version tracking: old value → new value)
- Graph queries (entity relationships via Neo4j)

**Configuration per project:**
- Project isolation via `project_id` + `user_id`
- Custom entity types for discovery (stakeholder, feature, decision,
  integration, assumption, constraint)
- Fact categories mapped to control point areas

### Shared Infrastructure

| Service | Purpose | Notes |
|---------|---------|-------|
| **PostgreSQL** | Application data | Projects, users, settings, control point templates, readiness scores, audit logs |
| **Redis** | Cache + job queue | Agent task queue, session cache, rate limiting, temporary state during pipelines |
| **S3 / MinIO** | File storage | Uploaded documents (before sending to RAGFlow), generated output documents (PDF, MD) |

### External Services

| Service | Purpose | Notes |
|---------|---------|-------|
| **LLM API** | AI reasoning for all agents | Anthropic Claude on Bild's tenant. Model configurable per agent (Opus / Sonnet / Haiku). |
| **Claude Code** | Repository analysis | CLI or API integration. Triggered by Intake Agent when PO provides a repo URL. Aligns with existing Bild pipeline (Phases 2-4 use Claude Code). |

---

## Data Flow Between Services

```
PO uploads document
       │
       ▼
  API Server
       │
       ├──→ S3/MinIO (store original file)
       │
       ├──→ RAGFlow API
       │    └── Parse → Chunk → Embed → Index
       │        (stored in Elasticsearch)
       │
       ├──→ Mem0 API
       │    └── Extract facts → Deduplicate → Store
       │        (facts in PGVector, graph in Neo4j)
       │
       └──→ Agent Workers
            └── Control Point evaluation
                (reads Mem0, writes score to PostgreSQL)

PO asks a question
       │
       ▼
  API Server → Query Router
       │
       ├──→ RAGFlow API (if needs document text)
       ├──→ Mem0 API (if needs facts or graph)
       └──→ Claude Code (if needs repo info)
       │
       ▼
  Agent processes results → responds to PO
```

---

## Per-Project Data Isolation

Each client discovery project is isolated across all services:

| Service | Isolation method |
|---------|-----------------|
| **RAGFlow** | One dataset per project. Documents and chunks scoped to dataset. |
| **Mem0** | `project_id` parameter on all API calls. Facts and entities scoped per project. |
| **PostgreSQL** | Project ID foreign key on all app data tables. |
| **S3/MinIO** | Folder prefix per project (`/projects/{project_id}/`). |
| **Redis** | Key prefix per project for cache entries. |

A PO working on "NacXwan" never sees data from "ProjectX." All queries,
facts, entities, and documents are scoped to the active project.

**Cross-project access** (for learning/patterns) is a separate, explicit
feature — the system queries a shared "cross-project knowledge" scope that
contains only decision logs and learning docs, not client-specific data.

---

## LLM Configuration

Different agents and operations have different LLM needs:

| Operation | Model | Why |
|-----------|-------|-----|
| **Fact extraction** (Mem0) | Claude Haiku | High volume, needs to be fast and cost-effective. Extraction is structured. |
| **Agent reasoning** (Gap Detection, Meeting Prep) | Claude Sonnet | Needs strong reasoning for gap analysis and question generation. |
| **Document generation** | Claude Sonnet | Needs good writing quality for deliverables. |
| **Role simulation** | Claude Opus | Most complex reasoning — simulating multiple perspectives. |
| **Control point evaluation** | Claude Haiku | Structured yes/no checks against facts. Fast and efficient. |
| **Repo analysis** (Claude Code) | Claude (built-in) | Claude Code uses its own model. |
| **Metadata extraction** (RAGFlow) | Claude Haiku | RAGFlow's LLM-powered auto-tagging. Configure to use Anthropic API. |

All LLM operations use **Anthropic Claude models on Bild's own tenant**.
This means client data (meeting notes, specs, code repos) never leaves
Bild's controlled environment — no data is used for model training, and
all processing stays within the tenant boundary.

Using a dedicated tenant also allows us to use the strongest models
(Opus for complex reasoning, Sonnet for general agent work) without
data privacy concerns. This is critical because discovery data contains
sensitive client information — business strategy, technical architecture,
stakeholder details, and potentially proprietary code.

The system should support configuring the model per agent and per
operation type, so we can optimize cost by using Haiku for high-volume
structured tasks and Opus only where complex reasoning is needed.

---

## Resource Estimates

Approximate resource requirements for a production deployment:

| Service | CPU | RAM | Storage | Notes |
|---------|-----|-----|---------|-------|
| API Server | 2 cores | 2 GB | Minimal | Stateless, scales horizontally |
| Agent Workers | 2-4 cores | 4 GB | Minimal | CPU for orchestration, most work is LLM API calls |
| Frontend | 1 core | 512 MB | Minimal | Static build served by Node |
| RAGFlow Server | 2-4 cores | 4-8 GB | Minimal | Document parsing is CPU-intensive |
| Elasticsearch | 2-4 cores | 4-8 GB | 10-50 GB | Depends on document volume per project |
| MySQL | 1 core | 1 GB | 1-5 GB | RAGFlow metadata, lightweight |
| MinIO (RAGFlow) | 1 core | 512 MB | 10-50 GB | Original document storage |
| Mem0 Server | 2 cores | 2 GB | Minimal | LLM API calls are the bottleneck |
| PGVector | 1-2 cores | 2-4 GB | 5-20 GB | Fact embeddings |
| Neo4j | 2 cores | 2-4 GB | 1-10 GB | Entity graph, grows with projects |
| PostgreSQL | 1 core | 1 GB | 1-5 GB | App data, lightweight |
| Redis | 1 core | 512 MB | Minimal | Cache and queue |

**Total estimate:** 16-24 cores, 24-40 GB RAM, 50-150 GB storage

This is for a team-scale deployment (5-20 POs, 10-50 concurrent projects).
For initial development and testing, everything runs comfortably on a single
machine with 8 cores and 32 GB RAM.

---

## Development Environment

For local development:

```bash
# Clone the repo
git clone <repo-url>
cd discovery-ai-assistant

# Start all services
docker compose up -d

# Services available at:
# - Frontend:        http://localhost:3000
# - API Server:      http://localhost:8000
# - RAGFlow UI:      http://localhost:9380  (admin/config)
# - Neo4j Browser:   http://localhost:7474  (graph exploration)
# - Elasticsearch:   http://localhost:9200
# - MinIO Console:   http://localhost:9001

# Environment variables needed:
# - ANTHROPIC_API_KEY (Bild tenant API key)
# - RAGFLOW_API_KEY (generated in RAGFlow admin)
# - MEM0_API_KEY (if using Mem0 cloud, or omit for self-hosted)
```

**Local development tip:** RAGFlow and Mem0 can each take 1-2 minutes to
initialize on first startup (downloading models, initializing indices).
Subsequent starts are faster.

---

## Deployment Options

### Option A: Single Server (Development / Small Team)

Everything on one machine via Docker Compose. Simplest setup.

```
Single Server (8+ cores, 32+ GB RAM)
└── Docker Compose
    ├── Discovery App services
    ├── RAGFlow stack
    ├── Mem0 stack
    └── Shared infrastructure
```

**Best for:** Development, demos, small teams (1-5 POs).

### Option B: Split Services (Production / Larger Team)

Separate RAGFlow and Mem0 onto their own servers for better resource
isolation and independent scaling.

```
Server 1: Discovery App
├── API Server, Agent Workers, Frontend, Scheduler
├── PostgreSQL, Redis
└── S3/MinIO

Server 2: RAGFlow
├── RAGFlow Server
├── Elasticsearch
├── MySQL
└── MinIO (RAGFlow-internal)

Server 3: Mem0
├── Mem0 Server
├── PGVector
└── Neo4j
```

**Best for:** Production with 5-20 POs, 10-50 concurrent projects.

### Option C: Kubernetes (Enterprise Scale)

Each service as a Kubernetes deployment with autoscaling. RAGFlow and Mem0
both provide Helm charts or can be containerized from their Docker Compose
definitions.

**Best for:** Enterprise deployment, multi-team, high availability requirements.

---

## Monitoring and Observability

Key metrics to track:

| Category | Metrics |
|----------|---------|
| **Ingestion** | Documents processed/day, average parse time, failure rate |
| **Knowledge** | Facts extracted/day, contradictions detected, entities created |
| **Agents** | Queries/day per agent, average response time, LLM token usage |
| **Readiness** | Average readiness score across projects, time to 85% ready |
| **Cost** | LLM API spend per project, per agent, per operation type |
| **Infrastructure** | Elasticsearch index size, Neo4j node count, queue depth |

**LLM cost tracking** is particularly important — Mem0's fact extraction
calls the LLM for every document ingested. Monitor token usage per project
and optimize model selection (use smaller models where possible).

---

## Security Considerations

| Area | Approach |
|------|----------|
| **Authentication** | Internal SSO (company identity). Internal users only for MVP. |
| **Authorization** | Project-level access control. POs see only their projects. |
| **Data isolation** | Per-project scoping across all services (see above). |
| **LLM data privacy** | All LLM calls go through Bild's Anthropic tenant. Client data stays within Bild's controlled environment — not used for training, not shared, not retained beyond the API call. |
| **Client code repos** | Analyzed via Claude Code on Bild's tenant. Repo contents never leave the secure boundary. |
| **Document storage** | Encrypted at rest (S3/MinIO encryption). |
| **Network** | Internal service communication via Docker network. No external exposure except frontend + API. |
| **Secrets** | API keys in environment variables / secret manager. Never in code or config files. |

**Why Anthropic tenant matters:** Discovery data is among the most sensitive
in any client engagement — business strategy, technical architecture,
stakeholder details, budget constraints, and potentially proprietary
source code. Running all AI operations on Bild's own Anthropic tenant
ensures this data is processed securely, with full control over data
residency and retention. This is a requirement, not an optimization.
