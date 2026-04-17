# Functional Requirements — [PROJECT_NAME]

> Generated: [DATE]
> Total requirements: [N] (Must: [N] | Should: [N] | Could: [N] | Won't: [N])

## 1. Overview

- **Project description:**
- **Business objective:**
- **Target users:**

## 2. User Roles & Permissions

| Role | Description | Key permissions |
|---|---|---|
|  |  |  |

## 3. Functional Requirements

Each requirement includes acceptance criteria (GIVEN/WHEN/THEN) that the QA chain can triage directly and story-story-agent can use verbatim in PBIs.

### FR-001: [Feature name]

- **Priority:** [MUST / SHOULD / COULD / WON'T]
- **Status:** [CONFIRMED / PROPOSED / ASSUMED]
- **Story type:** [UI / API / FULL-STACK / BACKEND-ONLY]
- **Complexity:** [LOW / MEDIUM / HIGH]
- **Test strategy:** [MANUAL / AUTOMATED / BOTH]
- **Dependencies:** [FR-003, FR-005 — blocking FRs]
- **Source:** [BR-NNN] — [document, date, quote]

**Description:** [what the system shall do]

**User perspective:** *As a [role], I want to [action], so that [benefit].*

**Business rules:**
- [rule] — Source: [doc] [CONFIRMED / ASSUMED]

**Known edge cases:**
- [edge case]

**Acceptance criteria:**

```
AC1: [Short title]
GIVEN [precondition]
WHEN [action]
THEN [expected outcome]

AC2: [Short title]
GIVEN [precondition]
WHEN [action]
THEN [expected outcome]
```

**UI/UX notes:**

### FR-002: [Feature name]

…

## 4. Non-Functional Requirements

### NFR-001: [Requirement name]

- **Category:** [Performance / Security / Scalability / Accessibility / Observability / Reliability]
- **Target:** [measurable value — e.g., "P95 latency < 500ms"]
- **Measured where:** [production metric / load test / manual audit]
- **Acceptance criteria:**
- **Source:** [CONFIRMED / ASSUMED]

## 5. Data Model Overview

High-level entities and their relationships. The full data model lives in the tech doc.

### Core entities

| Entity | Description | Key attributes | Related entities |
|---|---|---|---|
| [Entity] | [one-line] | [id, name, …] | [relations] |

### Key relationships

- [Entity A] has many [Entity B]
- [Entity B] belongs to [Entity C]
- [Entity X] many-to-many [Entity Y]

## 6. Error Handling Conventions

- **User-facing error messages:** [tone — apologetic / factual / actionable; localized?]
- **Error codes:** [format — HTTP status + app-specific code]
- **Validation errors:** [surfaced inline / toast / modal]
- **Server errors:** [retry policy / fallback / graceful degradation]
- **Logging:** [what's logged server-side vs client-side]
- **Observability:** [trace IDs, correlation IDs]

## 7. Technical Context

- **Existing systems / integrations:**
- **Technical constraints from client:**
- **Hosting / deployment requirements:**
- **API surface expected:** [REST / GraphQL / gRPC / webhooks]

## 8. Assumptions [NEED VALIDATION]

| ID | Assumption | Basis | Risk if wrong | Validate with |
|---|---|---|---|---|
| ASM-001 |  |  |  |  |

## 9. Dependencies

| Dependency | Type | Status | Impact if unavailable | Owner |
|---|---|---|---|---|
|  | External API / Service / Team / Data |  |  |  |

## 10. Traceability Matrix

Links each functional requirement back to its source — BR from discovery extraction, the client statement that introduced it, and the stakeholder who raised it.

| FR | BR | Priority | Source document | Source stakeholder |
|---|---|---|---|---|
| FR-001 | BR-003 | must | [doc, date] | [name, role] |
| FR-002 | BR-005 |  |  |  |

## 11. Out of Scope

| Item | Rationale | Target release |
|---|---|---|
|  |  | v1.1 / v2 / unplanned |

## 12. Glossary

| Term | Definition | Source |
|---|---|---|
|  |  |  |

---
*Prepared by Crnogochi*
