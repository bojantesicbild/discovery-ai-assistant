# Crnogorchi — Product Vision

## What Is Crnogorchi

Crnogorchi is an AI-assisted software development pipeline that covers the
full lifecycle from client discovery to quality assurance. It is **one product
with four phases**, connected by a shared knowledge system that grows smarter
with every project.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CRNOGORCHI                                   │
│                                                                     │
│  Phase 1          Phase 2            Phase 3          Phase 4       │
│  DISCOVERY    →   STORY & TECH   →   CODE          →  QA           │
│                   DOCS                                              │
│  ┌──────────┐    ┌──────────────┐   ┌────────────┐   ┌───────────┐ │
│  │ Discover  │    │ Spec &       │   │ Build &    │   │ Test &    │ │
│  │ what to   │ →  │ plan what    │ → │ implement  │ → │ validate  │ │
│  │ build     │    │ to build     │   │            │   │           │ │
│  └──────────┘    └──────────────┘   └────────────┘   └───────────┘ │
│       │                │                  │                │        │
│       └────────────────┴──────────────────┴────────────────┘        │
│                              │                                      │
│                    ┌─────────▼──────────┐                           │
│                    │  SHARED KNOWLEDGE   │                           │
│                    │  SYSTEM             │                           │
│                    │                    │                           │
│                    │  Every phase reads │                           │
│                    │  and writes.       │                           │
│                    │  Knowledge grows   │                           │
│                    │  across phases     │                           │
│                    │  and projects.     │                           │
│                    └────────────────────┘                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## The Problem

Today, each phase of software development at Bild operates in relative
isolation. Information flows forward through documents and conversations,
but:

**Context gets lost between phases.**
The Tech Lead writing stories doesn't have full access to what was discussed
in discovery meetings. The developer writing code doesn't know why a certain
architecture decision was made. The QA engineer doesn't know which requirements
were assumptions vs. confirmed facts.

**No learning across projects.**
Project A's discovery team doesn't benefit from what Project B's code team
learned six months ago. Each project starts from zero.

**No unified view.**
There's no single place to see: "Where is this project? What's the status
across all phases? What decisions were made, by whom, and when?"

**Manual handoffs.**
Moving from one phase to the next requires meetings, document sharing,
and verbal context transfer. Information is lost at every handoff.

## What Crnogorchi Does Differently

### 1. One Knowledge System

All four phases read from and write to the same knowledge base. When
Discovery learns that the client wants Microsoft SSO, that fact is
available to every downstream phase — the story writer, the developer,
and the QA engineer.

### 2. Knowledge Grows Across Phases

Each phase enriches the shared understanding:
- **Discovery** creates the foundation: stakeholders, requirements, decisions
- **Story/Tech Docs** refines it: detailed specs, architecture decisions, story breakdowns
- **Code** resolves it: implementation decisions, technical learnings, what actually worked
- **QA** validates it: what passed, what failed, what assumptions were wrong

### 3. Cross-Phase Visibility

Any user in any phase can see relevant information from other phases:
- PO in Discovery sees: "Similar projects had auth migration take 3 sprints"
  (learned from a past project's Code phase)
- Developer in Code sees: "This requirement was confirmed by the CTO in
  Meeting 3" (from Discovery)
- QA engineer sees: "This feature was marked as 'assumed, not confirmed'
  in discovery" (flag for extra testing)

### 4. Cross-Project Learning

Every project makes the system smarter. Decision logs, learning documents,
and outcomes from past projects are available to inform future ones.

---

## Who Uses It

| Role | Primary Phase | Also sees |
|------|--------------|-----------|
| **Product Owner** | Phase 1 (Discovery) | Status from all phases, decisions, readiness |
| **Business Developer** | Phase 1 (Discovery) | Client context, requirements tracking |
| **Tech Lead / BA** | Phase 2 (Story/Tech) | Discovery context, architecture decisions |
| **Solution Architect** | Phase 2 (Story/Tech) | Technical requirements, integration details |
| **Developer** | Phase 3 (Code) | Stories, specs, discovery context, decisions |
| **QA Engineer** | Phase 4 (QA) | Requirements, stories, code changes, traceability |
| **Project Manager** | All phases | Overall status, timeline, blockers across phases |

---

## Why One Product, Not Four Tools

| Approach | Four separate tools | Crnogorchi (one product) |
|----------|-------------------|------------------------|
| **Knowledge** | Each tool has its own data silo | Shared knowledge system across all phases |
| **Context** | Lost at every handoff | Preserved and enriched at every phase |
| **Learning** | Each project starts from zero | Past projects inform future ones |
| **Visibility** | See only your phase | See the full project lifecycle |
| **Handoff** | Manual document sharing | Structured, automatic, nothing lost |
| **Traceability** | Requires manual tracking | Requirement → story → code → test traced automatically |
| **Consistency** | Different tools, different patterns | One architecture, one UI, one knowledge model |

---

## The Name

Crnogorchi — a unified AI development pipeline by Bild Studio.

---

## What's Built vs. What's Planned

| Phase | Status | Technology |
|-------|--------|-----------|
| Phase 1: Discovery | **To build** | Custom agents + RAGFlow + Mem0 |
| Phase 2: Story/Tech Docs | **Built** | Claude Code + Atlassian + Figma |
| Phase 3: Code Assistant | **Built** | Claude Code |
| Phase 4: QA Assistant | **Built** | Claude Code + Report Portal |
| Shared Knowledge System | **To build** | RAGFlow + Mem0 (extends to all phases) |
| Unified UI | **To build** | Cross-phase dashboard |

Phases 2-4 exist as individual assistants today. Crnogorchi connects them
into one product with a shared knowledge layer and unified interface.
