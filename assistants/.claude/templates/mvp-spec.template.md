# MVP Specification — [PROJECT_NAME]

> Generated: [DATE]
> Readiness: [SCORE]%
> Total requirements: [N] (Must: [N] | Should: [N] | Could: [N] | Won't: [N])

This document is the single source of truth shared by PM ↔ client (scope
commitment, release criteria, sign-off) and the dev team (per-feature spec
with ACs). It replaces the historical *MVP Scope Freeze* + *Functional
Requirements* split.

## 1. Purpose & MVP Goal

- **What MVP delivers:**
- **Based on:** [source documents]
- **Definition of done:** [what "MVP complete" means measurably]
- **Intended to be:** [usable / stable / deployable / demo-able]

## 2. Platforms & Entry Points

- **Platforms:** [web / iOS / Android / desktop / API-only]
- **Access points:** [URL / mobile store / SSO portal]
- **Browser matrix:** [Chrome, Firefox, Safari, Edge — versions]
- **Explicitly excluded:**

## 3. User Roles & Permissions

| Role | Description | Key permissions |
|---|---|---|
|  |  |  |

## 4. Functional Requirements

Each section header IS the BR — same ID, same data. The agent lifts
`acceptance_criteria`, `business_rules`, `edge_cases`, `priority`, and
`source_quote` directly from the BR row; per-feature attributes that
aren't yet first-class in the schema (story type, complexity, test
strategy) are synthesized at write time. Use the BR-NNN id verbatim —
the dev team, QA, and the web UI all use this id, so the spec must
match.

Lift `acceptance_criteria` from the BR row when populated; only
synthesize when the list is empty (mark as `[ASSUMED — synthesized
from source_quote]`).

### BR-001: [Feature name]

- **Priority:** [MUST / SHOULD / COULD / WON'T]
- **Status:** [CONFIRMED / PROPOSED / ASSUMED]
- **Story type:** [UI / API / FULL-STACK / BACKEND-ONLY]
- **Complexity:** [LOW / MEDIUM / HIGH]
- **Test strategy:** [MANUAL / AUTOMATED / BOTH]
- **Dependencies:** [BR-003, BR-005 — blocking BRs (`blocked_by`)]
- **Source:** [document, date, quote]

**Description:** [what the system shall do]

**User perspective:** *As a [role], I want to [action], so that [benefit].*

**Business rules:**
- [rule] — Source: [doc] [CONFIRMED / ASSUMED]

**Known edge cases:**
- [edge case]

**Acceptance criteria:**

Render each AC as a bold title followed by `Given` / `When` / `Then`
bullets — never a fenced code block. The chat and document renderers
style fenced blocks as flat green monospace, which buries the GIVEN /
WHEN / THEN structure under uniform code styling. Bulleted markdown
gives the dev team a scannable triage view.

**AC1: [Short title]**
- **Given** [precondition]
- **When** [action]
- **Then** [expected outcome]

**AC2: [Short title]**
- **Given** [precondition]
- **When** [action]
- **Then** [expected outcome]

**UI/UX notes:**

### BR-002: [Feature name]

…

## 5. Non-Functional Requirements

### 5.1 Performance targets

| Metric | Target | Measured where |
|---|---|---|
| P95 page load | < 2s | real-user monitoring |
| P95 API latency | < 500ms | server metrics |
| Concurrent users | [N] | load test |
| Throughput | [req/sec] | synthetic test |

### 5.2 Security & Authentication

- **Auth method:** [OAuth / SAML / JWT / session] [CONFIRMED / ASSUMED]
- **Authorization model:** [RBAC / ABAC / ACL]
- **Session policy:** [timeout, refresh, concurrent sessions]
- **Password / credential policy:** [complexity, rotation, MFA]
- **Encryption in transit:** [TLS version]
- **Encryption at rest:** [algorithm, key rotation]
- **Secrets management:** [vault / env / KMS]
- **Audit logging:** [events captured, retention]

### 5.3 Accessibility

- **Target standard:** [WCAG 2.1 AA / AAA / none]
- **Assistive tech supported:** [screen readers, keyboard-only, high contrast]
- **Testing tool:** [axe / Lighthouse / manual]

### 5.4 Localization

- **Languages supported at MVP:** [list or "English only"]
- **Post-MVP languages:**
- **Date / number / currency formatting:** [locale strategy]

### 5.5 Observability & Telemetry

- **Product analytics:** [Amplitude / Mixpanel / GA4 / none]
- **Events tracked at MVP:** [core funnel events, not exhaustive]
- **Error monitoring:** [Sentry / Datadog / Rollbar / none]
- **Performance monitoring:** [RUM tool / APM tool]
- **PII handling in telemetry:** [scrubbing rules]

## 6. Data Model Overview

The full data model lives in the tech doc; this captures the entities and
relationships every dev needs at MVP read time.

### Core entities

| Entity | Description | Key attributes | Related entities |
|---|---|---|---|
| [Entity] | [one-line] | [id, name, …] | [relations] |

### Key relationships

- [Entity A] has many [Entity B]
- [Entity B] belongs to [Entity C]
- [Entity X] many-to-many [Entity Y]

## 7. Data & Privacy Scope

- **Data collected:** [categories — PII, financial, health, usage, …]
- **Where stored:** [region, provider, service]
- **Retention policy:** [duration per category]
- **User rights supported:** [access / export / delete]
- **GDPR disposition:** [controller / processor / not applicable]
- **Legal basis:** [consent / contract / legitimate interest]
- **Data processing agreements needed:** [list]

## 8. Integrations & External Dependencies

| Integration | Direction | Protocol | Authentication | Criticality | Impact if unavailable |
|---|---|---|---|---|---|
| [System] | in / out / both | REST / webhook / SFTP / SDK | OAuth / API key / mTLS | critical / nice-to-have | [graceful degradation / hard block] |

## 9. Error Handling Conventions

- **User-facing error messages:** [tone — apologetic / factual / actionable; localized?]
- **Error codes:** [format — HTTP status + app-specific code]
- **Validation errors:** [surfaced inline / toast / modal]
- **Server errors:** [retry policy / fallback / graceful degradation]
- **Logging:** [what's logged server-side vs client-side]
- **Observability:** [trace IDs, correlation IDs]

## 10. Deployment & Distribution

- **Distribution method:** [direct deploy / app store / customer install]
- **Hosting model:** [cloud / on-prem / hybrid]
- **Infrastructure-as-code:** [Terraform / Pulumi / manual]
- **CI/CD:** [platform + branch strategy]
- **Environments:** [dev / staging / prod]

## 11. Out of Scope for MVP

| Item | Rationale | Target release | Source |
|---|---|---|---|
|  |  | v1.1 / v2 / unplanned | [document, date] |

## 12. Release Criteria (quality gates)

MVP cannot ship until:

- [ ] All MUST requirements implemented and confirmed
- [ ] Test pass rate ≥ [X]%
- [ ] No BLOCKER or CRITICAL defects open
- [ ] Performance targets met (section 5.1)
- [ ] Accessibility target met (section 5.3)
- [ ] Security review passed
- [ ] Data processing agreements signed (if applicable)
- [ ] Rollback plan documented and rehearsed
- [ ] Runbooks / support docs complete

## 13. Rollback & Migration Plan

- **Data migration:** [none / one-time / incremental / dual-write]
- **Rollback trigger:** [conditions that force rollback]
- **Rollback procedure:** [steps, RTO, RPO]
- **Legacy system cutover:** [big-bang / phased / parallel running]

## 14. Support & SLA

- **Support hours:** [business / 24×7 / on-call]
- **Response SLA by severity:** [P1: 1h / P2: 4h / P3: 1d]
- **Escalation path:**
- **On-call rotation (post-launch):** [team / provider]
- **Handoff to support plan:** [documentation, training, knowledge transfer]

## 15. Assumptions [need validation]

Each row references a `gap` finding with `kind='unvalidated_assumption'`.
Validate before development; if the assumption is wrong, the related FR(s)
need rework.

| Gap | Assumption | Basis | Risk if wrong | Validate with |
|---|---|---|---|---|
| GAP-001 |  |  |  |  |

## 16. Requirement Index

One-row-per-BR summary so the dev team, QA, and PM can scan all features
and their provenance without flipping through the per-BR sections above.

| BR | Title | Priority | Status | Source document | Source stakeholder |
|---|---|---|---|---|---|
| BR-001 |  | must | confirmed | [doc, date] | [name, role] |

## 17. Glossary

| Term | Definition | Source |
|---|---|---|
|  |  |  |

## 18. Sign-off

| Role | Name | Date | Status |
|---|---|---|---|
| Client |  |  | approved / pending |
| PO |  |  |  |
| Tech Lead |  |  |  |
| QA Lead |  |  |  |

---
*Prepared by Crnogochi*
