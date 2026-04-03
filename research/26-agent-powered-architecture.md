# 26 — Agent-Powered Architecture: Rethinking the Engine

> **Date:** 2026-04-02
> **Purpose:** Evaluate whether to adopt Claude Agent SDK as the core engine
> **Builds on:** research/25 (agent capabilities), research/23 (final decisions), ARCHITECTURE.md
> **Status:** PROPOSAL — needs decision

---

## 1. The Insight

Research/25 revealed that Claude Agent SDK provides the exact infrastructure
we were planning to build manually:

| What We Planned to Build | Agent SDK Gives Us For Free |
|--------------------------|---------------------------|
| Pipeline stages with async processing | `query()` agentic loop with tool calling |
| Skill runner (prompt + LLM call + parse) | Subagents with `AgentDefinition` |
| RAGFlow client (search abstraction) | Custom tools (Python functions) |
| Intent classifier (haiku classification) | Agent reasoning (routes naturally) |
| Preamble builder (context injection) | System prompt + session context |
| Error handling + retry | Built-in retry with tool error feedback |
| LLM call tracking | Hooks (PostToolUse) for logging |

Plus capabilities we WEREN'T planning but now can:

| New Capability | How |
|---------------|-----|
| Web research | Built-in WebSearch + WebFetch, or Tavily/Firecrawl MCP |
| Code repo analysis | Built-in Read + Glob + Grep + Bash |
| Rich HTML generation | Built-in Write tool |
| Autonomous research loops | Subagent dispatch pattern |
| Browser exploration (v2) | Playwright MCP server |

---

## 2. Two Architecture Options

### Option A: Keep FastAPI, Use Agent SDK as a Library

```
┌─────────────────────────────────────────────────┐
│                 FRONTEND (Next.js)                │
└──────────────────┬──────────────────────────────┘
                   │ REST API
┌──────────────────▼──────────────────────────────┐
│              BACKEND (FastAPI)                    │
│                                                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐ │
│  │ Pipeline  │  │ Chat API  │  │ Dashboard    │ │
│  │ (our code)│  │ (our code)│  │ API          │ │
│  └─────┬─────┘  └─────┬─────┘  └──────────────┘ │
│        │               │                          │
│  ┌─────▼───────────────▼──────────────────────┐  │
│  │  Claude Agent SDK (library calls)           │  │
│  │  - query() for skills                       │  │
│  │  - Custom tools for RAGFlow, PostgreSQL     │  │
│  │  - Subagents for research tasks             │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**How it works:**
- FastAPI handles HTTP routing, auth, database operations, file uploads
- When the system needs LLM intelligence (extraction, skills, research), it calls
  `claude_agent_sdk.query()` with appropriate tools and prompts
- Custom tools wrap our services (RAGFlow search, fact storage, graph queries)
- Pipeline is still our code, but extraction stages use Agent SDK
- Skills are Agent SDK `query()` calls with subagent definitions

**Pros:**
- We keep full control over HTTP layer, auth, database
- Agent SDK is a tool we use, not a framework we depend on
- Familiar web app architecture — any Python dev can work on it
- Easy to test (mock the Agent SDK calls)
- Can swap Agent SDK for raw Anthropic API if needed

**Cons:**
- We still write pipeline orchestration ourselves
- Agent SDK capabilities (tool chaining, autonomous reasoning) are limited
  to the scope of each `query()` call
- Two mental models: web app code + agent code

### Option B: Agent SDK as the Core Engine

```
┌─────────────────────────────────────────────────┐
│                 FRONTEND (Next.js)                │
└──────────────────┬──────────────────────────────┘
                   │ WebSocket / SSE
┌──────────────────▼──────────────────────────────┐
│           THIN API LAYER (FastAPI)                │
│  Auth, file upload, WebSocket proxy               │
│  Passes messages to Agent SDK                     │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│         AGENT ENGINE (Claude Agent SDK)           │
│                                                  │
│  Main Agent (Discovery Coordinator)              │
│  ├── Tools: search_facts, search_docs,           │
│  │          store_fact, evaluate_control_points,  │
│  │          web_search, web_fetch                 │
│  │                                                │
│  ├── Subagents:                                  │
│  │   ├── document-processor                      │
│  │   │   Tools: Read, RAGFlow upload/parse       │
│  │   ├── company-researcher                      │
│  │   │   Tools: WebSearch, WebFetch, Firecrawl   │
│  │   ├── code-analyst                            │
│  │   │   Tools: Bash, Read, Glob, Grep           │
│  │   ├── gap-analyzer                            │
│  │   │   Tools: search_facts, search_docs        │
│  │   ├── meeting-prep                            │
│  │   │   Tools: search_facts, search_docs        │
│  │   ├── doc-generator                           │
│  │   │   Tools: search_facts, search_docs, Write │
│  │   └── report-builder                          │
│  │       Tools: Write (HTML generation)          │
│  │                                                │
│  └── MCP Servers:                                │
│      ├── tavily (web search)                     │
│      ├── firecrawl (web scraping)                │
│      └── playwright (browser, v2)                │
└──────────────────────────────────────────────────┘
```

**How it works:**
- FastAPI is a thin proxy: handles auth, file upload, WebSocket
- Every user message goes to the Agent Engine
- Main agent (coordinator) decides what to do: invoke a subagent, use a tool, ask the user
- Subagents have focused tool sets and isolated context
- Agent SDK manages the reasoning loop, tool calling, retries, sessions

**Pros:**
- Agent handles complex multi-step tasks naturally (research → extract → store → evaluate)
- No pipeline orchestration code — agent reasons about what to do next
- New capabilities are just new tools or subagents (not new pipeline stages)
- Autonomous research loops work naturally (agent detects gap → dispatches researcher)
- Session management built in (multi-turn conversations with memory)

**Cons:**
- Less predictable than a coded pipeline (agent might take unexpected paths)
- Harder to test (LLM behavior is non-deterministic)
- Higher LLM cost (agent reasoning overhead for every action)
- Agent SDK is a newer dependency (v0.1.53 as of research date)
- Debugging is harder (trace through agent reasoning, not code paths)

---

## 3. Recommendation: Hybrid (Option A with Agent SDK for Intelligence)

**Use FastAPI for structure. Use Agent SDK for intelligence.**

The pipeline (upload → parse → extract → store → evaluate) should remain
coded logic. It's deterministic, testable, and cost-efficient. Making the
agent "figure out" how to process a document adds LLM overhead with no benefit.

But skills, chat, and research should use Agent SDK. These are inherently
open-ended — the agent needs to reason about what to search, what tools to use,
and how to present results.

```
┌──────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                      │
│  Chat + Dashboard + Document viewer                        │
└──────────────────┬───────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────┐
│                  BACKEND (FastAPI)                         │
│                                                           │
│  DETERMINISTIC LAYER (our code):                          │
│  ├── Auth (OAuth2 + JWT)                                  │
│  ├── File upload → Pipeline (parse → extract → store)     │
│  ├── Dashboard API (readiness, control points, activity)  │
│  ├── Project management (CRUD, templates)                 │
│  └── Polling / status endpoints                           │
│                                                           │
│  INTELLIGENCE LAYER (Agent SDK):                          │
│  ├── Chat handler → Agent SDK query()                     │
│  │   Main agent reasons + routes to:                      │
│  │   ├── search_documents (RAGFlow tool)                  │
│  │   ├── search_facts (RAGFlow + PostgreSQL tool)         │
│  │   ├── search_graph (RAGFlow GraphRAG tool)             │
│  │   ├── store_fact (PostgreSQL tool)                     │
│  │   ├── Subagent: gap-analyzer                           │
│  │   ├── Subagent: meeting-prep                           │
│  │   ├── Subagent: doc-generator                          │
│  │   ├── Subagent: deep-analyzer                          │
│  │   ├── Subagent: company-researcher (Tavily+Firecrawl)  │
│  │   └── Subagent: code-analyst (Read+Glob+Grep+Bash)    │
│  │                                                        │
│  └── Pipeline extraction stages also use Instructor       │
│      (not Agent SDK — deterministic, structured)          │
└──────────────────────────────────────────────────────────┘
```

### What Uses What

| Component | Technology | Why |
|-----------|-----------|-----|
| **Pipeline** (upload → parse → extract → dedup → store → evaluate) | FastAPI + Instructor + RAGFlow API | Deterministic, testable, cost-efficient. No reasoning needed. |
| **Chat + Skills** (PO interaction, research, analysis) | Claude Agent SDK | Open-ended reasoning, tool selection, multi-step research. |
| **Custom Tools** (knowledge layer access) | Python functions registered with Agent SDK | Bridge between agent and our data stores. |
| **Subagents** (specialized tasks) | Agent SDK `AgentDefinition` | Isolated context per task type. |
| **Web Research** | Tavily API (via tool or MCP) | AI-optimized search, /research for deep dives. |
| **Web Scraping** | Firecrawl API (via tool or MCP) | Website → structured markdown. |
| **Code Analysis** | Agent SDK built-in tools | Read, Glob, Grep, Bash — no extra infra. |
| **Rich Reports** | Agent generates HTML (Write tool) | Chart.js + Mermaid.js + Tailwind via CDN. |

---

## 4. Custom Tools for Agent SDK

These are Python functions that the agent can call. They bridge our knowledge
layers into the agent's tool set.

```python
# tools/knowledge.py

from claude_agent_sdk import tool

@tool
def search_documents(query: str, project_id: str, top_n: int = 10) -> str:
    """Search raw document chunks in RAGFlow. Returns passages with source citations.
    Use this when you need actual paragraphs from client documents."""
    results = ragflow_client.search(
        dataset_id=f"project-{project_id}-documents",
        query=query, top_n=top_n
    )
    return format_search_results(results)

@tool
def search_facts(query: str, project_id: str) -> str:
    """Search extracted structured facts. Returns confirmed/partial/missing facts.
    Use this when you need to know the STATUS of a requirement or decision."""
    results = ragflow_client.search(
        dataset_id=f"project-{project_id}-facts",
        query=query, top_n=10
    )
    facts = db.get_facts_with_metadata(project_id, [r.id for r in results])
    return format_facts_with_status(facts)

@tool
def search_graph(query: str, project_id: str) -> str:
    """Search entity relationships via RAGFlow GraphRAG. Returns entities and connections.
    Use this for questions about WHO decided something, WHAT depends on something."""
    results = ragflow_client.search_graph(
        dataset_id=f"project-{project_id}-documents",
        query=query
    )
    return format_graph_results(results)

@tool
def store_finding(project_id: str, statement: str, category: str,
                  confidence: str, source: str, source_quote: str) -> str:
    """Store a new finding/fact in the knowledge base. Use this after research
    to persist what you learned. The PO will be asked to confirm."""
    fact = create_fact(project_id, statement, category, confidence,
                       source, source_quote, status="pending_review")
    return f"Finding stored (pending PO review): {statement}"

@tool
def get_control_points(project_id: str) -> str:
    """Get all control points with their current status and confidence.
    Use this to understand what's covered, partial, or missing."""
    cps = db.get_project_control_points(project_id)
    return format_control_points_table(cps)

@tool
def get_project_context(project_id: str) -> str:
    """Get the full project context: name, client, type, readiness score,
    recent activity, unresolved contradictions. Use this at the start of
    any analysis to understand the current state."""
    return build_preamble(project_id)

@tool
def generate_html_report(project_id: str, report_type: str, content: str) -> str:
    """Generate a rich HTML report with charts and diagrams.
    report_type: 'gap_analysis' | 'readiness_dashboard' | 'discovery_brief'
    content: the structured data to visualize."""
    html = render_report_template(report_type, content, project_id)
    path = save_report(project_id, report_type, html)
    return f"Report generated: {path}"
```

---

## 5. Subagent Definitions

```python
# agents/definitions.py

from claude_agent_sdk import AgentDefinition

DISCOVERY_AGENTS = {
    "gap-analyzer": AgentDefinition(
        description="Analyzes discovery gaps by checking control points against knowledge base.",
        prompt=open("skills/prompts/gaps.md").read(),
        tools=["search_facts", "search_documents", "get_control_points",
               "get_project_context"],
    ),

    "meeting-prep": AgentDefinition(
        description="Prepares client meeting agendas based on current gaps and contradictions.",
        prompt=open("skills/prompts/prep_meeting.md").read(),
        tools=["search_facts", "search_documents", "get_control_points",
               "get_project_context"],
    ),

    "doc-generator": AgentDefinition(
        description="Generates discovery deliverables: Discovery Brief, MVP Scope, Requirements.",
        prompt=open("skills/prompts/generate_docs.md").read(),
        tools=["search_facts", "search_documents", "search_graph",
               "get_control_points", "get_project_context",
               "generate_html_report"],
    ),

    "deep-analyzer": AgentDefinition(
        description="Deep cross-reference analysis on specific topics with evidence from multiple layers.",
        prompt=open("skills/prompts/analyze.md").read(),
        tools=["search_facts", "search_documents", "search_graph",
               "get_project_context"],
    ),

    "company-researcher": AgentDefinition(
        description="Researches companies, competitors, and industries via web search.",
        prompt="""You are a business research specialist for software project discovery.
Research the given topic thoroughly using web search and website scraping.
Extract structured findings: company overview, products, market position,
technology indicators, key people, recent news.
Always cite sources with URLs.""",
        tools=["WebSearch", "WebFetch", "store_finding"],
    ),

    "code-analyst": AgentDefinition(
        description="Analyzes code repositories to extract technical context for discovery.",
        prompt="""You are a technical analyst. Clone and analyze the given repository.
Extract: tech stack, architecture pattern, API endpoints, database schema,
deployment setup, testing approach, key dependencies.
Produce a structured technical context report.""",
        tools=["Bash", "Read", "Glob", "Grep", "store_finding"],
    ),
}
```

---

## 6. The Main Agent (Discovery Coordinator)

```python
# agents/coordinator.py

COORDINATOR_SYSTEM_PROMPT = """
You are the Discovery AI Assistant — an expert at helping Product Owners
run structured client discovery for software projects.

You have access to:
- A knowledge base of uploaded client documents (search_documents)
- Extracted structured facts with lifecycle tracking (search_facts)
- An entity relationship graph (search_graph)
- Control points tracking discovery completeness (get_control_points)
- Project context with readiness scores (get_project_context)
- The ability to store new findings (store_finding)
- The ability to generate rich HTML reports (generate_html_report)
- Specialized subagents for complex tasks

## How to Handle Requests

SEARCH QUERIES ("What did client say about X?", "Tell me about hosting"):
→ Use search_documents and/or search_facts directly. Return passages with citations.

SKILL REQUESTS ("What are the gaps?", "Prepare meeting", "Generate docs"):
→ Dispatch the appropriate subagent (gap-analyzer, meeting-prep, doc-generator).
   Always call get_project_context first to provide full context to the subagent.

RESEARCH REQUESTS ("Research ACME Corp", "What do competitors offer?"):
→ Dispatch company-researcher subagent with specific research goals.
   Present findings to PO for review before storing as facts.

CODE ANALYSIS ("Analyze this repo", "What tech stack does the client use?"):
→ Dispatch code-analyst subagent with the repo URL.

GRAPH QUERIES ("Who decided on SSO?", "What depends on auth?"):
→ Use search_graph directly.

STATUS QUERIES ("How ready are we?", "What changed?"):
→ Use get_project_context and get_control_points.

REPORT REQUESTS ("Generate a visual report", "Show me a readiness dashboard"):
→ Gather data, then use generate_html_report.

## Rules
- Always cite sources (document name, page, quote)
- When presenting findings from research, mark as PENDING PO REVIEW
- When uncertain, say so. Never fabricate facts.
- Use get_project_context at the start of complex tasks
- Present options with recommendations (AskUserQuestion format)
"""
```

---

## 7. Chat Handler (FastAPI → Agent SDK)

```python
# api/chat.py

from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition
from agents.definitions import DISCOVERY_AGENTS
from tools.knowledge import (search_documents, search_facts, search_graph,
                              store_finding, get_control_points,
                              get_project_context, generate_html_report)

@app.post("/projects/{project_id}/chat")
async def chat(project_id: str, user_id: str, message: ChatMessage):
    """Send message to discovery agent. Returns streamed response."""

    # Get conversation history
    conversation = await db.get_or_create_conversation(project_id, user_id)

    # Build messages with history
    messages = conversation.messages[-20:]  # Last 20 for context
    messages.append({"role": "user", "content": message.text})

    # Call Agent SDK
    response_parts = []
    async for event in query(
        prompt=message.text,
        options=ClaudeAgentOptions(
            model="claude-sonnet-4-20250514",
            system_prompt=COORDINATOR_SYSTEM_PROMPT.replace(
                "{project_id}", project_id
            ),
            tools=[
                search_documents, search_facts, search_graph,
                store_finding, get_control_points, get_project_context,
                generate_html_report,
            ],
            agents=DISCOVERY_AGENTS,
            messages=messages,
            # MCP servers for web research
            mcp_servers={
                "tavily": {
                    "command": "npx",
                    "args": ["tavily-mcp-server"],
                    "env": {"TAVILY_API_KEY": settings.TAVILY_API_KEY},
                },
            },
        ),
    ):
        if event.type == "text":
            response_parts.append(event.content)
        elif event.type == "tool_use":
            # Log tool usage for cost tracking
            await log_tool_use(project_id, event)

    # Save to conversation
    full_response = "".join(response_parts)
    await db.append_message(conversation.id, message.text, full_response)

    # Log LLM call
    await log_llm_call(project_id, "chat", event.usage)

    return {"response": full_response}
```

---

## 8. What Changes from Current ARCHITECTURE.md

| Area | Current | Proposed |
|------|---------|----------|
| **Chat handler** | Intent classifier → route to skill/search | Agent SDK `query()` — agent reasons and routes naturally |
| **Skill execution** | SkillRunner (prompt + Instructor call) | Agent SDK subagents with tool access |
| **Intent classification** | Separate haiku call ($0.001) | Agent handles routing as part of reasoning (no extra call) |
| **Web research** | Not in MVP | MVP via Tavily MCP + WebSearch/WebFetch tools |
| **Code analysis** | Not planned | MVP via Agent SDK built-in tools (Read, Glob, Grep, Bash) |
| **Rich reports** | Deferred | MVP basic HTML via Write tool + CDN chart libraries |
| **Autonomous research** | Deferred to v2 | v1.5 — subagent dispatch for focused research tasks |
| **Shared services** | InstructorClient, RAGFlowClient, etc. | Custom tools registered with Agent SDK |
| **Pipeline** | UNCHANGED | Still FastAPI + Instructor + RAGFlow. Deterministic. |
| **Database** | UNCHANGED | Still PostgreSQL. Same schema. |
| **RAGFlow** | UNCHANGED | Still documents + facts datasets + GraphRAG. |
| **Auth** | UNCHANGED | Still OAuth2 + JWT via FastAPI. |
| **Dashboard API** | UNCHANGED | Still REST endpoints from FastAPI. |

### What Does NOT Change
- The pipeline (upload → classify → parse → extract → dedup → store → evaluate)
- PostgreSQL schema (facts, control points, users, etc.)
- RAGFlow integration (2 datasets + GraphRAG per project)
- Auth and project management
- Dashboard and status APIs
- Docker Compose infrastructure (8 containers)

### What Changes
- Chat goes through Agent SDK instead of intent classifier + skill runner
- Skills become subagents with tool access instead of single Instructor calls
- New capabilities: web research, code analysis, rich HTML generation
- Intent classification happens naturally (agent decides, not a separate call)

---

## 9. Cost Impact

| Component | Current Estimate | With Agent SDK |
|-----------|-----------------|---------------|
| Pipeline per document | $0.15-0.40 | $0.15-0.40 (unchanged — uses Instructor) |
| Chat per message (simple search) | $0.005-0.03 | $0.01-0.05 (agent reasoning overhead) |
| Skill invocation | $0.03-0.25 | $0.05-0.30 (subagent + tools) |
| Web research task | N/A | $0.10-0.30 (Tavily + agent reasoning) |
| Code analysis task | N/A | $0.10-0.50 (depends on repo size) |
| **Per project** | **$5-12** | **$8-20** (more capabilities, slightly higher cost) |

The cost increase (~50%) is justified by significantly more capabilities.
Web research alone saves the PO hours of manual Googling per project.

---

## 10. MVP Scope (Revised)

### Ships in v1 (with Agent SDK)

Everything from current ARCHITECTURE.md PLUS:
- Chat powered by Agent SDK with natural routing (no intent classifier needed)
- 4 skill subagents (/gaps, /prep, /generate, /analyze)
- Web research subagent (Tavily + WebSearch/WebFetch)
- Code analysis subagent (built-in tools)
- Basic HTML report generation (readiness dashboard, gap analysis)
- Custom tools for knowledge layer access
- Tool use logging for cost tracking

### Deferred to v2

- Browser daemon for interactive exploration (gstack pattern / Playwright MCP)
- Meeting transcription (Whisper/AssemblyAI)
- OpenAPI/Swagger analysis tool
- Autonomous research loops (agent detects gap → auto-researches)
- Coordinator Mode (parallel research subagents)
- autoDream memory consolidation
- Advanced HTML reports (interactive charts, PDF export)

---

## 11. Dependencies

| Dependency | Version | Risk | Mitigation |
|-----------|---------|------|-----------|
| `claude-agent-sdk` | 0.1.53 | New SDK, may have breaking changes | Pin version, wrap in abstraction |
| `anthropic` | Latest | Stable, well-maintained | Low risk |
| `instructor` | Latest | Stable, well-maintained | Pipeline only, not Agent SDK |
| Tavily API | - | External service | Free tier for MVP, fallback to WebSearch |
| Firecrawl API | - | External service | Optional, fallback to WebFetch |

**The main risk is `claude-agent-sdk` maturity.** At v0.1.53, it's early. Mitigation:
- Wrap all Agent SDK calls in our own abstraction layer
- Keep the pipeline on Instructor (proven, stable)
- Agent SDK only handles chat + skills (if it breaks, pipeline still works)
- Can fall back to raw `anthropic` SDK + manual tool loop if needed

---

## 12. Implementation Plan Impact

The sprint plan from current architecture changes slightly:

```
WEEK 1-2: Foundation (UNCHANGED)
  - FastAPI project setup
  - PostgreSQL schema
  - RAGFlow integration
  - Instructor extraction pipeline

WEEK 3-4: Pipeline (UNCHANGED)
  - Redis queue + worker
  - Pipeline stages with checkpoints
  - Control point evaluation
  - Dashboard API

WEEK 5-6: Agent + Skills (CHANGED)
  - Install Claude Agent SDK
  - Define custom tools (search_documents, search_facts, etc.)
  - Define 4 skill subagents + company-researcher + code-analyst
  - Write coordinator system prompt
  - Chat API → Agent SDK integration
  - Tavily MCP setup for web research

WEEK 7-8: Frontend + Polish (UNCHANGED)
  - Next.js dashboard
  - Chat interface
  - Document upload + pipeline status
  - Control point editor
  - Basic HTML report rendering
```

The total timeline stays ~8 weeks. Week 5-6 shifts from "build skill runner
from scratch" to "configure Agent SDK with tools and subagents" — arguably less
code, more prompt engineering.
