# AI Agent Frameworks & Engines Survey (March 2026)

A comprehensive survey of open-source AI agent frameworks available in 2026, evaluated for use in the Discovery AI Assistant project.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Market Context](#market-context)
3. [Major Frameworks (Tier 1)](#major-frameworks-tier-1)
4. [Emerging Frameworks (Tier 2)](#emerging-frameworks-tier-2)
5. [Specialized / Niche Frameworks (Tier 3)](#specialized--niche-frameworks-tier-3)
6. [Comparison Table](#comparison-table)
7. [Recommendation for Discovery AI Assistant](#recommendation-for-discovery-ai-assistant)
8. [Sources](#sources)

---

## Executive Summary

The AI agent framework market has matured significantly in 2026. Open-source frameworks reached 34.5 million downloads in 2025 (a 340% YoY increase), and 2026 has seen consolidation: Microsoft merged AutoGen and Semantic Kernel into Microsoft Agent Framework, AG2 forked from AutoGen as the community successor, and provider-native SDKs (Anthropic, OpenAI, Google) have matured into serious production options.

**Key trends in 2026:**
- **Graph-based orchestration** (LangGraph) dominates production deployments
- **Provider-native SDKs** (Claude Agent SDK, OpenAI Agents SDK, Google ADK) are now viable standalone options
- **TypeScript-first** frameworks (Mastra) are gaining massive traction for web-app developers
- **Memory-first** architectures (Letta/MemGPT) are carving out a niche for stateful agents
- **Minimalism** is valued: Smolagents, Pydantic AI, and Atomic Agents push back against over-abstraction
- **Microsoft consolidation**: AutoGen + Semantic Kernel merged into Microsoft Agent Framework (RC, targeting Q1 2026 GA)

---

## Market Context

| Metric | Value |
|--------|-------|
| Total open-source agent framework downloads (2025) | 34.5 million |
| YoY download growth | 340% |
| Companies using LangGraph Platform | ~400 |
| Most-starred agent framework | Dify (129.8k), AutoGen (54.6k), CrewAI (44.3k) |
| Fastest-growing framework (2025-2026) | Smolagents (3k to 26k stars), Mastra (0 to 22k stars) |

---

## Major Frameworks (Tier 1)

### 1. LangGraph (LangChain)

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/langchain-ai/langgraph |
| **Stars** | ~24.8k |
| **License** | MIT |
| **Language** | Python, TypeScript |
| **Monthly Downloads** | 34.5M (pip) |

**What it does:** LangGraph is the agent orchestration layer within the LangChain ecosystem. It models agents as directed state graphs where nodes represent actions (LLM calls, tool invocations, human checkpoints) and edges represent conditional transitions. It provides durable execution, checkpointing, and human-in-the-loop workflows for production-grade agent systems.

**Architecture:** State graph with typed state objects. Nodes are functions; edges can be conditional. Supports cycles (not just DAGs), enabling iterative agent loops. State is passed between nodes and can be persisted via checkpointers.

**Tool/function calling:** Full support via LangChain tool abstractions. Any Python function can be a tool. Supports parallel tool execution.

**Multi-agent support:** Yes -- single agent, multi-agent (supervisor pattern), hierarchical, and sequential. Sub-graphs compose naturally. Agents can delegate to other agents as sub-graphs.

**Memory/state:** Built-in checkpointing with `MemorySaver` (in-memory) and `InMemoryStore` for cross-thread memory. Supports time-travel debugging -- replay and inspect any prior state. Long-term memory via external stores.

**Model support:** Fully model-agnostic via LangChain. Supports OpenAI, Anthropic, Google, Mistral, Ollama, and any LangChain-compatible provider.

**Unique features:**
- Time-travel debugging (inspect/replay any checkpoint)
- Human-in-the-loop with approval gates
- LangSmith integration for tracing, evaluation, monitoring
- Streaming support (per-node token streaming)
- Durable execution with fault tolerance

**Who uses it:** Klarna (853 employee-equivalent support bot, $60M savings), Uber, Cisco, LinkedIn, BlackRock, JPMorgan, AppFolio. ~400 companies on LangGraph Platform.

**Maturity:** Production-ready. Battle-tested at enterprise scale. The most widely adopted framework for production agent systems. Stable API.

---

### 2. CrewAI

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/crewai/crewai |
| **Stars** | ~44.3k |
| **License** | MIT + Commercial tiers |
| **Language** | Python |
| **Monthly Downloads** | 5.2M (pip) |

**What it does:** CrewAI is a role-based multi-agent orchestration framework where you define agents with roles, goals, and backstories, then organize them into "crews" that collaborate on tasks. It offers the fastest path to a working multi-agent prototype -- developers can build systems in 2-4 hours.

**Architecture:** Role-based agent teams. Agents have personas (role/goal/backstory). Crews execute tasks in sequential, hierarchical, or consensual process modes. "Flows" provide conditional logic, loops, and execution control.

**Tool/function calling:** Yes, with structured annotations. Streaming tool calls added January 2026. Supports custom tools and integrations.

**Multi-agent support:** Core strength. Hierarchical (manager-worker), sequential delegation, and consensual decision-making patterns.

**Memory/state:** Layered memory: short-term (ChromaDB), task results (SQLite), long-term entity memory. Qdrant Edge memory backend. Hierarchical memory isolation between crews.

**Model support:** Model-agnostic. Native support for OpenAI-compatible providers (OpenRouter, DeepSeek, Ollama, vLLM, Cerebras).

**Unique features:**
- Lowest barrier to entry for multi-agent systems
- Visual Studio editor for crew design
- Built-in monitoring and execution tracking
- Role/goal/backstory abstraction is intuitive for non-technical stakeholders

**Who uses it:** Widely used for customer service, marketing automation, content generation. Strong in startup/SMB space.

**Maturity:** Production-ready with commercial platform. High GitHub stars but noted for higher token consumption than alternatives. Free tier (50 executions/month); Professional $25/month.

---

### 3. OpenAI Agents SDK

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/openai/openai-agents-python |
| **Stars** | ~19k |
| **License** | MIT |
| **Language** | Python, TypeScript |
| **Monthly Downloads** | 10.3M (pip) |

**What it does:** A lightweight framework for multi-agent workflows from OpenAI. Production-ready successor to the experimental Swarm project. Provides minimal primitives: Agents (LLMs with instructions and tools), Handoffs (agent-to-agent delegation), and Guardrails (input/output validation).

**Architecture:** Handoff-based model. Agents transfer control to other agents via explicit handoffs. Linear handoff chains with shared context. Simple and opinionated.

**Tool/function calling:** Yes. Built-in tools include web search, file search, and computer use. Custom function tools supported.

**Multi-agent support:** Yes, via handoff mechanism. Best for sequential workflows with 8-10 agent types maximum. Not suited for complex parallel orchestration.

**Memory/state:** Session-based persistence. Message history. Stateless by default; persistence requires manual integration.

**Model support:** OpenAI-first but supports 100+ LLMs via compatible endpoints. Provider-agnostic via Chat Completions API.

**Unique features:**
- Built-in tracing and visualization
- Guardrails for input/output validation
- Voice agent support with gpt-realtime-1.5
- Extremely minimal API surface
- Clean handoff primitives

**Who uses it:** OpenAI ecosystem developers. Growing enterprise adoption.

**Maturity:** Active development (v0.13.3 as of March 2026). Stable for production use but API still evolving. Well-documented.

---

### 4. Claude Agent SDK (Anthropic)

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/anthropics/claude-agent-sdk-python |
| **Stars** | ~5.9k (Python SDK) |
| **License** | Apache 2.0 |
| **Language** | Python, TypeScript |

**What it does:** The open-source foundation that powers Claude Code. Provides the same agent loop, tools, and context management system that Anthropic uses internally. Built around four core concepts: tools, hooks, MCP servers, and subagents.

**Architecture:** Tool-use-first loop. The agent continuously invokes tools (including other agents as tools) in a ReAct-style loop. Subagents are callable as tools within the parent agent loop. MCP (Model Context Protocol) is the standardized interface for tool integration.

**Tool/function calling:** First-class. Built-in tools for file I/O, shell commands, HTTP requests, web search. MCP servers provide standardized tool interfaces. Custom tools via decorators.

**Multi-agent support:** Yes. Agents callable as tools within parent agent loops. Subagent delegation is a core pattern.

**Memory/state:** Via MCP servers. Session state managed through the MCP protocol. Hooks provide lifecycle callbacks for state management.

**Model support:** Claude models only. Locked to Anthropic's ecosystem.

**Unique features:**
- Extended thinking for transparent reasoning chains
- Computer use capability (browser/desktop interaction)
- MCP standardization (emerging industry standard for tool integration)
- Constitutional AI constraints built-in
- Same engine as Claude Code (battle-tested)

**Who uses it:** Powers Claude Code. Used by gstack, Superpowers, and other Claude Code-based projects. Safety-critical applications.

**Maturity:** Production-ready (powers Claude Code). Relatively new as a standalone SDK (late 2025 rebrand). Active development.

---

### 5. Google ADK (Agent Development Kit)

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/google/adk-python |
| **Stars** | ~17.8k |
| **License** | Apache 2.0 |
| **Language** | Python, TypeScript, Go, Java |
| **Monthly Downloads** | 3.3M (pip) |

**What it does:** Google's open-source, code-first toolkit for building AI agents. Optimized for Gemini but model-agnostic. Provides hierarchical agent composition, native multimodal support, and deep Google Cloud integration.

**Architecture:** Hierarchical agent tree with root-to-sub-agent delegation. Agents are composed in parent-child hierarchies. Supports both workflow-based (deterministic) and LLM-driven (dynamic) routing.

**Tool/function calling:** Yes. Custom tools, BigQuery toolset, Slack integration. Native integration with Google Cloud services.

**Multi-agent support:** Yes. Hierarchical compositions. A2A (Agent-to-Agent) protocol for cross-framework agent communication -- a unique interoperability feature.

**Memory/state:** Session state with pluggable backends (in-memory, database, Vertex AI-managed). Structured memory management.

**Model support:** Optimized for Gemini. Supports other providers. Deep Vertex AI integration.

**Unique features:**
- A2A protocol for cross-framework agent interoperability
- Native multimodal support (images, audio, video)
- Multi-language support (Python, TS, Go, Java)
- Less than 100 lines of code for basic setup
- Google Cloud native deployment

**Who uses it:** Google Agentspace platform, enterprise customer engagement solutions. Growing adoption in Google Cloud shops.

**Maturity:** Announced April 2025, rapidly growing. Production-ready with Google Cloud backing. Strong enterprise support path.

---

### 6. Microsoft Agent Framework (AutoGen + Semantic Kernel)

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/microsoft/semantic-kernel (evolving) |
| **Stars** | ~27.5k (Semantic Kernel) + ~54.6k (AutoGen, maintenance mode) |
| **License** | MIT |
| **Language** | Python, C#, Java |

**What it does:** The unified successor to both AutoGen and Semantic Kernel. Combines AutoGen's dynamic multi-agent orchestration with Semantic Kernel's enterprise-grade features (session-based state management, type safety, filters, telemetry). Introduces explicit workflow control and robust state management for long-running scenarios.

**Architecture:** Combines conversation-based multi-agent patterns (from AutoGen) with enterprise plugin/function architecture (from Semantic Kernel). Event-driven core. Explicit workflow definitions for multi-agent execution paths.

**Tool/function calling:** Yes. Semantic Kernel plugin system. Native Azure AI integration.

**Multi-agent support:** Yes. GroupChat coordination, supervisor patterns, conversational debate patterns. Human-in-the-loop workflows.

**Memory/state:** Session-based state management. Long-running scenario support with checkpointing. Enterprise-grade persistence.

**Model support:** Model-agnostic. Strong Azure OpenAI integration. Supports OpenAI, Anthropic, Google, and local models.

**Unique features:**
- Enterprise-grade (SSO, RBAC, telemetry, filters)
- Multi-language (Python, C#, Java)
- Migration path from both AutoGen and Semantic Kernel
- Azure ecosystem integration
- Production-grade from day one

**Who uses it:** Microsoft enterprise customers. Novo Nordisk (data science workflows). Azure-native deployments.

**Maturity:** Release Candidate (February 2026). Targeting 1.0 GA by end of Q1 2026. AutoGen and Semantic Kernel in maintenance mode.

---

### 7. Pydantic AI

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/pydantic/pydantic-ai |
| **Stars** | ~15.5k |
| **License** | MIT |
| **Language** | Python |

**What it does:** A type-safe, Python-first agent framework from the creators of Pydantic. Brings the same ergonomic design philosophy that made FastAPI revolutionary to AI agent development. Emphasizes structured outputs, dependency injection, and composable capabilities.

**Architecture:** Decorator-based agent definition. Agents are Python functions with type annotations. Capabilities bundle tools, hooks, instructions, and model settings into reusable, composable units. Strong emphasis on type safety throughout.

**Tool/function calling:** Yes. Provider-adaptive tools (WebSearch, WebFetch, MCP, ImageGeneration). Tools are typed Python functions with Pydantic validation.

**Multi-agent support:** Yes, with Agent2Agent (A2A) communication protocol. Subagent delegation via typed interfaces.

**Memory/state:** Type-safe state management. Structured context passing via dependency injection.

**Model support:** 25+ providers: OpenAI, Anthropic, Gemini, DeepSeek, Grok, Cohere, Mistral, Perplexity; Azure AI Foundry, Amazon Bedrock, Vertex AI, Ollama, LiteLLM, Groq, OpenRouter, Together AI, Fireworks AI.

**Unique features:**
- Type safety throughout (IDE auto-completion, write-time error detection)
- Pydantic Logfire integration (OpenTelemetry observability)
- Composable Capabilities (reusable tool/hook/instruction bundles)
- Powerful evals for systematic testing
- Feels like FastAPI for agents

**Who uses it:** Python developers who value type safety. Growing adoption among teams already using Pydantic/FastAPI.

**Maturity:** Active development. v2 milestone in progress. Strong community backing from Pydantic ecosystem.

---

## Emerging Frameworks (Tier 2)

### 8. Mastra

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/mastra-ai/mastra |
| **Stars** | ~22.3k |
| **License** | Apache 2.0 |
| **Language** | TypeScript |
| **Monthly Downloads** | 300k+ (npm) |

**What it does:** TypeScript-first agent framework from the team behind Gatsby. Provides essential primitives for building AI applications: agents with memory and tool-calling, deterministic LLM workflows, and RAG for knowledge integration. Reached v1.0 in January 2026 after YC W25 with $13M funding.

**Architecture:** Graph-based workflows with TypeScript-native primitives: `.then()`, `.branch()`, `.parallel()`. Agents communicate via `.network()` method for routing. Workflows are code-first and type-safe.

**Tool/function calling:** Yes. Type-safe tool definitions. Integrates with Vercel AI SDK.

**Multi-agent support:** Yes, via `.network()` method for agent routing and delegation.

**Memory:** Four-tier system: message history, working memory, semantic recall, and RAG.

**Model support:** 81 LLM providers and 2,436+ models via Vercel AI SDK. Extremely broad coverage.

**Unique features:**
- TypeScript-first (ideal for web app teams)
- Four-tier memory architecture
- Local dev playground for testing
- From the Gatsby team (strong OSS track record)
- YC-backed, $13M funding

**Who uses it:** Replit Agent 3 (improved from 80% to 96% success rate), Marsh McLennan (75k employees), SoftBank Satto Workspace.

**Maturity:** v1.0 (January 2026). Production deployments documented. Fastest-growing framework in 2026.

---

### 9. Smolagents (HuggingFace)

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/huggingface/smolagents |
| **Stars** | ~26.3k |
| **License** | Apache 2.0 |
| **Language** | Python |

**What it does:** A minimalist agent library from HuggingFace where the core logic fits in ~1,000 lines of code. Agents write their actions in Python code (CodeAgent) rather than JSON tool calls, enabling more flexible and composable behaviors.

**Architecture:** Two agent types: CodeAgent (writes and executes Python code as actions) and ToolCallingAgent (traditional JSON-based tool calling). Code execution in sandboxed environments (E2B, Docker, Pyodide, Modal).

**Tool/function calling:** Yes. Tools can be shared via HuggingFace Hub. Community tool ecosystem.

**Multi-agent support:** Yes. ManagedAgent for multi-agent orchestration. Agents can delegate to sub-agents.

**Memory:** Conversation memory. Agent state via code execution context.

**Model support:** Model-agnostic. Local transformers, Ollama, HuggingFace Hub models, OpenAI, Anthropic via LiteLLM.

**Unique features:**
- CodeAgent paradigm (agents write Python, not JSON)
- Sandboxed execution (E2B, Docker, Pyodide)
- HuggingFace Hub integration for tool/agent sharing
- Multimodal (text, vision, video, audio)
- ~1,000 lines of core code (extreme minimalism)

**Who uses it:** HuggingFace ecosystem users. Research and prototyping. Open-source model enthusiasts.

**Maturity:** Rapidly growing (3k to 26k stars in one year). Active development. Good for experimentation; production readiness improving.

---

### 10. Agno (formerly Phidata)

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/agno-agi/agno |
| **Stars** | ~18.5k |
| **License** | Apache 2.0 |
| **Language** | Python |

**What it does:** A high-performance framework for building multi-modal AI agents. Claims to be 5,000x faster in agent instantiation and 50x more memory-efficient than LangGraph. Natively supports text, image, audio, and video inputs.

**Architecture:** Lightweight agent definitions with minimal overhead. Function-based tool integration. Designed for extreme performance at scale.

**Tool/function calling:** Yes. Decorator-based tool definitions.

**Multi-agent support:** Yes. Team-based multi-agent coordination.

**Memory:** Built-in memory management with database backends.

**Model support:** Model-agnostic. Supports OpenAI, Anthropic, Google, and open-source models.

**Unique features:**
- Extreme performance (5,000x faster instantiation than LangGraph)
- Native multimodal support
- Rebranded from Phidata (established community)
- Memory-efficient for large-scale deployments

**Who uses it:** Teams needing high-throughput agent systems. Performance-critical applications.

**Maturity:** Stable. Active development. Rebranded January 2025 from Phidata.

---

### 11. Strands Agents (AWS)

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/strands-agents/sdk-python |
| **Stars** | ~6k |
| **License** | Apache 2.0 |
| **Language** | Python, TypeScript |
| **Downloads** | 14M+ total since May 2025 |

**What it does:** AWS's open-source agent SDK taking a model-driven approach. Build agents in a few lines of code with native MCP support and deep AWS integration. Default provider is Amazon Bedrock.

**Architecture:** Model-driven approach. The LLM drives the agent loop with tool selection. Minimal abstractions. Simple `@tool` decorators.

**Tool/function calling:** Yes. Native MCP support for thousands of pre-built tools. Custom tool support via decorators.

**Multi-agent support:** Yes. Multi-agent systems and autonomous agents supported.

**Memory:** Session-based. AWS-managed persistence options.

**Model support:** Amazon Bedrock (default), Anthropic, Gemini, LiteLLM, Llama, Ollama, OpenAI, Writer, custom providers.

**Unique features:**
- Native MCP support
- AWS/Bedrock-native (IAM, VPC, encryption)
- Strands Labs for experimental agent research
- Minimal boilerplate
- 14M+ downloads in under a year

**Who uses it:** AWS-native teams. Enterprise deployments on Bedrock.

**Maturity:** Released May 2025. Rapidly adopted. Production-ready for AWS environments.

---

### 12. Letta (formerly MemGPT)

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/letta-ai/letta |
| **Stars** | ~21.6k |
| **License** | Apache 2.0 |
| **Language** | Python |

**What it does:** The platform for building stateful agents that remember, learn, and self-improve over time. Introduces an "LLM-as-Operating-System" paradigm where the model manages its own memory, context, and reasoning loops. Unlike most frameworks that keep state in Python variables, Letta persists agent state in databases.

**Architecture:** OS-inspired memory hierarchy. The LLM manages its own context window, deciding what to keep in "RAM" (context) and what to page to "disk" (database). Tiered memory: core memory (always in context), archival memory (vector-searchable), recall memory (conversation history).

**Tool/function calling:** Yes. Programmatic tool calling for any LLM. Agents can generate their own workflows.

**Multi-agent support:** Yes. Multi-agent with shared memory via Conversations API.

**Memory:** **Best-in-class.** Tiered: core memory (in-context), archival memory (vector DB), recall memory (conversation logs). Persistent across sessions. Agents self-manage their memory.

**Model support:** Model-agnostic. #1 model-agnostic agent on Terminal-Bench coding benchmark.

**Unique features:**
- Self-managing memory (agents decide what to remember)
- Database-persisted state (not Python variables)
- Conversations API for shared memory across agents
- Letta Filesystem for document organization
- Letta Evals for stateful agent testing
- Cross-device agent access (laptop to phone)

**Who uses it:** Teams building long-lived, stateful agents. Customer support, personal assistants, research agents.

**Maturity:** v1 released. Production platform available. Strong research foundation (MemGPT paper).

---

### 13. CAMEL AI

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/camel-ai/camel |
| **Stars** | ~16.6k |
| **License** | Apache 2.0 |
| **Language** | Python |

**What it does:** The first and self-described "best" multi-agent framework, focused on finding the scaling laws of agents. Enables large-scale agent simulations (up to 1M agents), role-playing for agent collaboration, and workforce modeling with roles, hierarchies, and long-horizon tasks.

**Architecture:** Role-playing communication protocol. Agents adopt roles (AI assistant, AI user) and collaborate through structured dialogue. Supports society-of-agents patterns.

**Tool/function calling:** Yes. Extensive tool ecosystem.

**Multi-agent support:** **Core focus.** Up to 1M agent simulations. Real-time agent interactions. Workforce modeling with hierarchies.

**Memory:** Historical context retention. Agents leverage past interactions for improved decision-making.

**Model support:** Model-agnostic. Supports major providers.

**Unique features:**
- 1M agent simulations (OASIS project)
- OWL (Optimized Workforce Learning) -- 19.3k stars
- Research-grade benchmarking and evaluation
- Role-playing communication protocol
- Academic research backing

**Who uses it:** Research institutions. Teams studying multi-agent dynamics and scaling laws.

**Maturity:** Research-oriented but production-capable. Active development. Strong academic community.

---

## Specialized / Niche Frameworks (Tier 3)

### 14. AG2 (AutoGen Community Fork)

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/ag2ai/ag2 |
| **Stars** | ~4.2k |
| **License** | Apache 2.0 |
| **Language** | Python |

**What it does:** Community fork of AutoGen, evolved in November 2024 under open governance. Features a ground-up redesign in beta (autogen.beta) with streaming, event-driven architecture, and multi-provider support.

**Architecture:** Conversation-based with message passing. GroupChat coordination. Event-driven core (beta).

**Multi-agent:** Yes. Conversable agents communicate through structured dialogue.

**Memory:** Conversation-based. In-memory by default.

**Model support:** Multi-provider: OpenAI, Anthropic, Gemini, DashScope (Qwen), Ollama.

**Maturity:** Beta. On path to v1.0. Current framework in maintenance mode while beta matures.

---

### 15. Atomic Agents

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/BrainBlend-AI/atomic-agents |
| **Stars** | ~5.8k |
| **License** | MIT |
| **Language** | Python |

**What it does:** Extremely lightweight and modular framework built around the concept of atomicity. Each agent is a minimal, composable unit. Pushes back against over-abstraction in favor of explicit, predictable pipelines.

**Architecture:** Atomic units composable into pipelines. Context Providers inject dynamic context at runtime. Pydantic-based I/O schemas.

**Multi-agent:** Yes. Composable pipelines of atomic agents.

**Memory:** Via Context Providers (dynamic runtime injection).

**Model support:** Model-agnostic. MCP tool support with typed Pydantic schemas.

**Maturity:** v2.7.5. Active development. Good documentation.

---

### 16. Mirascope

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/Mirascope/mirascope |
| **Stars** | ~1.3k |
| **License** | MIT |
| **Language** | Python |

**What it does:** Self-described "LLM Anti-Framework" -- a lightweight Python library for structured prompt engineering with strong type safety. Unified interface across all major LLM providers. Focuses on LLM calls, not complex orchestration.

**Architecture:** Decorator-based. LLM calls as Python function decorators. Structured outputs via Pydantic models.

**Multi-agent:** Limited. Focused on individual agent/LLM interactions rather than orchestration.

**Memory:** Via integration with external stores.

**Model support:** Unified interface for OpenAI, Anthropic, Gemini, Mistral, and more.

**Maturity:** v2 with Mirascope Cloud. Smaller community but well-designed for its niche.

---

### 17. BeeAI Framework (IBM / Linux Foundation)

| Property | Detail |
|----------|--------|
| **Repo** | https://github.com/i-am-bee/beeai-framework |
| **Stars** | ~3.1k |
| **License** | Apache 2.0 |
| **Language** | Python, TypeScript |

**What it does:** IBM-backed framework for production-grade multi-agent systems, hosted by the Linux Foundation under open governance. Complete feature parity between Python and TypeScript. Dynamic workflows with decorators, built-in memory management, and parallelism/retry/replanning patterns.

**Architecture:** Decorator-based dynamic workflows. Multi-agent patterns with parallelism, retries, and replanning.

**Multi-agent:** Yes. Advanced patterns for collaboration.

**Memory:** Built-in memory management with multiple implementations. Configurable per-agent.

**Model support:** Model-agnostic. IBM Granite integration.

**Maturity:** 162 releases. Active development. Linux Foundation governance provides stability.

---

## Comparison Table

| Framework | Stars | Architecture | Multi-Agent | Memory | Model Support | Maturity | Best For |
|-----------|-------|-------------|-------------|--------|---------------|----------|----------|
| **LangGraph** | 24.8k | State graph | Yes (supervisor, hierarchical) | Checkpointing + stores | Fully agnostic | Production (enterprise) | Complex stateful workflows, regulated industries |
| **CrewAI** | 44.3k | Role-based teams | Yes (hierarchical, sequential, consensual) | Layered (ChromaDB, SQLite) | Agnostic | Production | Rapid multi-agent prototyping |
| **OpenAI Agents SDK** | 19k | Handoff chains | Yes (sequential) | Session-based | OpenAI-first, 100+ via compat | Stable (v0.x) | OpenAI ecosystem, simple handoffs |
| **Claude Agent SDK** | 5.9k | Tool-use loop + MCP | Yes (subagents as tools) | MCP servers | Claude only | Production (powers Claude Code) | Claude-native, safety-critical, MCP ecosystem |
| **Google ADK** | 17.8k | Hierarchical tree | Yes (A2A protocol) | Session state, pluggable | Gemini-first, agnostic | Production | Google Cloud, multimodal agents |
| **MS Agent Framework** | 27.5k | Event-driven + workflows | Yes (GroupChat, supervisor) | Session + checkpoint | Agnostic (Azure-native) | RC (Q1 2026 GA) | Azure enterprise, C#/Java teams |
| **Pydantic AI** | 15.5k | Typed decorators | Yes (A2A) | Type-safe state | 25+ providers | Active dev (v2) | Type-safe Python, FastAPI teams |
| **Mastra** | 22.3k | Graph workflows (TS) | Yes (`.network()`) | 4-tier (history, working, semantic, RAG) | 81 providers, 2,436+ models | v1.0 (Jan 2026) | TypeScript web apps, broad model support |
| **Smolagents** | 26.3k | Code agents | Yes (ManagedAgent) | Conversation | Agnostic (LiteLLM) | Active dev | Research, open-source models, minimalism |
| **Agno** | 18.5k | Lightweight agents | Yes (teams) | DB-backed | Agnostic | Stable | High-throughput, performance-critical |
| **Strands (AWS)** | 6k | Model-driven | Yes | Session | Bedrock-first, agnostic | Production | AWS-native deployments |
| **Letta (MemGPT)** | 21.6k | OS-inspired memory | Yes (Conversations API) | **Best-in-class** (tiered, self-managing) | Agnostic | v1 | Long-lived stateful agents, memory-critical |
| **CAMEL AI** | 16.6k | Role-playing | Yes (up to 1M agents) | Historical context | Agnostic | Research + production | Multi-agent research, simulations |
| **AG2** | 4.2k | Conversation-based | Yes (GroupChat) | Conversation history | Multi-provider | Beta (pre-v1) | AutoGen migration, research |
| **Atomic Agents** | 5.8k | Atomic pipelines | Yes (composable) | Context Providers | Agnostic + MCP | v2.7 | Minimal, explicit pipelines |
| **Mirascope** | 1.3k | Decorators | Limited | External | Unified interface | v2 | Prompt engineering, LLM calls |
| **BeeAI** | 3.1k | Dynamic workflows | Yes (parallel, retry) | Built-in, configurable | Agnostic (Granite) | Active (162 releases) | IBM/Linux Foundation ecosystem |

---

## Recommendation for Discovery AI Assistant

### Our Requirements Recap

| Requirement | Detail |
|-------------|--------|
| Tool calling | Custom tools for RAGFlow, PostgreSQL, web search |
| Subagents | 6 specialized subagents |
| Session management | Multi-turn chat with Product Owner |
| Primary model | Claude (with model flexibility desired) |
| Capabilities | Web research, code analysis, HTML generation |
| Deployment | FastAPI backend (web app, not CLI) |

### Evaluation of Top Candidates

#### Option A: Pydantic AI (RECOMMENDED)

**Why it fits best:**

1. **FastAPI alignment.** Built by the same team that created Pydantic (the foundation of FastAPI). The ergonomics are identical. If the team knows FastAPI, Pydantic AI will feel natural.

2. **Type-safe tool calling.** Tools are typed Python functions with Pydantic validation -- perfect for our custom RAGFlow, PostgreSQL, and web search tools. Structured outputs ensure reliable subagent communication.

3. **Multi-agent via Capabilities.** Composable Capabilities bundle tools, hooks, instructions, and model settings into reusable units. Our 6 subagents map cleanly to 6 Capabilities or child agents with typed interfaces.

4. **Claude-first with flexibility.** Supports 25+ providers including Anthropic (Claude), OpenAI, Gemini, DeepSeek, Ollama. We can use Claude as primary and swap models per-agent if needed.

5. **Session management.** Type-safe dependency injection for session context. Integrates with any persistence layer.

6. **Observability.** Pydantic Logfire (OpenTelemetry) for tracing, debugging, and cost tracking out of the box.

7. **Lightweight.** No heavy abstractions or vendor lock-in. We control the agent loop.

**Risk:** Newer framework (v2 in progress). Smaller community than LangGraph. Multi-agent patterns less mature than LangGraph's graph-based orchestration.

#### Option B: LangGraph

**Why it's strong:**

1. **Most battle-tested** for production multi-agent systems. Used by Klarna, Uber, JPMorgan.
2. **State graph** is ideal for our 6-subagent orchestration (coordinator as supervisor node, subagents as graph nodes).
3. **Checkpointing** provides built-in session persistence and fault tolerance.
4. **Human-in-the-loop** gates align with our PO interaction model.
5. **LangSmith** monitoring is genuinely useful for debugging complex agent flows.

**Risk:** Heavier abstraction layer. LangChain ecosystem coupling (though LangGraph can be used standalone). More complex to set up than Pydantic AI. Higher learning curve.

#### Option C: Claude Agent SDK

**Why it's relevant:**

1. **Powers Claude Code** -- proven at scale for tool-heavy agent workflows.
2. **MCP is our tool protocol** -- if we adopt MCP for RAGFlow/PostgreSQL tools, the SDK is the native runtime.
3. **Subagent pattern** is first-class (agents as tools).

**Risk:** Claude-only. No model flexibility. Designed for CLI/desktop, not web apps. Would need significant adaptation for our FastAPI backend. Smaller ecosystem.

#### Option D: Mastra

**Why it's interesting:**

1. **TypeScript-first** -- if our frontend team wanted to own the agent layer.
2. **Four-tier memory** is excellent for our session management needs.
3. **81 providers** via Vercel AI SDK.
4. **v1.0, YC-backed, $13M funding** -- serious commitment.

**Risk:** TypeScript, not Python. Our backend is FastAPI (Python). Would require a language split or migration.

### Final Recommendation

**Primary: Pydantic AI** for the Discovery AI Assistant.

The alignment with our FastAPI stack, type-safe tool calling, broad model support (Claude-first but flexible), and composable agent architecture make it the best fit. The team behind Pydantic has a proven track record of building developer-beloved tooling, and the framework's design philosophy matches our needs: explicit over magic, typed over stringly, composable over monolithic.

**Secondary consideration: LangGraph** if we find Pydantic AI's multi-agent patterns too immature for our 6-subagent coordinator pattern. LangGraph's state graph with supervisor nodes is the most proven pattern for this exact architecture. We could also use LangGraph for orchestration while using Pydantic AI for individual agent definitions.

**Avoid for our use case:**
- **Claude Agent SDK** -- too locked to Claude, designed for CLI not web apps
- **CrewAI** -- role-based abstraction adds unnecessary indirection for our typed subagent pattern
- **OpenAI Agents SDK** -- too tied to OpenAI ecosystem
- **Mastra** -- TypeScript, we need Python

### Implementation Approach

```
Discovery AI Assistant Architecture with Pydantic AI
=====================================================

FastAPI Backend
  |
  +-- Coordinator Agent (Pydantic AI)
  |     |-- Session context via dependency injection
  |     |-- Claude as primary model
  |     |-- Typed tool interfaces
  |     |
  |     +-- Subagent: Research Agent (Capability)
  |     |     Tools: RAGFlow search, web search
  |     |
  |     +-- Subagent: Code Analysis Agent (Capability)
  |     |     Tools: repo cloning, AST parsing, file reading
  |     |
  |     +-- Subagent: Knowledge Graph Agent (Capability)
  |     |     Tools: PostgreSQL queries, graph operations
  |     |
  |     +-- Subagent: QA Agent (Capability)
  |     |     Tools: test generation, validation
  |     |
  |     +-- Subagent: Story Writer Agent (Capability)
  |     |     Tools: template rendering, HTML generation
  |     |
  |     +-- Subagent: Dashboard Agent (Capability)
  |           Tools: metrics aggregation, chart data
  |
  +-- Session Store (PostgreSQL)
  +-- RAGFlow Integration (MCP or direct API)
  +-- Observability (Pydantic Logfire / OpenTelemetry)
```

---

## Sources

### Framework Comparison Articles
- [12 Best AI Agent Frameworks in 2026 - Data Science Collective](https://medium.com/data-science-collective/the-best-ai-agent-frameworks-for-2026-tier-list-b3a4362fac0d)
- [Top 9 AI Agent Frameworks - Shakudo](https://www.shakudo.io/blog/top-9-ai-agent-frameworks)
- [Top 5 Open-Source Agentic AI Frameworks - AIMultiple](https://aimultiple.com/agentic-frameworks)
- [Best Open Source Agent Frameworks - Firecrawl](https://www.firecrawl.dev/blog/best-open-source-agent-frameworks)
- [Best Multi-Agent Frameworks 2026 - GuruSup](https://gurusup.com/blog/best-multi-agent-frameworks-2026)
- [Definitive Guide to Agentic Frameworks 2026 - SoftmaxData](https://softmaxdata.com/blog/definitive-guide-to-agentic-frameworks-in-2026-langgraph-crewai-ag2-openai-and-more/)
- [6 Best AI Agent Frameworks - Gumloop](https://www.gumloop.com/blog/ai-agent-frameworks)
- [Top 7 AI Agent Frameworks - DEV Community](https://dev.to/paxrel/top-7-ai-agent-frameworks-in-2026-a-developers-comparison-guide-hcm)
- [Comparing Open-Source AI Agent Frameworks - Langfuse](https://langfuse.com/blog/2025-03-19-ai-agent-comparison)

### Framework-Specific Sources
- [LangGraph - GitHub](https://github.com/langchain-ai/langgraph)
- [CrewAI - GitHub](https://github.com/crewai/crewai)
- [OpenAI Agents SDK - GitHub](https://github.com/openai/openai-agents-python)
- [Claude Agent SDK - GitHub](https://github.com/anthropics/claude-agent-sdk-python)
- [Google ADK - GitHub](https://github.com/google/adk-python)
- [Microsoft Agent Framework - Foundry Blog](https://devblogs.microsoft.com/foundry/introducing-microsoft-agent-framework-the-open-source-engine-for-agentic-ai-apps/)
- [Pydantic AI - GitHub](https://github.com/pydantic/pydantic-ai)
- [Mastra - GitHub](https://github.com/mastra-ai/mastra)
- [Smolagents - GitHub](https://github.com/huggingface/smolagents)
- [Agno - GitHub](https://github.com/agno-agi/agno)
- [Strands Agents - GitHub](https://github.com/strands-agents/sdk-python)
- [Letta - GitHub](https://github.com/letta-ai/letta)
- [CAMEL AI - GitHub](https://github.com/camel-ai/camel)
- [AG2 - GitHub](https://github.com/ag2ai/ag2)
- [Atomic Agents - GitHub](https://github.com/BrainBlend-AI/atomic-agents)
- [Mirascope - GitHub](https://github.com/Mirascope/mirascope)
- [BeeAI Framework - GitHub](https://github.com/i-am-bee/beeai-framework)

### Industry Context
- [LangChain Deep Agents vs Claude Agent SDK - Medium](https://medium.com/@richardhightower/the-agent-framework-landscape-langchain-deep-agents-vs-claude-agent-sdk-1dfed14bb311)
- [Microsoft Agent Framework RC Announcement](https://devblogs.microsoft.com/foundry/microsoft-agent-framework-reaches-release-candidate/)
- [AWS Strands Labs Launch - InfoQ](https://www.infoq.com/news/2026/03/aws-strands-agents/)
- [Letta v1 Agent Architecture](https://www.letta.com/blog/letta-v1-agent)
- [Pydantic AI Decision Guide - DEV Community](https://dev.to/linou518/the-2026-ai-agent-framework-decision-guide-langgraph-vs-crewai-vs-pydantic-ai-b2h)
