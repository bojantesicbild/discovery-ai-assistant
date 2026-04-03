# Production Agent Engine Reality Check (March 2026)

What agent engines do real-world production projects actually use? An honest assessment to inform our engine choice for Discovery AI Assistant.

---

## Table of Contents

1. [Paperclip Research](#1-paperclip-research)
2. [Real Production Deployments by Framework](#2-real-production-deployments-by-framework)
3. [Notable Claude Code Ecosystem Projects](#3-notable-claude-code-ecosystem-projects)
4. [The Honest Comparison](#4-the-honest-comparison)
5. [The Honest Answer](#5-the-honest-answer)
6. [Sources](#6-sources)

---

## 1. Paperclip Research

**What is it?** Paperclip is "open-source orchestration for zero-human companies" -- a Node.js/React platform that coordinates teams of AI agents to run a business. It provides org charts, budgets, goal tracking, governance, and accountability for AI agent teams.

**Does it use Claude Code?** Not as a dependency. Paperclip is **agent-engine-agnostic**. It orchestrates agents -- Claude Code sessions, OpenClaw bots, Python scripts, shell commands, HTTP webhooks -- anything that can receive a heartbeat signal. Its philosophy: "If it can receive a heartbeat, it's hired."

**Tech stack:** Node.js + TypeScript backend, PostgreSQL, React UI, pnpm workspaces monorepo.

**Key architecture:**
- Agents run on scheduled heartbeats and event triggers (not continuous loops)
- Task checkout and budget enforcement are atomic (no double-work, no runaway spend)
- Persistent agent state across heartbeats (agents resume context, not restart)
- Immutable audit logs with full tool-call tracing
- Multi-company isolation in single deployment

**How it relates to Claude Code:** Paperclip sits *above* agent engines. It doesn't compete with Claude Agent SDK or Pydantic AI -- it coordinates instances of those agents. This is an orchestration layer, not an agent engine. You'd use Paperclip to manage a fleet of agents, each of which might be powered by Claude Agent SDK, Pydantic AI, or raw API calls.

**GitHub stats:** 45K+ stars, launched March 2, 2026, MIT licensed.

**Relevance to us:** Low for engine choice. Paperclip solves a different problem (multi-agent business orchestration). But its architecture validates that the agent engine is a pluggable concern -- the real complexity is in orchestration, state management, and governance.

---

## 2. Real Production Deployments by Framework

### Claude Agent SDK (formerly Claude Code SDK)

| Company | Use Case | Details |
|---------|----------|---------|
| **Spotify** | Codebase migrations | 650+ monthly PRs merged into production. Integrated into Fleet Management infrastructure (July 2025). Handles Java AutoValue-to-Records, framework upgrades, config updates. 90% time savings on migrations. |
| **Apple** | Xcode 26.3 integration | Native Claude Agent SDK in Xcode for refactoring, SwiftUI generation, architectural consistency across iOS/macOS/Vision Pro apps. |
| **NASA** | Mars rover route planning | Claude Code used to plan ~400m routes for Perseverance rover using Rover Markup Language. |
| **Anthropic (Claude Code itself)** | AI coding agent | The most widely used AI coding agent, built on the Agent SDK. Millions of users. |

**SDK status:** Python v0.1.48 on PyPI, TypeScript v0.2.71 on npm (as of March 2026). Renamed from "Claude Code SDK" in late 2025 to reflect it's a general-purpose agent runtime.

### LangGraph

| Company | Use Case | Details |
|---------|----------|---------|
| **Klarna** | Customer support AI | Handles support for 85M active users. 80% reduction in resolution time. |
| **Uber** | Code migration automation | Developer Platform team automates unit test generation for large-scale migrations. |
| **LinkedIn** | AI recruiter | Hierarchical agent system for candidate sourcing, matching, messaging. |
| **Elastic** | Threat detection | AI agents for SecOps threat detection scenarios. |
| **Cisco** | Various | Enterprise LangChain/LangGraph deployments. |
| **JP Morgan, BlackRock** | Financial analysis | Enterprise agent deployments. |

**Scale:** 90 million monthly downloads. ~400 companies on LangGraph Platform. Deployments at Uber, JP Morgan, BlackRock, Cisco, LinkedIn, Klarna.

### Pydantic AI

| Company | Use Case | Details |
|---------|----------|---------|
| *No named enterprise deployments found* | Various | Customer service bots, data analysis assistants, workflow automation, SQL generation. |

**Reality check:** Despite strong technical merits, Pydantic AI has **no publicly documented enterprise production deployments** at named companies. The framework has 15.1K GitHub stars and is well-regarded in the developer community, but the production evidence is tutorials, blog posts, and generic descriptions -- not Spotify-scale case studies.

### Raw Anthropic API + Custom Loop

| Project | Use Case | Details |
|---------|----------|---------|
| Many startups | Various | Common for simple agents (< 3 tools, linear flow). Direct API gives latency control, immediate access to new features. |

**When it makes sense:** Simple agents, single tool, linear flow, latency-critical, need to be first on new API features. Recommended max: ~300 lines of custom loop code before you should consider a framework.

---

## 3. Notable Claude Code Ecosystem Projects

### gstack (Garry Tan / Y Combinator)

- **What:** 28 slash commands that turn Claude Code into a virtual engineering team (CEO, designer, eng manager, QA, security officer)
- **Engine:** Claude Code directly (not Agent SDK, not a framework -- it's a skill/plugin layer)
- **Key innovation:** The browser subsystem -- giving Claude Code a persistent browser for QA testing
- **Results:** Garry Tan demonstrated 10,000 LOC and 100 PRs/week over 50 days
- **Stars:** 16K+, MIT licensed

### Superpowers (Jesse Vincent / obra)

- **What:** Agentic skills framework and software development methodology for Claude Code
- **Engine:** Claude Code directly (plugin/skills layer)
- **Key innovation:** Enforces TDD, YAGNI, DRY discipline. Subagent-driven development with built-in code review.
- **Philosophy:** "Instead of making the agent smarter, enforce the discipline human developers spent decades building"
- **Stars:** 93K+, accepted into official Anthropic Claude Code plugin marketplace (Jan 2026)

### OpenClaw

- **What:** Open-source multi-platform AI agent (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams)
- **Engine:** Model-agnostic (Claude, GPT-4o, DeepSeek, Gemini, local via Ollama), custom routing through single gateway
- **Key innovation:** Skills system (ClawHub: 5,700+ community skills), persistent memory, multi-agent orchestrator
- **Stars:** 135K+ (fastest repo to 100K stars), created November 2025
- **Self-hosted:** Runs entirely on your hardware, MIT licensed

### Key observation

gstack and Superpowers are **not** built on Claude Agent SDK. They are Claude Code plugins -- skill packs that enhance Claude Code's behavior through prompts, CLAUDE.md files, and slash commands. They work *within* Claude Code, not by importing the SDK.

OpenClaw is a completely custom architecture -- model-agnostic with its own tool loop, skills system, and orchestration layer.

---

## 4. The Honest Comparison

### What the data actually shows

**LangGraph has the strongest production evidence by far.** Named enterprise customers (Klarna, Uber, LinkedIn, Elastic, JP Morgan, BlackRock), 90M monthly downloads, verifiable case studies with metrics. It dominates complex, stateful, multi-step agent deployments.

**Claude Agent SDK has the most impressive single case study (Spotify)** and the implicit validation of powering Claude Code itself. But outside of Spotify and Apple's Xcode integration, named production deployments are sparse. The SDK is young (renamed late 2025, still at v0.1.x).

**Pydantic AI has zero named enterprise production deployments.** Strong technical design, good developer experience, model-agnostic -- but no public proof of production use at scale. The "production-grade" claims are aspirational, not evidenced.

**Raw API + custom loop is what many successful projects actually use.** OpenClaw (135K stars), many startups, and teams that need full control. The pattern works for focused agents.

### Framework rankings by production evidence

| Rank | Framework | Evidence Level |
|------|-----------|---------------|
| 1 | **LangGraph** | Strong: 6+ named enterprises, 90M downloads, verifiable metrics |
| 2 | **Claude Agent SDK** | Moderate: Spotify (strong), Apple (announced), Claude Code (implicit) |
| 3 | **CrewAI** | Moderate: Walmart supply chain cited, fast prototyping use cases |
| 4 | **Raw API / Custom** | Moderate: OpenClaw, many startups, but no framework to point at |
| 5 | **Pydantic AI** | Weak: No named production deployments, tutorials only |

### Head-to-head: Claude Agent SDK vs Pydantic AI

| Dimension | Claude Agent SDK | Pydantic AI |
|-----------|-----------------|-------------|
| **Production evidence** | Spotify, Apple, Claude Code | None named |
| **Model support** | Claude only | 25+ providers |
| **Type safety** | Minimal (dicts, strings) | Strong (Pydantic models) |
| **Observability** | Manual implementation | Native Logfire/OpenTelemetry |
| **Testing** | Manual API mocking | Built-in TestModel |
| **Setup time** | Minutes | Hours/days |
| **Token efficiency** | Lower (verbose schemas) | Higher (leaner patterns) |
| **MCP support** | Native, deepest integration | Supported |
| **Maturity** | v0.1.48 (Python), early | v1.0 released, more mature API |
| **Lock-in** | Claude only | Model-agnostic |

### The uncomfortable truth about each option

**Claude Agent SDK:**
- Battle-tested indirectly (via Claude Code), but the SDK itself is v0.1.x
- No type safety -- tool definitions are dicts, outputs are strings/loosely typed
- Token overhead from verbose system prompts and tool schemas compounds at scale
- Locked to Claude (if Anthropic pricing changes or a better model appears, you're stuck)
- "Shows cracks when handling hundreds of requests a day" (MindStudio analysis)

**Pydantic AI:**
- Zero production proof at scale. All the "production-grade" claims are untested marketing.
- More setup friction. Hours/days vs minutes to first working agent.
- The model-agnostic promise sounds great but adds complexity -- do we actually need 25 providers?
- v1.0 is recent, ecosystem is still small compared to LangGraph

**LangGraph:**
- Overkill complexity for what we need. Graph-based state machines for a document discovery assistant?
- Steep learning curve, high code volume
- LangChain ecosystem has a reputation for over-abstraction and frequent breaking changes
- 2.3x more initial setup time vs platforms

**Raw API + Custom Loop:**
- Full control, but you own every bug
- Context management, retry logic, error handling, token counting -- all on you
- Works great until you need multi-step state, human-in-the-loop, or complex tool orchestration
- The "it's only 300 lines" argument ignores that production code is never 300 lines

---

## 5. The Honest Answer

### What should we actually choose?

The question isn't "what's the best framework?" -- it's "what's the right framework for Discovery AI Assistant?"

**Our requirements (re-stated):**
- Document analysis and discovery assistance (not code generation)
- Multi-step agent workflows (extract, analyze, evaluate, synthesize)
- Web UI with streaming responses
- MCP tool integration
- Production reliability for legal/professional use
- Python/FastAPI backend

**The case for Claude Agent SDK is weaker than previously assumed:**
1. It's v0.1.x -- still early, API will change
2. No type safety in a Python/Pydantic codebase is a real cost
3. The "battle-tested via Claude Code" argument is misleading -- Claude Code is a TypeScript CLI, our product is a Python web app
4. Token overhead matters when we're running analysis agents on long legal documents
5. Vendor lock-in to Claude is a real risk for a production product

**The case for Pydantic AI is technically strong but unproven:**
1. Fits our stack perfectly (FastAPI, Pydantic, Python)
2. Type safety, dependency injection, observability are genuinely valuable
3. Model-agnostic means we can optimize cost/quality per task
4. But: zero production evidence at enterprise scale. We'd be early adopters.

**The case for LangGraph is production-proven but over-engineered:**
1. Most production evidence of any framework
2. But our agents aren't complex enough to need graph-based state machines
3. LangChain ecosystem complexity would slow us down

**The pragmatic recommendation:**

Start with **Pydantic AI** for these reasons:
1. **Stack fit:** It's Pydantic. We're already Pydantic/FastAPI. The integration is natural.
2. **Type safety:** For legal/professional document analysis, type safety in agent outputs is a genuine quality requirement, not a nice-to-have.
3. **Model flexibility:** We can start with Claude (best for complex reasoning) and add cheaper models for simple extraction tasks without rewriting agent logic.
4. **Testability:** Built-in TestModel means we can actually unit test our agents without mocking API calls.
5. **The risk is manageable:** If Pydantic AI fails us, migrating to Claude Agent SDK or raw API is straightforward -- the core agent logic (prompts, tools, schemas) transfers directly.

But keep Claude Agent SDK as the **fallback plan:**
- If Pydantic AI's abstractions get in the way of Claude-specific features we need (extended thinking, computer use, deep MCP integration)
- If performance at scale requires tighter Claude integration
- If the SDK matures past v0.1.x and adds type safety

**What we should NOT do:**
- Use LangGraph (over-engineered for our needs)
- Use CrewAI (too high-level, poor for custom workflows)
- Build a raw custom loop (we'll end up rebuilding what Pydantic AI already provides)
- Choose based on hype rather than fit

### The trend

The industry is splitting into two camps:
1. **Enterprise/complex workflows:** LangGraph dominates and will likely continue to
2. **Focused AI products:** Teams choose between provider-native SDKs (Claude, OpenAI) for speed and framework SDKs (Pydantic AI) for flexibility

The Claude Agent SDK will get stronger as it matures. Pydantic AI will get stronger as more teams adopt it. The winner in 2027 may be different from today. What matters is choosing something that fits our stack, ships our product, and doesn't create lock-in we can't escape.

---

## 6. Sources

### Paperclip
- [Paperclip GitHub](https://github.com/paperclipai/paperclip)
- [Paperclip Website](https://paperclip.ing/)
- [Paperclip AGENTS.md](https://github.com/paperclipai/paperclip/blob/master/AGENTS.md)
- [Deploy Paperclip - Zeabur](https://zeabur.com/blogs/deploy-paperclip-ai-agent-orchestration)

### Claude Agent SDK
- [Agent SDK Overview - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Building Agents with Claude Agent SDK - Anthropic](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Spotify Case Study - Claude](https://claude.com/customers/spotify)
- [Spotify Context Engineering Blog](https://engineering.atspotify.com/2025/11/context-engineering-background-coding-agents-part-2)
- [How to Run Claude Agents in Production - Hugo Lu](https://medium.com/@hugolu87/how-to-run-claude-agents-in-production-using-the-claude-sdk-756f9d3c93d8)

### Framework Comparisons
- [Agent SDK vs Framework: Claude vs Pydantic AI - MindStudio](https://www.mindstudio.ai/blog/agent-sdk-vs-framework-claude-pydantic-ai-production-2)
- [2026 AI Agent Framework Decision Guide - DEV Community](https://dev.to/linou518/the-2026-ai-agent-framework-decision-guide-langgraph-vs-crewai-vs-pydantic-ai-b2h)
- [12 Best AI Agent Frameworks 2026 - Medium](https://medium.com/data-science-collective/the-best-ai-agent-frameworks-for-2026-tier-list-b3a4362fac0d)
- [Top 7 AI Agent Frameworks 2026 - DEV Community](https://dev.to/paxrel/top-7-ai-agent-frameworks-in-2026-a-developers-comparison-guide-hcm)
- [Pydantic AI vs LangGraph - ZenML](https://www.zenml.io/blog/pydantic-ai-vs-langgraph)

### LangGraph Production
- [LangGraph Agents in Production - AlphaBold](https://www.alphabold.com/langgraph-agents-in-production/)
- [Is LangGraph Used in Production? - LangChain Blog](https://blog.langchain.com/is-langgraph-used-in-production/)
- [LangGraph Platform GA - LangChain Blog](https://blog.langchain.com/langgraph-platform-ga/)
- [Built with LangGraph](https://www.langchain.com/built-with-langgraph)

### Pydantic AI
- [Pydantic AI v1 - Pydantic](https://pydantic.dev/articles/pydantic-ai-v1)
- [Pydantic AI Docs](https://ai.pydantic.dev/)

### Claude Code Ecosystem
- [gstack - GitHub](https://github.com/garrytan/gstack)
- [Superpowers - GitHub](https://github.com/obra/superpowers)
- [OpenClaw vs Claude Code - DataCamp](https://www.datacamp.com/blog/openclaw-vs-claude-code)

### Raw API
- [Building an AI Agent from Scratch - Anthropic API](https://medium.com/@juanc.olamendy/building-an-ai-agent-from-scratch-using-the-anthropic-api-a-complete-guide-b67d93a63809)
- [Tool Use with Claude - API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
