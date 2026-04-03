# Discovery AI Assistant — Product Overview

## What Is It

An AI-powered assistant that helps Product Owners and Business Developers run
structured client discovery. It ingests all project inputs — meeting notes,
emails, client documents, and existing code repositories — analyzes them,
identifies what's missing, and produces the documentation needed to start
building.

## The Problem

Discovery is the most unstructured phase of any software project. Information
comes from everywhere — meetings, emails, Slack messages, client specs, existing
codebases — and it's the PO's job to turn that chaos into clear requirements.

What goes wrong today:

- **Information gets lost.** Key decisions from Meeting 2 are forgotten by Meeting 5.
- **Gaps go unnoticed.** Nobody realizes hosting requirements were never discussed
  until development starts.
- **Context is scattered.** The PO holds everything in their head. If they're
  unavailable, the project stalls.
- **Contradictions hide.** The client said "multi-tenant" in one email and
  "single-tenant" in a meeting. Nobody catches it until it's a problem.
- **Discovery drags.** Without structure, meetings repeat the same ground.
  There's no clear signal that discovery is "done."

The Discovery AI Assistant solves this by making discovery **structured,
tracked, and deterministic** — the PO always knows what they know, what they
don't know, and what to ask next.

---

## Where It Fits — Bild's AI Assistant Pipeline

Discovery is Phase 1 of a four-phase AI-assisted development pipeline.
Each phase is run by different people, and each phase's output feeds into
the next.

```
Phase 1              Phase 2                Phase 3           Phase 4
DISCOVERY        →   STORY & TECH DOCS  →   CODE           →  QA
─────────────        ──────────────────     ──────────         ──────────
Product Owner        Tech Lead / BA         Developers         QA Engineers
Business Dev         Solution Architect

Inputs:              Inputs:                Inputs:            Inputs:
• Client meetings    • Discovery docs       • Stories          • Code
• Emails, docs       • Figma designs        • Tech specs       • Stories
• Client repos       • Existing repo        • Architecture     • Test plans
• Client specs       • Atlassian context     decisions

Tool:                Tool:                  Tool:              Tool:
Discovery AI         Story & Tech Doc       Code               QA
Assistant            Assistant              Assistant          Assistant
 (to build)          (built)                (built)            (built)

Outputs:             Outputs:               Outputs:           Outputs:
• Discovery Brief    • User stories         • Working code     • Test results
• MVP Scope          • Tech specs           • PRs              • Bug reports
• Functional Reqs    • Architecture docs    • Documentation    • Coverage
• Gap Analysis       • Decision logs        • Decision logs    • Decision logs
                     • Learning docs        • Learning docs    • Learning docs
```

**Important:** Phases 2, 3, and 4 already exist. They are built using Claude Code
architecture and share common patterns:

- They read from and update **Atlassian** (Jira, Confluence)
- They read **Figma** designs for context
- They produce **decision and learning markdown files** alongside their main outputs
- They use **Claude Code** for deep code and repository understanding

**Discovery is the missing first phase.** It's the only one where we start from
unstructured human conversations and need to produce structured documentation
that the rest of the pipeline can consume.

---

## Knowledge Feedback Loop

The pipeline is not strictly one-directional. The downstream assistants produce
decision logs and learning documents as they work. These artifacts can flow back
into the Discovery AI Assistant's knowledge base:

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
                    ▼                                          │
Discovery  →  Story/Tech Docs  →  Code  →  QA                │
    │              │                │        │                 │
    │              ▼                ▼        ▼                 │
    │         decision.md     decision.md  decision.md        │
    │         learning.md     learning.md  learning.md        │
    │              │                │        │                 │
    │              └────────────────┴────────┘                 │
    │                        │                                 │
    │                        ▼                                 │
    │              Knowledge base (RAG)                        │
    │              • Cross-project patterns                    │
    │              • Lessons learned                           │
    │              • Common pitfalls                           │
    │              • Architecture decisions                    │
    │                        │                                 │
    └────────────────────────┘                                 │
     Future discovery projects benefit                         │
     from past project knowledge          ─────────────────────┘
                                          Current project can also
                                          receive updated context
                                          as downstream phases learn
```

This means the system gets smarter over time. A discovery for "Greenfield Web App"
in 2026 benefits from every previous greenfield project's decisions and lessons.

---

## Discovery Inputs

The Discovery AI Assistant accepts information from multiple sources:

### 1. Documents (meetings, emails, specs)
The primary input. POs upload meeting notes, email threads, client
specifications, RFP documents, and any other written material from the
discovery process.

**Supported formats:** PDF (including scanned), DOCX, TXT, HTML, CSV,
presentations, spreadsheets.

The system parses these with deep document understanding — OCR for scanned
documents, table recognition, layout analysis — and processes them through
smart chunking optimized per document type (meeting notes are chunked by
topic, emails per message in a thread, specs by section).

### 2. Client Code Repositories
When the client has an existing product and wants Bild to extend, integrate
with, or rebuild it, the PO can point the system at the client's repository.

The system uses **Claude Code** to analyze the codebase:
- Architecture and technology stack identification
- API surface and integration points
- Code quality and technical debt assessment
- Dependency analysis
- Documentation extraction

This feeds directly into discovery — the system knows what exists before
the first meeting, so the PO can ask informed questions from day one.

### 3. Previous Project Knowledge
Decision logs and learning documents from past projects (produced by all
four pipeline phases) are available in the knowledge base. The system can
surface relevant patterns: "Similar projects typically needed to address
X, Y, Z during discovery."

---

## What It Does — Core Flow

```
Step 1: INGEST
  PO uploads meeting notes, client docs, points to client repo
  → System parses documents, extracts facts, builds entity graph
  → System analyzes repo (if provided) via Claude Code
  → Control points are automatically evaluated

Step 2: ANALYZE
  System extracts structured knowledge:
  → Stakeholders and their roles
  → Features and priorities
  → Decisions (confirmed, pending, contradicted)
  → Technical constraints and integrations
  → Assumptions that need validation

Step 3: DETECT GAPS
  System compares what it knows against what it should know:
  → "Auth method: confirmed ✅"
  → "Hosting requirements: discussed but not confirmed ⚠️"
  → "Performance targets: never mentioned ❌"
  → "API rate limits: not applicable for this project type ➖"

Step 4: PREPARE
  Before each client meeting, system generates:
  → Prioritized list of open questions
  → Suggested discussion topics based on gaps
  → Context summary for the PO ("here's where we stand")
  → Stakeholder-specific questions ("ask Sarah about...")

Step 5: PRODUCE
  When discovery is sufficiently complete, system generates:
  → Project Discovery Brief (executive summary)
  → MVP Scope Freeze (what will be built)
  → Functional Requirements Overview (detailed requirements)
  → These become input for Phase 2 (Story & Tech Doc Assistant)
```

---

## Control Points — What Makes Discovery "Done"

The system doesn't guess whether discovery is complete. It uses **control
points** — structured checklists customized per project type — to track
exactly what's covered and what's missing.

Each control point is evaluated deterministically:
- **Covered** — the information exists and is confirmed
- **Partial** — mentioned but not confirmed, or incomplete
- **Missing** — never discussed
- **N/A** — not applicable for this project type

Control points are grouped into areas (Stakeholders, Functional Requirements,
Technical Architecture, etc.) with configurable weights. The system calculates
a readiness score:

| Score | Status | Meaning |
|-------|--------|---------|
| 85%+ | Ready | Discovery is complete enough to proceed |
| 65-84% | Conditional | Can proceed with identified risks |
| Below 65% | Not Ready | Significant gaps remain |

Different project types have different control point templates:
- **Greenfield Web App** — full checklist (all areas weighted)
- **Add-on / Plugin** — lighter on stakeholders, heavier on integration
- **API / Integration** — heavy on technical, lighter on UX
- **Mobile App** — adds platform-specific requirements
- **Custom** — PO builds their own checklist

The PO can always customize: add items, remove irrelevant ones, adjust
weights, and save configurations as templates for future projects.

---

## Target Users

| Role | How they use it |
|------|----------------|
| **Product Owner** | Primary user. Uploads documents, reviews gaps, prepares meetings, generates deliverables. |
| **Business Developer** | Uses during early client conversations. Gets structured questions to ask, tracks what's been covered. |
| **Tech Lead** (read access) | Reviews technical requirements and architecture decisions extracted during discovery. |
| **Phase 2 Team** (consumers) | Receives Discovery Brief, MVP Scope, and Functional Requirements as input for their work. |

---

## What It Produces

Six document types, three of which are the primary handoff to Phase 2:

| Document | Purpose | Audience |
|----------|---------|----------|
| **Project Discovery Brief** | Executive summary of what was discovered | Phase 2 team, stakeholders |
| **MVP Scope Freeze** | What will be built, with boundaries and priorities | Phase 2 team, client sign-off |
| **Functional Requirements Overview** | Detailed requirements per feature area | Phase 2 team |
| **Meeting Summary** | Structured notes after each client interaction | PO, internal team |
| **Gap Analysis Report** | What's missing and what to ask next | PO, for meeting prep |
| **Multi-Perspective Analysis** | Same requirements viewed from different roles (dev, QA, UX) | Internal review |
