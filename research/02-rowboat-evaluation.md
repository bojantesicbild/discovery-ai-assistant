# Rowboat Platform Evaluation

## Overview

Rowboat (https://github.com/rowboatlabs/rowboat) is an open-source (Apache 2.0)
repository that contains **two separate products**:

1. **Server App** (`apps/rowboat/`) — Multi-agent orchestration platform with
   vector RAG (Qdrant), project management, visual workflow editor. Cloud-hosted.
2. **Desktop App** (`apps/x/`) — Electron app that builds a knowledge graph from
   email/meetings as Obsidian-compatible markdown with wiki-link backlinks.

**We would use the Server App as our platform** and borrow the knowledge graph
concept from the Desktop App for entity tracking (see 09-rag-system.md).

## Tech Stack (Server App — `apps/rowboat/`)

| Component     | Technology          | Purpose                          |
|---------------|---------------------|----------------------------------|
| Frontend      | Next.js + React     | Web UI and API server            |
| Database      | MongoDB             | Primary data storage             |
| Vector DB     | Qdrant              | Vector RAG / semantic search     |
| Cache/Queue   | Redis               | Caching and job queue            |
| Auth          | Auth0               | Authentication                   |
| File Storage  | AWS S3              | Document uploads for RAG         |
| Web Scraping  | Firecrawl           | Crawl URLs for RAG data sources  |
| LLM           | OpenAI (gpt-4.1)    | Default, configurable per agent  |
| Embeddings    | text-embedding-3-small | Vector embeddings             |

Note: The Desktop App (`apps/x/`) uses a completely different stack — Electron,
local filesystem, grep-based search, no vector DB. Its knowledge graph stores
entities as markdown files with wiki-link backlinks. See 09-rag-system.md for details.

## Key Features Relevant to Discovery Assistant

### 1. Multi-Agent Orchestration
- 4 agent types: conversation, post_process, escalation, pipeline
- Per-agent model selection, instructions, control flow
- Agents can be user-facing or internal (hidden processing)
- Pipeline agents execute in ordered sequences

### 2. RAG Pipeline (Critical for our use case)
- Qdrant vector search with per-agent RAG configuration
- Web scraping via Firecrawl (useful for client website analysis)
- Document uploads via S3 (meeting notes, emails, PDFs)
- Configurable: return chunks vs. full content, top-K results
- Modular: RAG, uploads, scraping can be enabled independently

### 3. Visual Workflow Editor
- UI-based design of multi-agent workflows
- Configure agents, prompts, tools, and pipelines visually
- AI Copilot helps build and configure agents via natural language

### 4. MCP (Model Context Protocol) Support
- Add external tools via standard MCP protocol
- Supports HTTP and SSE transport
- Custom MCP server registration

### 5. Multi-Channel Deployment
- REST API for integration into any app
- Python SDK
- Embeddable chat widget
- CLI for automation

### 6. Project-Based Organization
- Multi-project support (maps well to our per-client structure)
- Per-project agents, data sources, tools, conversations

## Fit Assessment for Discovery Assistant

### Strong Fit ✅
- Multi-agent orchestration maps directly to our discovery agents
- RAG pipeline handles the core "ingest all client docs" requirement
- Project-based structure = one project per client engagement
- Visual workflow editor makes it easy to customize discovery flows
- MCP support allows connecting to Jira, Confluence, email systems
- Open source = full control over customization

### Gaps to Address ⚠️
- No built-in "control point" / checklist system (need to build)
- No template engine for structured document output (need to build)
- No meeting recording ingestion (would need integration)
- No email ingestion out of the box (desktop app has Gmail, but server version doesn't)
- Default LLM is OpenAI - may want to support Anthropic Claude too
- No Figma/design tool integration

### Customization Needed 🔧
1. **Discovery Control Points Agent** - custom agent that tracks discovery completeness
2. **Template Engine** - structured output templates (MVP Scope, Functional Req, etc.)
3. **Question Generator Agent** - analyzes gaps and produces follow-up questions
4. **Meeting Prep Agent** - creates agendas based on what's missing
5. **Document Analyzer Agent** - extracts key info from uploaded client docs
6. **Email/Meeting Ingestion** - pipeline to ingest client communications
7. **Progress Dashboard** - visual tracker for discovery phase completeness

## Recommendation

Rowboat is a strong starting point. It provides the core infrastructure (multi-agent,
RAG, project structure, API) so we can focus on building the discovery-specific logic
on top rather than reinventing the orchestration layer.
