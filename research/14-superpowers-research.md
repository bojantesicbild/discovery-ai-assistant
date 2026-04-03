# 14 — Superpowers Framework Research

> **Date:** 2026-03-31
> **Purpose:** Extract patterns and approaches from the Superpowers framework applicable to our Discovery AI Assistant
>
> **Repo:** [obra/superpowers](https://github.com/obra/superpowers) — Agentic skills framework for AI coding agents
> **Version:** v5.0.7 | **License:** MIT | **Author:** Jesse Vincent (Prime Radiant)

---

## 1. What Is Superpowers?

Superpowers is a **composable skills framework** that shapes how AI coding agents approach software development. It provides 14 structured "skills" — behavioral instruction sets — that enforce a disciplined workflow: **brainstorm → plan → execute → verify → review**.

Key insight: Superpowers treats **agent instructions as code** — tested, versioned, and reviewed like production software. The entire system is zero-dependency: just markdown documents + a bash bootstrap hook.

### Supported Platforms
Claude Code, Cursor, Codex, OpenCode, Gemini CLI, GitHub Copilot CLI — with platform-specific adapters.

### Architecture Overview

```
skills/          14 composable skill definitions (the core)
agents/          Agent role definitions (e.g., code-reviewer.md)
commands/        User-invocable commands (brainstorm, write-plan, execute-plan)
hooks/           Session lifecycle hooks (session-start bootstrap)
.claude-plugin/  Claude Code marketplace metadata
.cursor-plugin/  Cursor IDE adapter
```

---

## 2. Core Workflow Pipeline

```
brainstorming → writing-plans → [subagent-driven-development | executing-plans] → finishing
```

### The 14 Skills

| Category | Skills |
|----------|--------|
| **Process** | brainstorming, writing-plans, executing-plans, subagent-driven-development |
| **Quality** | test-driven-development, verification-before-completion, systematic-debugging |
| **Collaboration** | dispatching-parallel-agents, requesting-code-review, receiving-code-review |
| **Git** | using-git-worktrees, finishing-a-development-branch |
| **Meta** | using-superpowers, writing-skills |

### How It Bootstraps

1. On session start, `hooks/session-start` fires via `hooks.json`
2. Reads the `using-superpowers/SKILL.md`, JSON-escapes it
3. Injects as `additionalContext` into the AI agent's system prompt
4. Wraps in `<EXTREMELY_IMPORTANT>` tags, telling the agent to check for applicable skills before every response
5. Platform detection adjusts the output format per AI tool

---

## 3. Key Patterns for Discovery AI Assistant

### 3.1 Subagent-Driven Processing (Controller + Workers)

**How Superpowers does it:**
A controller agent dispatches fresh subagents per task, each getting:
- Full task text (never makes subagent read files — passes all context inline)
- Precise instructions and success criteria
- A self-review checklist and escalation protocol

Each task goes through a pipeline:
```
Implementer subagent → Spec reviewer subagent → Code quality reviewer subagent
```

Status reporting: `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`

**How we can apply it:**

Our Discovery pipeline already has 7 agents. The Superpowers pattern suggests structuring them more rigorously:

```
Document ingestion task:
  Intake Agent (worker) → Analysis Agent (spec reviewer) → Control Point Agent (quality reviewer)

Each agent reports: DONE / PARTIAL / NEEDS_CLARIFICATION / BLOCKED
```

**Concrete improvements:**
- **Context isolation**: Each agent gets a fresh context with precisely what it needs. No inherited session history. This prevents our Analysis Agent from being polluted by previous chat interactions.
- **Explicit task handoff**: Instead of implicit routing, the controller constructs focused prompts per agent with exactly the data they need.
- **Status protocol**: Standardized status responses let the orchestration layer make automated decisions (retry, escalate to PO, skip).

**Model tiering** (from Superpowers):
- Cheap models for mechanical tasks (document classification, metadata extraction)
- Standard models for analysis (gap detection, fact extraction)
- Most capable models for complex reasoning (contradiction detection, role simulation)

This directly maps to our cost optimization needs — not every agent needs GPT-4 / Claude Opus.

---

### 3.2 Verification-Before-Completion

**How Superpowers does it:**
The "Iron Law" — no success claims without running actual verification in the current message. Addresses the AI failure of saying "should work now" without evidence.

**How we can apply it:**

This is critical for our Control Point Agent and Gap Detection Agent:

| Current risk | Superpowers-inspired fix |
|-------------|------------------------|
| Agent says "auth is covered" based on vague chunk match | Require the agent to cite the specific fact from Mem0 with source doc + timestamp |
| Agent says "no contradictions found" | Require explicit comparison log: "Checked fact X (Meeting 2) vs fact Y (Meeting 4) — consistent" |
| Agent says "readiness at 85%" | Require per-control-point breakdown with evidence for each status |
| Document generator produces a section | Require source attribution: which RAGFlow chunks and Mem0 facts were used |

**Implementation pattern:**
```
Every agent response MUST include:
1. The claim ("Auth method is covered")
2. The evidence (Mem0 fact ID, source document, extraction date)
3. The verification command that was run (Mem0 query, RAGFlow search)
4. The raw result (not just the interpretation)
```

This transforms our agents from "AI that sounds confident" to "AI that shows its work."

---

### 3.3 Anti-Rationalization Tables

**How Superpowers does it:**
Every discipline-enforcing skill includes a table of excuses an AI will generate and explicit counters. Example from TDD skill:

| AI excuse | Counter |
|-----------|---------|
| "This is too simple to test" | Nothing is too simple. Write the test. |
| "I'll add tests after" | No. Test first. Always. |
| "The test would just duplicate the implementation" | That means your test is wrong, not unnecessary. |

**How we can apply it:**

Our agents will have the same rationalization tendencies. We should build anti-rationalization tables into each agent's system prompt:

**For Control Point Agent:**

| AI excuse | Counter |
|-----------|---------|
| "This control point is implicitly covered by the general discussion" | Implicit ≠ covered. If there's no explicit fact in Mem0, mark as PARTIAL, not COVERED. |
| "The client probably means X" | Never assume. Mark as PARTIAL and generate a clarification question. |
| "This is close enough to confirmed" | Close enough = PARTIAL. Only CONFIRMED when there's an explicit, unambiguous statement. |

**For Gap Detection Agent:**

| AI excuse | Counter |
|-----------|---------|
| "This gap isn't important for the project type" | The PO decides importance, not you. Report all gaps. Let the PO dismiss. |
| "The client will address this naturally" | Generate the question anyway. It's better to ask than to wait. |
| "There's enough information to infer this" | Inference ≠ knowledge. Flag it and let the PO confirm. |

**For Analysis Agent:**

| AI excuse | Counter |
|-----------|---------|
| "These two statements aren't really contradictory" | If they could be interpreted as contradictory, flag them. Let the PO resolve. |
| "The newer statement supersedes the older one" | Maybe. But track both versions and flag the change. |
| "This is a minor discrepancy" | Minor discrepancies in discovery become major problems in development. Flag it. |

This pattern is arguably **more important for discovery than for coding** — in coding, bad output fails tests. In discovery, bad output can go undetected until development starts.

---

### 3.4 Brainstorming-First Workflow (Design Before Execution)

**How Superpowers does it:**
- HARD-GATE: No code before design approval
- Agent asks clarifying questions one at a time
- Proposes 2-3 approaches with trade-offs
- Presents design in sections, gets user approval per section
- Writes a spec to `docs/superpowers/specs/` before any implementation

**How we can apply it:**

Map this to our Discovery project setup:

```
PO creates new discovery project:
  1. BRAINSTORM: System asks clarifying questions about the project type, industry,
     complexity, known constraints
  2. PLAN: System proposes a control point template, suggests which agents to
     prioritize, recommends a meeting cadence
  3. PO APPROVES: Confirms or adjusts the discovery plan
  4. EXECUTE: Discovery process begins with the agreed structure
```

This prevents the common failure where a PO just dumps documents and expects good output without the system understanding the context.

**More importantly** — apply this to how we build our agents. Each agent's behavior specification should go through:
1. Design the agent's responsibilities and constraints
2. Write anti-rationalization tables
3. Pressure-test with real scenarios
4. Iterate before coding

---

### 3.5 Skills as Testable Behavioral Code

**How Superpowers does it:**
Skills are developed using TDD methodology applied to documentation:
1. **RED**: Write pressure-test scenarios, run them without the skill — observe failures
2. **GREEN**: Write the skill, verify the agent now handles scenarios correctly
3. **REFACTOR**: Find new rationalizations the agent makes, close loopholes

The `writing-skills` meta-skill explicitly treats prompts as code that needs testing.

**How we can apply it:**

Our agent prompts/instructions should be treated the same way:

```
For each agent (e.g., Control Point Agent):
  1. Define test scenarios:
     - "Client says 'we'll probably use Azure' — should this be CONFIRMED or PARTIAL?"
     - "Two meetings mention hosting differently — should contradiction be flagged?"
     - "Control point has no relevant data at all — should it be MISSING or N/A?"

  2. Run scenarios WITHOUT specific instructions → observe agent failures

  3. Write the agent's system prompt to handle all scenarios correctly

  4. Run scenarios WITH instructions → verify compliance

  5. Find new edge cases → iterate
```

This gives us a **regression test suite for agent behavior** — invaluable when we update prompts or switch LLM providers.

---

### 3.6 Parallel Agent Dispatch

**How Superpowers does it:**
- Groups independent failures by domain
- Dispatches one agent per problem
- Each agent works in isolation (git worktree)
- Integration verification after all agents complete

**How we can apply it:**

When a PO uploads a new document, we can parallelize:

```
Document uploaded
  ├── [parallel] RAGFlow: Parse, chunk, embed
  ├── [parallel] Mem0: Extract facts, update fact store
  └── [parallel] Mem0: Extract entities, update graph

All complete →
  ├── [parallel] Control Point Agent: Re-evaluate all control points
  ├── [parallel] Analysis Agent: Check for contradictions with new facts
  └── [parallel] Gap Detection Agent: Update gap list

All complete →
  └── Orchestrator: Compose status update for PO dashboard
```

Current design (sequential pipeline) could be significantly faster with this pattern.

---

### 3.7 Context Management via Subagent Isolation

**How Superpowers does it:**
The controller never passes its session context to subagents. Instead, it extracts exactly what each subagent needs and constructs a focused prompt. This:
- Preserves the controller's context window for coordination
- Gives each worker clean, focused instructions
- Prevents context pollution between tasks

**How we can apply it:**

This directly addresses a challenge in our architecture. When the Analysis Agent processes Meeting 5 notes, it shouldn't carry the full context of Meetings 1-4 in its prompt. Instead:

```
Controller constructs Analysis Agent prompt:
  - The new document text (Meeting 5)
  - Relevant existing facts from Mem0 (only those that might contradict/update)
  - Specific instructions: "Compare these new statements against these existing facts"

NOT included:
  - Full chat history with PO
  - Previous analysis results
  - Unrelated facts from other domains
```

This keeps each agent focused and reduces LLM costs (smaller prompts = fewer tokens).

---

## 4. Patterns We Can Adopt Directly

### 4.1 Status Protocol

Standardize all agent responses:

```typescript
type AgentStatus =
  | 'DONE'                // Task completed successfully
  | 'DONE_WITH_CONCERNS'  // Completed but flagged issues
  | 'NEEDS_CONTEXT'       // Ambiguous data, needs PO clarification
  | 'BLOCKED'             // Cannot proceed (corrupt file, missing dependency)
  | 'PARTIAL'             // Some work done, remaining needs different approach

interface AgentResponse {
  status: AgentStatus;
  result: any;           // The actual output
  evidence: string[];    // What data was used
  concerns?: string[];   // Issues found
  questions?: string[];  // Questions for PO (if NEEDS_CONTEXT)
}
```

### 4.2 Agent Prompt Structure

Follow Superpowers' pattern for agent prompts:

```markdown
# Role
You are the [Agent Name] for the Discovery AI Assistant.

# Context
[Exactly what this agent needs to know — no more, no less]

# Task
[Specific task with measurable success criteria]

# Constraints
[Anti-rationalization table]
[Verification requirements]

# Output Format
[Exact format with required fields including evidence]

# Escalation
[When to report NEEDS_CONTEXT or BLOCKED instead of guessing]
```

### 4.3 The "Human Partner" Framing

Superpowers deliberately uses "your human partner" instead of "the user" — shaping the AI's relationship as collaborative, not servile.

For our agents: the PO is "your discovery partner." This framing encourages agents to push back when information is insufficient rather than producing low-confidence output silently.

---

## 5. What NOT to Adopt

| Superpowers pattern | Why we skip it |
|-------------------|---------------|
| Git worktrees for isolation | We don't do code; our isolation is per-project data boundaries |
| TDD (test-driven development) | Not applicable to document analysis; but the *discipline* of "verify before claiming" transfers |
| Code review protocol | Not applicable; but the *two-stage review* pattern (spec compliance → quality) maps to our Analysis → Control Point flow |
| Session-start hook bootstrap | Our agents are server-side, not CLI-based; we inject context differently |

---

## 6. Implementation Priority

Based on impact vs. effort for our Discovery AI Assistant:

| Priority | Pattern | Impact | Effort |
|----------|---------|--------|--------|
| **P0** | Anti-rationalization tables per agent | High — prevents silent failures in discovery | Low — prompt engineering |
| **P0** | Verification-before-completion | High — every claim needs evidence | Low — prompt engineering |
| **P1** | Status protocol (DONE/BLOCKED/NEEDS_CONTEXT) | High — enables automated orchestration | Medium — agent framework change |
| **P1** | Context isolation (focused prompts per agent) | High — reduces cost + improves quality | Medium — orchestration redesign |
| **P1** | Parallel agent dispatch | Medium — faster ingestion pipeline | Medium — orchestration change |
| **P2** | Brainstorming-first project setup | Medium — better discovery configuration | Medium — new workflow |
| **P2** | Skill TDD (regression tests for agent behavior) | High long-term — catches prompt regressions | High — test infrastructure |
| **P3** | Model tiering per agent | Medium — cost optimization | Low — configuration |

---

## 7. Key Takeaways

1. **Agent instructions are code, not prose.** Treat them with the same rigor — version, test, review. This is the single most transferable insight from Superpowers.

2. **Anti-rationalization is essential.** AI agents will find excuses to take shortcuts. In coding, tests catch this. In discovery, nothing catches it until development starts. We need explicit countermeasures.

3. **Verification-before-completion eliminates "confident but wrong."** Every agent claim must include evidence. This transforms our system from "AI that sounds right" to "AI that proves it's right."

4. **Context isolation improves both quality and cost.** Don't dump everything into every agent. Construct focused prompts with exactly what each agent needs.

5. **Parallel dispatch is free performance.** Our sequential ingestion pipeline can be parallelized at the orchestration layer without changing any agent logic.

6. **The subagent controller pattern** maps directly to our orchestration layer — a coordinator that dispatches specialized agents with focused tasks, collects results, and presents a unified view to the PO.

---

## 8. Deep Dive: The Secret Sauce — Exact Patterns from Source

### 8.1 Iron Laws (Non-Negotiable Gates)

Every discipline skill has exactly one Iron Law stated in ALL-CAPS. These are hard gates — no exceptions, no rationalizations:

| Skill | Iron Law |
|-------|----------|
| Verification | `NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE` |
| TDD | `NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST` |
| Debugging | `NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST` |
| Writing Skills | `NO SKILL WITHOUT A FAILING TEST FIRST` |
| Brainstorming | `Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it` |

### 8.2 Complete Anti-Rationalization Tables (from source)

**Verification-Before-Completion:**

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence does not equal evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter does not equal compiler |
| "Agent said success" | Verify independently |
| "I'm tired" | Exhaustion does not equal excuse |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |

**Test-Driven Development:**

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Tests after achieve same goals" | Tests-after = "what does this do?" Tests-first = "what should this do?" |
| "Already manually tested" | Ad-hoc ≠ systematic. No record, can't re-run. |
| "Deleting X hours is wasteful" | Sunk cost fallacy. Keeping unverified code is technical debt. |
| "Keep as reference, write tests first" | You'll adapt it. That's testing after. Delete means delete. |
| "Need to explore first" | Fine. Throw away exploration, start with TDD. |
| "Test hard = design unclear" | Listen to test. Hard to test = hard to use. |
| "TDD will slow me down" | TDD faster than debugging. |
| "Manual test faster" | Manual doesn't prove edge cases. |
| "Existing code has no tests" | You're improving it. Add tests. |

**Systematic Debugging:**

| Excuse | Reality |
|--------|---------|
| "Issue is simple, don't need process" | Simple issues have root causes too. Process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | First fix sets the pattern. Do it right from the start. |
| "I'll write test after confirming fix works" | Untested fixes don't stick. Test first proves it. |
| "Multiple fixes at once saves time" | Can't isolate what worked. Causes new bugs. |
| "Reference too long, I'll adapt the pattern" | Partial understanding guarantees bugs. Read it completely. |
| "I see the problem, let me fix it" | Seeing symptoms ≠ understanding root cause. |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question pattern, don't fix again. |

**Using Superpowers (bootstrap):**

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action wastes time. Skills prevent this. |

### 8.3 Subagent Prompt Templates (Exact Structure)

**Implementer Prompt Structure:**
1. Full task text pasted in (never reference a file)
2. Scene-setting context section
3. "Before You Begin" — explicit invitation to ask questions BEFORE starting
4. "Your Job" — implement, test (TDD), verify, commit, self-review, report
5. "Code Organization" — single responsibility, follow plan structure
6. "When You're in Over Your Head" — explicit permission to escalate:
   > "Bad work is worse than no work. You will not be penalized for escalating."
7. Self-review checklist: Completeness, Quality, Discipline, Testing
8. Report format: `DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`

**Escalation triggers (must stop and report NEEDS_CONTEXT):**
- "The task requires architectural decisions with multiple valid approaches"
- "You need to understand code beyond what was provided and can't find clarity"
- "You feel uncertain about whether your approach is correct"
- "You've been reading file after file trying to understand the system without progress"

**Spec Reviewer Prompt — Key anti-trust instruction:**
> "The implementer finished suspiciously quickly. Their report may be incomplete, inaccurate, or optimistic. You MUST verify everything independently."

Three verification axes:
1. Missing requirements — did they skip anything?
2. Extra/unneeded work — did they over-engineer?
3. Misunderstandings — did they solve the wrong problem?

### 8.4 Verification Gate (5-Step Protocol)

```
1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
5. ONLY THEN: Make the claim

"Skip any step = lying, not verifying"
```

**Verification requirements per claim type:**

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, "logs look good" |
| Bug fixed | Test original symptom: passes | "Code changed, assumed fixed" |
| Requirements met | Line-by-line checklist | Tests passing |
| Agent completed | VCS diff shows changes | Agent reports "success" |

### 8.5 Brainstorming 9-Step Checklist (Mandatory, In Order)

1. Explore project context
2. Offer visual companion (must be its OWN message)
3. Ask clarifying questions — ONE at a time
4. Propose 2-3 approaches with trade-offs and recommendation
5. Present design in sections, get approval after each
6. Write design doc to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
7. Spec self-review (placeholders, contradictions, ambiguity, scope)
8. User reviews written spec
9. Transition to implementation — invoke writing-plans skill ONLY

Anti-pattern callout: "This Is Too Simple To Need A Design" →
> "Simple projects are where unexamined assumptions cause the most wasted work."

### 8.6 Plan Document Requirements

Each task step must include:
- Takes 2-5 minutes (write test → verify failure → implement → verify pass → commit)
- Complete code blocks (never placeholders)
- Exact file paths
- Actual test commands with expected results
- No "TBD," "add validation," "similar to Task N," or incomplete references

### 8.7 Debugging 3-Strike Escalation Rule

```
Fix attempt 1 fails → return to Phase 1 (root cause)
Fix attempt 2 fails → return to Phase 1 (root cause)
Fix attempt 3 fails → STOP. This is NOT a failed hypothesis.
                       This is a WRONG ARCHITECTURE.
                       Discuss with your human partner before more fixes.
```

### 8.8 Claude Search Optimization (CSO)

Critical discovery for anyone building AI instruction systems:

- Skill descriptions must contain ONLY triggering conditions ("Use when...")
- NEVER summarize the workflow in the description
- **Why:** Testing revealed that when a description summarizes a skill's workflow, Claude follows the description summary instead of reading the full skill content
- Example: Description saying "code review between tasks" caused Claude to do ONE review, even though the full skill specified TWO reviews (spec + quality)

### 8.9 Cross-Cutting Meta-Patterns

| # | Pattern | Description |
|---|---------|-------------|
| 1 | **Anti-Rationalization Tables** | Map specific excuses to rebuttals. Derived from observed agent behavior. |
| 2 | **Iron Laws** | One non-negotiable gate per discipline skill, ALL-CAPS. |
| 3 | **Red Flags Lists** | Thought patterns that mean "STOP." |
| 4 | **Spirit-over-Letter Clause** | "Violating the letter of the rules IS violating the spirit." Preemptively cuts off the "I'm following the spirit" rationalization. |
| 5 | **Escalation Protocols** | Every skill defines when to stop. "Bad work is worse than no work." |
| 6 | **Evidence-before-Claims** | No success claim without command output in current message. |
| 7 | **TDD for Everything** | Code follows TDD. Skills follow TDD (pressure scenarios as tests). Recursively. |
| 8 | **Subagent Context Isolation** | Never inherit session context. Construct focused prompts. |
| 9 | **Two-Stage Review** | Spec compliance FIRST, THEN code quality. Never reverse. |
| 10 | **CSO** | Descriptions = triggers only, never workflow summaries. |

### 8.10 Contributor Guidelines (94% PR Rejection Rate)

The AGENTS.md file is itself a masterclass in instructing AI:

5 mandatory pre-PR checks:
1. Read entire PR template, fill every section with real answers
2. Search open AND closed PRs for duplicates
3. Verify this is a real problem (not speculative)
4. Confirm change belongs in core (not domain-specific)
5. Show human partner complete diff, get explicit approval

What won't be accepted: third-party dependencies, "compliance" rewording without eval evidence, bulk/spray-and-pray PRs, speculative fixes, domain-specific skills, fabricated content.

---

## 9. Comparison with Previous Research

| Pattern | OpenClaw (Research 13) | Superpowers (This) | Our Architecture |
|---------|----------------------|--------------------|-----------------|
| Search | Hybrid vector+BM25, MMR reranking | N/A (not a search tool) | RAGFlow handles this |
| Memory | Session-based context assembly | Context isolation per subagent | Mem0 fact store + graph |
| Agent orchestration | Single assistant, tool-based | Multi-agent with controller + workers | 7 specialized agents |
| Quality assurance | N/A | Anti-rationalization + verification | **Should adopt from Superpowers** |
| Prompt engineering | Dynamic system prompts | Skills as testable behavioral code | **Should adopt from Superpowers** |
| Parallel processing | N/A | Parallel agent dispatch | **Should adopt from Superpowers** |

**Superpowers fills the gap that OpenClaw left:** OpenClaw gave us search and memory patterns. Superpowers gives us **agent discipline, quality assurance, and orchestration patterns**. Together with our RAGFlow + Mem0 architecture decision, these form a complete picture.
