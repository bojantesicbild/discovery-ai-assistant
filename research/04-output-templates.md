# Discovery Output Templates

These are the documents that the Discovery Assistant produces.
They serve as the **input for Phase 2** — where POs and Tech Leads use the
Story/Tech Doc Assistant to generate detailed specs, user stories, and PBIs.

Discovery docs should be comprehensive overview documents — rich enough that
Phase 2 users can work without going back to raw meeting recordings or emails.

---

## Template 1: Project Discovery Brief

The main overview document. First thing Phase 2 users read to understand the project.

```
# Project Discovery Brief - [Project Name]

## 1. Client Overview
- Company:
- Industry:
- Company size:
- Key contacts:
  - Name | Role | Email | Decision authority

## 2. Business Context
- Current situation / pain point:
- Business objectives:
- Success metrics (KPIs):
- Timeline expectations:
- Budget range:

## 3. Target Users
- Primary persona:
  - Who:
  - Goals:
  - Pain points:
  - Technical proficiency:
- Secondary persona(s):

## 4. Competitive / Market Context
- Existing solutions client uses:
- Competitor products:
- Key differentiators needed:

## 5. Discovery Status
- Completeness: X%
- Assumptions (not yet validated by client):
- Open questions:
```

---

## Template 2: MVP Scope Freeze

Based on the NacXwan document structure. The key deliverable that defines
what gets built and what doesn't.

```
# MVP Scope Freeze Summary - [Project Name]

## 1. Purpose & MVP Goal
- What MVP delivers:
- Based on: [POC results / client discussions / market research]
- Intended to be: [usable, stable, deployable...]

## 2. Supported Platforms & Entry Points
- Platforms:
- Access points:
- Explicitly excluded:

## 3. Authentication & User Identity
- Auth method:
- Identity handling:
- Token management:

## 4. Core Functionalities (MVP)
### 4.1 [Feature 1]
- Description:
- User can:
- System behavior:

### 4.2 [Feature 2]
...

## 5. Integration Points
- External APIs:
- Third-party services:
- Dependencies:

## 6. Deployment & Distribution
- Distribution method:
- Installation:
- Hosting model:

## 7. UI/UX Scope
- Branding elements:
- Design constraints:

## 8. Out of Scope for MVP
- [Explicit list of excluded items]

## 9. Assumptions & Risks
- Assumptions:
- Risks:
- Mitigations:

## 10. Sign-off
- Client: [Name] | [Date]
- PO: [Name] | [Date]
- TL: [Name] | [Date]
```

---

## Template 3: Functional Requirements Overview

High-level functional requirements. The Story/Tech Doc Assistant will expand these
into detailed user stories, PBIs, and technical specs.

```
# Functional Requirements - [Project Name]

## 1. Overview
- Project description:
- Business objective:
- Target users:

## 2. User Roles & Permissions
| Role | Description | Key Permissions |
|------|-------------|-----------------|

## 3. Functional Requirements
### FR-001: [Feature Name]
- Priority: [Must/Should/Could/Won't]
- Description:
- User perspective: As a [role], I want to [action], so that [benefit]
- Key business rules:
- Known edge cases:
- UI/UX notes:

### FR-002: [Feature Name]
...

## 4. Non-Functional Requirements
- Performance:
- Security:
- Scalability:
- Accessibility:

## 5. Technical Context
- Existing systems / integrations:
- Technical constraints from client:
- Hosting / deployment requirements:

## 6. Assumptions
-

## 7. Dependencies
-

## 8. Out of Scope
-

## 9. Glossary
| Term | Definition |
|------|-----------|
```

---

## Template 4: Meeting Summary

Working document updated after every client interaction.

```
# Meeting Summary - [Date] - [Project Name]

## Attendees
- [Name] | [Role] | [Company]

## Agenda Items Covered
1.
2.

## Key Decisions Made
-

## New Information Learned
-

## Action Items
| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|

## Open Questions (Unresolved)
-

## Next Meeting
- Date:
- Focus:
- Preparation needed:

## Impact on Discovery
- Control points updated:
- New gaps identified:
- Completeness change: X% → Y%
```

---

## Template 5: Gap Analysis Report

Internal working document. Helps PO know what to ask in the next meeting.

```
# Gap Analysis Report - [Project Name] - [Date]

## Discovery Completeness: X%

## Critical Gaps (Blocking)
| Gap | Category | Impact | Suggested Question | Who Should Answer |
|-----|----------|--------|-------------------|-------------------|

## Important Gaps (High Priority)
| Gap | Category | Impact | Suggested Question | Who Should Answer |
|-----|----------|--------|-------------------|-------------------|

## Minor Gaps (Nice to Have)
| Gap | Category | Impact | Suggested Question | Who Should Answer |
|-----|----------|--------|-------------------|-------------------|

## Recommendations
- Next meeting should focus on:
- Documents to request from client:
- Internal analysis needed:
```

---

## Template 6: Multi-Perspective Analysis

Optional deeper analysis for complex features or decisions.

```
# Multi-Perspective Analysis - [Feature/Decision]

## End User Perspective
- Usability assessment:
- Pain points:
- Expected workflow:

## Admin Perspective
- Manageability:
- Configuration needs:
- Monitoring requirements:

## Developer Perspective
- Technical feasibility:
- Complexity estimate:
- Dependencies:
- Risks:

## Business Owner Perspective
- ROI alignment:
- Market fit:
- Revenue impact:

## UX Perspective
- Flow coherence:
- Accessibility:
- Consistency with patterns:

## Conflicts Detected
| Perspective A | Perspective B | Conflict | Suggested Resolution |
|--------------|--------------|----------|---------------------|

## Recommendation
-
```

---

## Summary: What Discovery Produces

| Document | Purpose | Used By |
|----------|---------|---------|
| Project Discovery Brief | Big picture overview | Everyone |
| MVP Scope Freeze | What's in/out of scope | PO, TL, Client |
| Functional Requirements | Feature-level detail | Story/Tech Doc Assistant (Phase 2) |
| Meeting Summaries | Decision log, action tracking | PO (internal) |
| Gap Analysis | What's missing, what to ask next | PO (internal) |
| Multi-Perspective Analysis | Deep dive on complex items | PO, TL (optional) |

**Primary handoff docs for Phase 2:** Discovery Brief + MVP Scope + Functional Requirements.
These three together give the Story/Tech Doc Assistant everything it needs to produce
detailed user stories, PBIs, and technical specs.
