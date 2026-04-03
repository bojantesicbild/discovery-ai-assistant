# 25 — Agent Capabilities Research: Real-World Tools for Discovery AI

> **Date:** 2026-03-31
> **Purpose:** Research how modern AI agent systems give agents real-world capabilities (tools, browsing, code analysis, document generation) and determine what's relevant for a Discovery AI Assistant that helps Product Owners gather client requirements.

---

## 1. Technology Landscape

### 1.1 gstack — Headless Browser Daemon

**Repo:** [garrytan/gstack](https://github.com/garrytan/gstack) | **License:** MIT

gstack gives Claude Code agents "eyes" through a **persistent headless Chromium daemon** built on Playwright. The architecture:

```
Claude Code → CLI binary (Bun) → HTTP POST → Server (Bun.serve) → CDP → Chromium (headless)
```

**Key patterns:**

- **Persistent browser state:** First command starts Chromium (~3s), subsequent commands are ~100ms. Cookies, tabs, and localStorage persist between commands with 30-minute idle shutdown.
- **Cookie import:** `/setup-browser-cookies` imports sessions from Chrome, Arc, Brave, Edge — enables authenticated browsing without manual login.
- **Browser ref system:** The `/browse` skill sends structured commands (navigate, click, screenshot, fill) via HTTP to the daemon. Each tab gets a separate agent control context. The daemon maintains tab isolation while sharing session state.
- **Real Chrome mode (`/connect-chrome`):** Launches user's actual Chrome with a Side Panel extension for live co-presence. A child Claude instance executes tasks in isolated 5-minute sessions. Visual indicator (green shimmer) shows when AI controls the browser.
- **Handoff mechanism:** If the agent hits a CAPTCHA, `$B handoff` opens visible Chrome for human intervention, then `$B resume` continues.

**The /qa skill:** Opens a real browser, executes test flows, discovers bugs through interaction, fixes them with atomic commits, auto-generates regression tests per fix, and re-verifies corrections. Integrates with a test matrix for coverage tracking.

**The /design skill pipeline:**
1. `/design-consultation` — landscape research + creative risk proposals + realistic mockups
2. `/design-shotgun` — multiple visual variants → comparison board in browser → "taste memory bias" tracking
3. `/design-html` — converts to production HTML with Pretext text-reflow computation

**Relevance for Discovery AI:** The persistent browser daemon pattern is directly applicable for client research — browse company websites, explore competitor products, map user flows in existing systems, all while maintaining authentication state.

---

### 1.2 Superpowers — Subagent Dispatch

**Repo:** [obra/superpowers](https://github.com/obra/superpowers) | **License:** Open Source | **Stars:** 121k+

Superpowers is an agentic skills framework by Jesse Vincent (Prime Radiant). The **subagent-driven-development** skill is the key pattern.

**Dispatch pattern:**
1. Controller agent curates exact context needed for each task
2. Fresh subagent spawned per task with **isolated context** — never inherits the session's history
3. Three specialized roles: Implementer, Spec Reviewer, Code Quality Reviewer
4. Sequential loop: Dispatch implementer → answer questions → spec review → quality review → mark complete → next task

**How workers get tool access:**
- Tools are **role-bound, not dynamically assigned**. Each role template defines capabilities implicitly.
- The controller provides **complete information upfront** rather than having subagents read files. Red flag: "Make subagent read plan file" — avoided in favor of injecting full text into the prompt.
- Model selection based on task complexity: mechanical tasks → cheaper model, integration tasks → standard model, architecture/review → most capable model.

**Key finding:** Superpowers discovered that a subagent review loop (dispatching a fresh agent to review plans) doubled execution time (~25 min overhead) without measurably improving quality. Regression testing across 5 versions showed identical quality scores regardless of review loop.

**Relevance for Discovery AI:** The isolated-context subagent pattern is ideal for discovery. A controller agent can dispatch specialized subagents for: company research, competitor analysis, technical assessment, compliance research — each with precisely curated context and focused prompts.

---

### 1.3 Claude Agent SDK

**Docs:** [platform.claude.com/docs/en/agent-sdk](https://platform.claude.com/docs/en/agent-sdk/overview) | **PyPI:** `claude-agent-sdk` v0.1.53

The Agent SDK gives developers the same tools, agent loop, and context management that power Claude Code, programmable in Python and TypeScript.

**Core concepts:**

1. **`query()` function** — Main entry point creating the agentic loop. Returns async iterator streaming messages as Claude works.
2. **Built-in tools** — Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, AskUserQuestion
3. **Custom tools** — Python functions offered to Claude, implemented as in-process MCP servers
4. **Hooks** — Callbacks at lifecycle points: PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd
5. **Subagents** — Spawn specialized agents with `AgentDefinition(description, prompt, tools)`
6. **MCP integration** — Connect external systems via `mcp_servers` config
7. **Sessions** — Maintain context across exchanges, resume/fork sessions

**Tool permission model:**
```python
ClaudeAgentOptions(
    allowed_tools=["Read", "Edit", "Glob", "WebSearch"],
    permission_mode="acceptEdits",  # or "dontAsk", "bypassPermissions", "default"
)
```

**Subagent definition:**
```python
agents={
    "code-reviewer": AgentDefinition(
        description="Expert code reviewer for quality and security reviews.",
        prompt="Analyze code quality and suggest improvements.",
        tools=["Read", "Glob", "Grep"],
    )
}
```

**MCP server connection:**
```python
mcp_servers={
    "playwright": {"command": "npx", "args": ["@playwright/mcp@latest"]}
}
```

**Relevance for Discovery AI:** This is our **primary SDK for building the agent backend**. The `query()` function with custom tools, subagents, and MCP servers provides the exact infrastructure needed. We can define discovery-specific tools (fact extraction, knowledge base operations) as custom tools and connect external capabilities via MCP.

---

### 1.4 Claurst — Claude Code Architecture Insights

**Repo:** [Kuberwastaken/claurst](https://github.com/Kuberwastaken/claurst)

Claurst is a clean-room Rust reimplementation of Claude Code, built from behavioral specs after Claude Code's source was accidentally exposed via npm sourcemaps (March 2026). Key architectural insights:

- **40+ tools** in the tool system: shell execution, file operations, web access, notebook editing, background tasks, MCP integration
- **Permission system** with ML-based auto-approval ("YOLO classifier"), risk stratification, and protected file lists
- **Coordinator Mode** spawning parallel worker agents with research/synthesis/implementation/verification phases
- **KAIROS** — always-on persistent assistant with daily logs, proactive decisions, push notifications
- **autoDream** — background memory consolidation: orient → gather signal → consolidate → prune
- **ULTRAPLAN** — remote 30-minute planning via Cloud Container Runtime with browser-based approval
- **System prompt architecture** — modular, cached sections with dynamic/static boundary markers

**Relevance for Discovery AI:** The **Coordinator Mode** (research → synthesis → implementation → verification) maps directly to discovery workflows. The **autoDream memory consolidation** pattern is relevant for long-running discovery projects where facts accumulate over days/weeks.

---

### 1.5 MCP Servers Ecosystem

MCP (Model Context Protocol) has reached ~97 million monthly downloads as of March 2026. Over 400 community-built servers exist.

#### Web Search Servers

| Server | Provider | Free Tier | Notes |
|--------|----------|-----------|-------|
| **Brave Search MCP** | Brave | ~1,000 queries/mo ($5 free credit) | Web + local search |
| **Tavily MCP** | Tavily/Nebius | 1,000 searches/mo | search, extract, map, crawl tools; /research endpoint for deep research |
| **SearXNG MCP** | Self-hosted | Unlimited (server cost) | Metasearch engine, privacy-focused |
| **OneSearch MCP** | Community | Varies | Unified: Tavily + DuckDuckGo + Bing + SearXNG |

#### Browser Automation Servers

| Server | Notes |
|--------|-------|
| **Playwright MCP** (Microsoft) | Accessibility snapshots, no screenshots needed. ~114k tokens/task via MCP vs ~27k via CLI |
| **Puppeteer MCP** | Lighter, Chrome-only. **Deprecated** by Anthropic, archived on npm |
| **Chrome MCP** | Extension-based, semantic search |
| **Browser MCP** | Extension + MCP for VS Code/Claude/Cursor |

#### Filesystem & Database Servers

| Server | Capabilities |
|--------|-------------|
| **Filesystem MCP** | File watching, glob patterns, metadata, batch operations |
| **PostgreSQL MCP** | Query databases, inspect schemas, write migrations |
| **SQLite MCP** | Local database access |

**Key concern:** Perplexity CTO Denis Yarats noted MCP can consume 40-50% of context windows before agents do actual work. Microsoft's `@playwright/cli` achieves 4x token reduction vs MCP for browser tasks.

**Relevance for Discovery AI:** MCP servers are the plug-and-play capability layer. For MVP, Tavily MCP for web search and Filesystem MCP for document management. For v2, Playwright MCP for interactive browsing and PostgreSQL MCP for structured knowledge storage.

---

### 1.6 Browser-Use

**Repo:** [browser-use/browser-use](https://github.com/browser-use/browser-use) | **Stars:** 85k+ | **License:** MIT

Browser-Use makes websites accessible for AI agents. Architecture:
- Browser control layer (Chromium-based)
- LLM integration for decision-making (supports Claude, GPT, Gemini, Ollama)
- Visual perception system (screenshot analysis)
- Custom tools for domain-specific extensions
- Cloud deployment with "stealth browsers," proxy rotation, CAPTCHA solving

**ChatBrowserUse** is their purpose-built model completing tasks 3-5x faster than general models.

**Relevance for Discovery AI:** Useful for v2 interactive exploration of client systems. More heavyweight than gstack's approach but offers cloud deployment and CAPTCHA handling.

---

### 1.7 Firecrawl

**Site:** [firecrawl.dev](https://www.firecrawl.dev/) | **Repo:** [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl)

Firecrawl converts websites into LLM-ready markdown/structured data. Key endpoints:
- **Scrape** — single page to clean markdown
- **Crawl** — discover and scrape all pages on a site
- **Extract** — structured data via AI prompts
- **Agent** — autonomous navigation for complex sites

Handles JavaScript rendering for SPAs. Output feeds directly into LLM prompts or RAG systems. Free tier: 500 credits/month. SDKs for Python and Node.js. MCP server available.

**Relevance for Discovery AI:** Ideal for **client company research** — crawl their website, extract structured company info, product offerings, tech stack indicators. The `/agent` endpoint handles complex multi-page navigation autonomously.

---

### 1.8 Tavily

**Site:** [tavily.com](https://www.tavily.com/)

AI-optimized search API. Key capabilities:
- **Search API** — real-time web search optimized for AI consumption
- **Extract API** — extract content from URLs
- **Research endpoint** (GA Jan 2026) — deep end-to-end web research via single API call: performs iterative searches, reasons over data, supports multi-agent coordination, returns comprehensive reports
- **Domain governance** — control which domains are searched
- **Agent Skills** — pre-built integrations for agent frameworks

Acquired by Nebius (Feb 2026). Integrated into Nvidia's AI-Q Blueprint as the retrieval layer.

**Relevance for Discovery AI:** The `/research` endpoint is particularly powerful — a single API call can produce comprehensive research reports on a client's industry, competitors, or regulatory landscape.

---

## 2. Capability Analysis for Discovery AI

### A. Web Research for Discovery

**Scenario:** PO says "Research the client's company and competitors"

**Recommended approach: Tavily /research + Firecrawl**

| Step | Tool | Action |
|------|------|--------|
| 1. Company overview | Tavily /research | Deep research on company: history, products, revenue, market position |
| 2. Website crawl | Firecrawl /crawl | Scrape entire company website → structured markdown |
| 3. Competitor identification | Tavily /search | Find competitors, industry reports |
| 4. Competitor deep-dives | Firecrawl /extract | Extract key data from competitor sites |
| 5. Industry trends | Tavily /research | Research industry trends, regulatory landscape |
| 6. Fact storage | Custom tool | Store findings as structured facts in knowledge base |

**Implementation via Claude Agent SDK:**
```python
async for message in query(
    prompt="Research ACME Corp and their top 3 competitors",
    options=ClaudeAgentOptions(
        allowed_tools=["WebSearch", "WebFetch", "Write", "custom_store_fact"],
        system_prompt="You are a discovery research specialist...",
        mcp_servers={
            "tavily": {"command": "npx", "args": ["tavily-mcp-server"]},
            "firecrawl": {"command": "npx", "args": ["firecrawl-mcp-server"]}
        }
    ),
)
```

**Priority:** MVP | **Effort:** 1-2 weeks | **Infrastructure:** Tavily API key ($0 free tier), Firecrawl API key ($0 free tier)

---

### B. Code Repository Analysis

**Scenario:** Client has an existing GitHub repo; agent identifies tech stack, architecture, APIs

**Recommended approach: Claude Agent SDK with built-in tools**

The Agent SDK already includes Read, Glob, Grep, and Bash — the exact tools needed for code analysis. No additional infrastructure required.

| Step | Tool | Action |
|------|------|--------|
| 1. Clone repo | Bash | `git clone` the client repo |
| 2. Identify tech stack | Glob + Read | Read package.json, requirements.txt, Dockerfiles, config files |
| 3. Map architecture | Grep + Read | Find entry points, routing, database schemas |
| 4. Extract API endpoints | Grep | Find route definitions, API handlers, OpenAPI specs |
| 5. Analyze patterns | Read | Review key files for architecture patterns |
| 6. Generate report | Write | Produce structured technical context document |

**Implementation:**
```python
agents={
    "code-analyst": AgentDefinition(
        description="Analyzes codebases to extract technical context for discovery.",
        prompt="Clone and analyze the repo. Identify: tech stack, architecture pattern, "
               "API endpoints, database schema, deployment setup, testing approach.",
        tools=["Bash", "Read", "Glob", "Grep", "Write"],
    )
}
```

**How gstack handles this:** gstack's `/investigate` skill performs systematic root-cause debugging by reading code, forming hypotheses, and verifying. The pattern of structured code exploration with specific goals is directly applicable.

**Priority:** MVP (basic), v2 (deep analysis) | **Effort:** 1 week (basic), 2 weeks (comprehensive) | **Infrastructure:** Git access to client repos

---

### C. Rich Document Generation

**Scenario:** Generate interactive HTML reports with charts, diagrams, heatmaps, exportable as PDF

**Recommended approach: HTML generation with embedded libraries**

| Component | Library | Purpose |
|-----------|---------|---------|
| **Charts** | Chart.js or D3.js (CDN) | Readiness scores, gap analysis, timeline |
| **Diagrams** | Mermaid.js (CDN) | Entity relationships, user flows, architecture |
| **Layout** | Tailwind CSS (CDN) | Professional styling, print-friendly |
| **PDF export** | html2pdf.js or browser Print→PDF | Client-ready deliverables |
| **Heatmaps** | D3.js heatmap or custom SVG | Gap analysis, risk matrices |

**Implementation patterns:**

1. **Template-based:** Pre-built HTML templates with placeholders. Agent fills in data and the template renders charts client-side. Simplest approach.
2. **AI-generated HTML:** Agent generates complete HTML using skills like gstack's `/design-html`. More flexible but requires quality review.
3. **Mermaid for diagrams:** AI generates Mermaid syntax (text-based), embedded in HTML with `<script src="mermaid.js">`. Renders entity relationships, sequence diagrams, flowcharts.

```html
<!-- Example: Mermaid entity relationship diagram -->
<div class="mermaid">
erDiagram
    CLIENT ||--o{ REQUIREMENT : has
    REQUIREMENT ||--o{ USER_STORY : generates
    USER_STORY ||--o{ ACCEPTANCE_CRITERIA : contains
    REQUIREMENT }o--|| CATEGORY : "belongs to"
</div>
```

**PDF export strategy:** Use `html2pdf.js` for in-browser export, or Puppeteer/Playwright on the server for headless rendering. The gstack pattern of maintaining a persistent browser daemon could serve as the PDF rendering engine.

**Priority:** v1 (basic HTML), v2 (interactive charts, PDF) | **Effort:** 2-3 weeks | **Infrastructure:** CDN-hosted JS libraries (no server-side deps for MVP)

---

### D. API Exploration

**Scenario:** Client has existing APIs the new system needs to integrate with; agent reads API docs and maps integration requirements

**Recommended approach: OpenAPI/Swagger parsing + Claude Agent SDK**

| Step | Tool | Action |
|------|------|--------|
| 1. Locate API docs | WebFetch or Read | Find and download OpenAPI/Swagger spec (JSON/YAML) |
| 2. Parse spec | Custom tool | Parse OpenAPI into structured endpoint list |
| 3. Analyze endpoints | Agent reasoning | Classify endpoints by domain, identify auth methods |
| 4. Map integrations | Agent reasoning | Which endpoints are relevant for the new system? |
| 5. Identify gaps | Agent reasoning | What's missing? What auth patterns are used? |
| 6. Generate report | Write | Produce integration requirements document |

**Key insight from research:** OpenAPI specs are self-describing, so AI agents can automatically interpret endpoints, parameters, and responses. Tools like Agentica convert Swagger docs directly into agent-callable functions.

**Implementation:**
```python
# Custom tool for OpenAPI analysis
@tool
def parse_openapi_spec(spec_url: str) -> dict:
    """Parse an OpenAPI spec and return structured endpoint data."""
    # Fetch and parse the spec
    # Return: endpoints, auth methods, data models, error patterns
```

**Priority:** v2 | **Effort:** 2 weeks | **Infrastructure:** None beyond Agent SDK

---

### E. Meeting Recording Analysis

**Scenario:** PO uploads audio/video recording of client meeting; agent transcribes and extracts decisions

**Recommended approach: Whisper/AssemblyAI transcription → Claude analysis**

| Step | Tool | Action |
|------|------|--------|
| 1. Transcribe | Whisper API or AssemblyAI | Audio → text with speaker diarization |
| 2. Identify speakers | WhisperX + Pyannote 3.1 | Label who said what |
| 3. Extract decisions | Claude Agent | Parse transcript for decisions, action items, requirements |
| 4. Identify themes | Claude Agent | Cluster discussion topics, flag concerns |
| 5. Store as facts | Custom tool | Each decision/requirement → structured fact |
| 6. Generate summary | Write | Meeting summary with extracted requirements |

**Transcription options:**

| Service | Accuracy (WER) | Speaker ID | Cost |
|---------|-----------------|------------|------|
| OpenAI Whisper (large-v3) | ~2.7% clean, ~8% noisy | Via WhisperX | $0.006/min |
| AssemblyAI Universal-2 | ~4-7% | Built-in | $0.01/min |
| Voxtral Mini Transcribe V2 | ~4% (FLEURS) | Yes | Varies |

**Priority:** v2 | **Effort:** 2-3 weeks | **Infrastructure:** Transcription API key, file upload handling

---

### F. Autonomous Research Loops

**Scenario:** Agent identifies a gap (e.g., "no information about compliance requirements") and autonomously researches it

**Recommended approach: Coordinator Mode pattern (from claurst) + Tavily /research**

**How gstack implements this:** The `/autoplan` skill runs an automated review pipeline with decision encoding. Each review skill (CEO, eng, design) feeds findings into the next stage. Gaps identified at any stage trigger follow-up work.

**How Superpowers implements this:** The controller agent maintains a plan, dispatches focused subagents per task, and tracks completion. If a subagent identifies missing context, the controller can dispatch additional research subagents.

**Recommended pattern for Discovery AI:**

```
Gap Detection → Research Subagent → Validation → Fact Storage
```

1. **Gap detection:** After each discovery session, agent analyzes knowledge base for completeness against a checklist (functional requirements, non-functional requirements, compliance, integrations, data model, user roles, etc.)
2. **Research dispatch:** For each gap, dispatch a focused subagent with Tavily /research access
3. **Findings presentation:** Research results presented to PO for validation before becoming facts
4. **Iterative refinement:** PO feedback triggers targeted follow-up research

**Implementation:**
```python
# Controller agent
agents={
    "gap-researcher": AgentDefinition(
        description="Researches specific gaps in discovery knowledge.",
        prompt="Research {topic} for {industry} in {region}. "
               "Focus on: regulations, compliance requirements, "
               "industry standards, common practices.",
        tools=["WebSearch", "WebFetch"],
    )
}
```

**Key insight from Superpowers:** Provide complete context upfront to subagents. Don't let them inherit session context — construct exactly what they need for focused research.

**Priority:** v2 | **Effort:** 2-3 weeks | **Infrastructure:** Tavily API, knowledge base gap-detection logic

---

### G. Interactive Exploration

**Scenario:** PO says "Show me how the client's current system works"; agent browses live product and maps user flows

**Recommended approach: gstack's browser daemon pattern + Playwright MCP**

| Step | Tool | Action |
|------|------|--------|
| 1. Launch browser | Playwright MCP or gstack daemon | Start headless browser session |
| 2. Navigate to app | Browser control | Go to client's application URL |
| 3. Authenticate | Cookie import or manual handoff | Login to the system |
| 4. Map user flows | Screenshot + navigate | Walk through key workflows, capture screenshots |
| 5. Document flows | Write | Generate user flow documentation with annotated screenshots |
| 6. Extract UI patterns | Agent reasoning | Identify UI patterns, data models from the interface |

**gstack's approach:** The `/qa` skill already does this for testing. The `/connect-chrome` skill adds real Chrome with live co-presence — the PO could watch the agent explore the client's system in real-time.

**Authentication handling:**
- `/setup-browser-cookies` imports sessions from the PO's browser
- Handoff mechanism for CAPTCHAs or MFA
- Tab isolation keeps exploration contained

**Browser-Use alternative:** For cloud deployment, Browser-Use offers stealth browsers with proxy rotation and CAPTCHA solving. More suitable for exploring public-facing systems without authentication.

**Token efficiency concern:** Playwright MCP consumes ~114k tokens per browser task. Microsoft's CLI alternative uses ~27k tokens. For token-sensitive deployments, consider the CLI approach or gstack's direct CDP integration.

**Priority:** v2/v3 | **Effort:** 3-4 weeks | **Infrastructure:** Playwright or gstack browser daemon, screenshot storage

---

## 3. Recommended Technology Stack

### MVP (v1) — Core Discovery with Web Research

| Capability | Technology | Rationale |
|------------|-----------|-----------|
| **Agent framework** | Claude Agent SDK (Python) | Official SDK, built-in tools, subagent support |
| **Web search** | Tavily API (via MCP or direct) | Best AI-optimized search, /research endpoint, free tier |
| **Web scraping** | Firecrawl (via MCP or direct) | Clean markdown output, JS rendering, free tier |
| **Code analysis** | Agent SDK built-in tools | Read, Glob, Grep, Bash — no extra infra needed |
| **Document output** | HTML templates + Mermaid.js | CDN-hosted, no server deps, Mermaid for diagrams |
| **Knowledge storage** | Structured JSON/SQLite | Simple, no external DB needed for MVP |

### v2 — Enhanced Capabilities

| Capability | Technology | Rationale |
|------------|-----------|-----------|
| **Interactive browsing** | Playwright MCP or gstack daemon | Client system exploration, authenticated browsing |
| **Meeting transcription** | AssemblyAI or Whisper API | Speaker diarization, good accuracy |
| **API exploration** | Custom OpenAPI parser tool | Automated integration analysis |
| **Rich reports** | HTML + Chart.js + Mermaid + html2pdf.js | Interactive charts, PDF export |
| **Autonomous research** | Subagent pattern + Tavily /research | Gap detection and fill |
| **Knowledge storage** | PostgreSQL (via MCP) | Structured queries, relationships |

### v3 — Full Automation

| Capability | Technology | Rationale |
|------------|-----------|-----------|
| **Live system mapping** | Browser-Use Cloud or gstack /connect-chrome | Stealth browsing, CAPTCHA handling |
| **Coordinator mode** | Multi-subagent orchestration | Parallel research across domains |
| **Memory consolidation** | autoDream pattern | Long-running project memory management |
| **Cross-project learning** | Session forking + knowledge transfer | Learn from past discoveries |

---

## 4. Effort Estimates Summary

| Capability | Priority | Effort | Dependencies |
|------------|----------|--------|-------------|
| A. Web Research | **MVP** | 1-2 weeks | Tavily API key, Firecrawl API key |
| B. Code Repo Analysis | **MVP** | 1 week | Git access |
| C. Rich Documents (basic) | **MVP** | 1 week | CDN libraries |
| C. Rich Documents (full) | v2 | 2 weeks | html2pdf.js |
| D. API Exploration | v2 | 2 weeks | OpenAPI parser |
| E. Meeting Transcription | v2 | 2-3 weeks | Transcription API |
| F. Autonomous Research | v2 | 2-3 weeks | Gap detection logic |
| G. Interactive Exploration | v2/v3 | 3-4 weeks | Browser infrastructure |

**Total MVP:** ~3-4 weeks
**Total v2:** ~10-14 weeks additional
**Total v3:** ~6-8 weeks additional

---

## 5. Key Architectural Decisions

### 5.1 Claude Agent SDK as the Foundation

The Claude Agent SDK is the clear choice for our agent backend:
- Same tools that power Claude Code, battle-tested at scale
- Built-in Read/Write/Edit/Bash/Glob/Grep/WebSearch/WebFetch
- Custom tools as Python functions (in-process MCP servers)
- Subagent support for specialized discovery tasks
- MCP integration for external capabilities
- Session management for multi-turn discovery conversations
- Hooks for logging, validation, and custom workflows

### 5.2 Subagent Pattern from Superpowers

Adopt the Superpowers pattern of **isolated-context subagents**:
- Controller agent manages the discovery session
- Specialized subagents for: company research, competitor analysis, code review, compliance research
- Each subagent gets exactly the context it needs — no session history inheritance
- Model selection by task complexity (use cheaper models for mechanical research)

### 5.3 Browser Daemon from gstack

For interactive exploration (v2+), adopt gstack's persistent browser daemon:
- Sub-100ms command latency after initial start
- Cookie import from real browsers for authenticated sessions
- Handoff mechanism for human intervention (CAPTCHAs, MFA)
- Tab isolation for parallel exploration

### 5.4 Token Efficiency

MCP servers can consume 40-50% of context windows. Mitigations:
- Use direct API calls (Tavily, Firecrawl) for high-volume operations
- Reserve MCP for interactive, stateful operations (browser, database)
- Consider CLI-based alternatives (Playwright CLI: 4x fewer tokens than MCP)
- Use subagents with focused context to preserve main agent's context window

### 5.5 Coordinator Mode for Complex Discovery

Adopt the Coordinator Mode pattern from Claude Code's architecture:
1. **Research phase** — parallel subagents gather information
2. **Synthesis phase** — combine findings, identify conflicts
3. **Implementation phase** — produce structured outputs (facts, documents)
4. **Verification phase** — validate completeness, present to PO

---

## 6. Sources

- [garrytan/gstack](https://github.com/garrytan/gstack) — Virtual engineering team via Claude Code
- [obra/superpowers](https://github.com/obra/superpowers) — Agentic skills framework
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) — Official documentation
- [Claude Agent SDK Quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart) — Getting started guide
- [Kuberwastaken/claurst](https://github.com/Kuberwastaken/claurst) — Claude Code Rust reimplementation and architecture breakdown
- [browser-use/browser-use](https://github.com/browser-use/browser-use) — Browser automation for AI agents
- [Firecrawl](https://www.firecrawl.dev/) — Web data API for AI
- [Tavily](https://www.tavily.com/) — AI-powered search API
- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) — Browser automation MCP server
- [MCP Servers Directory](https://mcpservers.org/) — Community MCP server listing
- [Brave Search MCP](https://www.pulsemcp.com/servers/brave-search) — Web search MCP server
- [MCP Roadmap 2026](https://thenewstack.io/model-context-protocol-roadmap-2026/) — Protocol evolution
- [Superpowers Blog Post](https://blog.fsck.com/2025/10/09/superpowers/) — Original methodology description
- [claude-agent-sdk on PyPI](https://pypi.org/project/claude-agent-sdk/) — Python package
