# Control Points & Readiness System

## Why Control Points

Discovery has no natural endpoint. Without structure, it either drags on
indefinitely or stops too early — leaving Phase 2 users with gaps they
can't fill.

Control points solve this by making discovery completeness **measurable
and deterministic**. Instead of the PO guessing "I think we have enough,"
the system tells them exactly what's covered, what's partial, and what's
missing.

This works because the Fact Store (Mem0) maintains structured, deduplicated
knowledge. The Control Point Agent doesn't search for text — it checks
whether specific facts exist and are confirmed. That's a yes/no lookup,
not a probabilistic search.

---

## How It Works

```
1. PO creates project → selects project type template
2. System loads the matching control point checklist
3. PO reviews and customizes (add, remove, reweight items)
4. As documents are ingested, Control Point Agent evaluates
   each item against Mem0 facts
5. Readiness score updates continuously
6. PO uses score + feedback to decide when to hand off
```

---

## Control Point Evaluation

For each item on the checklist, the Control Point Agent assigns a status
by querying the Fact Store (Mem0):

| Status | Meaning | How determined |
|--------|---------|----------------|
| ✅ **Covered** | Information exists and is confirmed | Fact exists in Mem0, status = confirmed |
| ⚠️ **Partial** | Some info exists but incomplete or ambiguous | Fact exists but status = discussed/assumed, or related facts are incomplete |
| ❌ **Missing** | No information found | No relevant fact in Mem0 |
| ➖ **N/A** | Not applicable to this project | PO explicitly marked as not relevant |

**Example — "Authentication method decided":**
- Mem0 has: `{fact: "Auth method: Microsoft SSO", status: "confirmed", source: "Meeting 4"}`
- → ✅ Covered

**Example — "Performance targets defined":**
- Mem0 has: `{fact: "Concurrent users: ~500", status: "assumed", source: "PO estimate"}`
- → ⚠️ Partial (exists but not confirmed by client)

**Example — "Data retention policy":**
- No relevant fact in Mem0
- → ❌ Missing

---

## Readiness Scoring

### Per Area

Control points are grouped into areas. Area score = percentage of items
that are ✅ Covered or ➖ N/A.

### Overall Score

Weighted average across areas. Weights are configurable per project.

| Area | Default Weight | Rationale |
|------|---------------|-----------|
| Business Understanding | 20% | Foundation — must be clear |
| Functional Requirements | 35% | Main input for Phase 2 (Story/Tech Doc Assistant) |
| Technical Context | 20% | Important but Tech Lead can fill gaps in Phase 2 |
| Scope Freeze | 25% | Defines boundaries — critical for handoff |

**Example weight overrides per project type:**
- **API project** → Technical 40%, Functional 20% (heavy integration focus)
- **Feature extension** → Business 10%, Functional 40% (already know the product)
- **Mobile app** → even split, 25% each

### Thresholds

| Score | Status | Meaning |
|-------|--------|---------|
| 85%+ | **Ready** | Safe to hand off. Minor gaps won't block Phase 2. |
| 65-84% | **Conditionally Ready** | Can hand off if PO accepts risks. Gaps documented. |
| Below 65% | **Not Ready** | Significant gaps will block Phase 2 users. |

---

## Project Type Templates

When a PO creates a new discovery project, they select a project type.
This loads a pre-configured control point checklist which the PO can
then customize.

### Default (Base Template)

Used as the starting point for all projects. Other templates extend or modify this.

**Business Understanding**
- [ ] Business problem clearly stated
- [ ] Business goals / success metrics defined
- [ ] Target market / users identified
- [ ] Budget and timeline constraints known
- [ ] Key stakeholders identified and interviewed

**Functional Requirements**
- [ ] Core user personas defined
- [ ] Primary user flows mapped
- [ ] Feature list prioritized (MoSCoW or similar)
- [ ] Acceptance criteria for key features defined
- [ ] Non-functional requirements specified (performance, security, etc.)

**Technical Context**
- [ ] Existing systems / integrations identified
- [ ] Technical constraints documented
- [ ] Hosting / deployment requirements known

**Scope Freeze**
- [ ] MVP scope agreed with client
- [ ] Out-of-scope items explicitly listed
- [ ] Assumptions documented and validated
- [ ] Sign-off obtained from all stakeholders

---

### Greenfield Web App

New product from scratch. Heavier on business context and architecture.

Adds to Default:
- [ ] Competitive landscape understood
- [ ] User research conducted (interviews, surveys, or market data)
- [ ] Data model / entities sketched
- [ ] API design approach agreed
- [ ] Hosting / infrastructure provider decided
- [ ] Compliance / regulatory requirements identified (GDPR, etc.)
- [ ] Scalability targets defined
- [ ] Risk register created

---

### Add-on / Plugin (e.g., Outlook Add-in, Shopify App)

Extending an existing platform. Heavy on integration constraints.

Adds to Default:
- [ ] Host platform version / API compatibility confirmed
- [ ] Platform-specific limitations documented
- [ ] Auth integration method decided (platform SSO, OAuth, etc.)
- [ ] Deployment / distribution method defined (store, manifest, sideload)
- [ ] Platform review / approval requirements understood
- [ ] Existing platform data access points mapped

Removes from Default:
- ~~Competitive landscape~~ (usually not applicable)
- ~~Hosting / deployment requirements~~ (platform dictates this)

---

### Feature Extension

Adding features to an existing product. Lighter discovery, focused on what changes.

Adds to Default:
- [ ] Impact on existing features assessed
- [ ] Migration / backward compatibility considered
- [ ] Existing codebase constraints documented

Removes from Default:
- ~~Target market / users identified~~ (already known)
- ~~Budget and timeline constraints~~ (usually pre-set)

**Note:** When the client provides a repo, Claude Code analysis automatically
populates "Existing codebase constraints" with architecture, stack, and
dependency information.

---

### API / Integration Project

Building connectors, middleware, data pipelines. Heavy on technical context.

Adds to Default:
- [ ] All external API docs collected and reviewed
- [ ] API authentication methods confirmed for each integration
- [ ] Data mapping between systems defined
- [ ] Error handling / retry strategy agreed
- [ ] Rate limits and quotas documented
- [ ] Data format / schema compatibility verified
- [ ] Monitoring / alerting requirements defined

Removes from Default:
- ~~Core user personas~~ (often system-to-system)
- ~~Primary user flows~~ (may not have a UI)

---

### Mobile App

Mobile-specific concerns on top of standard discovery.

Adds to Default:
- [ ] Target platforms decided (iOS, Android, both)
- [ ] Minimum OS versions defined
- [ ] Offline capability requirements known
- [ ] Push notification requirements defined
- [ ] App store submission requirements understood
- [ ] Device-specific constraints documented (camera, GPS, etc.)
- [ ] Deep linking requirements defined

---

### Custom (Blank)

PO builds the checklist from scratch, picking items from any template
or creating new items.

---

## PO Customization

After selecting a template, the PO can customize it for their specific project:

| Action | Example |
|--------|---------|
| **Add items** | "Add: HIPAA compliance audit required" |
| **Remove items** | Remove "Competitive landscape" — not relevant |
| **Change weights** | Make Technical Context 40% instead of 20% |
| **Add areas** | Add a "Security" area with its own control points |
| **Mark N/A** | Mark item as not applicable (doesn't count in score) |
| **Save as template** | Save this customized checklist for future projects |

Customizations are saved per project. If the PO creates a configuration
they want to reuse, they can save it as a new template available to all
POs in the organization.

---

## Continuous Feedback

The readiness score updates every time new information is ingested.
POs get ongoing feedback — not just at the end.

### After Every Document Ingestion

```
New document ingested: "Meeting notes Feb 10"

Updated scores:
- Technical Context: 55% → 70% (+15%)
  ✅ Now covered: Hosting requirements (client confirmed Azure)
  ✅ Now covered: CI/CD approach (GitHub Actions)
  ⚠️ Still partial: API contracts (endpoints listed but no auth details)

Overall readiness: 72% → 78%
Remaining blocking gaps: 2 (was 3)
```

### After Repo Analysis

```
Client repo analyzed via Claude Code

Updated scores:
- Technical Context: 30% → 55% (+25%)
  ✅ Now covered: Current tech stack (React 18, Express, PostgreSQL)
  ✅ Now covered: Existing integrations (Stripe, SendGrid)
  ✅ Now covered: Codebase constraints (monolith, no tests)
  ⚠️ Partial: 3 undocumented internal APIs (need client clarification)

Overall readiness: 45% → 58%
Suggested: Ask client about the 3 internal APIs in next meeting
```

### Weekly Digest (for long-running discoveries)

```
Weekly Discovery Health — NacXwan Project

Progress this week:
- Readiness: 60% → 78% (+18%)
- Documents ingested: 4
- Gaps closed: 5
- New gaps found: 1

Stale items (no progress in 7+ days):
- "API authentication method" — open since Jan 15
- "Data retention policy" — open since Jan 20

Suggested: Follow up with client on stale items.
```

### Alerts

The system proactively alerts the PO when something needs attention:

| Alert | Trigger | Example |
|-------|---------|---------|
| **Stalling** | No new info ingested in X days | "No new documents in 10 days. 4 gaps still open." |
| **Regression** | Score went down | "Readiness dropped 78% → 72%. New contradiction found in hosting." |
| **Scope creep** | New items appearing not in original scope | "3 new features mentioned in Meeting 5 that weren't in scope." |
| **Contradiction** | Mem0 detected conflicting facts | "Meeting 3: single-tenant. Email Feb 3: multi-tenant." |

---

## Feedback by Readiness Level

### Not Ready (Below 65%)

The system generates a **Blocking Gaps Report**:

```
DISCOVERY NOT READY FOR HANDOFF

3 Blocking Gaps Found:

1. TECHNICAL: Hosting requirements unknown
   → No documents mention where the system will be deployed.
   → Phase 2 impact: Tech Lead cannot write architecture specs.
   → Suggested action: Ask client "Who will host production?"
   → Ask: Client CTO or IT Lead

2. SCOPE: Out-of-scope items not defined
   → MVP features listed but nothing explicitly excluded.
   → Phase 2 impact: Risk of scope creep in story generation.
   → Suggested action: Create explicit "Out of Scope" list.

3. FUNCTIONAL: Authentication method not decided
   → Meeting notes mention "we'll figure out auth later."
   → Phase 2 impact: Cannot write auth-related stories or specs.
   → Suggested action: Decide in next meeting.

Recommended: Schedule one more client meeting focused on items 1-3.
```

### Conditionally Ready (65-84%)

```
DISCOVERY CONDITIONALLY READY — 78%

Can proceed, but Phase 2 users should be aware of:

Gaps that won't block but may cause rework:
1. Edge cases for Feature X not explored
   → Story assistant will generate stories without edge case coverage.
   → May need revision after QA finds issues.

Assumptions not yet validated by client:
- "Users will authenticate via Microsoft accounts" (from Meeting 2)
- "Maximum 500 concurrent users" (PO estimate, not confirmed)

[Accept Risks & Mark Ready]  [Address Gaps First]
```

### Ready (85%+)

```
DISCOVERY READY FOR HANDOFF — 91%

All areas above threshold:
- Business Understanding: 95% ✅
- Functional Requirements: 88% ✅
- Technical Context: 85% ✅
- Scope Freeze: 95% ✅

Remaining minor gaps (won't block Phase 2):
- Competitive analysis could be deeper (optional)

Assumptions flagged in handoff docs: 2
(Clearly marked in the output documents)

Generated documents ready for Phase 2:
  Project Discovery Brief — complete
  MVP Scope Freeze — complete
  Functional Requirements — complete

[Export Documents]  [Mark Project as Handed Off]
```

---

## PO Decision Gate

Regardless of the score, the **PO makes the final call**. The system
recommends but does not block.

| PO Action | What happens |
|-----------|-------------|
| **Mark as Ready** | Exports documents, records handoff date, notifies Phase 2 team |
| **Address Gaps** | Routes to Gap Detection Agent for prioritized next steps |
| **Mark N/A** | Mark specific control points as not applicable (adjusts score) |
| **Override** | Hand off below threshold with explicit justification (recorded in log) |

The override option exists because POs sometimes know that a gap is
acceptable for a specific project. The justification is recorded so
Phase 2 users understand why certain items are missing.

---

## After Handoff

Discovery doesn't always end cleanly. If Phase 2 users find issues:

1. They flag it to the PO
2. PO reopens the discovery project
3. New information is ingested, control points re-evaluated
4. Updated documents are re-exported
5. Phase 2 users get the updated version with a change log

The knowledge base retains everything — reopening doesn't lose prior work.
It just adds new information on top and re-evaluates readiness.
