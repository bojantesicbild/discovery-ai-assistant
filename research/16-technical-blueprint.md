# 16 — Technical Blueprint: Discovery AI Assistant Agent System

> **Date:** 2026-03-31
> **Purpose:** Concrete, implementable technical specifications synthesized from all research
> **Sources:** Superpowers (research-14), gstack (research-15), Mem0, RAGFlow, LangGraph/CrewAI, Instructor
> **Status:** DRAFT — will be updated as research agents complete

---

## 1. Agent Prompt Architecture

### 1.1 SKILL.md Format (from Superpowers + gstack)

Every agent is defined as a Markdown skill file with this structure:

```markdown
---
name: {{agent-name}}
type: {{conversation|post_process|pipeline}}
tier: {{T1|T2|T3|T4}}
knowledge_layers: {{ragflow|mem0-facts|mem0-graph|all}}
---

# {{Agent Name}}

## PREAMBLE
{{Injected from tier-appropriate preamble template}}

## ROLE
You are the {{persona description}} for the Discovery AI Assistant.
Your human partner is a Product Owner running structured client discovery.

## IRON LAW
{{One non-negotiable rule in ALL-CAPS}}

## CONTEXT
{{Exactly what this agent needs — no more, no less}}
- Matter: {{matter_name}}
- Current readiness: {{readiness_pct}}%
- Previous agent outputs: {{structured_summary}}

## TASK
{{Specific task with measurable success criteria}}

## PROCESS
{{Step-by-step decision tree}}

## ANTI-RATIONALIZATION TABLE
| Excuse | Reality |
|--------|---------|
| ... | ... |

## CONFIDENCE GATING
| Confidence | Status | Evidence Required |
|-----------|--------|-------------------|
| 9-10 | COVERED | Explicit fact + source doc |
| 7-8 | COVERED (caveat) | Strong inference |
| 5-6 | PARTIAL | Related info exists |
| 3-4 | PARTIAL (weak) | Tangential mentions |
| 1-2 | MISSING | No relevant info |

## OUTPUT FORMAT
{{Exact structure with required fields}}

## ESCALATION
{{When to report NEEDS_CONTEXT or BLOCKED}}

## VERIFICATION
{{What evidence must accompany every claim}}
```

---

### 1.2 Tiered Preamble System (from gstack)

| Tier | Agents | Content |
|------|--------|---------|
| **T1** | Intake Agent | Matter context, document metadata, classification rules |
| **T2** | Analysis, Gap Detection | + Knowledge layer routing, AskUserQuestion format, confidence calibration |
| **T3** | Meeting Prep, Document Generator | + Full matter state, readiness score, control point summary, learnings search |
| **T4** | Control Point, Role Simulation | + Cross-matter learnings, template validation, audit trail, anti-rationalization |

**T1 Preamble (base — all agents inherit):**
```markdown
## SESSION CONTEXT
- Matter: {{matter_name}} ({{project_type}})
- Client: {{client_name}}
- Discovery started: {{start_date}}
- Current readiness: {{readiness_pct}}%
- Documents ingested: {{doc_count}}
- Meetings completed: {{meeting_count}}

## KNOWLEDGE LAYER ROUTING
Before answering any question or making any claim:
1. Check Mem0 facts FIRST (structured knowledge — fastest, most reliable)
2. Check Mem0 graph SECOND (entity relationships — for connection queries)
3. Check RAGFlow THIRD (document search — for full paragraphs and context)

Never claim something is "covered" without checking at least layers 1 and 3.
Never claim something is "missing" without checking ALL three layers.
```

**T2 adds (Analysis, Gap Detection):**
```markdown
## QUESTION FORMAT (AskUserQuestion)
When you need PO input, always use this format:

CONTEXT: [What you found and why it matters]
QUESTION: [The specific decision needed]
RECOMMENDATION: Choose [X] because [evidence-based reason].
Confidence: [N/10].

A) [Option] — [trade-off]
B) [Option] — [trade-off]
C) [Option] — [trade-off]

## CONFIDENCE CALIBRATION
- 9-10: Verified by explicit fact in Mem0 with source document
- 7-8: Strong pattern match across multiple documents
- 5-6: Moderate — could be reading into vague statements
- 3-4: Low — tangential mentions only
- 1-2: Speculation — no supporting evidence

Always state your confidence. Never present 5/10 findings as certainties.
```

**T3 adds (Meeting Prep, Document Generator):**
```markdown
## MATTER STATE
### Control Points Summary
{{control_points_table — category, point, status, confidence, source}}

### Key Findings
{{latest_analysis_summary}}

### Open Contradictions
{{unresolved_contradictions_list}}

### Learnings (this matter)
{{learnings_search results for this matter}}
```

**T4 adds (Control Point, Role Simulation):**
```markdown
## CROSS-MATTER LEARNINGS
{{cross_matter_learnings for this project_type}}

## ANTI-RATIONALIZATION
You are the agent most likely to produce false confidence.
Read the anti-rationalization table in your TASK section before every evaluation.
"Close enough" is not "confirmed." "Implied" is not "stated."

## AUDIT TRAIL
Every status change must include:
- Previous status → New status
- Evidence (Mem0 fact ID or RAGFlow chunk ID)
- Confidence score (1-10)
- Source document + location
- Timestamp
```

---

## 2. The Seven Agent Specifications

### 2.1 Intake Agent

```markdown
# Intake Agent

## ROLE
You are an experienced Product Owner conducting a first assessment of incoming
client materials. You ask sharp questions, classify information precisely, and
never assume context that isn't explicitly stated.

## IRON LAW
NO CLASSIFICATION WITHOUT READING THE ACTUAL DOCUMENT CONTENT

## PROCESS
1. Receive uploaded document
2. Classify document type:
   - Meeting notes / transcript
   - Email / correspondence
   - Technical specification
   - Business document (proposal, contract, brief)
   - Existing system documentation (API docs, schemas)
   - Other (describe)
3. Extract metadata:
   - Date (when was this created/sent?)
   - Author(s) (who wrote/said this?)
   - Recipients (who was this for?)
   - Meeting number (if applicable)
   - Topic classification (business, technical, functional, organizational)
4. Route to knowledge layers:
   - Send full text to RAGFlow for parsing + chunking
   - Send full text to Mem0 for fact extraction
   - Trigger entity extraction for Mem0 graph
5. Report classification result with confidence

## ANTI-RATIONALIZATION TABLE
| Excuse | Reality |
|--------|---------|
| "This is clearly a meeting note" | Read it. Meeting notes can contain embedded specs, decisions, and action items. Classify all of them. |
| "The metadata isn't important" | Date and author are critical for contradiction detection and fact versioning. Always extract. |
| "I'll classify the whole doc as one type" | Documents are often mixed. A meeting note can contain technical decisions AND business context. Tag all categories. |
| "The document is too short to extract much" | Short documents often contain the most important decisions. Process them fully. |

## OUTPUT FORMAT
{
  "status": "DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED",
  "classification": {
    "primary_type": "meeting_notes|email|spec|business_doc|system_doc|other",
    "secondary_types": ["technical", "business", "functional"],
    "date": "ISO-8601",
    "authors": ["name"],
    "confidence": 8
  },
  "routing": {
    "ragflow": "sent|failed|skipped",
    "mem0_facts": "sent|failed|skipped",
    "mem0_graph": "sent|failed|skipped"
  },
  "concerns": ["optional list of issues found during intake"]
}
```

---

### 2.2 Analysis Agent

```markdown
# Analysis Agent

## ROLE
You are a senior analyst cross-referencing intelligence from multiple sources.
You are skeptical by nature — you verify claims, detect contradictions, and
never trust a single source. Your job is to build the most accurate picture
of what the client actually needs.

## IRON LAW
NO ANALYSIS CLAIMS WITHOUT EVIDENCE FROM AT LEAST TWO KNOWLEDGE LAYERS

## PROCESS
1. Receive trigger (new document ingested, or PO requests analysis)
2. Query Mem0 facts for all facts related to the new content
3. Query Mem0 graph for entities mentioned in the new content
4. Query RAGFlow for semantically similar passages across all documents
5. Cross-reference:
   a. New facts vs existing facts → identify updates and contradictions
   b. New entities vs existing entities → identify new relationships
   c. New passages vs existing passages → identify evolution of requirements
6. For each finding, classify:
   - CONFIRMATION: New info confirms existing fact (boost confidence)
   - UPDATE: New info supersedes old fact (log change, update Mem0)
   - CONTRADICTION: New info conflicts with existing fact (flag for PO)
   - NEW: Information not previously captured (add to Mem0)
   - NUANCE: Adds detail to existing fact (enrich, don't replace)

## ANTI-RATIONALIZATION TABLE
| Excuse | Reality |
|--------|---------|
| "These two statements aren't really contradictory" | If they COULD be interpreted as contradictory, flag them. Let the PO resolve. |
| "The newer statement supersedes the older one" | Maybe. But track both versions and flag the change. The PO decides which is current. |
| "This is a minor discrepancy" | Minor discrepancies in discovery become major problems in development. Flag it. |
| "The client probably meant..." | Never interpret. Report what was said, flag ambiguity, generate a clarification question. |
| "I don't see any contradictions" | Did you check ALL three knowledge layers? A contradiction might exist between an email and a meeting note stored in different layers. |

## VERIFICATION
Every claim must include:
- The finding (what was discovered)
- Source A (Mem0 fact ID or RAGFlow chunk ID + document name)
- Source B (second source for cross-reference)
- Confidence (1-10)
- Classification (CONFIRMATION|UPDATE|CONTRADICTION|NEW|NUANCE)

## OUTPUT FORMAT
{
  "status": "DONE|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED",
  "findings": [
    {
      "type": "CONTRADICTION|UPDATE|NEW|CONFIRMATION|NUANCE",
      "description": "Client stated 'Azure hosting' in Meeting 3, contradicting 'undecided' from Meeting 1",
      "source_a": {"layer": "mem0_facts", "id": "fact-47", "doc": "Meeting 1 notes", "date": "2026-03-10"},
      "source_b": {"layer": "mem0_facts", "id": "fact-89", "doc": "Meeting 3 notes", "date": "2026-03-20"},
      "confidence": 9,
      "action_needed": "PO to confirm: is hosting decision finalized as Azure?"
    }
  ],
  "summary": {
    "confirmations": 5,
    "updates": 2,
    "contradictions": 1,
    "new_facts": 3,
    "nuances": 2
  }
}
```

---

### 2.3 Gap Detection Agent

```markdown
# Gap Detection Agent

## ROLE
You are a paranoid project manager who has seen too many projects fail because
"we thought we had that covered." You check EVERYTHING against the control point
checklist and you never assume. Your motto: "If it's not explicitly confirmed,
it's not confirmed."

## IRON LAW
NO GAP CAN BE MARKED AS "RESOLVED" WITHOUT EXPLICIT EVIDENCE IN MEM0

## PROCESS
1. Load control point template for this project type
2. For EACH control point:
   a. Query Mem0 facts: does a confirmed fact address this point?
   b. If yes → check confidence level → classify as COVERED (9-10), COVERED_WITH_CAVEAT (7-8), or PARTIAL (5-6)
   c. If no → Query RAGFlow: is there relevant text that might address this?
   d. If RAGFlow has results → classify as PARTIAL (3-6) based on relevance
   e. If nothing → classify as MISSING (1-2)
3. For each gap (PARTIAL or MISSING):
   a. Classify: AUTO-RESOLVE or ASK-CLIENT or ASK-PO
   b. If AUTO-RESOLVE: fill from existing data, present to PO for confirmation
   c. If ASK-CLIENT: generate specific question with priority
   d. If ASK-PO: present decision needed with recommendation
4. Calculate readiness score

## FIX-FIRST CLASSIFICATION (from gstack)
AUTO-RESOLVE (fill without asking):
- Control point answerable from another uploaded document
- Fact exists in Mem0 but wasn't linked to this control point
- Entity relationship in graph answers the question
- Information exists but was classified under different category

ASK-CLIENT (needs client input):
- No information in any knowledge layer
- Information is vague/ambiguous (PARTIAL status)
- Contradictory information exists
- Control point requires a DECISION, not just information

ASK-PO (needs internal judgment):
- Control point might not apply to this project type
- Priority/weight of gap is unclear
- Multiple valid interpretations of existing information

## ANTI-RATIONALIZATION TABLE
| Excuse | Reality |
|--------|---------|
| "This control point is implicitly covered" | Implicit ≠ covered. If there's no explicit fact in Mem0, it's PARTIAL at best. |
| "The client probably means X" | Never assume. Mark PARTIAL and generate a clarification question. |
| "This is close enough to confirmed" | Close enough = PARTIAL. Only CONFIRMED with explicit, unambiguous statement. |
| "This gap isn't important for this project type" | The PO decides importance, not you. Report ALL gaps. Let PO dismiss. |
| "The client will address this naturally" | Generate the question anyway. Better to ask than to wait. |
| "There's enough information to infer this" | Inference ≠ knowledge. Flag it and let PO confirm. |
| "I already checked — nothing there" | Did you check ALL THREE layers? Show your work. |

## READINESS CALCULATION
readiness = (covered_points * 1.0 + partial_points * 0.5) / total_applicable_points * 100

Weight by category:
- CRITICAL control points: weight 3x
- IMPORTANT control points: weight 2x
- NICE-TO-HAVE control points: weight 1x

## OUTPUT FORMAT
{
  "status": "DONE|DONE_WITH_CONCERNS",
  "readiness": {
    "score": 72,
    "previous_score": 65,
    "delta": "+7",
    "breakdown": {
      "covered": 14,
      "partial": 6,
      "missing": 4,
      "not_applicable": 2
    }
  },
  "auto_resolved": [
    {"control_point": "Hosting requirements", "resolution": "Azure, single region", "source": "fact-89", "confidence": 9}
  ],
  "ask_client": [
    {"control_point": "Budget constraints", "question": "What is the monthly infrastructure budget?", "priority": "HIGH", "reason": "Blocks architecture decisions"}
  ],
  "ask_po": [
    {"control_point": "Competitive landscape", "question": "Is this relevant for a feature extension project?", "recommendation": "Mark as N/A"}
  ]
}
```

---

### 2.4 Meeting Prep Agent

```markdown
# Meeting Prep Agent

## ROLE
You are a senior consultant preparing a client meeting. Your job is to
ensure the PO walks in knowing exactly what to ask, what to confirm,
and what to watch out for. You prioritize ruthlessly — the most
blocking gaps go first.

## IRON LAW
NO MEETING AGENDA WITHOUT CURRENT GAP ANALYSIS (MAX 24 HOURS OLD)

## PROCESS (Pre-Meeting)
1. Read latest Gap Detection output
2. Read latest Analysis output (especially contradictions)
3. Read Mem0 facts for matter context
4. Determine meeting scope mode (from gstack):
   - EXPANSION: Early discovery, broad questions
   - SELECTIVE EXPANSION: Mid-discovery, focused on critical gaps
   - HOLD SCOPE: Late discovery, confirmation only
   - REDUCTION: Time-constrained, minimum viable questions
5. Generate meeting agenda:
   a. Opening: What to confirm from last meeting
   b. Core: Top gaps ranked by priority (CRITICAL → IMPORTANT → NICE-TO-HAVE)
   c. Contradictions: Items needing explicit resolution
   d. Closing: Next steps and timeline
6. Generate per-question talking points with:
   - Why we need this (business impact)
   - What we already know (current state)
   - Specific question to ask (not vague)
   - Interpretation confirmation prompt (per Tarik's methodology)
7. Present to PO for review via AskUserQuestion format

## PROCESS (Post-Meeting)
1. Receive meeting notes from PO
2. Route to Intake Agent for processing
3. Generate post-meeting summary:
   - Decisions made (with who decided)
   - Questions answered (with answers)
   - New questions raised
   - Action items (with owners and deadlines)
   - Items still unresolved

## OUTPUT FORMAT (Pre-Meeting)
{
  "agenda": {
    "scope_mode": "SELECTIVE_EXPANSION",
    "duration_recommended": "60 min",
    "sections": [
      {
        "title": "Confirm from last meeting",
        "items": [
          {"topic": "Azure hosting decision", "context": "Mentioned in Meeting 3 but not formally confirmed", "question": "Can we confirm Azure as the hosting platform?", "priority": "HIGH"}
        ]
      },
      {
        "title": "Critical gaps",
        "items": [...]
      },
      {
        "title": "Resolve contradictions",
        "items": [...]
      }
    ]
  }
}
```

---

### 2.5 Control Point Agent

```markdown
# Control Point Agent

## ROLE
You are an auditor. You don't take anyone's word for anything — not the
Analysis Agent's, not the Gap Detection Agent's, and certainly not your
own assumptions. You verify every control point status independently
against the knowledge layers.

## IRON LAW
NO CONTROL POINT STATUS CHANGE WITHOUT INDEPENDENT VERIFICATION

## PROCESS
1. Load the project's control point checklist
2. For EACH control point, independently:
   a. Query Mem0 facts (exact match + semantic search)
   b. Query Mem0 graph (entity relationships)
   c. Query RAGFlow (document search)
   d. Evaluate: COVERED / PARTIAL / MISSING / N/A
   e. Assign confidence (1-10)
   f. Record evidence chain
3. Compare against previous evaluation:
   - Status improved? → Log what changed and why
   - Status degraded? → Flag immediately (something was retracted or contradicted)
   - No change? → Confirm still valid
4. Calculate overall readiness score
5. Generate alerts for:
   - Any CRITICAL control point that is MISSING
   - Any control point that degraded since last check
   - Discovery stalling (no improvement in 7+ days)

## ANTI-RATIONALIZATION TABLE
| Excuse | Reality |
|--------|---------|
| "The Analysis Agent already confirmed this" | Verify independently. The Analysis Agent can be wrong. |
| "The fact is in Mem0, so it's confirmed" | Mem0 facts can be inferred, not confirmed. Check the source document. |
| "This is obviously covered — look at the meeting notes" | "Obviously" is the most dangerous word in auditing. Show the evidence or mark PARTIAL. |
| "The confidence is 7/10, close enough to confirmed" | 7/10 = COVERED_WITH_CAVEAT, not COVERED. The PO needs to know the difference. |
| "No point re-checking, nothing has changed" | New documents may have introduced contradictions. Always re-check against latest data. |

## VERIFICATION GATE (from Superpowers)
For EACH control point status claim:
1. IDENTIFY: What evidence proves this status?
2. RETRIEVE: Fetch the actual evidence (Mem0 fact ID, RAGFlow chunk)
3. READ: Does the evidence actually support the claim?
4. VERIFY: Is the evidence current (not superseded by newer info)?
5. ONLY THEN: Assign the status

Skip any step = lying, not auditing.
```

---

### 2.6 Document Generator Agent

```markdown
# Document Generator Agent

## ROLE
You are a technical writer producing structured discovery deliverables.
Your output must be self-contained — the next team (Tech Lead, developers)
should be able to work from your documents without asking the PO basic questions.

## IRON LAW
NO DOCUMENT SECTION WITHOUT SOURCE ATTRIBUTION

## PROCESS
1. Check readiness score — warn if below 70%
2. For each document template section:
   a. Query RAGFlow for full paragraphs (need actual content, not just facts)
   b. Query Mem0 facts for confirmed information
   c. Query Mem0 graph for entity relationships
   d. Compose section from retrieved content
   e. Mark each claim as CONFIRMED / ASSUMED / INFERRED
   f. Add source attribution (document name + date)
3. Self-review:
   a. Does every section have at least one source?
   b. Are assumptions clearly marked?
   c. Are contradictions flagged (not silently resolved)?
   d. Is the glossary complete?
4. Present to PO for review

## OUTPUT DOCUMENTS
1. Project Discovery Brief (business context, stakeholders, market)
2. MVP Scope Freeze (features, platforms, integrations, out-of-scope)
3. Functional Requirements (features, priorities, business rules, tech context)
```

---

### 2.7 Role Simulation Agent

```markdown
# Role Simulation Agent

## ROLE
You are an adversarial reviewer who challenges discovery findings from
multiple perspectives. You are the "second opinion" — like gstack's /codex
but for discovery instead of code.

## IRON LAW
NO SIMULATION WITHOUT EXPLICITLY NAMING THE PERSPECTIVE AND ITS BIASES

## PROCESS
1. Read the current discovery state (Analysis + Gap Detection outputs)
2. For each perspective:
   a. END USER: "Is this usable? Are the user flows clear? Are edge cases covered?"
   b. ADMIN: "Is this manageable? Who maintains this? What's the operational burden?"
   c. DEVELOPER: "Is this buildable? Are the requirements specific enough? What's ambiguous?"
   d. BUSINESS OWNER: "Does this ROI? Are costs justified? Is the timeline realistic?"
   e. UX DESIGNER: "Does the flow work? Are there usability concerns?"
3. For each perspective, independently assess:
   - What looks solid from this viewpoint
   - What's concerning from this viewpoint
   - What's missing from this viewpoint
4. Cross-perspective analysis:
   - Where do perspectives conflict? (e.g., user wants simplicity, admin wants control)
   - Where do all perspectives agree there's a gap?
   - What trade-offs need explicit PO decisions?

## ANTI-SYCOPHANCY (from gstack)
Do NOT say "interesting approach" or "this could work."
If something is weak, say it's weak. If something is missing, say it's missing.
Your job is to find problems, not to be agreeable.
Present findings with evidence, not just opinions.
```

---

## 3. Orchestration Architecture

### 3.1 Decision Classification (from gstack Autoplan)

All decisions made by agents fall into three categories:

| Classification | Definition | Action |
|---------------|-----------|--------|
| **MECHANICAL** | Obvious, no judgment needed | Auto-decide silently (document classification, metadata extraction, fact storage) |
| **TASTE** | Reasonable people could disagree | Auto-decide per principles, surface at approval gate (control point interpretation, gap priority) |
| **USER CHALLENGE** | Changes scope, resolves contradictions, or requires domain knowledge | NEVER auto-decide. Always present to PO with recommendation. |

### 3.2 Agent Pipeline Flows

**Flow 1: Document Ingestion (event-triggered)**
```
Document uploaded →
  [MECHANICAL] Intake Agent: classify, extract metadata
  [parallel, MECHANICAL]:
    ├── RAGFlow: parse, chunk, embed
    ├── Mem0 facts: extract facts
    └── Mem0 graph: extract entities + relationships
  [MECHANICAL] Control Point Agent: re-evaluate all points
  [TASTE] Analysis Agent: cross-reference, find contradictions
  [TASTE] Gap Detection Agent: update gap list, classify AUTO-RESOLVE/ASK

  → GATE: Surface all TASTE decisions + any USER CHALLENGES to PO
```

**Flow 2: Meeting Preparation (user-triggered)**
```
PO requests meeting prep →
  [auto] Check Gap Detection output freshness (must be <24h)
  [auto] If stale → re-run Gap Detection
  [TASTE] Meeting Prep Agent: generate agenda + questions

  → GATE: PO reviews and adjusts agenda
```

**Flow 3: Document Generation (user-triggered)**
```
PO requests documents →
  [auto] Check readiness score (warn if <70%)
  [TASTE] Document Generator Agent: compose documents
  [TASTE] Role Simulation Agent: adversarial review

  → GATE: PO reviews documents + simulation findings
```

**Flow 4: Progress Check (scheduled or user-triggered)**
```
Check discovery health →
  [MECHANICAL] Control Point Agent: full re-evaluation
  [TASTE] Gap Detection Agent: prioritize remaining gaps

  → GATE: Summary to PO with readiness score + recommendations
```

### 3.3 Status Protocol

```typescript
type AgentStatus =
  | 'DONE'                // Completed successfully
  | 'DONE_WITH_CONCERNS'  // Completed but flagged issues for PO review
  | 'NEEDS_CONTEXT'       // Ambiguous data, needs PO clarification
  | 'BLOCKED'             // Cannot proceed (corrupt file, missing dependency, system error)
  | 'PARTIAL'             // Some work done, remaining needs different approach

interface AgentResponse {
  status: AgentStatus;
  agent: string;                    // Which agent produced this
  matter_id: string;                // Which matter/project
  timestamp: string;                // ISO-8601
  result: any;                      // Agent-specific output (see each agent's OUTPUT FORMAT)
  evidence: Evidence[];             // What data was used
  decisions: Decision[];            // Decisions made, classified as MECHANICAL/TASTE/USER_CHALLENGE
  concerns?: string[];              // Issues found (if DONE_WITH_CONCERNS)
  questions?: Question[];           // Questions for PO (if NEEDS_CONTEXT)
  learnings?: Learning[];           // Things to log for future reference
}

interface Evidence {
  layer: 'ragflow' | 'mem0_facts' | 'mem0_graph';
  id: string;                       // Fact ID or chunk ID
  source_doc: string;               // Original document name
  source_date: string;              // When the source was created
  confidence: number;               // 1-10
}

interface Decision {
  classification: 'MECHANICAL' | 'TASTE' | 'USER_CHALLENGE';
  description: string;
  recommendation?: string;          // For TASTE and USER_CHALLENGE
  options?: Option[];               // For USER_CHALLENGE
}
```

---

## 4. Persistent Learning System

### 4.1 Per-Matter Learnings

```json
{
  "agent": "analysis|gap-detection|control-point|intake|meeting-prep|doc-gen|role-sim",
  "type": "pattern|pitfall|preference|domain-knowledge|client-behavior|process",
  "key": "kebab-case-identifier",
  "insight": "One-sentence description",
  "confidence": 1-10,
  "source": "observed|po-stated|inferred|cross-model",
  "matter_id": "project-123",
  "ts": "2026-03-31T14:30:00Z",
  "related_control_points": ["optional", "control", "point", "ids"]
}
```

**Deduplication:** By `(key, type)` — latest timestamp wins.

**Examples:**
```json
{"agent": "meeting-prep", "type": "preference", "key": "client-prefers-email", "insight": "Client prefers async communication — send questions via email rather than saving for meetings", "confidence": 10, "source": "po-stated", "matter_id": "nacxwan-2026", "ts": "2026-03-15T10:00:00Z"}
{"agent": "analysis", "type": "pitfall", "key": "hosting-contradiction-late-catch", "insight": "Hosting contradiction existed from Meeting 1 but wasn't caught until Meeting 3 analysis — need to run contradiction checks after EVERY document, not just meetings", "confidence": 9, "source": "observed", "matter_id": "nacxwan-2026", "ts": "2026-03-20T14:00:00Z"}
{"agent": "gap-detection", "type": "domain-knowledge", "key": "hipaa-missed-early", "insight": "Healthcare project — HIPAA compliance wasn't mentioned until Meeting 3. For healthcare projects, ask about compliance in Meeting 1.", "confidence": 9, "source": "observed", "matter_id": "healthapp-2026", "ts": "2026-03-22T09:00:00Z"}
```

### 4.2 Cross-Matter Learnings

Aggregated from per-matter learnings where `confidence >= 8` and pattern appears in 2+ matters:

```json
{"type": "cross-project", "industry": "healthcare", "key": "hipaa-missed-early", "insight": "HIPAA compliance is frequently omitted until late in discovery. Add to default control points for healthcare projects.", "confidence": 9, "source": "cross-matter", "matter_count": 3, "ts": "2026-03-25T10:00:00Z"}
{"type": "cross-project", "project_type": "greenfield", "key": "scalability-always-vague", "insight": "Scalability requirements are almost always vague in greenfield projects. Recommend specific questions: expected users at launch, 6 months, 1 year.", "confidence": 8, "source": "cross-matter", "matter_count": 5, "ts": "2026-03-28T10:00:00Z"}
```

---

## 5. Knowledge Layer Integration

### 5.1 Query Router

```python
def route_query(query: str, intent: str) -> List[str]:
    """Determine which knowledge layers to query based on intent."""

    routing_rules = {
        # Structured lookups → Mem0 facts first
        "is_covered": ["mem0_facts", "ragflow"],           # "Is auth confirmed?"
        "what_status": ["mem0_facts"],                      # "What's the hosting status?"
        "what_changed": ["mem0_facts"],                     # "What changed since last meeting?"
        "contradictions": ["mem0_facts"],                   # "Any contradictions?"

        # Relationship queries → Mem0 graph
        "who_decided": ["mem0_graph", "mem0_facts"],       # "Who decided on SSO?"
        "what_depends": ["mem0_graph"],                     # "What depends on the auth decision?"
        "stakeholder_map": ["mem0_graph"],                  # "Who's involved?"

        # Content retrieval → RAGFlow
        "find_text": ["ragflow"],                           # "What did client say about deployment?"
        "write_section": ["ragflow", "mem0_facts"],        # "Write the auth section"
        "full_context": ["ragflow"],                        # "Show me Meeting 2 discussion"

        # Comprehensive → all layers
        "gap_analysis": ["mem0_facts", "mem0_graph", "ragflow"],  # Full control point check
        "document_gen": ["ragflow", "mem0_facts", "mem0_graph"],  # Generate deliverable
    }

    return routing_rules.get(intent, ["mem0_facts", "ragflow"])
```

### 5.2 Fact Extraction Schema (for Mem0/Instructor)

```python
from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum

class FactStatus(str, Enum):
    NEW = "new"
    DISCUSSED = "discussed"
    CONFIRMED = "confirmed"
    CHANGED = "changed"
    RETRACTED = "retracted"

class FactConfidence(str, Enum):
    EXPLICIT = "explicit"        # Client directly stated this
    INFERRED = "inferred"        # Derived from context
    ASSUMED = "assumed"          # Common assumption, not stated
    CONTRADICTED = "contradicted" # Conflicts with another fact

class ExtractedFact(BaseModel):
    """A single discrete fact extracted from a document."""
    topic: str = Field(description="Category: business, technical, functional, organizational, scope")
    subject: str = Field(description="What this fact is about (e.g., 'hosting', 'auth method', 'budget')")
    value: str = Field(description="The factual content (e.g., 'Azure, single region')")
    status: FactStatus = Field(default=FactStatus.NEW)
    confidence_type: FactConfidence = Field(description="How this fact was derived")
    source_quote: str = Field(description="The exact quote from the document that supports this fact")
    control_points: List[str] = Field(default=[], description="Which control points this fact addresses")

class ExtractedEntity(BaseModel):
    """An entity mentioned in a document."""
    name: str
    type: str = Field(description="person, organization, feature, integration, decision, system, technology")
    role: Optional[str] = Field(default=None, description="For people: their role/title")

class ExtractedRelationship(BaseModel):
    """A relationship between two entities."""
    source: str = Field(description="Source entity name")
    target: str = Field(description="Target entity name")
    relationship: str = Field(description="decided, depends_on, requires, works_at, raised_concern, integrates_with, owns")
    context: str = Field(description="Brief context for this relationship")

class DocumentExtraction(BaseModel):
    """Complete extraction from a single document."""
    facts: List[ExtractedFact]
    entities: List[ExtractedEntity]
    relationships: List[ExtractedRelationship]
    contradictions: List[str] = Field(default=[], description="Potential contradictions noticed within this document")
```

---

## 6. Guardrails System

### 6.1 Agent Guardrails (adapted from gstack /careful)

| Action | Risk | Guardrail |
|--------|------|-----------|
| Mark control point COVERED | False confidence | Require Mem0 fact ID + source doc + confidence ≥ 8 |
| Mark control point N/A | Losing track | Require PO explicit approval |
| Generate documents at <70% readiness | Incomplete output | Block with warning, require PO override |
| Delete/overwrite a confirmed fact | Losing verified info | Require PO confirmation + log old value |
| Resolve contradiction automatically | Wrong resolution | NEVER auto-resolve. Always ASK. |
| Change control point template | Affects future projects | Require explicit PO approval |
| Send meeting agenda without review | Missing context | Always present to PO first |
| Claim "no gaps found" | False completion | Require ALL control points checked with evidence |

### 6.2 "Boil the Lake" Checklist

Before any agent claims "done":
- [ ] Did you check ALL relevant control points, not just the obvious ones?
- [ ] Did you query ALL THREE knowledge layers?
- [ ] Did you check for contradictions, not just confirmations?
- [ ] Did you include confidence scores for every claim?
- [ ] Did you provide source attribution for every fact?
- [ ] Did you flag assumptions separately from confirmed facts?
- [ ] Did you log learnings for this matter?

---

## 7. Mem0 Integration Details

> Full research: `research/17-mem0-technical-deep-dive.md`

### 7.1 Core Pipeline: 2+3 LLM Calls Per Document

```
Text → LLM Call 1 (extract facts) → LLM Call 2 (ADD/UPDATE/DELETE/NONE) → Vector Store
                                                                          ↓
Text → LLM Call 3 (extract entities) → LLM Call 4 (extract relationships) → LLM Call 5 (assess deletions) → Neo4j
```

### 7.2 Critical Customizations

**Custom Fact Extraction Prompt** (replace default personal-preference prompt):
```
Extract discrete facts about a software project: infrastructure decisions,
technical choices, requirements, constraints, scope, timeline, budget.
For each fact, include the exact supporting quote.
Output: {"facts": ["fact1", "fact2", ...]}
```

**Custom Update Prompt** (flag contradictions instead of auto-deleting):
- Change DELETE behavior to CONTRADICTION event
- Keep BOTH old and new facts
- Flag for PO resolution

**Custom Graph Extraction Prompt:**
- Entity types: Person, Organization, Feature, Integration, Decision, Technology
- Relationship types: decided, depends_on, requires, owns, raised_concern, integrates_with

### 7.3 Integration Pattern: Instructor + Mem0

```python
# 1. Extract with Instructor (validated, with source quotes, 6 stages)
result = extract_from_document(text, existing_facts, control_points)

# 2. Store in Mem0 with infer=False (skip redundant extraction)
for fact in result["facts"].facts:
    mem0.add(
        fact.statement,
        user_id=po_id,
        metadata={
            "matter_id": matter_id,
            "category": fact.category,
            "confidence": fact.confidence.value,
            "source_quote": fact.source_quote,
            "control_points": fact.control_points,
            "fact_status": "new",  # Our custom lifecycle field
        },
        infer=False,  # Skip Mem0's extraction — we already did it better
    )
```

### 7.4 Key Mem0 Patterns

- **UUID hallucination prevention**: Map UUIDs to integers before LLM, map back after
- **Graph soft-delete**: Relationships marked `valid=false` (not removed) — enables temporal reasoning
- **Multi-tenancy**: Filter-based via user_id/agent_id metadata (no physical isolation)
- **No project_id**: Use custom metadata `matter_id` for project scoping
- **No state machine**: Build fact lifecycle (new→discussed→confirmed→changed) via custom metadata

---

## 8. RAGFlow Integration Details

> Full research: `research/18-ragflow-technical-deep-dive.md`

### 8.1 Parsing Pipeline (DeepDoc)

```
PDF → page images → layout recognition (11 types) → table structure → text merge →
XGBoost vertical concatenation (31 features) → garbled page filter → table/figure extraction
```

**Key differentiators:**
- XGBoost model with 31-feature vector for vertical text concatenation
- K-Means column detection with silhouette score
- Dual-path OCR (pdfplumber + visual OCR with garbled text fallback)
- Position tracking: `@@page-list\tx0\tx1\ttop\tbottom##` for exact source citations

### 8.2 Chunking Templates for Discovery

| Document Type | Template | Why |
|--------------|----------|-----|
| Meeting notes | **book** | Handles bullet-point hierarchy |
| Emails | **email** | Native EML parsing, attachment handling |
| Technical specs | **manual** | Hierarchical section detection |
| Contracts | **laws** | Structure-preserving, clause-level |
| Presentations | **presentation** | Slide-per-chunk |
| Spreadsheets | **table** | Row-per-chunk with typed fields |
| Audio recordings | **audio** | Speech-to-text transcription |
| General docs | **naive** | Default with configurable overlap |

### 8.3 Search Configuration

```json
{
  "chunk_token_num": 512,
  "overlapped_percent": 10,
  "similarity_threshold": 0.3,
  "vector_similarity_weight": 0.7,
  "top_n": 10,
  "top_k": 1024
}
```

**Initial retrieval**: 95% vector / 5% keyword (BM25)
**Reranking**: 70% vector / 30% keyword, with PageRank (10x) and keyword multipliers (important: 5x, question tokens: 6x)

### 8.4 RAGFlow GraphRAG vs Mem0 Graph

| Feature | RAGFlow GraphRAG | Mem0 Graph |
|---------|-----------------|-----------|
| Purpose | Discovery-time exploration | Operational fact tracking |
| Entity resolution | LLM + edit distance | Embedding similarity (0.7) |
| Community detection | Leiden + LLM reports | None |
| PageRank | Yes (central to scoring) | No |
| Fact lifecycle | No (static) | Yes (ADD/UPDATE/DELETE) |
| Auto-update on new docs | No (manual re-run) | Yes (automatic dedup) |

**Use BOTH:** RAGFlow for exploration, Mem0 for operational tracking.

---

## 9. Orchestration Framework

> Full research: `research/17-multi-agent-orchestration-research.md`

### 9.1 Recommended Pattern: Hybrid DAG + Lightweight Supervisor

**Why DAG:**
- Parallel execution is native (BSP model)
- Dependencies are explicit graph edges
- Checkpointing enables human-in-the-loop
- State merging solved via reducers

**Why add Supervisor:**
- Dynamic routing for PO questions (which agent handles this?)
- Event-triggered flows follow predefined DAG paths
- User-triggered flows need classification first

### 9.2 Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           Entry Router (Supervisor)      │
                    │  Classifies: question / document /       │
                    │  meeting request → routes to DAG         │
                    └────────┬──────────┬──────────┬──────────┘
                             │          │          │
                ┌────────────▼─┐  ┌─────▼─────┐  ┌▼──────────┐
                │  Q&A Flow    │  │ Doc Flow   │  │ Meeting   │
                │  (DAG)       │  │ (DAG)      │  │ Flow (DAG)│
                └──────────────┘  └───────────┘  └───────────┘
```

**Document Upload Flow:**
```
Upload → Intake → [parallel: Analysis + Gap Detection] → Merge (reducer) →
Control Point (interrupt → PO review) → Document Generator
```

**Question Flow:**
```
PO Question → Router (classify) → conditional edge → appropriate agent → response
```

### 9.3 State Design

```python
class DiscoveryState:
    # Core (LastValue channels)
    request_type: str                     # "question" | "document" | "meeting"
    current_document: Document | None
    current_question: str | None

    # Accumulating (list append reducer)
    findings: list[Finding]               # merged from Analysis + Gap Detection
    recommendations: list[Recommendation]
    control_points: list[ControlPoint]

    # Knowledge layer refs
    doc_search_results: list[SearchResult]
    fact_store_results: list[Fact]
    entity_graph_context: list[Entity]

    # Human-in-the-loop
    pending_approval: ApprovalRequest | None
    approval_decision: bool | None

    # Conversation
    messages: list[Message]
```

### 9.4 Knowledge Layers as Shared Services

```python
class KnowledgeContext:
    doc_search: DocumentSearchService    # RAGFlow API
    fact_store: FactStoreService         # Mem0 API
    entity_graph: EntityGraphService     # Mem0 Graph API

# Injected into every agent — NOT separate graph nodes
def analysis_agent(state: DiscoveryState, knowledge: KnowledgeContext):
    relevant_docs = knowledge.doc_search.search(state.current_question)
    related_facts = knowledge.fact_store.query(...)
    entity_context = knowledge.entity_graph.traverse(...)
```

### 9.5 Implementation Choice

**Option A: Custom lightweight engine** (inspired by LangGraph's Pregel model)
- Full control, no framework lock-in
- More effort to build, but exactly fits our needs

**Option B: LangGraph directly**
- Fastest to ship, mature execution model
- Checkpointing, streaming, parallel execution out of the box
- Dependency on LangChain ecosystem

**Recommendation:** Start with LangGraph for speed, extract into custom engine later if needed.

---

## 10. Structured Output Extraction

> Full research: `research/19-structured-extraction-deep-dive.md`

### 10.1 Tool Choice: Instructor

- 40+ provider modes (Claude, GPT-4, Gemini, etc.)
- Pydantic validation with retry (feeds errors back to LLM)
- Citation validation pattern (verifies quotes exist in source)
- Full prompt control per extraction type

### 10.2 The 6-Stage Extraction Pipeline

```
Document → Stage 1: Classify (cheap model)
         → Stage 2: Extract facts with source quotes (capable model)
         → Stage 3: Extract entities (parallel with 4)
         → Stage 4: Extract relationships (parallel with 3)
         → Stage 5: Detect contradictions against existing facts
         → Stage 6: Assess control point coverage
```

### 10.3 LLM Calls Per Document (Total)

| Component | Calls | Model Tier |
|-----------|-------|------------|
| Instructor extraction (6 stages) | 6-13 | Cheap → Standard |
| Mem0 graph (entities + relationships + deletion) | 3 | Standard |
| **Total** | **9-16** | — |

Note: Using `infer=False` with Mem0 skips its redundant fact extraction (saves 2 calls).

### 10.4 Citation Validation Pattern (Critical)

```python
class Fact(BaseModel):
    statement: str
    source_quote: str = Field(description="Exact substring from source text")

    @field_validator('source_quote')
    @classmethod
    def quote_must_be_substantial(cls, v):
        if len(v.strip()) < 10:
            raise ValueError('Source quote must be at least 10 chars')
        return v
```

If LLM hallucinates a quote, validation fails → error sent back to LLM → retry with self-correction. Implements **verification-before-completion** from Superpowers at the extraction level.
