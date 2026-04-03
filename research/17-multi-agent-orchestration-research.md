# Multi-Agent Orchestration Frameworks: Technical Deep Dive

## Purpose

Technical analysis of multi-agent orchestration frameworks to inform our own agent orchestration design for the Discovery AI Assistant. This research covers LangGraph and CrewAI internals, orchestration patterns, and a recommendation for our 7-agent system.

---

## Part 1: LangGraph Internals

### Architecture Overview

LangGraph implements the **Pregel / Bulk Synchronous Parallel (BSP)** model. The execution engine runs in three repeating phases:

1. **Plan** -- determine which nodes to execute based on channel state changes
2. **Execute** -- run all triggered nodes in parallel
3. **Update** -- apply node outputs to shared state channels, checkpoint

This is fundamentally a **graph execution engine** where agents are nodes, state flows through typed channels, and edges define routing.

### Core Data Model

```
StateGraph
  ├── nodes: dict[str, StateNodeSpec]       # name -> (function, metadata)
  ├── edges: set[(source, target)]          # direct connections
  ├── branches: dict[str, BranchSpec]       # conditional routing
  ├── channels: dict[str, BaseChannel]      # state storage slots
  └── schemas: state_schema, input_schema, output_schema
```

**Key Types:**

| Type | Purpose |
|------|---------|
| `Command(goto, update, resume, graph)` | Instruct state updates + routing from within a node |
| `Send(node, arg)` | Route execution to a specific node with custom payload |
| `Interrupt(value, id)` | Pause execution for human-in-the-loop |
| `RetryPolicy(initial_interval, backoff_factor, max_attempts, jitter)` | Per-node retry configuration |
| `CachePolicy(key_func, ttl)` | Per-node output caching |
| `StateSnapshot(values, next, config, metadata, tasks, interrupts)` | Point-in-time state |

### Channel System (State Communication)

Channels are the backbone of inter-node communication. Each state field maps to a channel.

| Channel Type | Behavior |
|-------------|----------|
| `LastValue` | Stores most recent value. Rejects multiple writes per step. |
| `BinaryOperatorAggregate` | Applies a reducer function (e.g., `operator.add`) to merge multiple node outputs into one value. Supports `Overwrite` to bypass reducer. |
| `EphemeralValue` | Temporary within a single step, cleared after consumption. |
| `NamedBarrierValue` | Waits for all named predecessors before releasing value. |
| `Topic` | Pub-sub style -- accumulates all writes. |

**How state flows between nodes:**
1. Node receives mapped input (full state dict coerced to node's input schema)
2. Node returns a dict of partial state updates (or a `Command`)
3. Updates are written to corresponding channels via reducers
4. Changed channels trigger downstream nodes in the next superstep

### Graph Compilation

`StateGraph.compile()` transforms the builder into an executable `Pregel` instance:

1. Validates graph structure (entry/exit points, node references)
2. Converts state schema fields into channel definitions
3. Attaches input/output mappers to nodes (Pydantic model coercion)
4. Registers edges as channel triggers
5. Compiles conditional branches into routing functions
6. Returns `Pregel` object supporting `invoke()`, `stream()`, and async variants

### The Execution Loop (PregelLoop)

The `PregelLoop` is the heart of the engine. Lifecycle:

```
__enter__() -> Load/create checkpoint -> Initialize channels -> Setup executors
    |
    v
tick() [repeats]:
    1. prepare_next_tasks()  -- identify triggered nodes from channel version changes
    2. Check interrupt_before -- pause if configured
    3. Execute tasks (parallel via BackgroundExecutor)
    4. Collect writes via put_writes()
    |
    v
after_tick():
    1. apply_writes() -- update channels with task outputs
    2. Update channel versions
    3. Emit streams (values, updates, messages, checkpoints)
    4. Save checkpoint via _put_checkpoint()
    5. Check interrupt_after
    6. prepare_next_tasks() for next iteration
    |
    v
Status transitions: "input" -> "pending" -> "done" | "interrupt_before" | "interrupt_after" | "out_of_steps"
```

**Node scheduling algorithm:**
- Each channel has a version counter
- Each node declares which channels it triggers on
- `prepare_next_tasks()` compares current channel versions against versions_seen
- Only nodes whose trigger channels changed since last execution are scheduled
- This is efficient -- avoids scanning all nodes each step

### Conditional Routing (BranchSpec)

```python
graph.add_conditional_edges(
    "analyzer",
    route_function,        # receives state, returns node name(s)
    path_map={"gap": "gap_detector", "complete": "doc_generator"}
)
```

Internals:
1. `route_function` is invoked with current state
2. Return value mapped through `path_map` dict (or identity if list/Literal type hint)
3. `_finish()` normalizes to list, validates destinations, writes channel updates
4. Supports returning `Send` objects for dynamic fan-out

### Parallel Execution

Two mechanisms:

**1. Automatic parallelism (BSP model):**
- All nodes triggered in the same superstep execute in parallel
- `BackgroundExecutor` (sync) uses `ThreadPoolExecutor` with `copy_context()`
- `AsyncBackgroundExecutor` uses `asyncio.create_task()` with optional `Semaphore` for `max_concurrency`
- Results collected via futures; exceptions aggregated

**2. Explicit fan-out via Send:**
```python
def route(state):
    return [Send("analyzer", {"doc": doc}) for doc in state["documents"]]
```
Each `Send` creates an independent task instance of the target node.

### Checkpointing and Persistence

```python
graph.compile(checkpointer=SqliteSaver("checkpoints.db"))
```

Checkpoint lifecycle:
1. After each superstep, `_put_checkpoint()` serializes channel values + versions
2. Checkpoints are immutable snapshots with parent references (linked list)
3. On resume: load checkpoint, restore channels, replay pending writes
4. `get_state_history()` iterates checkpoint chain for time-travel debugging

Checkpoint data:
- `channel_versions`: version ID per channel
- `channel_values`: serialized channel data
- `versions_seen`: tracks which channel changes each node has processed
- `pending_writes`: writes not yet applied (for crash recovery)

### Error Handling and Retry

Per-node retry via `RetryPolicy`:
```python
graph.add_node("analyzer", analyze, retry_policy=RetryPolicy(max_attempts=3))
```

Implementation:
- `run_with_retry()` wraps node execution
- Exponential backoff: `interval = min(max_interval, initial_interval * backoff_factor^(attempts-1))`
- Jitter randomizes intervals to prevent thundering herd
- Three exception categories: `ParentCommand` (route to parent graph), `GraphBubbleUp` (immediate termination), general (retryable)
- `retry_on` accepts exception types, sequences, or callable predicates

### Agent Handoffs

LangGraph implements handoffs via the `Command` type:

```python
def analyst_node(state):
    result = analyze(state)
    if result.needs_gap_analysis:
        return Command(goto="gap_detector", update={"analysis": result})
    return Command(goto="doc_generator", update={"analysis": result})
```

For multi-agent supervisor patterns, `langgraph-supervisor` provides:
```python
from langgraph_supervisor import create_supervisor, create_handoff_tool

handoff_tool = create_handoff_tool(agent_name="math_expert")
supervisor = create_supervisor([research_agent, math_agent], model=llm)
```

Handoff internals:
- Supervisor is a node with handoff tools
- Handoff tools return `Command(goto=agent_name, update={"messages": ...})`
- State includes `messages` (conversation history) and `active_agent`
- Two output modes: `full_history` (all worker messages) or `last_message` (final only)

### Human-in-the-Loop

```python
graph.compile(interrupt_before=["approval_node"], checkpointer=saver)
```

Mechanism:
1. Before executing `approval_node`, `should_interrupt()` checks channel updates
2. Raises `GraphInterrupt` with pending task info
3. State persisted via checkpoint
4. External system calls `graph.update_state(config, {"approved": True})`
5. Execution resumes from checkpoint

The `Interrupt` type can surface data to the client:
```python
def review_node(state):
    answer = interrupt({"question": "Approve this recommendation?", "data": state["recommendation"]})
    # execution pauses here, resumes when answer provided
```

---

## Part 2: CrewAI Internals

### Architecture Overview

CrewAI uses a **role-based agent collaboration** model. The core primitives are:

- **Agent** -- an LLM-powered entity with a role, goal, backstory, and tools
- **Task** -- a unit of work with a description, expected output, and assigned agent
- **Crew** -- an orchestration container that runs agents through tasks
- **Process** -- the execution strategy (sequential or hierarchical)
- **Flow** -- an event-driven workflow engine (higher-level than Crew)

### Core Data Model

**Agent (BaseAgent):**
```
BaseAgent:
  identity:    id, role, goal, backstory
  execution:   max_iter (25), max_tokens, verbose, cache
  tools:       list[BaseTool], tools_handler, tools_results
  delegation:  allow_delegation (bool), crew reference
  memory:      Memory | MemoryScope | MemorySlice | None
  knowledge:   Knowledge, knowledge_sources, knowledge_config
  platform:    apps (Asana, Slack, etc.), mcps (MCP servers)
  security:    security_config (fingerprinting)
```

**Task:**
```
Task:
  definition:  description, expected_output, name
  execution:   agent, async_execution, human_input, tools
  context:     context (list[Task] -- prior tasks whose output feeds this one)
  output:      output_file, output_json, output_pydantic, response_model
  validation:  guardrail(s), guardrail_max_retries (3)
  tracking:    id, start_time, end_time, used_tools, tools_errors, retry_count
  callbacks:   callback (post-completion)
```

**Crew:**
```
Crew:
  agents:      list[BaseAgent]
  tasks:       list[Task]
  process:     Process.sequential | Process.hierarchical
  manager:     manager_agent, manager_llm
  memory:      Memory with hierarchical scoping (/crew/{name}/...)
  knowledge:   Knowledge with RAG
  config:      max_rpm, cache, stream, planning, verbose
  callbacks:   before_kickoff_callbacks, after_kickoff_callbacks,
               task_callback, step_callback
```

### Sequential Process

```
kickoff(inputs) ->
  prepare_kickoff() (interpolate inputs into task/agent descriptions) ->
  _run_sequential_process() ->
    _execute_tasks(tasks):
      for each task:
        1. prepare_task_execution() -- setup agent, tools, context
        2. Check conditional skip (ConditionalTask)
        3. If async_execution: create Future, continue to next task
        4. If sync: wait for pending futures, then execute
        5. Store execution log
      Return CrewOutput
```

Context passing between tasks:
```python
task2 = Task(
    description="Analyze gaps",
    context=[task1],  # receives task1's output as context string
    agent=gap_agent
)
```

Internally, `_get_context()` calls `aggregate_raw_outputs_from_tasks()` to concatenate prior task outputs into a context string injected into the task prompt.

### Hierarchical Process

```
kickoff() ->
  _run_hierarchical_process() ->
    _create_manager_agent() -- creates agent with DelegateWorkTool + AskQuestionTool
    _execute_tasks(tasks) -- manager decides which agent handles each task
```

The manager agent receives delegation tools pointing to all worker agents. The LLM driving the manager decides task assignment based on agent roles and goals.

### Agent Execution Loop (CrewAgentExecutor)

Two execution paradigms:

**Native Function Calling (preferred):**
```
1. Convert tools to OpenAI schema
2. Call LLM with tools
3. If tool calls detected:
   a. Check cache for each tool
   b. Run before_tool_call hooks
   c. Execute tools (parallel via ThreadPoolExecutor, max 8 workers)
   d. Run after_tool_call hooks
   e. Append results to messages
   f. Check if result_as_answer tool was called
4. If no tool calls: extract final answer
5. Repeat until AgentFinish or max_iter (25)
```

**ReAct Pattern (fallback):**
```
1. Embed tool descriptions in prompt
2. Call LLM
3. Parse response for AgentAction or AgentFinish
4. If AgentAction: execute tool, append result, loop
5. If AgentFinish: return
```

Error handling:
- Context length exceeded: `handle_context_length()` trims messages
- Parser errors: `handle_output_parser_exception()` with retry
- Max iterations: `handle_max_iterations_exceeded()` forces final response
- Unknown errors: litellm errors re-raise; others logged and re-raised

### Delegation Between Agents

**DelegateWorkTool:**
```python
# Agent A calls this tool to delegate to Agent B:
# Input: task description, context string, coworker name
# Internally:
1. Sanitize coworker name (case-fold, remove quotes)
2. Find matching agent by role
3. Create new Task(description=task, agent=matched_agent)
4. Execute task synchronously
5. Return result string to delegating agent
```

**AskQuestionTool:**
Same mechanism but framed as asking a question rather than delegating a full task.

Key insight: delegation is implemented as **tool calling** -- the LLM decides when to delegate by invoking the delegation tool. The target agent gets a fresh Task with context passed as a string.

### Memory System

CrewAI's `Memory` class provides a unified, LLM-enhanced memory system:

**Storage:** Pluggable backends (LanceDB default, Qdrant Edge alternative) with vector embeddings for semantic search.

**Record structure:**
```
MemoryRecord:
  content, embedding, timestamp, scope_path,
  categories, importance, metadata, source, private
```

**Write pipeline:**
```
remember(content) ->
  LLM analysis (extract discrete memories) ->
  Embedding generation ->
  Consolidation with existing memories ->
  Storage with scope path
```

**Read pipeline:**
```
recall(query, scope, depth) ->
  depth="shallow": direct vector search
  depth="deep": LLM sub-query distillation -> multiple searches -> merge
```

**Scoring:** Composite relevance = (recency_weight * recency_decay) + (semantic_weight * similarity) + (importance_weight * importance)

**Agent sharing:** Agents write to shared storage with distinct `source` identifiers. Privacy flag controls visibility. Scoped views (`/crew/name/agent/role/`) enable isolation without data leakage.

### CrewAI Flow (Event-Driven Orchestration)

The `Flow` class provides a higher-level orchestration layer on top of Crew:

**Decorators:**
- `@start()` -- marks entry points, runs at kickoff
- `@listen("method_name")` -- triggers when a method completes
- `@router("method_name")` -- conditional branching based on return value
- `@persist()` -- state persistence for pause/resume

**Conditional logic:**
```python
@router("check_status")
def route(self):
    return "SUCCESS" if self.state.valid else "FAILURE"

@listen("SUCCESS")
def handle_success(self): ...

@listen("FAILURE")
def handle_failure(self): ...
```

**Parallel execution:**
- Multiple `@start()` methods run concurrently
- Multiple `@listen()` methods for the same trigger run in parallel
- OR conditions: racing groups where first completion wins

**Human feedback:**
```python
@human_feedback(emit="review_outcome")
def review_step(self):
    raise HumanFeedbackPending(context=self.state.recommendation)
# Flow pauses, persists state, resumes when feedback provided
```

**State management:** Thread-safe `StateProxy` with `LockedListProxy` and `LockedDictProxy` for concurrent mutation. State is either a dict or Pydantic BaseModel.

---

## Part 3: Orchestration Pattern Analysis

### Pattern 1: Supervisor (Orchestrator-Worker)

**How it works:** A single supervisor agent receives requests, breaks them into subtasks, delegates to specialized workers, and aggregates results.

**Routing:** Supervisor LLM decides via tool calling (handoff tools). Routing is dynamic -- the LLM reasons about which worker is best suited.

**State:** Supervisor maintains global conversation history. Workers receive relevant context subset. Two modes: full message history or last-message-only.

**Parallel execution:** Workers execute independently. Supervisor can dispatch multiple workers simultaneously if the framework supports it.

**Error handling:** Supervisor can retry failed workers, reassign to different workers, or handle errors itself.

**Strengths:**
- Easy to reason about (single control flow)
- Natural quality control point
- Simple debugging (trace supervisor decisions)
- Good for 3-10 specialized agents

**Weaknesses:**
- Supervisor is a bottleneck (3s LLM call per routing decision)
- Context window pressure with many workers
- Single point of failure

**Best for:** Customer support triage, document processing, general-purpose coordination with quality control.

### Pattern 2: Pipeline (Sequential)

**How it works:** Fixed sequence of agent stages. Output of stage N feeds into stage N+1.

**Routing:** Static, predefined sequence. No runtime decisions.

**State:** Clear input/output contracts at stage boundaries. Each stage holds only its context.

**Parallel execution:** None inherently. Can add branching with conditional tasks.

**Error handling:** Stage failure blocks pipeline. Retry at stage level.

**Strengths:**
- Simplest to implement and monitor
- Supports human review between stages
- Easy to test (stage-by-stage)

**Weaknesses:**
- Cannot handle conditional branching
- Stage failures cascade
- Rigid -- cannot skip stages or reorder

**Best for:** Content generation, data enrichment, compliance verification, any workflow with clear sequential phases.

### Pattern 3: DAG (Directed Acyclic Graph)

**How it works:** Agents arranged as nodes in a directed acyclic graph. Dependencies define execution order. Nodes without dependencies execute in parallel.

**Routing:** Defined at graph construction time (compile-time). Conditional edges add runtime branching. Dynamic fan-out via Send for runtime graph expansion.

**State:** Shared state object flowing through the graph. Channels manage individual state fields with reducers for merging parallel outputs.

**Parallel execution:** Automatic -- BSP model executes all ready nodes simultaneously. Barrier synchronization between supersteps.

**Error handling:** Per-node retry policies. Graph can checkpoint and resume. Failed branches don't block independent branches.

**Strengths:**
- Maximum parallelism for independent work
- Compile-time validation of graph structure
- Natural for workflows with complex dependencies
- Checkpointing enables fault tolerance

**Weaknesses:**
- Acyclic constraint limits iterative refinement (workaround: cycles via re-entry)
- More complex to design than pipelines
- State merging requires careful reducer design

**Best for:** Document analysis pipelines, workflows with parallel independent analysis, systems needing checkpointing.

### Pattern 4: Swarm (Self-Organizing)

**How it works:** Agents operate as autonomous peers coordinating through shared state (blackboard). No central coordinator. Each agent has handoff tools pointing to peers.

**Routing:** Agents decide locally when to hand off, based on their own assessment. "Active agent" field in shared state tracks who is currently running.

**State:** Shared blackboard/workspace. Eventually consistent. Agents read/write freely.

**Parallel execution:** Highly parallel. Agents activate when they observe relevant state changes.

**Error handling:** No single point of failure. Agent replacement transparent. Requires explicit termination conditions (max iterations, quality threshold, timeout).

**Strengths:**
- High fault tolerance
- No coordination bottleneck
- Excellent scalability (50+ agents)
- Natural for exploration tasks

**Weaknesses:**
- Poor observability (requires distributed tracing)
- Non-deterministic execution order
- Convergence uncertainty
- Difficult debugging

**Best for:** Research/exploration tasks, competitive intelligence, problems where optimal path is unknown.

### Pattern 5: Hierarchical

**How it works:** Tree structure with multiple delegation levels. Top manager delegates to supervisors, who delegate to workers.

**Routing:** Each level routes independently. Top level makes strategic decisions, middle levels make tactical decisions.

**State:** Distributed across levels. Summarization at each level boundary. Top holds strategy + summaries, workers hold task-specific input.

**Parallel execution:** Parallel within branches, sequential between levels.

**Strengths:**
- Solves context window limits via summarization
- Logarithmic scalability
- Natural for organizational structures

**Weaknesses:**
- Latency accumulates per level
- Information loss through summarization
- Complex tracing

**Best for:** Enterprise-scale (50+ agents), multi-domain systems, organizational hierarchies.

---

## Part 4: Comparison Matrix

| Dimension | LangGraph | CrewAI |
|-----------|-----------|--------|
| **Core model** | Graph execution (Pregel/BSP) | Role-based agent collaboration |
| **Orchestration unit** | Node (function) | Agent (LLM entity with role/goal) |
| **State management** | Typed channels with reducers | Shared memory + task output chaining |
| **Routing** | Compile-time edges + runtime conditional branches + Command | LLM-driven delegation via tools |
| **Parallel execution** | Native BSP (all ready nodes run in parallel) | Async tasks + ThreadPoolExecutor for tools |
| **Checkpointing** | First-class (checkpoint every superstep) | Flow-level persistence |
| **Human-in-the-loop** | `interrupt_before`/`interrupt_after` + `Interrupt` type | `human_input` flag on Task + HumanFeedbackPending in Flow |
| **Error handling** | Per-node RetryPolicy with exponential backoff | Per-agent max_iter + guardrails with max_retries |
| **Agent handoff** | `Command(goto=...)` or handoff tools | DelegateWorkTool / AskQuestionTool |
| **Memory** | External store (InMemoryStore, etc.) | Built-in unified Memory with vector search |
| **Learning curve** | Higher (graph theory concepts) | Lower (natural role/task metaphor) |
| **Flexibility** | Very high (arbitrary graph topologies) | Moderate (sequential/hierarchical + Flow) |
| **Production readiness** | High (checkpointing, streaming, observability) | Moderate (event system, training mode) |

---

## Part 5: Recommendation for Discovery AI Assistant

### System Requirements Recap

- 7 specialized agents: Intake, Analysis, Gap Detection, Meeting Prep, Document Generator, Control Point, Role Simulation
- 3 knowledge layers: Document Search, Fact Store, Entity Graph
- User-triggered flows (PO asks question) + Event-triggered flows (document uploaded)
- Parallel execution (multiple agents analyzing a document simultaneously)
- Human-in-the-loop (PO approves/rejects recommendations)

### Recommended Pattern: Hybrid DAG + Supervisor

We recommend a **DAG-based orchestration engine with a lightweight supervisor for routing**, implemented using LangGraph's architecture as the reference model. Here is why:

#### Why DAG as the foundation

1. **Parallel execution is native.** When a document is uploaded, Intake, Analysis, and Gap Detection can run simultaneously on different aspects. The BSP model handles this automatically -- any nodes whose input channels have been updated execute in the same superstep.

2. **Dependencies are explicit.** Meeting Prep depends on Analysis + Gap Detection completing. Document Generator depends on Control Point approval. These are natural graph edges.

3. **Checkpointing enables human-in-the-loop.** When Control Point needs PO approval, the graph pauses (interrupt), persists state, and resumes when the PO responds. This is exactly LangGraph's `interrupt_before` pattern.

4. **State merging is solved.** When Analysis and Gap Detection both produce findings, a reducer (BinaryOperatorAggregate) can merge them into a unified findings list.

#### Why add a Supervisor layer

A pure DAG cannot handle dynamic routing (e.g., "the PO asked a question -- which agent should handle it?"). The supervisor pattern handles this:

1. **User-triggered flows** go through a lightweight Intake/Router agent that examines the question and routes to the appropriate agent(s)
2. **Event-triggered flows** follow predefined DAG paths (document upload always triggers Intake -> Analysis + Gap Detection in parallel -> ...)

The supervisor is NOT a heavyweight LLM agent making every routing decision. It is a thin routing layer that handles the entry point, while the DAG handles the execution flow.

#### Proposed Architecture

```
                        ┌─────────────────────────────────────────┐
                        │           Entry Router (Supervisor)      │
                        │  - Classifies: question vs document vs   │
                        │    meeting request                       │
                        │  - Routes to appropriate DAG subgraph    │
                        └────────┬──────────┬──────────┬──────────┘
                                 │          │          │
                    ┌────────────▼─┐  ┌─────▼─────┐  ┌▼──────────┐
                    │  Q&A Flow    │  │ Doc Flow   │  │ Meeting   │
                    │  (DAG)       │  │ (DAG)      │  │ Flow (DAG)│
                    └──────────────┘  └───────────┘  └───────────┘
```

**Document Upload Flow (DAG):**
```
                         Document Upload Event
                                │
                         ┌──────▼──────┐
                         │   Intake    │
                         │  (extract,  │
                         │  classify)  │
                         └──┬─────┬───┘
                            │     │
              ┌─────────────▼─┐ ┌─▼──────────────┐
              │   Analysis    │ │  Gap Detection  │  ← parallel (BSP)
              │  (deep dive)  │ │  (find missing) │
              └──────┬────────┘ └────┬────────────┘
                     │               │
                     ▼               ▼
              ┌──────────────────────────┐
              │    Merge (reducer)       │  ← BinaryOperatorAggregate
              │    Combine findings      │
              └───────────┬──────────────┘
                          │
                    ┌─────▼──────┐
                    │  Control   │
                    │  Point     │──── interrupt ──── PO Reviews
                    │ (validate) │                    (human-in-loop)
                    └─────┬──────┘
                          │ (after approval)
                    ┌─────▼──────┐
                    │  Document  │
                    │  Generator │
                    └────────────┘
```

**Question Flow (DAG):**
```
                    PO Question
                        │
                  ┌─────▼──────┐
                  │  Intake    │
                  │ (classify  │
                  │  question) │
                  └─────┬──────┘
                        │
                  ┌─────▼──────┐
                  │  Router    │  ← conditional edge
                  │ (which     │    based on question type
                  │  agent?)   │
                  └──┬────┬──┬─┘
                     │    │  │
            ┌────────▼┐ ┌▼──▼────────┐
            │Analysis │ │Role Sim    │  etc.
            └────┬────┘ └────┬───────┘
                 │           │
                 ▼           ▼
              (merge + format response)
```

#### State Design

Inspired by LangGraph's channel model:

```
DiscoveryState:
  # Core state (LastValue channels)
  request_type: str                    # "question" | "document" | "meeting"
  current_document: Document | None
  current_question: str | None

  # Accumulating state (BinaryOperatorAggregate with list append)
  findings: list[Finding]              # merged from Analysis + Gap Detection
  recommendations: list[Recommendation]
  control_points: list[ControlPoint]

  # Knowledge layer references
  doc_search_results: list[SearchResult]
  fact_store_results: list[Fact]
  entity_graph_context: list[Entity]

  # Human-in-the-loop
  pending_approval: ApprovalRequest | None
  approval_decision: bool | None

  # Conversation
  messages: list[Message]              # full conversation history
```

#### Knowledge Layer Integration

All 3 knowledge layers are accessible as **shared services**, not agents:

```python
# Injected into agent context, not separate graph nodes
class KnowledgeContext:
    doc_search: DocumentSearchService    # RAG over uploaded documents
    fact_store: FactStoreService         # Structured facts
    entity_graph: EntityGraphService     # Entity relationships

# Each agent receives this in their execution context
def analysis_agent(state: DiscoveryState, knowledge: KnowledgeContext):
    relevant_docs = knowledge.doc_search.search(state.current_question)
    related_facts = knowledge.fact_store.query(state.current_document.entities)
    entity_context = knowledge.entity_graph.traverse(state.current_document.entities)
    # ... analyze with full knowledge context
```

#### Error Handling Strategy

| Scenario | Handling |
|----------|----------|
| Agent LLM failure | Per-node RetryPolicy(max_attempts=3, backoff_factor=2.0) |
| Knowledge layer timeout | Timeout with fallback to cached results |
| Agent produces invalid output | Guardrail validation + retry (CrewAI pattern) |
| PO never responds to approval | Timeout interrupt with auto-escalation |
| Parallel agent disagreement | Merge reducer flags conflicts for Control Point review |

#### Why Not Pure CrewAI

CrewAI's role-based model is intuitive but has limitations for our use case:

1. **No native parallel execution of agents** -- CrewAI's sequential process runs tasks one-by-one. Async tasks exist but are limited.
2. **Delegation is LLM-driven** -- an LLM decides when to delegate via tool calling. This adds latency and non-determinism to routing. Our flows have known structures.
3. **No compile-time graph validation** -- LangGraph validates the graph structure at compile time. CrewAI validates task dependencies at runtime.
4. **Checkpointing is limited** -- LangGraph checkpoints every superstep. CrewAI Flow has persistence but not at the same granularity.

However, CrewAI's **memory system** is worth studying for our knowledge layer integration (scoped memory, composite scoring, LLM-enhanced recall).

#### Why Not Pure Swarm

Our system has well-defined workflows, not exploratory tasks. Swarm's non-determinism would make it harder to guarantee consistent outputs for PO-facing features. The overhead of distributed tracing is not justified when our agent count is small (7).

### Implementation Approach

We recommend **building our own lightweight orchestration engine** inspired by LangGraph's architecture, rather than depending directly on either framework:

1. **Graph definition layer** -- define agents as nodes with typed inputs/outputs
2. **Channel-based state** -- shared state with reducers for parallel merge
3. **BSP execution loop** -- plan/execute/update cycle
4. **Interrupt mechanism** -- pause/resume for human-in-the-loop
5. **Checkpoint persistence** -- save/restore state for fault tolerance

This gives us full control over the orchestration without framework lock-in, while leveraging the proven patterns from LangGraph's Pregel model.

Alternatively, if speed-to-market is prioritized over control, **LangGraph is the recommended framework** to adopt directly. It has the most mature execution model, first-class checkpointing, and native parallel execution -- all critical for our system.

---

## Sources

- [LangGraph Repository](https://github.com/langchain-ai/langgraph) -- Pregel engine, StateGraph, channels, checkpointing
- [LangGraph Supervisor](https://github.com/langchain-ai/langgraph-supervisor-py) -- Supervisor pattern implementation
- [CrewAI Repository](https://github.com/crewAIInc/crewAI) -- Agent, Task, Crew, Flow, Memory systems
- [Agent Orchestration Patterns: Swarm vs Mesh vs Hierarchical](https://gurusup.com/blog/agent-orchestration-patterns)
- [Best Multi-Agent Frameworks in 2026](https://gurusup.com/blog/best-multi-agent-frameworks-2026)
- [LangGraph Multi-Agent Systems Tutorial](https://latenode.com/blog/ai-frameworks-technical-infrastructure/langgraph-multi-agent-orchestration/langgraph-multi-agent-systems-complete-tutorial-examples)
- [Multi-Agent Orchestration Patterns Complete Guide 2026](https://fast.io/resources/multi-agent-orchestration-patterns/)
- [LangGraph Swarm: Multi-Agent Collaboration](https://dev.to/sreeni5018/building-multi-agent-systems-with-langgraph-swarm-a-new-approach-to-agent-collaboration-15kj)
