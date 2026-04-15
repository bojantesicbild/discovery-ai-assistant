# Build Instruction: Discovery SKILL.md

## Goal

Create `.claude/skills/discovery/SKILL.md` — the domain orchestration file for the
discovery phase. This file tells Claude Code HOW to run a discovery session.

## Context

This SKILL.md follows the same pattern as the existing crnogochi-assistants skills:
- `.claude/skills/coding/SKILL.md` — coding domain
- `.claude/skills/tech-stories/SKILL.md` — tech-stories domain
- `.claude/skills/qa/SKILL.md` — QA domain

Reference these files at `/Users/bojantesic/git-tests/crnogochi-assistants/.claude/skills/`
for the exact format, style, and patterns used. Match their structure precisely.

## Key Design Principle

**All discovery data flows through the MCP server (`discovery` MCP).**
The agent does NOT write .memory-bank/ files for discovery state.
Instead, it calls MCP tools like `store_requirement()`, `get_readiness()`, etc.
The only files it writes are the final handoff documents to `.memory-bank/docs/discovery/`.

## Structure to Follow

```markdown
# Discovery Skill

[DISCOVERY-SKILL-LOADED]

## When to Use
## Anti-Patterns (NEVER do these)
## Classification
## State Checks
## Workflows
## Checkpoints (with Anti-Rationalization)
## Scope Lock
## Three-Strikes Rule
## Active Task Updates
## Available Agents
```

## Detailed Specifications

### When to Use

Activated when user message contains: discovery, readiness, gaps, requirements,
client said, meeting prep, handoff, constraints, stakeholders, assumptions,
scope, contradictions, control points, prepare meeting, generate docs.

### Anti-Patterns (NEVER do these)

```
- "Storing discovery data in .memory-bank/ files" (All discovery data goes through MCP server)
- "Extracting requirements without source quotes" (Every requirement needs exact source quote)
- "Marking requirements as confirmed without explicit client statement" (Confirmed = client explicitly said it, not inferred)
- "Skipping gap analysis before generating documents" (Documents from incomplete data are worse than no documents)
- "Auto-resolving contradictions" (Contradictions always surface to user for resolution)
- "Generating handoff docs below 70% readiness without explicit user approval" (Warn first, get confirmation)
```

### Classification

| Priority | Pattern | Action |
|----------|---------|--------|
| 1 | After any MCP store call | Update status → show what was stored |
| 2 | "now"/"also"/"next" + active discovery task | Continuation → Workflow B |
| 3 | User pastes/references client communication (meeting notes, emails, docs) | Document Processing → Workflow A |
| 4 | "gaps"/"what's missing"/"readiness"/"status" | Gap Analysis → Workflow C |
| 5 | "prepare meeting"/"meeting agenda"/"next meeting" | Meeting Prep → use discovery-prep-agent |
| 6 | "generate docs"/"handoff"/"create deliverables" | Document Generation → use discovery-docs-agent |
| 7 | "research"/"look up"/"find out about" + company/competitor/industry | Web Research → Workflow D |
| 8 | Question about discovery data (no action implied) | Query → search via MCP |
| 9 | Ambiguous | Ask for clarification |

### State Checks

Before any task work:
1. Read `.memory-bank/active-tasks/discovery.md`
2. Check content — placeholders only → Initialize & proceed
3. Real work documented → Show task detection prompt & WAIT
4. Update `.memory-bank/active-task.md` router: Current Domain = discovery

### Workflows

#### Workflow A: Process New Client Document

When the user provides client communication (meeting notes, email, document):

```
1. Read/receive the document content
2. Extract typed business data using the extraction framework:
   → Requirements (FR-xxx, NFR-xxx) with MoSCoW priority
   → Constraints (budget, timeline, technology, regulatory)
   → Decisions (who decided what, why, alternatives)
   → Stakeholders (name, role, authority level)
   → Assumptions (what we believe + risk if wrong)
   → Scope items (explicitly in/out of MVP)
   → Contradictions (vs existing data from MCP get_requirements)
3. For EACH extracted item, call the appropriate MCP store tool:
   → store_requirement(), store_constraint(), store_decision(), etc.
4. Check for contradictions: compare new items against existing via MCP
   → If found: call store_contradiction() and surface to user
5. After storing, call get_readiness() to show updated score
6. [GATE: Extraction Review] — Show user what was extracted, ask to confirm/edit
7. Update active-tasks/discovery.md
```

**Extraction Framework** — For each type, extract:

**Requirements:**
- ID: auto-generate FR-001, NFR-001 etc. (check existing via MCP to avoid dupes)
- Title: short descriptive name
- Type: functional or non_functional
- Priority: must/should/could/wont (infer from language: "critical", "nice to have", "must", "optional")
- Description: what the system shall do
- User perspective: "As a [role], I want [X], so that [Y]" (generate if not explicit)
- Business rules: specific rules mentioned
- Edge cases: edge cases mentioned or obvious ones
- Source quote: EXACT quote from the document (minimum 10 characters)
- Status: proposed (default for new), discussed (if mentioned in multiple docs), confirmed (only if client EXPLICITLY confirmed)
- Confidence: high (explicit statement), medium (implied), low (inferred)

**Constraints:**
- Type: budget/timeline/technology/regulatory/organizational
- Description: what the constraint is
- Impact: how it limits the project
- Source quote: exact quote
- Status: confirmed/assumed/negotiable

**Decisions:**
- Title: what was decided
- Decided by: person name + role
- Rationale: why this was chosen
- Alternatives considered: what else was discussed
- Source quote: exact quote
- Status: confirmed/tentative/reversed

**Stakeholders:**
- Name, role, organization
- Decision authority: final/recommender/informed
- Interests: what they care about

**Assumptions:**
- Statement: what we believe
- Basis: why we assume this
- Risk if wrong: what breaks
- Needs validation by: who should confirm

**Scope Items:**
- Description: feature or capability
- In scope: true/false
- Rationale: why in or out

#### Workflow B: Continuation

1. Read active-tasks/discovery.md for current state
2. Call get_project_context() from MCP for latest status
3. Continue where left off
4. Update progress

#### Workflow C: Gap Analysis

1. Call MCP: get_gaps(project_id)
2. Call MCP: get_readiness(project_id)
3. Call MCP: get_contradictions(project_id)
4. Dispatch discovery-gap-agent for structured analysis
5. Present results with Fix-First classification:
   - AUTO-RESOLVE: gaps fillable from existing data → fill + confirm with user
   - ASK-CLIENT: needs client input → generate specific question + priority
   - ASK-PO: needs internal judgment → present decision + recommendation
6. Show readiness score with per-area breakdown

#### Workflow D: Web Research

1. Clarify what to research (company, competitor, technology, industry)
2. Use web_research() MCP tool or built-in WebSearch/WebFetch
3. Present findings to user for review
4. [GATE: Research Review] — user confirms which findings to store
5. Store confirmed findings via MCP store tools

### Checkpoints

#### Gate: Extraction Review

After processing a document, show:
```
Extracted from [document name]:
─────────────────────────────
Requirements: [N] new ([list titles])
Constraints: [N] new
Decisions: [N] new
Stakeholders: [N] new/updated
Assumptions: [N] new
Scope items: [N] new
Contradictions: [N] found

Readiness: [X]% (was [Y]%)

Review the extraction above. Options:
(a) Approve all — store as shown
(b) Edit — I'll correct specific items
(c) Re-extract — try again with different focus
(d) Cancel — discard this extraction
```

#### Anti-Rationalization (applies to ALL checkpoints)

```
Do NOT skip any checkpoint because:
| Excuse | Why It's Wrong |
|--------|---------------|
| "The extraction is obviously correct" | LLMs hallucinate source quotes. User must verify. |
| "Only 2 items extracted, not worth reviewing" | 2 wrong items corrupt the knowledge base. Review. |
| "The user already saw the document" | Seeing ≠ verifying extraction. Different things. |
| "I'll ask after storing" | Stored wrong data creates contradictions. Verify first. |
| "The readiness score barely changed" | Small changes can flip control point status. Show it. |

If you catch yourself thinking any of these → STOP, re-read this SKILL.md.
```

### Scope Lock

Once user approves an extraction at a checkpoint:
- Approved items are stored via MCP. Do NOT modify them without new checkpoint.
- Do NOT re-extract from the same document unless user asks.
- Do NOT add items the user didn't see in the extraction review.
- If you discover something new → STOP, show new checkpoint, get approval.

### Three-Strikes Rule

If 3 extraction attempts from the same document produce unsatisfactory results:
1. STOP
2. Document: what you tried, why each was unsatisfactory
3. Present options:
   (a) User manually identifies key items from the document
   (b) Try with a different extraction focus (just requirements, or just decisions)
   (c) Mark document as "needs human review" and move on

### Active Task Updates

Update `.memory-bank/active-tasks/discovery.md` checkboxes:
- [ ] Context loaded (MCP get_project_context called)
- [ ] Document received/identified
- [ ] Extraction complete
- [ ] User approved extraction
- [ ] Items stored via MCP
- [ ] Readiness updated
- [ ] Completion prompt shown

### Available Agents

| Agent | Use When |
|-------|----------|
| discovery-gap-agent | User asks about gaps, readiness, what's missing, or wants full analysis |
| discovery-docs-agent | User requests handoff documents (discovery brief, scope freeze, requirements) |
| discovery-prep-agent | User wants to prepare for a client meeting |
| research-agent | Deep research on unfamiliar technology, industry, or competitor |

### Control Point Templates (Reference)

When evaluating readiness, these are the control point areas and weights:

```
Business Understanding (20%):
- Business problem clearly stated
- Business goals / success metrics defined
- Target market / users identified
- Budget and timeline constraints known
- Key stakeholders identified

Functional Requirements (35%):
- Core user personas defined
- Primary user flows mapped
- Feature list prioritized (MoSCoW)
- Acceptance criteria for key features
- Non-functional requirements specified

Technical Context (20%):
- Existing systems / integrations identified
- Technical constraints documented
- Hosting / deployment requirements known

Scope Freeze (25%):
- MVP scope agreed with client
- Out-of-scope items explicitly listed
- Assumptions documented and validated
- Sign-off path identified
```

Project type templates (Greenfield, Add-on, API, Mobile, Feature Extension)
add additional control points per type. The MCP server returns the appropriate
template via get_control_points().

## File Location

```
/Users/bojantesic/git-tests/crnogochi-assistants/.claude/skills/discovery/SKILL.md
```

## Reference Materials

Read these research documents for detailed specifications:
- `research/32-simplification-and-requirements.md` — the 6 typed extraction models
- `research/03-discovery-agents-design.md` — control point templates per project type
- `research/04-output-templates.md` — handoff document formats
- `research/07-readiness-and-feedback.md` — readiness scoring and feedback
- `research/14-superpowers-research.md` — anti-rationalization patterns
- `research/15-gstack-research.md` — Fix-First classification, scope modes
- `research/00-what-is-discovery-assistant.md` — typical PO workflow week by week

## Success Criteria

- [ ] SKILL.md follows crnogochi format exactly (match existing skills)
- [ ] All data flows through MCP (no .memory-bank/ file writes for discovery state)
- [ ] Extraction produces all 6 typed categories with correct fields
- [ ] Every extracted item has a source quote
- [ ] Checkpoints show extraction summary and wait for user approval
- [ ] Anti-rationalization block present at every checkpoint
- [ ] Scope lock enforced after approval
- [ ] Three-strikes rule for failed extractions
- [ ] Readiness score shown after every change
