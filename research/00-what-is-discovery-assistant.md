# What is the Discovery AI Assistant?

## One-Liner

An AI-powered tool that helps Product Owners run structured client discovery —
collecting information, identifying gaps, preparing meetings, and producing
ready-to-use documentation for the next development phase.

## The Problem

When Bild starts a new project, someone (usually a PO or BD) has multiple meetings
and email exchanges with the client. They collect requirements, constraints, business
goals, technical details, etc. This process is:

- **Unstructured** — no standard process, each PO does it differently
- **Easy to miss things** — nobody tracks what information we have vs. what's missing
- **Manual and slow** — writing up discovery docs after meetings is tedious
- **Disconnected** — raw meeting notes and emails don't feed cleanly into the next
  phase where Tech Leads and POs create user stories and technical specs

The result: projects start development with gaps in understanding, and the team
discovers missing requirements mid-sprint.

## The Solution

The Discovery AI Assistant sits between **client communication** and **development
preparation**. It acts as a structured layer that:

1. **Collects** — You upload meeting notes, emails, client documents, transcripts.
   Everything goes into a project-specific knowledge base (RAG).

2. **Analyzes** — AI agents read across all collected materials and identify what
   we know, what's contradictory, and what's still missing.

3. **Guides** — The system tracks a customizable checklist of "control points"
   (things you need to know before starting development). It shows you what's
   covered, what's partial, and what's completely missing. It generates specific
   follow-up questions for the next client meeting.

4. **Prepares** — Before each meeting, the assistant generates an agenda focused
   on closing the biggest gaps. After the meeting, new notes are ingested and
   the picture updates automatically.

5. **Produces** — When discovery is complete enough, the assistant generates
   structured overview documents (Discovery Brief, MVP Scope, Functional
   Requirements) that become the input for the next phase.

## How It Fits in the Company

Bild already has AI assistants for later phases. Discovery is the missing first step.

```
         YOU ARE HERE
              ↓
┌─────────────────────┐    ┌──────────────────┐    ┌──────────────┐    ┌──────────────┐
│ Discovery Assistant  │───▶│ Story/Tech Doc   │───▶│ Code         │───▶│ QA           │
│                     │    │ Assistant        │    │ Assistant    │    │ Assistant    │
│ PO talks to client, │    │ PO & TL create   │    │ Devs write   │    │ QA tests     │
│ collects info,      │    │ user stories,    │    │ code based   │    │ based on     │
│ produces discovery  │    │ tech specs from  │    │ on stories   │    │ code + docs  │
│ docs                │    │ discovery docs   │    │ + tech specs │    │              │
└─────────────────────┘    └──────────────────┘    └──────────────┘    └──────────────┘
```

Each phase is run by **different people**. Discovery output must be self-contained
enough that the next team can work without asking the PO basic questions.

## A Typical Workflow

**Week 1: First client meeting**
- PO has an initial call with the client
- Uploads meeting notes to the Discovery Assistant
- System ingests the notes, extracts key information
- Shows: "You're at 25% — business goals are clear, but no technical context,
  no user personas, no scope defined"
- Generates 12 follow-up questions prioritized by importance

**Week 1-2: Email exchanges + second meeting**
- Client sends over some existing documents (old specs, API docs)
- PO uploads them, system ingests
- Before the second meeting, PO asks: "Prepare my meeting agenda"
- System generates agenda focused on the top gaps: user roles, hosting, auth approach
- After the meeting, PO uploads notes
- System updates: "You're at 58% — functional requirements taking shape,
  still weak on technical constraints"

**Week 2-3: Closing gaps**
- PO uses gap analysis to send targeted questions via email
- Uploads client responses
- System identifies a contradiction: "Client said 'single tenant' in meeting 1
  but 'multi-tenant' in the email. Needs clarification."
- PO resolves it in next call

**Week 3: Document generation**
- System shows 87% readiness
- PO asks: "Generate the discovery documents"
- System produces: Discovery Brief, MVP Scope Freeze, Functional Requirements
- PO reviews, makes minor edits
- Hands off to Tech Lead and PO team for Phase 2 (Story/Tech Doc Assistant)

## Control Points (The Key Feature)

Control points are a customizable checklist that tracks what you know about the project.
They are loaded from **project type templates** (Greenfield, Add-on, Mobile, API, etc.)
and can be customized per project.

The system automatically evaluates each point against ingested documents:
- ✅ **Covered** — we have clear information
- ⚠️ **Partial** — something exists but it's vague or assumed
- ❌ **Missing** — not mentioned in any document
- ➖ **N/A** — marked as not applicable by PO

This gives a concrete readiness score and specific feedback on what's missing,
rather than a vague feeling of "I think we're ready."

## What It Produces

Three key documents that become input for the next phase:

| Document | What's in it |
|----------|-------------|
| **Project Discovery Brief** | Client overview, business context, target users, market context |
| **MVP Scope Freeze** | What's being built, platforms, integrations, what's out of scope |
| **Functional Requirements** | Features, priorities, business rules, technical context, assumptions |

Plus working documents used during discovery:
- Meeting summaries with decision logs
- Gap analysis reports with suggested questions
- Multi-perspective analysis for complex features (optional)

## Who Uses It

- **Product Owners** — primary users, run the discovery process
- **Business Developers** — client-facing, contribute meeting notes and context

## Built On

Rowboat — an open-source multi-agent platform that provides:
- Multi-agent orchestration (different AI agents for different tasks)
- RAG pipeline (knowledge base from uploaded documents)
- Project-based structure (one project per client engagement)
- Chat interface for interacting with agents
