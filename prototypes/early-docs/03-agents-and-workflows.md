# Agents & Workflows

## Overview

The Discovery AI Assistant uses 7 specialized agents. Each agent has a
specific role, queries specific knowledge layers, and produces specific
outputs. Agents chain together in pipelines to handle complete workflows.

```
┌──────────────────────────────────────────────────────────────────┐
│                        AGENT FRAMEWORK                            │
│                                                                  │
│  User-Facing Agents          Internal Agents                     │
│  (PO interacts via chat)     (run automatically)                 │
│                                                                  │
│  ┌─────────────────┐         ┌──────────────────┐               │
│  │ Intake Agent     │         │ Analysis Agent    │               │
│  │ Gap Detection    │         │ Control Point     │               │
│  │ Meeting Prep     │         │ Role Simulation   │               │
│  │ Document Gen     │         │                  │               │
│  └─────────────────┘         └──────────────────┘               │
│                                                                  │
│  All agents access knowledge layers via the Query Router:        │
│  ├── RAGFlow    (document search)                                │
│  ├── Mem0 Facts (structured knowledge)                           │
│  ├── Mem0 Graph (entity relationships)                           │
│  └── Claude Code (repo analysis)                                 │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Agent Definitions

### 1. Intake Agent
**Type:** User-facing
**Purpose:** First point of contact. Receives raw input and routes it into
the knowledge system.

**Responsibilities:**
- Accept uploaded documents (meeting notes, emails, specs, contracts, RFPs)
- Accept client repository URLs for code analysis
- Classify document type (meeting notes, email thread, client spec, technical doc)
- Trigger the ingestion pipeline:
  - Document → RAGFlow for parsing and chunking
  - Document text → Mem0 for fact extraction and entity graph
  - Repo URL → Claude Code for codebase analysis
- Confirm to the PO what was ingested and what changed ("3 new facts, 1 update,
  readiness 72% → 78%")

**Knowledge layers used:**
- RAGFlow (write — sends documents for parsing)
- Mem0 (write — triggers fact extraction)
- Claude Code (read — triggers repo analysis)

**Triggers:** PO uploads a document or provides a repo URL

---

### 2. Analysis Agent
**Type:** Internal (runs automatically after ingestion)
**Purpose:** Deep analysis of collected information. Extracts structured
knowledge from unstructured input.

**Responsibilities:**
- Cross-reference new information against existing knowledge
- Identify contradictions between different sources
  - "Meeting 2 said multi-tenant, Meeting 4 said single-tenant"
- Map stakeholder perspectives and priorities
- Detect implicit assumptions that need validation
  - "Client mentioned 'our standard auth flow' — we don't know what that means"
- Extract and track entities: stakeholders, features, decisions, integrations,
  constraints, deadlines
- Build relationships between entities in the graph

**Knowledge layers used:**
- RAGFlow (read — searches for related content across all documents)
- Mem0 Facts (read + write — compares new info against existing facts)
- Mem0 Graph (write — creates/updates entity relationships)
- Claude Code (read — if repo analysis found relevant technical context)

**Triggers:** Automatically after every document ingestion

---

### 3. Gap Detection Agent
**Type:** User-facing
**Purpose:** Identify what's missing from the discovery phase.

**Responsibilities:**
- Compare known facts against the project's control point checklist
- For each missing or partial item, generate specific follow-up questions
- Prioritize questions by impact:
  - **Blocking** — can't proceed without this (e.g., no auth decision)
  - **Important** — should have before Phase 2 (e.g., performance targets)
  - **Nice to have** — useful but not blocking (e.g., competitive analysis)
- Suggest which stakeholder should answer each question
  - Uses entity graph to map questions to people
- Track which gaps have been addressed over time

**Knowledge layers used:**
- Mem0 Facts (read — checks what exists, what's missing, what's unconfirmed)
- Mem0 Graph (read — maps questions to stakeholders)
- RAGFlow (read — searches for partial mentions that might upgrade a "missing" to "partial")

**Output:** Gap Analysis Report

**Triggers:** On demand (PO asks), after ingestion pipeline completes,
weekly scheduled check

---

### 4. Meeting Prep Agent
**Type:** User-facing
**Purpose:** Prepare the PO for the next client meeting.

**Responsibilities:**
- Generate meeting agenda based on current gaps (prioritized)
- Prepare talking points for specific topics
- Summarize current state: "here's what we know, here's what we need"
- Suggest questions ordered by priority and grouped by stakeholder
- Create "interpretation confirmation" prompts:
  - "In Meeting 2 you mentioned 'standard auth' — did you mean SSO or API keys?"
  - Based on Tarik Zaimovic's methodology of validating PO interpretations
- After the meeting: process uploaded meeting notes and update the knowledge base

**Knowledge layers used:**
- Mem0 Facts (read — what do we know, what's missing, what changed)
- Mem0 Graph (read — which stakeholders to ask about which topics)
- RAGFlow (read — pull exact quotes for confirmation prompts)

**Output:** Meeting Agenda, Context Summary, Post-Meeting Summary

**Triggers:** PO requests meeting prep, PO uploads post-meeting notes

---

### 5. Document Generator Agent
**Type:** User-facing
**Purpose:** Produce the structured discovery deliverables that feed Phase 2.

**Responsibilities:**
- Generate **Project Discovery Brief** (executive summary)
- Generate **MVP Scope Freeze** (what will be built, boundaries, priorities)
- Generate **Functional Requirements Overview** (detailed per feature area)
- All documents clearly mark:
  - Confirmed facts vs. assumptions
  - Who provided each piece of information and when
  - Open items that Phase 2 should be aware of
- Include glossary of client-specific terms
- Formatted for Phase 2 consumption (Story/Tech Doc Assistant input)

**Knowledge layers used:**
- RAGFlow (read — needs full paragraphs and original context for rich documents)
- Mem0 Facts (read — structured data for tables, checklists, status markers)
- Mem0 Graph (read — stakeholder lists, decision trees, dependency maps)
- Claude Code (read — technical context from repo analysis for architecture sections)

**Output:** Discovery Brief, MVP Scope Freeze, Functional Requirements Overview

**Triggers:** PO requests document generation (typically when readiness score is
65%+ conditional or 85%+ ready)

---

### 6. Control Point Agent
**Type:** Internal (runs automatically)
**Purpose:** Track discovery completeness and enforce process discipline.

**Responsibilities:**
- Maintain the project's control point checklist (loaded from template, customized by PO)
- Auto-evaluate each control point against Mem0 facts:
  - Fact exists + status confirmed → **Covered** ✅
  - Fact exists + status discussed/assumed → **Partial** ⚠️
  - No relevant fact found → **Missing** ❌
  - Marked by PO → **N/A** ➖
- Calculate readiness score (weighted per area)
- Trigger alerts:
  - Discovery stalling (no new information in X days)
  - Readiness regression (score went down after new contradicting info)
  - Scope creep (new items appearing that weren't in original scope)
- Provide discovery health summary
- Support PO decision gates: "proceed", "proceed with risks", "need more discovery"

**Knowledge layers used:**
- Mem0 Facts (read — primary source for evaluating each control point)
- Mem0 Graph (read — checks entity completeness, e.g., "all stakeholders have roles defined?")

**Output:** Readiness Score, Discovery Progress Report, Alerts

**Triggers:** After every ingestion, on schedule (daily/weekly), on PO request

---

### 7. Role Simulation Agent
**Type:** Internal (runs on demand)
**Purpose:** Analyze requirements from multiple professional perspectives.
Based on Tarik Zaimovic's cognitive simulation methodology.

**Responsibilities:**
- Analyze current requirements from 5 perspectives:
  - **End User:** "Is this usable? Does the flow make sense?"
  - **Admin:** "Is this manageable? What about configuration, monitoring?"
  - **Developer:** "Is this buildable? What's the technical complexity?"
  - **Business Owner:** "Does this make business sense? ROI?"
  - **QA Engineer:** "Is this testable? What are the edge cases?"
- Flag conflicts between perspectives
  - "Developer says auth migration takes 3 sprints, Business Owner wants launch in 2"
- Suggest resolution approaches
- Surface requirements that only one perspective would catch
  - QA: "What happens when the SSO token expires mid-session?"
  - Admin: "Who manages user provisioning?"

**Knowledge layers used:**
- RAGFlow (read — needs full context to simulate perspectives meaningfully)
- Mem0 Facts (read — current state of decisions and requirements)
- Mem0 Graph (read — dependency chains to assess impact per perspective)

**Output:** Multi-Perspective Analysis

**Triggers:** PO requests, before generating final documents (optional step)

---

## Agent Pipeline Flows

### Pipeline 1: Document Ingestion

Triggered when the PO uploads a document or provides a repo URL.

```
PO uploads document / provides repo URL
       │
       ▼
┌──────────────┐
│ Intake Agent  │  Classifies input, triggers ingestion
│               │  → Document → RAGFlow (parse, chunk, index)
│               │  → Text → Mem0 (extract facts, update graph)
│               │  → Repo URL → Claude Code (analyze codebase)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Analysis     │  Cross-references new info against existing knowledge
│ Agent        │  Identifies contradictions, extracts entities
│              │  Updates relationships in graph
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Gap Detection│  Re-evaluates what's covered vs missing
│ Agent        │  Updates gap priorities
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Control Point│  Re-scores all control points
│ Agent        │  Updates readiness percentage
│              │  Checks for stalling, regression, scope creep
└──────┬───────┘
       │
       ▼
  PO receives notification:
  "Meeting 4 notes processed. 3 new facts confirmed,
   1 contradiction detected (hosting: multi-tenant → single-tenant).
   Readiness: 72% → 78%. 4 items still missing."
```

### Pipeline 2: Meeting Preparation

Triggered when PO asks to prepare for the next client meeting.

```
PO requests: "Prepare for next client meeting"
       │
       ▼
┌──────────────┐
│ Gap Detection│  Generates current gap list
│ Agent        │  Prioritizes: blocking → important → nice to have
│              │  Maps gaps to stakeholders
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Meeting Prep │  Builds agenda from prioritized gaps
│ Agent        │  Creates confirmation prompts for assumptions
│              │  Generates context summary for PO
│              │  Suggests stakeholder-specific questions
└──────┬───────┘
       │
       ▼
  PO receives:
  ┌─────────────────────────────────────────────────────┐
  │ MEETING AGENDA — Client Meeting #5                   │
  │                                                     │
  │ Priority items (blocking):                          │
  │ 1. Confirm deployment model (ask IT Lead John)      │
  │    Context: Meeting 3 said single-tenant,           │
  │    email Feb 3 implied multi-tenant                 │
  │                                                     │
  │ 2. Define performance requirements (ask CTO Sarah)  │
  │    Never discussed. Similar projects typically      │
  │    need: concurrent users, response time, uptime    │
  │                                                     │
  │ Confirmation prompts:                               │
  │ • "You mentioned 'standard auth' in Meeting 2.     │
  │    Did you mean Microsoft SSO or something else?"   │
  │                                                     │
  │ Current state: 78% ready, 4 gaps remaining          │
  └─────────────────────────────────────────────────────┘
```

### Pipeline 3: Document Generation

Triggered when PO wants to produce discovery deliverables.

```
PO requests: "Generate the MVP Scope document"
       │
       ▼
┌──────────────┐
│ Control Point│  Checks readiness score
│ Agent        │  Warns if below threshold
│              │  "Readiness is 78% (conditional). 2 items
│              │   are unconfirmed. Proceed?"
└──────┬───────┘
       │  PO confirms
       ▼
┌──────────────┐
│ Role         │  (Optional) Analyzes from multiple perspectives
│ Simulation   │  Flags concerns each role would raise
│ Agent        │  Adds perspective-specific notes
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Document     │  Pulls full paragraphs from RAGFlow
│ Generator    │  Pulls structured facts from Mem0
│ Agent        │  Pulls stakeholder/decision data from graph
│              │  Pulls technical context from Claude Code analysis
│              │  Composes structured document per template
│              │  Marks assumptions vs confirmed facts
└──────┬───────┘
       │
       ▼
  PO receives: MVP Scope Freeze document
  ┌─────────────────────────────────────────────────────┐
  │ MVP SCOPE FREEZE — NacXwan Project                   │
  │                                                     │
  │ 1. Project Overview                                 │
  │    [composed from discovery brief facts + context]  │
  │                                                     │
  │ 2. Features (prioritized)                           │
  │    [from entity graph: features + priorities]       │
  │                                                     │
  │ 3. Technical Architecture                           │
  │    [from repo analysis + meeting discussions]       │
  │                                                     │
  │ 4. Stakeholders & Decisions                         │
  │    [from entity graph: people + decisions]          │
  │                                                     │
  │ ⚠️ Assumptions (unconfirmed):                       │
  │ • Performance targets assumed from similar projects │
  │ • Mobile support scope not explicitly confirmed     │
  │                                                     │
  │ Readiness: 78% (conditional)                        │
  └─────────────────────────────────────────────────────┘
```

### Pipeline 4: Progress Check

Runs automatically on schedule or when PO asks "how are we doing?"

```
PO asks: "What's our discovery status?"
       │
       ▼
┌──────────────┐
│ Control Point│  Evaluates all control points
│ Agent        │  Calculates readiness per area
│              │  Detects stalling, regression, scope creep
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Gap Detection│  Summarizes remaining gaps
│ Agent        │  Suggests next actions
└──────┬───────┘
       │
       ▼
  PO receives:
  ┌─────────────────────────────────────────────────────┐
  │ DISCOVERY STATUS — NacXwan Project                   │
  │                                                     │
  │ Overall: 78% ready (Conditional ✅)                  │
  │                                                     │
  │ By area:                                            │
  │ ├── Business Understanding:  90% ███████████░       │
  │ ├── Functional Requirements: 80% ████████░░░       │
  │ ├── Technical Context:       65% ██████░░░░░       │
  │ └── Scope Freeze:            75% ███████░░░░       │
  │                                                     │
  │ Blocking gaps:                                      │
  │ • Deployment model contradicted (Meeting 3 vs email)│
  │ • Performance targets never discussed               │
  │                                                     │
  │ Trend: ↑ improving (+6% this week)                  │
  │ Next step: Resolve deployment contradiction in      │
  │            next client meeting                      │
  └─────────────────────────────────────────────────────┘
```

### Pipeline 5: Repo Analysis

Triggered when PO provides a client repository for the first time.

```
PO provides: client repo URL
       │
       ▼
┌──────────────┐
│ Intake Agent  │  Validates repo access
│               │  Triggers Claude Code analysis
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Claude Code  │  Analyzes codebase:
│ (service)    │  → Architecture and stack identification
│              │  → API surface mapping
│              │  → Integration points
│              │  → Technical debt assessment
│              │  → Dependency analysis
│              │  → Documentation extraction
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Analysis     │  Processes Claude Code output:
│ Agent        │  → Architecture summary → RAGFlow (as document)
│              │  → Technical facts → Mem0 (as confirmed facts)
│              │  → Service dependencies → Mem0 graph (as entities)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Gap Detection│  Updates gaps based on repo knowledge:
│ Agent        │  "We now know the stack. Still missing:
│              │   migration plan, API deprecation timeline"
└──────┬───────┘
       │
       ▼
  PO receives:
  "Repo analyzed. Found: React 18 + Express + PostgreSQL.
   3 undocumented internal APIs. JWT auth with custom middleware.
   12 technical facts extracted. Readiness: 45% → 58%.
   Suggested questions for next meeting:
   • What are the 3 internal APIs used for?
   • Is the custom JWT middleware staying or migrating?"
```

---

## Agent-to-Knowledge Layer Matrix

Which agent reads/writes which layer:

| Agent | RAGFlow (docs) | Mem0 Facts | Mem0 Graph | Claude Code |
|-------|:-:|:-:|:-:|:-:|
| **Intake** | write | write | — | trigger |
| **Analysis** | read | read/write | write | read |
| **Gap Detection** | read | read | read | — |
| **Meeting Prep** | read | read | read | — |
| **Document Generator** | read | read | read | read |
| **Control Point** | — | read | read | — |
| **Role Simulation** | read | read | read | — |

---

## Agent Communication Pattern

Agents don't talk to each other directly. They communicate through the
knowledge layers:

```
Intake Agent writes facts to Mem0
       ↓
Analysis Agent reads new facts, writes entities to graph
       ↓
Control Point Agent reads facts + graph, writes readiness score
       ↓
Gap Detection Agent reads facts + readiness, generates gap report
```

The **orchestration layer** manages the pipeline sequence and triggers.
Each agent is stateless — it reads from the knowledge layers, does its
work, and writes results back. This means:

- Agents can be updated independently
- Pipelines can be reordered or extended without modifying agents
- Any agent can be re-run at any time (idempotent)
- New agents can be added without changing existing ones
