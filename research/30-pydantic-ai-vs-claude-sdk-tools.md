# Pydantic AI vs Claude Agent SDK: Tool & Capability Comparison

> **Research date**: 2026-03-31
> **Sources**: [Pydantic AI docs](https://ai.pydantic.dev/), [Claude Agent SDK docs](https://platform.claude.com/docs/en/agent-sdk/overview), [Pydantic AI GitHub](https://github.com/pydantic/pydantic-ai)

---

## Executive Summary

The **Claude Agent SDK** (formerly Claude Code SDK) provides a batteries-included agent runtime with ~9 built-in tools for file operations, shell execution, web access, and code search -- the same tools that power Claude Code. It is **Claude-only** (Anthropic, Bedrock, Vertex, Azure).

**Pydantic AI** is a **model-agnostic** agent framework (OpenAI, Anthropic, Google, Groq, Mistral, Ollama, etc.) that ships with **no file/shell/search tools built-in** but provides a rich system for defining custom tools via decorated Python functions, plus first-class MCP client support and a growing set of "common tools" and "built-in tools" (provider-native capabilities).

**Key takeaway**: Claude Agent SDK gives you a working coding agent out of the box. Pydantic AI gives you a flexible framework where you wire up your own tools -- but with MCP support, you can get equivalent capabilities through community MCP servers.

---

## Tool-by-Tool Comparison

| Tool / Capability | Claude Agent SDK | Pydantic AI | How to Get It in Pydantic AI |
|---|---|---|---|
| **File Read** | Built-in (`Read`) | No built-in | Custom `@agent.tool` (~10 lines) or MCP `@modelcontextprotocol/server-filesystem` |
| **File Write** | Built-in (`Write`) | No built-in | Custom `@agent.tool` (~10 lines) or MCP filesystem server |
| **File Edit** (precise string replacement) | Built-in (`Edit`) | No built-in | Custom tool (~30 lines, implement diff/replace logic) or MCP filesystem server (no exact equivalent) |
| **Bash/Shell execution** | Built-in (`Bash`) | No built-in | Custom tool with `asyncio.create_subprocess_exec` (~20 lines) or MCP `mcp-run-python` for sandboxed Python |
| **Glob (file pattern search)** | Built-in (`Glob`) | No built-in | Custom tool using `pathlib.Path.glob()` (~10 lines) or MCP filesystem server |
| **Grep (content search with regex)** | Built-in (`Grep`, ripgrep-based) | No built-in | Custom tool wrapping `subprocess` + `rg` (~20 lines) or MCP filesystem server |
| **Web Search** | Built-in (`WebSearch`) | **Yes** -- `WebSearchTool` (provider-native built-in) + `DuckDuckGoSearchTool`, `TavilySearchTool`, `ExaSearchTool` (common tools) | `WebSearchTool()` as built-in, or `DuckDuckGoSearchTool()` as common tool. Also available as `WebSearch` capability. |
| **Web Fetch** | Built-in (`WebFetch`) | **Yes** -- `WebFetchTool` (provider-native built-in) + common `WebFetchTool` (fetches & converts to markdown with SSRF protection) | `WebFetchTool()` built-in or common tool variant. Also available as `WebFetch` capability. |
| **Agent / Subagent** | Built-in (`Agent` tool) -- define named agents with their own instructions and tool sets | **Yes** -- native multi-agent via tool delegation or programmatic hand-off | Call `sub_agent.run()` inside a `@agent.tool`, or use programmatic hand-off pattern. Also `pydantic-deep` community package. |
| **MCP Server integration** | Built-in -- stdio, HTTP, SSE transports; in-process SDK MCP servers; `.mcp.json` config files | **Yes** -- first-class `MCPServerStdio`, `MCPServerStreamableHTTP`, `MCPServerSSE`, `FastMCPToolset`; also `MCPServerTool` (provider-native) | Register MCP servers as toolsets: `Agent(toolsets=[mcp_server])`. Supports sampling and elicitation. |
| **Notebook editing** | Built-in (`NotebookEdit`) | No built-in | Custom tool or MCP server (no standard one exists) |
| **Task/Todo management** | Built-in (`TodoWrite`) | No built-in | Custom tool, or community `pydantic-ai-todo` capability |
| **Code Execution** (sandboxed) | Built-in (via Bash) | **Yes** -- `CodeExecutionTool` (provider-native built-in) | `CodeExecutionTool()` -- executed by the LLM provider in a sandbox |
| **Image Generation** | Not built-in | **Yes** -- `ImageGenerationTool` (provider-native) | `ImageGenerationTool()` with supported models |
| **File Search / RAG** | Not built-in (use Grep + Read) | **Yes** -- `FileSearchTool` (provider-native, vector search) | `FileSearchTool()` with OpenAI or Google |
| **Memory** | Built-in (CLAUDE.md files, session context) | **Yes** -- `MemoryTool` (provider-native, Anthropic only) | `MemoryTool()` or custom capability |
| **Session management** | Built-in -- `session_id` + `resume` option; fork sessions | Manual -- pass `message_history` between runs | Store `result.new_messages()`, pass to next `agent.run(message_history=...)`. No built-in session persistence. |
| **Streaming** | Built-in -- `async for message in query()` yields messages as they arrive | Built-in -- `run_stream()`, `run_stream_events()`, `iter()`, `stream_text()`, `stream_output()` | Multiple streaming modes including text deltas, structured output streaming, and SSE encoding for web UIs |
| **Hooks (pre/post tool)** | Built-in -- `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit` | Built-in -- `Capabilities` system with `before_tool_execute`, `after_tool_execute`, `wrap_tool_execute`, `before_model_request`, `after_model_request`, etc. | Use `Hooks` capability or subclass `AbstractCapability` with lifecycle hook methods |
| **AskUserQuestion** | Built-in tool | No built-in | Custom tool + MCP elicitation support |
| **Tool Search** (lazy loading) | Built-in -- auto-defers large tool sets | `DeferredLoadingToolset` | Use `DeferredLoadingToolset` to hide tools until discovered |
| **Permissions / Approval** | Built-in -- `allowed_tools`, `disallowed_tools`, `permissionMode` | `ApprovalRequiredToolset` + deferred tools | Wrap toolsets with `ApprovalRequiredToolset` for human-in-the-loop |

---

## Architecture Comparison

### Claude Agent SDK

```
query(prompt, options) --> Agent Loop (built-in)
  |
  +-- Built-in tools (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch)
  +-- Custom tools (via in-process MCP server: create_sdk_mcp_server)
  +-- External MCP servers (stdio, HTTP, SSE)
  +-- Subagents (Agent tool with named agent definitions)
  +-- Hooks (PreToolUse, PostToolUse, etc.)
  +-- Sessions (resume, fork)
```

- **Language**: Python and TypeScript SDKs
- **Model support**: Claude only (Anthropic API, Bedrock, Vertex, Azure)
- **Tool execution**: Handled by the SDK runtime -- you don't implement the tool loop
- **Custom tools**: Define with `@tool` decorator, wrap in `create_sdk_mcp_server()`, pass to `query()`
- **Tool naming**: `mcp__{server_name}__{tool_name}` for custom/MCP tools; built-ins use simple names like `Read`, `Bash`

### Pydantic AI

```
Agent(model, tools, toolsets, capabilities) --> agent.run() / run_stream() / iter()
  |
  +-- Function tools (@agent.tool, @agent.tool_plain)
  +-- Built-in tools (WebSearchTool, CodeExecutionTool, etc. -- provider-native)
  +-- Common tools (DuckDuckGoSearchTool, WebFetchTool, TavilySearchTool, ExaSearchTool)
  +-- MCP servers (MCPServerStdio, MCPServerStreamableHTTP, etc.)
  +-- Capabilities (composable behavior units: tools + hooks + instructions)
  +-- Toolsets (FunctionToolset, FilteredToolset, PrefixedToolset, etc.)
  +-- Third-party (LangChainToolset, ACIToolset)
```

- **Language**: Python only
- **Model support**: OpenAI, Anthropic, Google, Groq, Mistral, xAI, Ollama, OpenRouter, and more
- **Tool execution**: Framework calls your Python functions; you define the tool logic
- **Custom tools**: `@agent.tool` with type hints + docstrings --> auto-generated JSON schema
- **Output types**: Structured output with Pydantic model validation, streaming partial validation

---

## Deep Dive: Key Differentiators

### 1. MCP Support (Both have it)

**Claude Agent SDK**:
- Stdio, HTTP, SSE transports
- In-process SDK MCP servers (`create_sdk_mcp_server`)
- `.mcp.json` config file support
- Auto tool search for large tool sets
- Tool naming: `mcp__servername__toolname`
- Wildcard permissions: `mcp__github__*`

**Pydantic AI**:
- `MCPServerStdio`, `MCPServerStreamableHTTP`, `MCPServerSSE` classes
- `FastMCPToolset` alternative client
- `MCPServerTool` -- provider-native (model provider handles MCP communication)
- Supports MCP sampling (server can request LLM calls)
- Supports MCP elicitation (server can request user input)
- JSON config file loading with env var expansion
- `tool_prefix` for namespace conflicts

**Verdict**: Both have comprehensive MCP support. Pydantic AI has slightly more advanced features (sampling, elicitation). Claude Agent SDK has better DX with `.mcp.json` config and auto tool search.

### 2. Streaming

**Claude Agent SDK**:
- `async for message in query()` -- yields typed message objects (SystemMessage, AssistantMessage, ResultMessage)
- Messages include tool calls, results, and final output
- Simple, single streaming pattern

**Pydantic AI**:
- `run_stream()` -- streams until first output match, then stops
- `run_stream_events()` / `iter()` -- streams all events including tool calls
- `stream_text(delta=True)` -- text deltas only
- `stream_output()` -- streaming structured output with partial Pydantic validation
- `stream_responses()` -- raw ModelResponse objects
- SSE encoding via `UIAdapter.encode_stream()` for web UIs
- Vercel AI SDK integration

**Verdict**: Pydantic AI has significantly more streaming flexibility, especially for structured output and web UI integration.

### 3. Multi-Agent / Subagent Patterns

**Claude Agent SDK**:
- Define named agents in `options.agents` with description, prompt, and tool set
- Main agent invokes subagents via the `Agent` tool
- Subagent messages tagged with `parent_tool_use_id`
- Simple, declarative approach

**Pydantic AI**:
- **Tool delegation**: Call `sub_agent.run()` inside a `@agent.tool` function
- **Programmatic hand-off**: Sequential agent execution controlled by application code
- **Pydantic Graphs**: State machine patterns for complex orchestration
- **Deep agents**: Planning, delegation, sandboxed execution (community `pydantic-deep` package)
- **A2A Protocol**: Expose agents as A2A servers via `agent.to_a2a()` (Google's Agent-to-Agent standard)

**Verdict**: Pydantic AI has far more multi-agent patterns and supports the A2A interoperability standard. Claude Agent SDK's approach is simpler but less flexible.

### 4. Session / Conversation Management

**Claude Agent SDK**:
- Built-in session IDs
- Resume sessions: `options.resume = session_id`
- Fork sessions to explore different approaches
- Automatic context preservation across exchanges

**Pydantic AI**:
- Manual: store `result.new_messages()`, pass to `message_history` parameter
- No built-in persistence -- developer manages storage
- Full control over conversation scope
- A2A protocol provides `context_id` for cross-task conversation threads

**Verdict**: Claude Agent SDK has much better session management out of the box. Pydantic AI requires manual implementation but offers more control.

### 5. Hooks / Lifecycle System

**Claude Agent SDK**:
- `PreToolUse`, `PostToolUse` with regex matchers
- `Stop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`
- Callback functions receive input data and context
- Can block, modify, or log tool calls

**Pydantic AI (Capabilities system)**:
- `before_run` / `after_run` / `wrap_run` / `on_run_error`
- `before_model_request` / `after_model_request` / `wrap_model_request`
- `before_tool_validate` / `after_tool_validate` / `wrap_tool_validate`
- `before_tool_execute` / `after_tool_execute` / `wrap_tool_execute`
- `before_node_run` / `after_node_run` / `wrap_node_run`
- `prepare_tools()` -- dynamic tool filtering per step
- `wrap_run_event_stream()` -- observe/transform streamed events
- `for_run()` -- per-run state isolation
- Middleware-style nesting for `wrap_*` hooks
- Error hooks with raise-to-propagate, return-to-recover semantics

**Verdict**: Pydantic AI's Capabilities system is significantly more powerful and composable. It provides fine-grained lifecycle hooks at every level with middleware composition patterns.

### 6. The "Capabilities" Pattern (Pydantic AI exclusive)

A **Capability** is a reusable, composable unit of agent behavior that bundles:
- Tools (via toolsets or built-in tools)
- Lifecycle hooks (before/after/wrap/error at every level)
- Instructions (static or dynamic)
- Model settings

Built-in capabilities:
| Capability | Purpose |
|---|---|
| `Thinking` | Extended reasoning at configurable effort |
| `WebSearch` | Provider-adaptive web search with local fallback |
| `WebFetch` | Provider-adaptive web fetch with local fallback |
| `ImageGeneration` | Image creation with subagent fallback |
| `MCP` | MCP server integration |
| `PrepareTools` | Dynamic tool filtering per step |
| `PrefixTools` | Tool name namespacing |
| `Hooks` | Decorator-based lifecycle hooks |

Multiple capabilities compose cleanly:
```python
agent = Agent(
    'openai:gpt-4',
    capabilities=[
        Thinking(effort='high'),
        WebSearch(),
        ImageGeneration(fallback_model='openai:gpt-4v'),
        CustomGuardrail()
    ]
)
```

This pattern has **no equivalent in Claude Agent SDK**. The closest approximation is combining hooks + MCP servers + subagents, but without the unified composition model.

### 7. A2A Protocol Support

**Claude Agent SDK**: No A2A support.

**Pydantic AI**: Full A2A support via FastA2A library:
```python
agent = Agent('openai:gpt-5.2', instructions='Be fun!')
app = agent.to_a2a()  # Expose as A2A server
# Run with: uvicorn agent_to_a2a:app
```
- Task and context management
- Conversation history across tasks
- Storage and broker abstraction
- ASGI-compatible (Starlette-based)

---

## What It Takes to Replicate Claude Agent SDK Tools in Pydantic AI

### Easy (< 20 lines each)

**File Read**:
```python
@agent.tool_plain
async def read_file(file_path: str) -> str:
    """Read a file and return its contents."""
    return Path(file_path).read_text()
```

**File Write**:
```python
@agent.tool_plain
async def write_file(file_path: str, content: str) -> str:
    """Write content to a file."""
    Path(file_path).write_text(content)
    return f"Wrote {len(content)} bytes to {file_path}"
```

**Glob**:
```python
@agent.tool_plain
async def glob_search(pattern: str, path: str = '.') -> list[str]:
    """Find files matching a glob pattern."""
    return [str(p) for p in Path(path).glob(pattern)]
```

### Medium (~30-50 lines each)

**Bash/Shell**: Need subprocess management, timeout handling, output capture
**Grep**: Need regex compilation, file traversal, context lines, output formatting
**File Edit**: Need precise string matching and replacement with uniqueness checks

### Hard (100+ lines or use MCP)

**Notebook editing**: Complex JSON structure manipulation for .ipynb files
**Todo/Task management**: Need persistence layer, status tracking, subtask support

### Already Available via MCP

All of the above can be obtained through MCP servers:
- `@modelcontextprotocol/server-filesystem` -- file read/write/search
- `mcp-run-python` -- sandboxed Python execution
- `@playwright/mcp` -- browser automation
- `@modelcontextprotocol/server-github` -- GitHub operations
- `@modelcontextprotocol/server-postgres` -- database queries
- Hundreds more at [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)

---

## Decision Matrix

| Factor | Claude Agent SDK | Pydantic AI |
|---|---|---|
| **Need coding agent fast** | Winner -- works out of the box | Need to wire up file/shell tools |
| **Model flexibility** | Claude only | Any model provider |
| **Custom tool DX** | Good (MCP-based) | Excellent (decorated functions + auto-schema) |
| **Multi-agent patterns** | Basic (subagents) | Rich (delegation, hand-off, graphs, A2A) |
| **Composability** | Limited | Excellent (Capabilities, Toolsets) |
| **Streaming for web UIs** | Basic message stream | Rich (text, structured, SSE, Vercel AI) |
| **Session management** | Built-in, easy | Manual, flexible |
| **Hooks / lifecycle** | Good (6 hook types) | Excellent (20+ hook variants, middleware) |
| **Type safety** | Limited (message types) | Excellent (Pydantic models everywhere) |
| **Ecosystem** | Claude Code, MCP | MCP, LangChain tools, ACI.dev, A2A |
| **Language support** | Python + TypeScript | Python only |
| **Production readiness** | High (powers Claude Code) | High (backed by Pydantic team) |
| **Observability** | Basic message logging | Logfire integration (OpenTelemetry) |

---

## Recommendation for Discovery AI Assistant

If the goal is to build a **flexible, multi-model agent system** with rich tool composition:
- **Use Pydantic AI** -- better composability, model flexibility, Capabilities pattern, A2A support
- Implement file/shell tools as custom tools (~100 lines total) or connect MCP servers
- Use the Capabilities pattern for guardrails, logging, and tool management

If the goal is to build a **Claude-powered coding/research agent** quickly:
- **Use Claude Agent SDK** -- everything works immediately, same tools as Claude Code
- Add custom tools via `create_sdk_mcp_server()` for domain-specific operations
- Use sessions for multi-turn conversations

For a **hybrid approach**:
- Use Pydantic AI as the orchestration framework
- Connect Claude Agent SDK-style capabilities via MCP servers
- Use A2A protocol to expose agents as interoperable services
- Leverage Capabilities for cross-cutting concerns (logging, guardrails, cost tracking)

---

## Sources

- [Pydantic AI - Main Documentation](https://ai.pydantic.dev/)
- [Pydantic AI - Function Tools](https://ai.pydantic.dev/tools/)
- [Pydantic AI - Built-in Tools](https://ai.pydantic.dev/builtin-tools/)
- [Pydantic AI - Common Tools](https://ai.pydantic.dev/common-tools/)
- [Pydantic AI - Toolsets](https://ai.pydantic.dev/toolsets/)
- [Pydantic AI - MCP Client](https://ai.pydantic.dev/mcp/client/)
- [Pydantic AI - Multi-Agent Patterns](https://ai.pydantic.dev/multi-agent-applications/)
- [Pydantic AI - Capabilities](https://ai.pydantic.dev/capabilities/)
- [Pydantic AI - A2A Protocol](https://ai.pydantic.dev/a2a/)
- [Pydantic AI - Agents](https://ai.pydantic.dev/agent/)
- [Pydantic AI - Output / Streaming](https://ai.pydantic.dev/output/)
- [Claude Agent SDK - Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK - Custom Tools](https://platform.claude.com/docs/en/agent-sdk/custom-tools)
- [Claude Agent SDK - MCP Integration](https://platform.claude.com/docs/en/agent-sdk/mcp)
- [Claude Agent SDK - Subagents](https://docs.anthropic.com/en/docs/claude-code/sdk/subagents)
