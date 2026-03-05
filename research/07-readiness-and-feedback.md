# Discovery Readiness & Feedback System

## The Problem

How does the PO know discovery is "done enough" to hand off to Phase 2?
And when it's not — what specific feedback helps them close the gaps?

## How It Works

Two layers: **AI evaluation** (continuous, automatic) + **PO decision** (human gate).

```
┌─────────────────────────────────────────────────────────┐
│                   DISCOVERY DASHBOARD                    │
│                                                         │
│  Project: NacXwan Outlook Add-in                        │
│                                                         │
│  Overall Readiness: 72% ██████████░░░░ NOT READY        │
│                                                         │
│  ┌─────────────────────────────┬──────┬────────┐        │
│  │ Area                        │Score │ Status │        │
│  ├─────────────────────────────┼──────┼────────┤        │
│  │ Business Understanding      │ 95%  │ ✅ OK  │        │
│  │ Functional Requirements     │ 80%  │ ⚠️ Gaps│        │
│  │ Technical Context           │ 55%  │ ❌ Weak│        │
│  │ Scope Freeze                │ 60%  │ ❌ Weak│        │
│  └─────────────────────────────┴──────┴────────┘        │
│                                                         │
│  🔴 3 Blocking gaps                                     │
│  🟡 5 Important gaps                                    │
│  🟢 2 Minor gaps                                        │
│                                                         │
│  [View Details]  [Generate Report]  [Mark as Ready ▶]   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Evaluation: How Readiness is Scored

### Per Control Point
Control points are **customized per project type** (see 03-discovery-agents-design.md).
When a project starts, the PO picks a template (Greenfield, Add-on, API, Mobile, etc.)
and can further customize items and weights. The Control Point Agent evaluates against
this project-specific checklist using RAG search across all ingested documents.

For each item, the agent assigns:

| Status | Meaning | How Determined |
|--------|---------|----------------|
| ✅ Covered | Information exists and is clear | Found in docs, confirmed by client |
| ⚠️ Partial | Some info exists but incomplete or ambiguous | Found but vague, contradictory, or assumed |
| ❌ Missing | No information found | Not mentioned in any ingested document |
| ➖ N/A | Not applicable to this project | PO explicitly marked as not relevant |

### Per Area (Business, Functional, Technical, Scope)
Area score = percentage of control points that are ✅ Covered or ➖ N/A.

### Overall Readiness Score
Weighted average across areas. Default weights below — PO can adjust per project.

| Area | Default Weight | Rationale |
|------|---------------|-----------|
| Business Understanding | 20% | Foundation — must be clear |
| Functional Requirements | 35% | Main input for Story/Tech Doc Assistant |
| Technical Context | 20% | Important but TL can fill gaps in Phase 2 |
| Scope Freeze | 25% | Defines boundaries — critical for handoff |

Example weight overrides:
- **API project** → Technical Context 40%, Functional 20% (heavy integration focus)
- **Feature extension** → Business 10%, Functional 40% (already know the product)
- **Mobile app** → even split, all areas matter equally

### Readiness Thresholds

| Score | Status | Meaning |
|-------|--------|---------|
| 85%+ | 🟢 **Ready** | Safe to hand off. Minor gaps won't block Phase 2. |
| 65-84% | 🟡 **Conditionally Ready** | Can hand off if PO accepts risks. Gaps listed. |
| <65% | 🔴 **Not Ready** | Significant gaps will block Phase 2 users. |

## Feedback: What the System Tells the PO

### When Not Ready (🔴)

The system generates a **Blocking Gaps Report**:

```
❌ DISCOVERY NOT READY FOR HANDOFF

3 Blocking Gaps Found:

1. TECHNICAL CONTEXT: Hosting requirements unknown
   → No documents mention where the system will be deployed.
   → Phase 2 impact: Tech Lead cannot write architecture specs without this.
   → Suggested action: Ask client "Who will host the production environment?"
   → Suggested stakeholder: Client CTO or IT lead

2. SCOPE: Out-of-scope items not defined
   → MVP features are listed but nothing is explicitly excluded.
   → Phase 2 impact: Risk of scope creep, Story assistant may over-generate.
   → Suggested action: Create explicit "Out of Scope" list with client sign-off.

3. FUNCTIONAL: Authentication method not decided
   → Meeting notes mention "we'll figure out auth later."
   → Phase 2 impact: Cannot write auth-related stories or tech specs.
   → Suggested action: Decide OAuth2 vs. SAML vs. API key in next meeting.

Recommended: Schedule one more client meeting focused on items 1-3.
[Generate Meeting Agenda for These Gaps]
```

### When Conditionally Ready (🟡)

```
⚠️ DISCOVERY CONDITIONALLY READY

Overall: 78%

Can proceed, but Phase 2 users should be aware of:

Gaps that won't block but may cause rework:
1. Edge cases for Feature X not explored (Functional, 🟡 Important)
   → Story assistant will generate stories without edge case coverage.
   → May need revision after QA finds issues.

2. Competitive landscape incomplete (Business, 🟢 Minor)
   → Won't affect Phase 2 directly, but useful for prioritization.

Assumptions not yet validated by client:
- "Users will authenticate via Microsoft accounts" (from meeting 2024-01-15)
- "Maximum 500 concurrent users" (PO estimate, not confirmed)

[Accept Risks & Mark Ready]  [Address Gaps First]
```

### When Ready (🟢)

```
✅ DISCOVERY READY FOR HANDOFF

Overall: 91%

All areas above threshold:
- Business Understanding: 95% ✅
- Functional Requirements: 88% ✅
- Technical Context: 85% ✅
- Scope Freeze: 95% ✅

Remaining minor gaps (won't block Phase 2):
- Competitive analysis could be deeper (optional)

Assumptions to flag in handoff docs: 2
(These are clearly marked in the output documents)

Generated documents ready for Phase 2:
📄 Project Discovery Brief — complete
📄 MVP Scope Freeze — complete
📄 Functional Requirements — complete

[Export Documents]  [Mark Project as Handed Off]
```

## Continuous Feedback (During Discovery)

The readiness score updates every time new information is ingested.
PO gets ongoing feedback, not just at the end.

### After Every Document Ingestion
```
📥 New document ingested: "Meeting notes 2024-02-10"

Updated scores:
- Technical Context: 55% → 70% (+15%)
  ✅ Now covered: Hosting requirements (client confirmed Azure)
  ✅ Now covered: CI/CD approach (GitHub Actions)
  ⚠️ Still partial: API contracts (endpoints listed but no auth details)

Overall readiness: 72% → 78%

Remaining blocking gaps: 2 (was 3)
```

### Weekly Digest (if discovery runs long)
```
📊 Weekly Discovery Health — Project: NacXwan

Progress this week:
- Readiness: 60% → 78% (+18%)
- Documents ingested: 4
- Gaps closed: 5
- New gaps found: 1

Stale items (no progress in 7+ days):
- "API authentication method" — open since Jan 15
- "Data retention policy" — open since Jan 20

Suggested: Follow up with client on stale items.
[Generate Follow-up Email Draft]
```

## PO Decision Gate

Regardless of the score, the **PO makes the final call**. The system recommends
but doesn't block.

```
PO actions:
├── "Mark as Ready" — exports docs, records handoff date, notifies Phase 2 team
├── "Address Gaps" — routes to Gap Detection Agent for next steps
├── "Mark N/A" — mark specific control points as not applicable
└── "Override" — PO can hand off below threshold with explicit justification
                 (justification is recorded in discovery log)
```

## After Handoff

If Phase 2 users find issues:
1. They flag it to the PO
2. PO reopens the discovery project
3. New info is ingested, control points re-evaluated
4. Updated docs are re-exported
5. Phase 2 users get the updated version with a change log
