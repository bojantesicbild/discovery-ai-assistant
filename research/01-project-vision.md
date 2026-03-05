# Discovery AI Assistant - Project Vision

## Company Pipeline (End-to-End)

Bild Studio has a sequential AI assistant pipeline. Each phase is run by **different
users** in the company, each assistant takes the previous phase's output as input.

```
PHASE 1                PHASE 2                  PHASE 3                PHASE 4
─────────────────      ─────────────────────    ─────────────────      ─────────────────
DISCOVERY ASSISTANT    STORY/TECH DOC ASSISTANT CODE ASSISTANT         QA ASSISTANT
🔨 TO BUILD            ✅ EXISTS                ✅ EXISTS              ✅ EXISTS
─────────────────      ─────────────────────    ─────────────────      ─────────────────
Run by:                Run by:                  Run by:                Run by:
POs, BDs               POs, Tech Leads          Developers             QA Engineers

Input:                 Input:                   Input:                 Input:
• Client meetings      • Discovery output       • Tech docs            • Code repo
• Emails               docs (figma, repo, docs) • Story docs           • Story docs
• Client docs                                                          • Tech docs
• Recordings           Output:                  Output:
                       • Tech documentation     • Code                 Output:
Output:                • User stories / PBIs    • Architecture         • Test results
• Discovery docs ─────▶• Functional specs  ─────▶• APIs           ─────▶• Bug reports
  (structured)         • Acceptance criteria     • DB schemas           • Coverage
                       • Design specs                                  • Compliance
```

**Our focus: Build Phase 1 — the Discovery AI Assistant.**

The other three assistants already exist. We need to ensure discovery output
is structured in a way that the existing Story/Tech Doc Assistant can consume.

## Problem Statement

The company lacks a formalized discovery phase. From internal interviews:
- Most projects start with somewhat-defined requirements (not true discovery)
- Discovery and design phases overlap with unclear boundaries
- No standardized templates for functional documentation
- Business goals are often implicit rather than explicitly defined
- Different Tech Leads structure PBIs differently (stylistic variance)
- There is no multi-role discovery workshop process

## What the Discovery Assistant Should Do

Help Product Owners and Business Developers extract, organize, and validate
client requirements through a structured, AI-assisted discovery workflow.

### Core Flow

```
1. INPUT COLLECTION
   Client meetings, emails, documents, recordings
          │
          ▼
2. RAG INGESTION
   All project docs indexed into project-specific knowledge base
          │
          ▼
3. AGENT WORK
   ├── Analyze collected information
   ├── Identify gaps and ambiguities
   ├── Generate follow-up questions
   ├── Prepare meeting agendas
   ├── Suggest clarifications needed
   └── Draft structured documents
          │
          ▼
4. CONTROL POINTS (Discovery Completeness Tracker)
   ├── Business goals defined? ☐
   ├── Target users identified? ☐
   ├── Core user flows mapped? ☐
   ├── Technical constraints known? ☐
   ├── Integration points identified? ☐
   ├── MVP scope agreed? ☐
   └── ... (customizable checklist)
          │
          ▼
5. STRUCTURED OUTPUT (Discovery Docs)
   These docs become INPUT for Phase 2 (Story/Tech Doc Assistant)
   ├── Project Discovery Brief
   ├── MVP Scope Freeze
   ├── Functional Requirements
   ├── Meeting Summaries
   ├── Gap Analysis Reports
   └── Multi-Perspective Analysis
```

## Key Insights from Interviews

### From Nemanja (PO/PM perspective)
- Focus on **structured environments**, not chaotic ideation
- Should support cases where client has enough knowledge for functional specs
- Translation of structured inputs into delivery-ready artifacts
- Future: project-level visibility, Jira mapping, estimation, profitability tracking

### From Tarik (Senior BD/UX perspective)
- Discovery = cognitive role simulation (user, admin, dev, business owner, UX, sales)
- Prototypes are thinking tools, not deliverables
- Iterative: Listen → Ask → Categorize → Rephrase → Confirm
- Need for "memory bank" across projects - critical feature
- Need scope limiters and decision gates
- Clear separation needed between exploration mode and production mode

### Common Ground
- Both see need for structured AI-assisted discovery
- Both emphasize the gap between rapid prototyping and production engineering
- Both want the tool to enforce process discipline (stopping points, checklists)

## Target Users (of Discovery Assistant)

1. **Product Owners** - primary users, manage client requirements
2. **Business Developers** - client-facing, initial discovery conversations

## Downstream Consumers (of Discovery Output)

3. **POs / Tech Leads** - use discovery docs as input for Story/Tech Doc Assistant
4. **Developers** - use tech/story docs (from Phase 2) as input for Code Assistant
5. **QA Engineers** - use code repo + docs (from Phases 2-3) as input for QA Assistant
