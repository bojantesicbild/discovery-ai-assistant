# 13 — Open-Source Tools Research

> **Date:** 2026-03-24
> **Purpose:** Extract patterns and approaches from open-source tools applicable to our Discovery AI Assistant
>
> **Tools Researched:**
> - [OpenClaw](https://github.com/openclaw/openclaw) — Self-hosted AI assistant (skills, search, agents)
> - [AutoResearch](https://github.com/karpathy/autoresearch) — Karpathy's autonomous experiment loop
> - Self-Improving Skills — Pattern for autonomous prompt/agent optimization

---

# Part 1: OpenClaw

## 1. What Is OpenClaw?

OpenClaw is a **self-hosted, personal AI assistant** (TypeScript monorepo, 333K+ stars, MIT licensed). It connects to 20+ messaging platforms (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, etc.) with multi-model support (OpenAI, Anthropic, Gemini, Ollama).

It is **not** a discovery or legal tool — but its internal subsystems (search, memory, context assembly, media processing, security) contain production-grade patterns directly relevant to our work.

---

## 2. Key Patterns Discovered

### 2.1 Hybrid Search (Vector + BM25)

**How it works:**
- Dual-backend search: vector cosine similarity (sqlite-vec) + BM25 full-text search
- Results combined with configurable weights:
  ```
  score = vectorWeight * vectorScore + textWeight * textScore
  ```
- Allows tuning per query type — semantic queries lean on vector, exact-term queries lean on BM25

**Why it matters:**
Hybrid search consistently outperforms either approach alone. Legal/business documents contain both conceptual ideas (need semantic search) and precise terms like names, dates, amounts (need keyword search).

---

### 2.2 MMR (Maximal Marginal Relevance) Re-ranking

**How it works:**
```
MMR = λ * relevance - (1-λ) * max_similarity_to_selected
```
- Uses Jaccard similarity on tokenized text to measure redundancy between results
- Default λ=0.7 (slight relevance bias over diversity)
- Applied after initial retrieval, before presenting results

**Why it matters:**
Discovery documents are repetitive — the same topic discussed across multiple meetings, emails referencing the same spec. Without MMR, top-10 results can all say essentially the same thing.

---

### 2.3 Temporal Decay with Evergreen Exemptions

**How it works:**
```
multiplier = e^(-ln(2) / halfLifeDays * ageDays)
```
- Recent content scores higher than old content
- "Evergreen" content (foundational docs, contracts) bypasses decay entirely
- Half-life is configurable per use case

**Why it matters:**
In discovery, the client's latest statement overrides earlier ones. A meeting from yesterday is more relevant than one from 3 months ago — unless it's a signed contract or requirements doc that remains authoritative.

---

### 2.4 Query Expansion

**How it works:**
- Multilingual stop-word removal (7 languages)
- Language-specific tokenization (handles CJK scripts)
- Optional LLM-powered semantic expansion with local fallback
- Converts natural language queries into multiple search terms

**Why it matters:**
POs and clients use different terminology. A PO might search "login flow" while the client called it "authentication process" in the meeting. Query expansion bridges this gap.

---

### 2.5 Context Engine (Registry-Based Prompt Assembly)

**How it works:**
- Multiple sources register as context builders (memory, session, plugins, retrieved docs)
- System assembles them into a coherent prompt with compaction
- Each source contributes its section independently
- Compaction ensures the prompt stays within token limits

**Why it matters:**
Our agents need to combine: retrieved doc chunks + extracted facts + entity relationships + control point status + user instructions. A registry-based approach keeps this modular and maintainable.

---

### 2.6 Media Understanding Pipeline

**How it works:**
- MIME type detection with binary filtering
- Routes to appropriate processor: PDF → text extraction, audio → transcription, image → multimodal model
- Provider registry pattern — swap processors without changing pipeline
- Content wraps into formatted blocks injected into agent context

**Why it matters:**
Discovery ingests PDFs, scanned documents, audio recordings of meetings, screenshots of whiteboards. A provider-based pipeline handles the variety without monolithic code.

---

### 2.7 Tiered Security & Audit Model

**How it works:**
- Multi-severity audit: critical / warn / info
- Exec trust levels: deny → sandboxed → full
- Filesystem permission checks, channel allowlists
- Tool policy evaluation before execution
- Deep audit mode scans plugin code for risky patterns

**Why it matters:**
Discovery data is sensitive — client NDAs, business plans, financial info. A layered security model ensures agents can't leak data across projects or expose privileged information.

---

## 3. How These Patterns Fit Our Discovery Assistant

### 3.1 Hybrid Search → Enhancing Our RAGFlow Layer (Layer 1: SEARCH)

**Current state:** RAGFlow already supports hybrid search (vector + keyword). This validates our architecture choice.

**What OpenClaw adds:**
- **Configurable weight ratios per query type.** We should implement query-type detection: when an agent searches for "meeting where John discussed the API timeline" → lean vector. When it searches for "NDA signed 2026-01-15" → lean keyword. This adaptive weighting is something we haven't designed yet.
- **Implementation pattern:** A simple query classifier (rule-based or LLM) that sets `vectorWeight` and `textWeight` before each search call.

**Recommendation:** Add adaptive search weighting to our Query Router design. Low effort, high impact.

---

### 3.2 MMR Re-ranking → Result Quality for All Agents

**Current state:** We have reranking planned as a "Should Have" technique (cross-encoder rescoring). MMR is a different, complementary technique.

**What OpenClaw adds:**
- MMR is about **diversity**, not relevance — it's applied after reranking
- Especially valuable for our Gap Detection Agent and Document Generator Agent, which pull from many documents that may overlap heavily

**Recommendation:** Add MMR as a post-reranking step in our retrieval pipeline. The algorithm is simple (Jaccard + greedy selection), can be implemented in <100 lines of Python. Stack it: retrieve → rerank (cross-encoder) → MMR (diversity filter).

---

### 3.3 Temporal Decay → Contradiction Resolution & Freshness

**Current state:** Our Fact Store (Mem0, Layer 2) tracks fact lifecycle and timestamps. But our search layer (RAGFlow, Layer 1) doesn't inherently prefer recent content.

**What OpenClaw adds:**
- Apply temporal decay at the **search scoring level**, not just at the fact management level
- The "evergreen exemption" pattern maps perfectly: contracts, signed specs, requirements docs = evergreen. Meeting notes, emails, chat logs = decaying.

**How it fits:**
- Tag documents at ingestion with `evergreen: true/false` based on document type
- Apply decay multiplier during search scoring: `final_score = relevance_score * temporal_multiplier`
- Our document type classification (12 templates) already gives us the metadata to decide what's evergreen

**Recommendation:** Implement temporal decay in our search scoring. This directly helps contradiction resolution — when two chunks contradict, the more recent one naturally surfaces higher. Complements our Fact Store lifecycle tracking.

---

### 3.4 Query Expansion → Bridging PO/Client Terminology

**Current state:** We have query transformation planned as a "Nice to Have" (multi-query approach).

**What OpenClaw adds:**
- A practical, layered implementation: stop-word removal → keyword extraction → LLM expansion → fallback
- The LLM expansion step generates synonym/rephrased queries that capture different ways people express the same concept

**How it fits:**
- Our Gap Detection Agent asks questions like "What authentication method will be used?" — the client might have said "login with Google" or "OAuth" or "SSO" in different meetings
- Query expansion turns one query into 3-4 variants, dramatically improving recall

**Recommendation:** Promote query expansion from "Nice to Have" to "Should Have." Implement the layered approach: rule-based first (fast, cheap), LLM expansion for complex queries (slower, better). This is especially important for our Meeting Prep Agent which needs to find ALL relevant context.

---

### 3.5 Context Engine → Agent Prompt Assembly

**Current state:** Our agents each assemble their own prompts by querying the three knowledge layers through the Query Router.

**What OpenClaw adds:**
- A **registry pattern** where context sources are modular and independently managed
- Compaction logic that intelligently trims when approaching token limits
- Each agent gets a dynamically assembled prompt without knowing the details of each source

**How it fits:**
- Our agents need context from: RAGFlow chunks + Mem0 facts + Neo4j relationships + control point status + project settings + conversation history
- Instead of each agent hardcoding how to gather and format this, a Context Engine assembles it
- Compaction is critical — our Document Generator Agent might need context from 50+ documents

**Recommendation:** Design a Context Engine service between our Query Router and agents. This is an architectural improvement worth implementing in MVP — it will make adding new agents and context sources much easier.

---

### 3.6 Media Pipeline → Document Ingestion

**Current state:** RAGFlow handles document parsing (DeepDoc: OCR, table recognition, layout analysis).

**What OpenClaw adds:**
- The **provider registry pattern** for media processing — each format has a registered processor, new formats are added without changing the pipeline
- Audio/video processing (meeting recordings → transcription → text)

**How it fits:**
- RAGFlow handles PDFs, images, tables well — we don't need to rebuild this
- But meeting recordings (audio/video) are a gap. OpenClaw's pattern of routing to transcription providers (Deepgram, Whisper) is relevant
- We should plan audio ingestion as a future feature using this pattern

**Recommendation:** Keep RAGFlow as our primary document processor. Add audio/video transcription as a plugin using OpenClaw's provider registry pattern in a later phase.

---

### 3.7 Security Model → Per-Project Isolation

**Current state:** We plan per-project isolation in Mem0 and RAGFlow.

**What OpenClaw adds:**
- Multi-layer audit trail — every action logged with severity
- Tool policy evaluation before execution (can this agent do this action?)
- The concept of "trust levels" for different operations

**How it fits:**
- Our agents operate on sensitive client data — we need audit trails for who accessed what
- Trust levels map to our agent roles: Intake Agent has write access, Gap Detection Agent has read-only access to docs
- Audit trail is important for enterprise clients who need to prove data handling compliance

**Recommendation:** Implement basic audit logging from day one (agent, action, project, timestamp). Add trust levels per agent type. This is not MVP-blocking but should be in the architecture from the start.

---

## 4. Comparison: OpenClaw's Approach vs. Our Three-Layer Architecture

### What OpenClaw Does (Single-Layer RAG)

OpenClaw uses a **single memory/search layer** that combines:
- Vector embeddings + BM25 in sqlite-vec
- File-based memory indexed and chunked
- MMR for diversity
- Temporal decay for freshness
- Query expansion for recall

This is a solid general-purpose RAG system optimized for a personal assistant.

### What We Do (Three-Layer Architecture)

| Layer | Tool | Purpose |
|-------|------|---------|
| SEARCH | RAGFlow | Full document retrieval with deep parsing |
| KNOW | Mem0 | Extracted facts with lifecycle, deduplication, versioning |
| CONNECT | Mem0 + Neo4j | Entity relationships and graph traversal |

### Verdict: Our Approach Is Better for Discovery — Here's Why

**OpenClaw's single-layer approach would break down for us because:**

1. **No fact lifecycle.** OpenClaw's memory is flat — a fact is either there or not. We need: `new → discussed → confirmed → changed`. Without this, our Control Point Agent can't distinguish "client mentioned it once casually" from "client formally confirmed this requirement." This distinction is the core of our readiness scoring.

2. **No deduplication with source tracking.** If the same requirement appears in 5 meetings, OpenClaw stores 5 chunks. We store one fact with 5 source references. This is critical for contradiction detection — we need to know when source A says X and source B says Y about the same fact.

3. **No relationship graph.** OpenClaw can find "John mentioned the API" but can't answer "Who has decision authority over the API design, and what depends on it?" Our Neo4j layer handles this natively with graph traversal.

4. **Control points need structured data.** Our readiness scoring checks: "Does a confirmed fact exist for requirement X?" This is a structured query against Mem0, not a semantic search. OpenClaw's search-only approach would require the LLM to interpret search results and guess — which makes readiness probabilistic instead of deterministic.

### But — OpenClaw's Search Techniques Should Enhance Our Layer 1

Our Layer 1 (RAGFlow) handles the same job as OpenClaw's search system — retrieving relevant document chunks. The techniques OpenClaw applies at this layer are directly valuable:

| Technique | OpenClaw Has It | We Have It | Should We Add It? |
|-----------|----------------|------------|-------------------|
| Hybrid search (vector + BM25) | Yes | Yes (RAGFlow) | Already covered |
| MMR re-ranking | Yes | No | **Yes — high value** |
| Temporal decay | Yes | No (only in Mem0) | **Yes — add to search scoring** |
| Query expansion | Yes | Planned (Nice to Have) | **Yes — promote to Should Have** |
| Adaptive search weights | Yes | No | **Yes — add to Query Router** |
| Context engine / compaction | Yes | No (agents assemble own) | **Yes — add as service** |

### Bottom Line

> **Keep our three-layer architecture. Adopt OpenClaw's search-layer techniques to make Layer 1 significantly better.**
>
> Our architecture solves problems that OpenClaw's approach cannot (fact lifecycle, deduplication, graph queries, deterministic readiness). But OpenClaw's search engineering is more mature than what we've designed — MMR, temporal decay, adaptive weights, and query expansion should all be incorporated into our retrieval pipeline.

---

## 5. Concrete Action Items

### High Priority (incorporate into MVP design)
1. **Add MMR re-ranking** to retrieval pipeline (retrieve → rerank → MMR)
2. **Add temporal decay** to search scoring with evergreen document exemptions
3. **Design Context Engine** as a service between Query Router and agents

### Medium Priority (Should Have, early post-MVP)
4. **Promote query expansion** from Nice to Have → Should Have
5. **Add adaptive search weighting** to Query Router (detect query type → set weights)
6. **Implement basic audit logging** for agent actions (agent, action, project, timestamp)

### Low Priority (future enhancement)
7. **Audio/video transcription** pipeline using provider registry pattern
8. **Trust levels per agent type** for security model
9. **Plugin architecture** for adding new document processors without code changes

---

## 6. Key Takeaway

OpenClaw validates that hybrid search + intelligent post-processing (MMR, decay, expansion) is the production standard for RAG systems. Our three-layer architecture is the right call for discovery-specific needs, but we should bring our search layer up to OpenClaw's level of sophistication. The gap is not in architecture — it's in search engineering details that meaningfully improve result quality.

---
---

# Part 2: OpenClaw Skill & Agent Architecture

> **Source:** [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) — `skills/`, `src/agents/`, `src/plugins/`

## 7. How OpenClaw Defines Skills

Skills follow the **AgentSkills spec** (agentskills.io-compatible). Each skill is a directory with a `SKILL.md` file:

```
skill-name/
  SKILL.md          ← YAML frontmatter + instructions (required)
  scripts/          ← executable code (optional)
  references/       ← docs loaded on-demand (optional)
  assets/           ← files used in output, not loaded into context (optional)
```

**SKILL.md frontmatter** (only `name` and `description` are required):
```yaml
---
name: weather
description: "Get current weather for a location"
metadata:
  openclaw:
    emoji: "🌤️"
    requires:
      bins: ["curl"]
    install:
      - kind: brew
        package: curl
    os: ["darwin", "linux"]
    always: false
user-invocable: true
---

[Full skill instructions in markdown body...]
```

### Progressive Disclosure Pattern

This is the key architectural insight — **three-stage loading**:

| Stage | What's loaded | When | Token cost |
|-------|--------------|------|------------|
| **1. Metadata** | `name` + `description` only | Always in system prompt | ~20 tokens per skill |
| **2. Full instructions** | `SKILL.md` body | Only when agent decides to use this skill | Hundreds to thousands |
| **3. Resources** | `references/`, `scripts/` | Only when needed during execution | On demand |

**Limits:** Max 150 skills in prompt, max 30K chars total, max 256KB per skill file.

**Why this matters:** With 50+ skills, you can't put everything in the system prompt. Progressive disclosure keeps the prompt lean while still giving the agent awareness of all available capabilities.

## 8. How Agents Are Created & Configured

Agents are defined in `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "list": [
      {
        "id": "coding",
        "name": "Coding Agent",
        "default": false,
        "workspace": "~/workspaces/coding",
        "model": { "primary": "claude-sonnet-4-6" },
        "skills": ["coding-agent", "github", "git-*"],
        "subagents": {
          "model": "claude-haiku-4-5-20251001",
          "thinkingLevel": "medium",
          "timeout": 300000
        },
        "sandbox": { "enabled": true }
      }
    ]
  }
}
```

Each agent gets:
- **Isolated workspace** with its own `SOUL.md`, `AGENTS.md`, `USER.md`
- **Filtered skills** — only sees skills matching its filter
- **Own session store** and auth profiles
- **Model configuration** — different agents can use different models
- **Trust levels** — from deny to full execution access

## 9. Sub-Agent Spawning & Orchestration

**Multi-agent routing:** Multiple isolated agents run in one Gateway process. Messages are routed via **8-tier binding resolution** (peer → guild+roles → team → account → channel → default).

**Sub-agent spawning:** A running agent can spawn sub-agents:

```
Parent Agent
  ├── calls sessions_spawn(task, model, timeout)
  ├── Sub-agent runs in isolated session
  ├── Sub-agent completes work
  └── Results announced back to parent (push-based, no polling)
```

- **One-shot mode** (`run`) — execute task, return result, terminate
- **Persistent mode** (`session`) — stays alive with thread binding
- Configurable nesting depth, model overrides, timeouts
- Sub-agents get minimal system prompts (reduced context)
- Sub-agents do NOT get session tools by default (isolation)

## 10. Skill Marketplace (ClawHub)

- **Vector-based search** for discovering skills (not just keywords)
- **Semver versioning** with changelogs
- **Content hashing** to detect local modifications vs. registry versions
- **Moderation:** 3+ unique reports auto-hide a skill
- **Security gate:** GitHub account must be ≥1 week old to publish
- **Skill-creator meta-skill** — the AI itself guides you through building new skills

## 11. How This Fits Our Discovery Assistant

### 11.1 Markdown-Driven Agent Definitions

**Current state:** Our 7 agents will have prompts defined somewhere in our Python codebase.

**What OpenClaw teaches us:**
Define each agent as an `AGENT.md` file with frontmatter:

```yaml
---
name: gap-detection
description: "Identifies missing information in discovery projects"
requires_layers: [SEARCH, KNOW]
tools: [query_router, fact_store]
trust_level: read-only
---

[Full agent instructions...]
```

**Benefits:**
- POs or team leads can customize agent behavior without touching Python
- Agent instructions are version-controlled and diffable
- New agents can be added by creating a new markdown file
- Progressive disclosure keeps orchestration prompt lightweight

### 11.2 Progressive Context Loading for Our Query Router

**Current state:** Not yet designed how the orchestrator decides which agent to activate.

**What OpenClaw teaches us:**
- Keep only agent `name` + `description` in the orchestrator prompt (~20 tokens each)
- When a user message matches, load the full `AGENT.md` instructions
- When the agent needs tools/references, load those on demand

**For 7 agents:** ~140 tokens always in context vs. potentially thousands if we loaded everything.
**For future 20+ agents:** This pattern becomes essential.

### 11.3 Custom Skills for POs

**What OpenClaw teaches us:**
POs could create project-specific skills without code:

```yaml
---
name: compliance-check
description: "Check project against GDPR compliance requirements"
requires_layers: [KNOW]
---

Query the Fact Store for these specific items:
1. Data processing agreement status
2. User consent mechanism defined
3. Data retention policy specified
...
```

This turns our system from "7 fixed agents" into "7 core agents + unlimited custom skills."

### 11.4 Sub-Agent Pattern for Parallel Analysis

**Current state:** Our Analysis Agent processes documents sequentially after ingestion.

**What OpenClaw teaches us:**
When a batch of 10 documents arrives:
1. Analysis Agent spawns 10 sub-agents (one per document)
2. Each sub-agent runs in parallel with a focused task
3. Results announce back to parent
4. Parent synthesizes findings

**Benefits:** 10x faster batch processing, each sub-agent has smaller context (one doc vs. ten), failures in one don't block others.

### 11.5 Skill Discovery for Agent Templates

**What OpenClaw teaches us (ClawHub pattern):**
- Bild Studio could maintain a registry of agent/skill templates
- When starting a new discovery project, browse available templates
- "Greenfield Web App" template → pre-loaded control points + customized agents
- Teams share successful custom skills across projects

---
---

# Part 3: Karpathy's AutoResearch

> **Source:** [github.com/karpathy/autoresearch](https://github.com/karpathy/autoresearch)
> **Context:** [Self-Improving Claude Code Skills (Shubh Jain)](https://medium.com/@shubhjain191/how-to-make-your-claude-code-skills-self-improving-using-auto-research-803ff97d5483)

## 12. What Is AutoResearch?

An autonomous AI experiment loop by Andrej Karpathy. The AI agent modifies code, runs an experiment, measures the result, keeps improvements, reverts failures — and repeats forever. Karpathy ran **700+ experiments in 2 days**, finding 20 optimizations for 11% training speedup.

The key insight: **"You're not touching Python files like you normally would. Instead, you are programming the `program.md` Markdown files that provide context to the AI agents."**

## 13. Architecture — Radical Simplicity (3 Files)

| File | Role | Who edits it |
|------|------|-------------|
| `program.md` | Agent instructions: experiment protocol, constraints, logging format | **Human** (the "research strategy") |
| `train.py` | The experiment code — model, optimizer, hyperparameters | **AI agent** (the "editable asset") |
| `prepare.py` | Fixed infrastructure: data loading, evaluation, metrics | **Nobody** (read-only, prevents gaming) |

Supporting:
- `results.tsv` — append-only experiment log (commit, score, status, description)
- `analysis.ipynb` — post-hoc visualization of progress

## 14. The Experiment Loop

```
┌─────────────────────────────────────────────┐
│  1. Read current code + results.tsv         │
│  2. Generate hypothesis                     │
│  3. Modify train.py                         │
│  4. git commit                              │
│  5. Run experiment (fixed 5-min budget)     │
│  6. Extract metric (val_bpb)                │
│  7. If improved → keep commit               │
│     If worse   → git reset                  │
│  8. Log to results.tsv                      │
│  9. GOTO 1 (never stop)                     │
└─────────────────────────────────────────────┘
```

**~12 experiments/hour, ~100 overnight.**

### Critical Design Rules

| Rule | Why |
|------|-----|
| **Never stop** | Agent doesn't ask permission, keeps going indefinitely |
| **Single scalar metric** | One number decides success — no ambiguity |
| **Fixed time budget** | Every experiment gets same resources — fair comparison |
| **Simplicity criterion** | Reject improvements that add ugly complexity |
| **Git as state machine** | Branch tip = best known state, failures get `git reset` |
| **Output to file, not context** | `> run.log 2>&1`, only grep key metrics — protects context window |
| **Crash resilience** | Read stack trace, attempt fix or skip — never get stuck |

## 15. Self-Improving Skills (The Shubh Jain Extension)

Applies the Karpathy loop to **prompt/skill optimization** instead of ML code:

- Skills start at **~40-50% pass rate** on structured test cases
- Through overnight auto-iteration → reach **75-85%**
- Cost: **~$1.50-$4.50** for an overnight run

### The 8-Phase Cycle

```
Review → Plan → Modify → Commit → Verify → Evaluate → Decide → Log
```

### Binary Eval Assertions (The Key Innovation)

Instead of subjective LLM scoring, use **deterministic yes/no checks**:

```python
# Example assertions for a customer support response skill
def assert_contains_empathy(response):
    return any(phrase in response for phrase in EMPATHY_PHRASES)

def assert_under_word_limit(response):
    return len(response.split()) <= 200

def assert_has_next_steps(response):
    return "next step" in response.lower() or "action item" in response.lower()

# Pass rate = % of test cases where ALL assertions return True
```

### Three Primitives

| Primitive | Definition | Example |
|-----------|-----------|---------|
| **Editable asset** | The single file the agent can modify | The skill prompt / agent instructions |
| **Scalar metric** | The single number determining success | Pass rate on test cases |
| **Time-boxed cycle** | Fixed duration per experiment | 5-15 minutes per cycle |

### The Reflect System (Complementary Pattern)

From [claude-reflect-system](https://github.com/haddock-development/claude-reflect-system) — instead of metric-driven, it learns from **human corrections**:
- User says "use uv instead of pip"
- System classifies correction by confidence
- Updates skill files with timestamped backups
- The mistake never recurs — **"correct once, never again"**

## 16. How AutoResearch Fits Our Discovery Assistant

### 16.1 Self-Improving Agent Prompts

**The idea:** Treat each of our 7 agent prompts as an **editable asset** and define binary assertions for each.

| Agent | Editable Asset | Scalar Metric | Example Assertions |
|-------|---------------|---------------|-------------------|
| **Gap Detection** | `gap-detection-agent.md` | % of known gaps correctly identified | Found ≥3 of 5 planted gaps? Prioritized correctly? No false positives? |
| **Meeting Prep** | `meeting-prep-agent.md` | % of agendas covering top-priority items | Covers #1 gap? Under 10 agenda items? Includes context summary? |
| **Document Generator** | `doc-generator-agent.md` | % of facts correctly attributed | All facts have sources? No hallucinated facts? Follows template? |
| **Control Point** | `control-point-agent.md` | % of evaluations matching ground truth | Correct status (✅/⚠️/❌) on 20 test items? No false ✅? |
| **Analysis** | `analysis-agent.md` | % of contradictions/entities found | Found planted contradiction? Extracted key entities? |
| **Intake** | `intake-agent.md` | % of documents correctly classified | Right doc type? Right metadata? Triggered right pipeline? |
| **Role Simulation** | `role-sim-agent.md` | % of perspectives providing unique insights | Dev perspective mentions tech debt? QA mentions edge cases? |

**The workflow:**
1. Create 5-10 test projects with known ground truth (planted gaps, contradictions, entities)
2. Define binary assertions for each agent
3. Run the Karpathy loop overnight per agent
4. Agents improve their own prompts against real test data
5. Human reviews changes in the morning, cherry-picks improvements

**Cost estimate:** 7 agents × $3/night = ~$21 for one round of optimization across all agents.

### 16.2 Self-Improving Control Point Templates

**The idea:** Our control point templates (Greenfield Web App, API Integration, etc.) are checklists. Some items may be too vague, too specific, or missing entirely.

**Editable asset:** The control point template (list of items + evaluation criteria)
**Scalar metric:** On 10 test projects, % of items where the template correctly identifies readiness status
**Binary assertions:**
- Did it flag the missing API auth requirement? (known gap)
- Did it NOT flag the clearly-covered database schema? (no false negatives)
- Did it mark "discussed but not confirmed" as ⚠️ partial, not ✅ covered?

**The loop optimizes:** Which items to include, how to phrase evaluation criteria, what evidence to look for.

### 16.3 Self-Improving Query Strategies

**The idea:** Our Query Router decides search parameters (vector vs. keyword weight, which layers to query, how many results). These can be optimized.

**Editable asset:** Query Router configuration / routing rules
**Scalar metric:** Relevance of retrieved results (measured by: does the retrieved context contain the information needed to answer the question?)
**Binary assertions:**
- Top-5 results contain the relevant passage? (recall)
- No duplicate/redundant results in top-5? (diversity)
- Results from the correct time period? (temporal accuracy)

### 16.4 The "Correct Once, Never Again" Pattern

**The idea:** When a PO corrects an agent's behavior ("don't list assumptions as confirmed facts"), the correction is captured and permanently integrated.

**How it works for us:**
1. PO flags an agent error in the UI
2. System classifies the correction (fact accuracy? formatting? missing context?)
3. Correction is added to the agent's instructions as a rule
4. Binary assertion is auto-generated to prevent recurrence
5. Next Karpathy loop run includes the new assertion

**This creates a flywheel:** Human corrections → new assertions → overnight optimization → better agents → fewer corrections needed.

### 16.5 The "Program, Don't Code" Paradigm

**The paradigm shift for our project:**

| Traditional | AutoResearch Pattern |
|-------------|---------------------|
| Agent behavior defined in Python code | Agent behavior defined in `AGENT.md` markdown |
| Prompt improvements require developer | PO or team lead edits markdown |
| Quality is subjective ("does this feel right?") | Quality is measured (pass rate on assertions) |
| Improvement is manual and sporadic | Improvement is autonomous and continuous |
| No record of what was tried | Git history = complete experiment log |

**For our discovery assistant specifically:**
- Define agent strategies in markdown (combine with OpenClaw's skill pattern)
- Define evaluation as binary assertions (deterministic, not vibes)
- Let the Karpathy loop run overnight after each major agent change
- Git history of agent prompts becomes a research log of what works

---
---

# Part 4: Combined Architecture Vision

## 17. How All Three Patterns Combine

```
┌─────────────────────────────────────────────────────────────────┐
│                    DISCOVERY AI ASSISTANT                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  AGENT LAYER (OpenClaw Pattern)                          │   │
│  │                                                          │   │
│  │  AGENT.md files with progressive disclosure:             │   │
│  │  ├── gap-detection.md                                    │   │
│  │  ├── meeting-prep.md                                     │   │
│  │  ├── document-generator.md                               │   │
│  │  ├── control-point.md                                    │   │
│  │  ├── analysis.md                                         │   │
│  │  ├── intake.md                                           │   │
│  │  ├── role-simulation.md                                  │   │
│  │  └── custom-skills/ (PO-created)                         │   │
│  │                                                          │   │
│  │  Sub-agent spawning for parallel document analysis       │   │
│  │  Skill registry for cross-project template sharing       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                      │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  CONTEXT ENGINE (OpenClaw Pattern)                       │   │
│  │                                                          │   │
│  │  Registry-based prompt assembly with compaction          │   │
│  │  Sources: RAGFlow + Mem0 + Neo4j + control points +     │   │
│  │           project settings + conversation history        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                      │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  SEARCH LAYER (OpenClaw Techniques on RAGFlow)           │   │
│  │                                                          │   │
│  │  Hybrid search (vector + BM25) with adaptive weights     │   │
│  │  → Cross-encoder reranking                               │   │
│  │  → MMR diversity filter                                  │   │
│  │  → Temporal decay with evergreen exemptions              │   │
│  │  → Query expansion (rule-based + LLM)                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                      │
│                          ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  THREE KNOWLEDGE LAYERS (Our Architecture)               │   │
│  │                                                          │   │
│  │  Layer 1: SEARCH  → RAGFlow (documents, chunks)          │   │
│  │  Layer 2: KNOW    → Mem0 (facts, lifecycle, versions)    │   │
│  │  Layer 3: CONNECT → Neo4j (entities, relationships)      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  SELF-IMPROVEMENT LOOP (AutoResearch Pattern)            │   │
│  │                                                          │   │
│  │  Runs overnight / on-demand:                             │   │
│  │  1. Agent prompts optimized against test projects        │   │
│  │  2. Control point templates optimized against ground     │   │
│  │     truth                                                │   │
│  │  3. Query strategies optimized for retrieval relevance   │   │
│  │  4. Human corrections → new assertions → auto-optimize   │   │
│  │                                                          │   │
│  │  Editable asset: AGENT.md files                          │   │
│  │  Scalar metric: pass rate on binary assertions           │   │
│  │  State machine: git branches, keep/revert                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 18. What Each Tool Contributes

| Source | What We Take | What We Skip |
|--------|-------------|-------------|
| **OpenClaw** | Hybrid search techniques (MMR, temporal decay, query expansion), progressive disclosure for skills, context engine pattern, sub-agent spawning, security audit model | Messaging platform integration, single-layer RAG, ClawHub marketplace (not needed yet) |
| **AutoResearch** | Autonomous experiment loop, keep/revert on git, single scalar metric, binary assertions, "never stop" autonomy, simplicity criterion | ML training specifics, MuonAdamW optimizer, GPT architecture details |
| **Self-Improving Skills** | 8-phase optimization cycle, binary eval assertions, overnight prompt tuning, correction flywheel, "program don't code" paradigm | Claude Code-specific skill format (we use our own AGENT.md format) |

## 19. Implementation Priority

### Phase 1: MVP (build the foundation)
- AGENT.md format for all 7 agents (OpenClaw skill pattern)
- Context Engine between Query Router and agents (OpenClaw pattern)
- MMR + temporal decay in search layer (OpenClaw techniques)
- Basic audit logging (OpenClaw security pattern)

### Phase 2: Early Post-MVP (make it better)
- Query expansion in retrieval pipeline (OpenClaw technique)
- Adaptive search weighting (OpenClaw technique)
- Sub-agent spawning for parallel analysis (OpenClaw pattern)
- Create 5-10 test projects with ground truth (AutoResearch prerequisite)

### Phase 3: Self-Improvement (make it autonomous)
- Binary assertions for each agent (AutoResearch pattern)
- Overnight optimization loops (AutoResearch/Self-Improving Skills)
- Correction flywheel: PO feedback → assertions → auto-optimize
- Control point template optimization
- Query strategy optimization

### Phase 4: Scale (share across projects)
- Skill/template registry for Bild Studio (inspired by ClawHub)
- Cross-project learning from optimized agents
- Custom skill creation for POs
- Audio/video ingestion pipeline

---

## 20. Key Takeaway

> **Three open-source patterns, one coherent system:**
>
> - **OpenClaw** gives us the skill architecture (markdown-driven, progressive disclosure) and search engineering (MMR, temporal decay, query expansion) to build a modular, high-quality retrieval system.
>
> - **AutoResearch** gives us the methodology to make that system self-improving — autonomous experiment loops with binary eval, keep/revert on git, and the "program, don't code" paradigm.
>
> - **Our three-layer architecture** remains the foundation because discovery requires structured fact management, lifecycle tracking, and relationship graphs that no single-layer RAG provides.
>
> The combination is greater than the sum: markdown-driven agents that improve themselves overnight, powered by a three-layer knowledge base with production-grade search engineering.

---
---

# Part 5: Agent Orchestration Frameworks

> **Independent research — 2026-03-24**
> **Purpose:** Evaluate how to orchestrate our 7 specialized agents in production

## 21. Framework Comparison

### 21.1 LangGraph (LangChain)

**Architecture:** Graph-based state machine. Agents are nodes, edges define control flow. State is a typed dictionary (`TypedDict`) passed through every node with reducer functions for concurrent updates.

**Key patterns:**
- **Supervisor pattern** — central LLM-powered node routes tasks to specialists. Maps directly to our Discovery Coordinator → 7 specialist agents.
- **Hierarchical supervisors** — subgraphs with their own supervisors. E.g., "Document Analysis Supervisor" managing contradiction-detection + gap-analysis agents.
- **Scatter-gather** — fan-out to multiple agents in parallel, fan-in to consolidate. Run requirement extraction + contradiction detection simultaneously.
- **Checkpoint/resume** — durable execution. If a workflow crashes mid-run, it resumes from last checkpoint. Critical for multi-session discovery engagements.

**State management:** Central reducer-driven schema. All agents read/write shared state. Concurrent writes resolved through annotated reducer functions (append-only lists, last-writer-wins). Most explicit state management of any framework.

**Human-in-the-loop:** First-class. Execution pauses at designated nodes for PO review, resumes after approval.

**Strengths:** Maximum control. Production-grade with durable execution, memory, LangSmith observability. Python and JS/TS. Most battle-tested.
**Weaknesses:** More boilerplate. Graph definitions get complex with 7+ agents. LangChain ecosystem dependency.

---

### 21.2 CrewAI

**Architecture:** Two layers: **Crews** (autonomous agent teams with roles) and **Flows** (event-driven state machines). No LangChain dependency.

**Key patterns:**
- **Role-playing metaphor** — each agent has a role, goal, and backstory. Natural fit for discovery roles.
- **Flows** — `@start` (entry points), `@listen` (trigger on completion), `@router` (conditional), `and_()` / `or_()` for fan-in:

```python
class DiscoveryFlow(Flow):
    @start()
    def ingest_documents(self):
        # Kick off document parsing

    @listen(ingest_documents)
    def extract_requirements(self, parsed_docs):
        # Runs after ingestion

    @listen(ingest_documents)
    def detect_contradictions(self, parsed_docs):
        # Runs in parallel with extract_requirements

    @listen(and_(extract_requirements, detect_contradictions))
    def prepare_meeting_brief(self, requirements, contradictions):
        # Fan-in: only runs when BOTH complete
```

**State management:** Pydantic models for structured state with type validation.

**Strengths:** Highest-level abstraction, fastest to prototype. Intuitive role definitions. Flows with `and_()` is exactly what we need. MIT licensed.
**Weaknesses:** Less granular control than LangGraph. Autonomous delegation can be unpredictable. Python only.

---

### 21.3 Microsoft Agent Framework (AutoGen successor)

**Architecture:** Actor model. Async message passing. Each agent is an actor. AutoGen merged with Semantic Kernel in October 2025.

**Key patterns:**
- **AgentTool** — wrap any agent as a callable tool. Coordinator invokes specialists as tools.
- **Group chat** — structured multi-agent conversations with termination conditions.
- **AutoGen Studio** — no-code GUI for configuring agent workflows.

**Status:** AutoGen is in maintenance mode. Microsoft Agent Framework targeting GA Q1 2026. Migration risk.

**Strengths:** Enterprise ecosystem, actor model scales to distributed, cross-language (.NET + Python), GUI.
**Weaknesses:** In transition. More complex setup. Async-first can be confusing.

---

### 21.4 Mastra (TypeScript)

**Architecture:** TypeScript-native. `.then()`, `.branch()`, `.parallel()` syntax. Built by the Gatsby team.

**Key patterns:**
- Built-in RAG, working memory, semantic recall
- MCP server authoring — agents consumable by any MCP client
- Suspend/resume with persistent storage
- React/Next.js integration

**Strengths:** Best choice if building in TypeScript. Modern DX. Built-in RAG.
**Weaknesses:** Younger ecosystem. Less battle-tested for complex multi-agent.

---

### 21.5 Google ADK

**Architecture:** Three built-in workflow agent types: `SequentialAgent`, `ParallelAgent`, `LoopAgent`.

**Key patterns:**
- **LoopAgent** — iterative refinement until quality threshold. Agents signal `escalate=True` to exit. Unique and useful for: "keep refining requirement extraction until confidence is high."
- **ParallelAgent** — simultaneous execution with shared session state.
- **A2A protocol** — agent-to-agent communication across frameworks.

**Strengths:** Clean workflow primitives. LoopAgent is unique. Google ecosystem.
**Weaknesses:** Newer (April 2025). ADK 2.0 still in alpha.

---

### 21.6 OpenAI Agents SDK

**Architecture:** Handoff-centric. Agents decide when to pass control to another specialist.

**Key patterns:**
- **Handoffs** — decentralized routing. Triage agent → specialist.
- **Guardrails** — input/output validation before proceeding.

**Strengths:** Simplest API. Built-in tracing.
**Weaknesses:** Less flexible for complex orchestration. Provider-biased toward OpenAI.

---

## 22. Framework Comparison Matrix

| Capability | LangGraph | CrewAI | MS Agent FW | Mastra | Google ADK | OpenAI SDK |
|---|---|---|---|---|---|---|
| 7-agent orchestration | Excellent | Excellent | Good | Good | Good | Moderate |
| Shared typed state | Best | Good (Pydantic) | Good | Good | Good | Limited |
| Parallel execution | Native | Native (`and_`) | Native (async) | Native | Native | Manual |
| Conditional routing | Native | Native (`@router`) | Native | Native | Native | Agent-decided |
| Human-in-the-loop | First-class | Via Flows | Supported | First-class | Supported | No |
| Iterative refinement | Manual (cycles) | Manual | Manual | Manual | **Native (LoopAgent)** | Manual |
| Checkpoint/resume | Yes | No | Yes | Yes | No | No |
| TypeScript support | Yes | No | .NET + Python | **Native** | Python | Python |
| Production readiness | High | High | In transition | Growing | Growing | High |

## 23. Recommendation for Our Stack

**For our Python/FastAPI backend: LangGraph or CrewAI.**

**LangGraph** if we want maximum control over agent interactions, typed state, and checkpoint/resume for multi-session discovery. The supervisor + subgraph pattern maps cleanly to our architecture.

**CrewAI** if we want faster development. The Flows layer with `and_()` fan-in is exactly our "run gap detection + contradiction detection in parallel, aggregate when both complete" pattern. The role/goal/backstory metaphor makes agent definitions intuitive.

**Key patterns to adopt regardless of framework:**
1. **Supervisor/coordinator** — central agent routes to 7 specialists
2. **Parallel fan-out** — gap detection + contradiction detection + entity extraction run simultaneously
3. **Fan-in aggregation** — consolidate before generating meeting briefs
4. **Iterative refinement loops** — loop requirement extraction until confidence threshold
5. **Typed shared state** — Pydantic models for discovery state (requirements, gaps, contradictions, entities)
6. **Human-in-the-loop checkpoints** — PO reviews at critical decisions

---
---

# Part 6: Fact Extraction & Contradiction Detection Tools

> **Independent research — 2026-03-24**
> **Purpose:** Find tools for extracting structured facts and detecting contradictions in discovery documents

## 24. Document Parsing Layer

### Docling (IBM)
- Converts PDF, DOCX, PPTX, XLSX, HTML, audio, video → structured markdown/JSON
- Granite-Docling-258M model (Apache 2.0) — DocTags markup captures charts, tables, forms, code
- **Relevance:** Strong at diverse document types in discovery (specs as PDF, notes as DOCX, emails as HTML). Preserves section context for fact attribution.
- **vs. RAGFlow:** Complementary. RAGFlow uses DeepDoc; Docling could be an alternative or pre-processor.

### MinerU (OpenDataLab)
- PDF → markdown/JSON. v2.5 (1.2B params) surpasses Gemini 2.5 Pro and GPT-4o on OmniDocBench
- v2.7: hybrid backend — fast text extraction for text PDFs, VLM-based OCR for scanned docs
- **Relevance:** Best-in-class PDF accuracy. Good for mixed-quality discovery docs (typed + scanned handwritten).

### Unstructured.io
- Partitions documents into **semantic elements** (titles, narrative, tables, list items) — not raw text chunks
- Lowest hallucination rate (Tokens Added = 0.027), highest table extraction accuracy (0.844) in 2025 benchmarks
- **Relevance:** Distinguishes "this is a requirements table" from "this is meeting narrative." Structural awareness feeds better fact extraction.

## 25. Entity & Relationship Extraction

### GLiNER / GLiNER2 — Zero-Shot NER
- **What:** Extract any entity type you specify at runtime — no training data needed
- **How:** DeBERTa-based encoder, <500M params, runs on CPU. Pass entity type labels alongside text.
- **Relevance:** Define types like "decision", "requirement", "deadline", "stakeholder", "risk", "assumption" and extract immediately. Iterate on entity schema without retraining.
- **Example:** From "John confirmed we'll use PostgreSQL by March 15" → `{type: "decision", text: "use PostgreSQL"}`, `{type: "deadline", text: "March 15"}`, `{type: "stakeholder", text: "John"}`
- **GitHub:** [urchade/GLiNER](https://github.com/urchade/GLiNER)

### ReLiK (Sapienza University) — Entity Linking + Relation Extraction
- **What:** Fast combined EL + RE in a Retriever-Reader architecture
- **How:** (1) Retriever identifies candidate entities/relations from KB, (2) Reader aligns with text spans
- **Relevance:** Resolves ambiguity — "the database" gets linked to a specific entity. Produces structured triples: `(PostgreSQL, selected_for, user_service)`. Works with LlamaIndex + Neo4j.
- **GitHub:** [SapienzaNLP/relik](https://github.com/SapienzaNLP/relik)

### spaCy-LLM — Hybrid Pipeline
- **What:** Integrates LLMs into spaCy's structured NLP pipelines
- **How:** Modular tasks (NER, RE, classification, coreference) backed by any LLM. Responses parsed into structured Doc objects.
- **Relevance:** Mix spaCy's deterministic pipeline (tokenization, dependency parsing) with LLM-based extraction for ambiguous parts. Good for production pipelines.
- **GitHub:** [explosion/spacy-llm](https://github.com/explosion/spacy-llm)

## 26. Structured Fact Extraction

### LangExtract (Google) — Schema-Driven with Source Grounding
- **What:** Extracts structured info from text with **exact character offset mapping** back to source
- **How:** Gemini Controlled Generation for schema enforcement. Handles long docs via chunking + parallel passes. Supports cloud LLMs and local models (Ollama).
- **Relevance:** The source grounding is critical for us. When we extract "API deadline is March 15," we know exactly where in the source document that came from. The "learn from examples" approach means a domain expert provides 3-5 examples and the system generalizes.
- **GitHub:** [google/langextract](https://github.com/google/langextract)

### LlamaIndex Structured Extraction — Pydantic-First
- **What:** Define extraction schemas as Pydantic models, LLMs extract structured data
- **How:** Schema-first: `class Decision(BaseModel): text: str; date: str; stakeholders: list[str]; confidence: str`
- **Relevance:** Maps directly to our fact schema. Define `FactClaim`, `Requirement`, `Decision`, `OpenQuestion` as Pydantic models with source, timestamp, confidence, status fields.

## 27. Contradiction Detection

### Two-Stage NLI Pipeline (Recommended Approach)
The most practical architecture for contradiction detection:

```
Stage 1: Candidate Retrieval (fast, cheap)
  - Extract atomic claims from each document
  - Embed all claims using sentence-transformers
  - Find candidate pairs by cosine similarity (claims about same topic)

Stage 2: Classification (accurate, expensive)
  - Run cross-encoder NLI on candidate pairs only
  - Classify: entailment / contradiction / neutral
  - Models: cross-encoder/nli-deberta-v3-base (best accuracy/speed)
```

**Why two stages:** Avoids O(n^2) pairwise comparison. Stage 1 filters 10,000 claims down to ~100 candidate pairs. Stage 2 runs NLI only on those.

**Limitation:** Sentence-level NLI misses implicit contradictions ("launch April 15" vs. "need 8 more weeks of testing" when today is March 1). These require temporal reasoning on top.

### EvoKG — Temporal Fact Tracking with Contradiction Resolution
- **What:** Evolving knowledge graphs that distinguish **exclusive** vs. **non-exclusive** facts
- **Exclusive:** "Launch date is April 15" vs. "Launch date is May 1" — only one can be true. Maintains both with confidence scores and temporal ordering.
- **Non-exclusive:** "Discussed PostgreSQL" + "Discussed MongoDB" — both valid, temporally ordered.
- **Relevance:** **Closest existing system to our fact lifecycle model.** The confidence-based resolution considers source reliability and temporal cues.
- **Paper:** [arxiv.org/abs/2509.15464](https://arxiv.org/abs/2509.15464)

### DocForensics — Cross-Document Contradiction Detection
- **What:** Detects contradictions and agreements across PDF collections with evidence pointers
- **Relevance:** Directly targets our multi-document problem. Compares claims across meeting transcripts, specs, emails.
- **GitHub:** [Helixo613/docforensics](https://github.com/Helixo613/docforensics)

### NeuroCausal-RAG — Causality-Aware Contradiction Detection
- **What:** RAG with causal graph integration for multi-hop reasoning and contradiction detection
- **Relevance:** Detects logically incompatible claims: "the API is complete" contradicts "we haven't started API tests" (completion causally implies testing).
- **GitHub:** [ertugrulakben/NeuroCausal-RAG](https://github.com/ertugrulakben/NeuroCausal-RAG)

### OpenFactCheck — Modular Fact-Checking Framework
- **What:** Customizable fact-checking pipeline: claim decomposition → evidence retrieval → verification
- **Relevance:** The claim decomposition module breaks meeting paragraphs into atomic claims. Oriented toward external KB verification, but the decomposition pattern applies to cross-document verification.
- **GitHub:** [yuxiaw/OpenFactCheck](https://github.com/yuxiaw/OpenFactCheck)

## 28. Recommended Fact Extraction Pipeline for Discovery

```
Documents (PDF, DOCX, email, audio)
  │
  ▼
┌─────────────────────────────────────────┐
│  PARSING: Docling or MinerU             │
│  → Structured markdown with sections    │
│  → Tables preserved, images described   │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  ENTITY EXTRACTION: GLiNER2             │
│  → Zero-shot: decision, requirement,    │
│    deadline, stakeholder, risk           │
│  → No training, iterate schema freely   │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  FACT EXTRACTION: LangExtract           │
│  → Schema-driven structured records     │
│  → Source grounding (char offsets)       │
│  → Learn from 3-5 examples              │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  CONTRADICTION DETECTION                │
│  → Stage 1: Embed claims, find pairs    │
│  → Stage 2: NLI cross-encoder classify  │
│  → EvoKG temporal confidence scoring    │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  KNOWLEDGE STORE                        │
│  → Facts with lifecycle + sources       │
│  → Entities + relationships in graph    │
│  → Temporal validity tracking           │
└─────────────────────────────────────────┘
```

---
---

# Part 7: Knowledge Graph & Graph-RAG Tools

> **Independent research — 2026-03-24**
> **Purpose:** Evaluate graph-based retrieval and knowledge management for our Neo4j layer

## 29. Microsoft GraphRAG

**What:** Builds a hierarchical knowledge graph from documents using LLMs, then uses graph structure for retrieval.

**How it builds the graph:**
1. Text chunking
2. LLM extracts entities + relationships per chunk (automatic, no manual schema)
3. Graph construction
4. **Leiden community detection** — finds clusters hierarchically (fine → coarse)
5. LLM generates community summaries at each level (pre-computed at index time)

**Query modes:**
- **Local:** Entity-specific queries via embedding similarity + subgraph context
- **Global:** Corpus-wide queries via map-reduce over community summaries
- **DRIFT:** Hybrid of both

**Relevance:** Community detection automatically finds clusters like "everything related to the database migration decision." Multi-level summaries give zoom levels: executive overview ↔ detailed decision history.

**Limitation:** Expensive upfront indexing (LLM calls per chunk + per community). Better for batch analysis than real-time ingestion.

**GitHub:** [microsoft/graphrag](https://github.com/microsoft/graphrag)

## 30. LazyGraphRAG — Cost-Optimized Variant

**What:** Defers all LLM summarization to query time. Indexing cost = 0.1% of full GraphRAG.

**How:** Builds lightweight graph + vector index without pre-generating summaries. At query time, uses iterative deepening: best-first search + breadth-first exploration, calling LLM only on promising subgraphs.

**Result:** Quality comparable to full GraphRAG Global Search at **700x lower query cost**.

**Relevance:** The pragmatic choice for continuous discovery where new documents arrive weekly. Low indexing cost = fast ingestion. Being integrated into GraphRAG library.

## 31. LightRAG — Simple, Fast, Incremental

**What:** Simpler alternative to GraphRAG. Merges knowledge graph with vector retrieval.

**How it builds the graph:**
1. LLM extracts entities + relationships per chunk
2. Entities → nodes, relationships → edges (no community detection)
3. **Incremental updates** — new docs union into existing graph without full rebuild (~50% faster)

**Dual-level retrieval:**
- **Low-level:** Entity keyword extraction → node/edge retrieval. "Who is the product owner for module X?"
- **High-level:** Thematic keyword extraction → relationship cluster retrieval. "What are the main integration challenges?"
- **Hybrid:** Both simultaneously

**Performance:** ~30% lower latency than standard RAG. Outperforms both naive RAG and GraphRAG on benchmarks. Can use Neo4j as backend.

**Relevance:** Best fit for incremental ingestion. Dual-level retrieval maps to our use cases. ~1/10th the complexity of GraphRAG.

**GitHub:** [HKUDS/LightRAG](https://github.com/hkuds/lightrag)

## 32. Graphiti/Zep — Temporal Knowledge Graph (MAJOR FINDING)

**What:** A bi-temporal knowledge graph engine designed specifically for AI agent memory. Open-source core of Zep. **Uses Neo4j natively.**

**Architecture:**
- **Bi-temporal model:** Every edge tracks:
  - `t_valid` — when the fact was true in the real world
  - `t_invalid` — when it stopped being true
- **Incremental ingestion** — new data integrates without recomputation
- **Entity resolution** — handles duplicates and evolving references
- **Hybrid retrieval:** Semantic + BM25 + graph traversal. **No LLM calls during retrieval.** P95 latency ~300ms.

**Why this matters for discovery:**
- "In week 2, client said React. In week 4, they switched to Vue." → Graphiti tracks both with temporal validity
- "John decided X" → edge with `t_valid = week 2`, later `t_invalid = week 4` when overridden
- Stakeholder tracking: who said what, when, whether it's still current
- Designed for the exact use case of an AI assistant accumulating knowledge across sessions

### Graphiti vs. Mem0 — Critical Comparison

| Dimension | Mem0 | Graphiti/Zep |
|-----------|------|-------------|
| **Primary store** | Vector store (Qdrant) + optional Neo4j | **Neo4j (primary)** |
| **Graph model** | Thin triples, no temporal fields, graph+vector stores disconnected | Rich edges with temporal validity, descriptions, source refs |
| **Memory type** | Atomic fact strings in vector store | Structured graph with full provenance |
| **Temporal awareness** | None | **Bi-temporal** (when it happened + when recorded) |
| **Retrieval** | Vector similarity over fact strings | Hybrid: semantic + BM25 + graph traversal, no LLM |
| **Latency** | Depends on vector store | P95 ~300ms |
| **Benchmark** | 66.9% on LOCOMO | **94.8% on DMR** |

### Recommendation: Consider Replacing Mem0 with Graphiti

**Mem0's graph memory is a thin add-on to a vector-first architecture.** The graph and vector stores are independent systems with no shared identifiers. Graphiti treats the graph as the primary knowledge structure.

For a discovery assistant tracking evolving stakeholder decisions and dependencies, Graphiti's temporal graph model is **architecturally superior**:
- Fact lifecycle (`t_valid` / `t_invalid`) maps to our `new → discussed → confirmed → changed` model
- Neo4j native — drops into our existing stack
- Source tracking on edges — provenance built-in
- No LLM at retrieval — fast, predictable, cost-efficient

**What we would lose:** Mem0's simple API for "add memory" / "search memory." Graphiti is more complex to set up.

**What we would gain:** Temporal awareness, superior benchmarks, unified graph+vector in one system, provenance tracking.

**GitHub:** [getzep/graphiti](https://github.com/getzep/graphiti)

## 33. Neo4j LLM Knowledge Graph Builder

**What:** Neo4j's own tool for extracting knowledge graphs from documents directly into Neo4j.

**Features:**
- Accepts PDFs, documents, images, web pages, YouTube transcripts
- Configurable LLMs (OpenAI, Gemini, Claude, Llama3) for extraction
- Custom entity/relationship schemas
- Builds lexical graph (documents → chunks) + entity graph (nodes + relationships)
- Includes Leiden community detection + summarization (GraphRAG-style)
- Multiple RAG modes: GraphRAG, Vector, Text2Cypher

**Relevance:** Most natural fit for our Neo4j stack. We could define: Person, Organization, Feature, Decision, Dependency, Constraint as entity types and get automatic extraction from discovery documents.

**GitHub:** [neo4j-labs/llm-graph-builder](https://github.com/neo4j-labs/llm-graph-builder)

## 34. Updated Three-Layer Architecture Recommendation

Based on this research, here's how our knowledge layers should evolve:

### Current Plan
| Layer | Tool | Role |
|-------|------|------|
| SEARCH | RAGFlow | Document retrieval |
| KNOW | Mem0 | Facts with lifecycle |
| CONNECT | Mem0 + Neo4j | Entity relationships |

### Revised Recommendation
| Layer | Tool | Role | Change |
|-------|------|------|--------|
| SEARCH | RAGFlow | Document retrieval | Keep — add MMR, temporal decay, query expansion |
| KNOW | **Graphiti/Zep** | Facts with temporal lifecycle | **Replace Mem0** — bi-temporal, source-grounded |
| CONNECT | **Graphiti/Zep + Neo4j** | Entity relationships | **Simplify** — Graphiti uses Neo4j natively |
| EXTRACT | **GLiNER2 + LangExtract** | Entity + fact extraction pipeline | **New layer** — structured extraction with source grounding |
| CONTRADICT | **NLI pipeline + EvoKG patterns** | Contradiction detection | **New layer** — two-stage detection with temporal confidence |

### Why This Is Better

1. **Layers 2 and 3 merge.** Graphiti handles both facts (with temporal lifecycle) and entity relationships in a single Neo4j graph. No need for separate Mem0 + Neo4j setup with disconnected stores.

2. **Extraction becomes explicit.** Instead of relying on Mem0's LLM-powered fact extraction (black box), we use GLiNER2 (zero-shot entities) + LangExtract (schema-driven facts with source grounding). More control, more transparency.

3. **Contradiction detection gets a dedicated pipeline.** Instead of hoping the LLM notices contradictions in context, we run systematic NLI classification on extracted claims. Deterministic, auditable.

4. **Temporal awareness is native.** Every fact has `t_valid` / `t_invalid` instead of relying on metadata timestamps. The graph itself knows what's current.

---
---

# Part 8: Revised Combined Architecture

## 35. Updated Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                     DISCOVERY AI ASSISTANT v2                        │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  AGENT LAYER                                                   │  │
│  │  (OpenClaw skill pattern + CrewAI/LangGraph orchestration)     │  │
│  │                                                                │  │
│  │  AGENT.md files with progressive disclosure                    │  │
│  │  Coordinator → 7 specialists (parallel fan-out, fan-in)        │  │
│  │  Sub-agent spawning for batch document analysis                │  │
│  │  Human-in-the-loop at critical checkpoints                     │  │
│  │  Self-improving via AutoResearch loop                          │  │
│  └──────────────────────────┬─────────────────────────────────────┘  │
│                             │                                        │
│                             ▼                                        │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  CONTEXT ENGINE (OpenClaw pattern)                             │  │
│  │  Registry-based prompt assembly with compaction                │  │
│  └──────────────────────────┬─────────────────────────────────────┘  │
│                             │                                        │
│            ┌────────────────┼────────────────┐                       │
│            ▼                ▼                ▼                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐       │
│  │  SEARCH      │  │  KNOW +      │  │  EXTRACT +           │       │
│  │  (RAGFlow)   │  │  CONNECT     │  │  CONTRADICT          │       │
│  │              │  │  (Graphiti   │  │  (GLiNER2 +          │       │
│  │  Hybrid      │  │   + Neo4j)   │  │   LangExtract +      │       │
│  │  search      │  │              │  │   NLI pipeline)       │       │
│  │  + MMR       │  │  Bi-temporal │  │                       │       │
│  │  + temporal   │  │  facts +     │  │  Zero-shot entity    │       │
│  │    decay     │  │  entities +  │  │  extraction +         │       │
│  │  + query     │  │  relations   │  │  schema-driven facts  │       │
│  │    expansion │  │  in unified  │  │  + source grounding   │       │
│  │              │  │  graph       │  │  + contradiction      │       │
│  │  Documents   │  │              │  │    classification     │       │
│  │  & chunks    │  │  Lifecycle:  │  │                       │       │
│  │              │  │  t_valid /   │  │  Two-stage NLI:       │       │
│  │              │  │  t_invalid   │  │  embed → candidates   │       │
│  │              │  │              │  │  → cross-encoder      │       │
│  └──────────────┘  └──────────────┘  └──────────────────────┘       │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  SELF-IMPROVEMENT (AutoResearch + Karpathy loop)               │  │
│  │  Agent prompts, control points, query strategies               │  │
│  │  Binary assertions + overnight optimization                    │  │
│  │  PO corrections → new assertions → auto-optimize               │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  DOCUMENT INGESTION (Docling/MinerU → RAGFlow + Graphiti)      │  │
│  │  PDF, DOCX, email, audio → structured text → parse → index    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 36. Complete Tool Registry

| Category | Tool | Role | Priority |
|----------|------|------|----------|
| **Orchestration** | LangGraph or CrewAI | Agent coordination, parallel execution, state management | MVP |
| **Document Search** | RAGFlow | Hybrid search, chunking, document retrieval | MVP |
| **Knowledge Graph** | Graphiti/Zep + Neo4j | Bi-temporal facts, entities, relationships | MVP |
| **Entity Extraction** | GLiNER2 | Zero-shot NER for custom entity types | MVP |
| **Fact Extraction** | LangExtract | Schema-driven extraction with source grounding | MVP |
| **Contradiction** | NLI pipeline (DeBERTa) | Two-stage contradiction detection | MVP |
| **Document Parsing** | Docling or MinerU | PDF/DOCX/HTML → structured markdown | MVP |
| **Community Detection** | Leiden (via Graphiti or Neo4j) | Automatic topic clustering | Post-MVP |
| **Graph Retrieval** | LightRAG patterns | Dual-level (entity + thematic) retrieval | Post-MVP |
| **Causal Reasoning** | NeuroCausal-RAG patterns | Implicit contradiction detection | Future |
| **Cross-Doc Analysis** | DocForensics patterns | Agreement/contradiction across document sets | Future |
| **Self-Improvement** | AutoResearch loop | Overnight agent optimization | Phase 3 |

## 37. Key Architecture Decisions Updated

| Decision | Previous | Updated | Why |
|----------|----------|---------|-----|
| Fact/Memory store | Mem0 | **Graphiti/Zep** | Bi-temporal, Neo4j native, 94.8% vs 66.9% benchmark, unified graph+vector |
| Entity extraction | Mem0's built-in | **GLiNER2 + LangExtract** | Zero-shot customizable, source grounding, transparent pipeline |
| Contradiction detection | LLM-in-context | **NLI pipeline** | Deterministic, scalable, auditable, avoids O(n^2) with two-stage approach |
| Agent orchestration | Custom Python | **LangGraph or CrewAI** | Battle-tested, typed state, parallel execution, human-in-the-loop |
| Agent definitions | Python code | **AGENT.md files** | Version-controlled, PO-editable, progressive disclosure |
| Agent improvement | Manual prompt editing | **AutoResearch loop** | Autonomous, measurable, overnight optimization |

## 38. Final Takeaway

> **This research expanded our architecture from 3 knowledge layers to a 5-component system:**
>
> 1. **SEARCH** (RAGFlow) — enhanced with MMR, temporal decay, query expansion from OpenClaw
> 2. **KNOW + CONNECT** (Graphiti + Neo4j) — unified bi-temporal graph replacing Mem0's disconnected stores
> 3. **EXTRACT** (GLiNER2 + LangExtract) — transparent, source-grounded extraction pipeline
> 4. **CONTRADICT** (NLI + EvoKG patterns) — deterministic contradiction detection
> 5. **SELF-IMPROVE** (AutoResearch loop) — autonomous agent optimization
>
> **The biggest finding is Graphiti/Zep.** It solves our fact lifecycle problem natively (bi-temporal edges), uses our planned Neo4j stack, and benchmarks significantly better than Mem0. This is worth a dedicated architecture decision document.
>
> **Sources researched:** OpenClaw, AutoResearch, CrewAI, LangGraph, Microsoft Agent Framework, Mastra, Google ADK, OpenAI Agents SDK, Docling, MinerU, Unstructured.io, GLiNER, ReLiK, spaCy-LLM, LangExtract, LlamaIndex, GraphRAG, LazyGraphRAG, LightRAG, Graphiti/Zep, Neo4j LLM Graph Builder, EvoKG, DocForensics, NeuroCausal-RAG, OpenFactCheck.
