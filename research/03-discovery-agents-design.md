# Discovery Agents Design

## Agent Architecture

Based on the discovery workflow and Rowboat's multi-agent capabilities, here is the
proposed agent system design.

7 agents focused purely on discovery work. Their output is a set of overview
documents (see 04-output-templates.md) that Phase 2 users feed into the
existing Story/Tech Doc Assistant.

## Agent Definitions

### 1. Intake Agent (conversation, user-facing)
**Purpose:** First point of contact. Receives raw client input and classifies it.

**Responsibilities:**
- Accept uploaded documents (emails, meeting notes, specs, contracts)
- Classify document type (functional req, business context, technical constraint, etc.)
- Extract key entities (stakeholders, systems, deadlines, constraints)
- Route to appropriate specialist agents

**RAG:** Uses all project data sources

---

### 2. Analysis Agent (post_process, internal)
**Purpose:** Deep analysis of collected information.

**Responsibilities:**
- Cross-reference information across all ingested documents
- Identify contradictions between different client communications
- Map stakeholder perspectives and priorities
- Detect implicit assumptions
- Extract and track key entities (stakeholders, systems, features, deadlines)
  and their relationships (see RAG Limitations section in 09-rag-system.md)

**RAG:** Full project corpus, returns chunks for detailed analysis

---

### 3. Gap Detection Agent (conversation, user-facing)
**Purpose:** Identify what's missing from the discovery phase.

**Responsibilities:**
- Compare collected info against discovery control point checklist
- Generate specific follow-up questions for the client
- Prioritize questions by impact (blocking vs. nice-to-have)
- Suggest which stakeholder should answer each question
- Track which gaps have been addressed over time

**Template Output:** Gap Analysis Report

---

### 4. Meeting Prep Agent (conversation, user-facing)
**Purpose:** Prepare for client meetings.

**Responsibilities:**
- Generate meeting agendas based on current gaps
- Prepare talking points for specific topics
- Summarize what we know vs. what we need to confirm
- Suggest questions ordered by priority
- Create "interpretation confirmation" prompts (per Tarik's methodology)
- Post-meeting: process meeting notes and update knowledge base

**Template Output:** Meeting Agenda, Post-Meeting Summary

---

### 5. Document Generator Agent (conversation, user-facing)
**Purpose:** Produce structured discovery deliverables.

**Responsibilities:**
- Generate Project Discovery Brief
- Create MVP Scope Freeze document
- Create Functional Requirements Overview
- All docs should clearly mark assumptions vs. validated facts
- Include glossary of client-specific terms

**Template Output:** Discovery Brief, MVP Scope Freeze, Functional Requirements

---

### 6. Control Point Agent (post_process, internal)
**Purpose:** Track discovery completeness and enforce process discipline.

**Responsibilities:**
- Maintain discovery checklist per project
- Auto-evaluate completion % based on ingested data
- Trigger alerts when discovery is stalling
- Suggest "stop here" points (decision gates)
- Prevent scope creep by flagging new items as change requests
- Report on discovery health

**Template Output:** Discovery Progress Report

---

### 7. Role Simulation Agent (pipeline, internal)
**Purpose:** Implements Tarik's cognitive simulation methodology.

**Responsibilities:**
- Analyze requirements from multiple perspectives:
  - End User: "Is this usable?"
  - Admin: "Is this manageable?"
  - Developer: "Is this buildable?"
  - Business Owner: "Does this make business sense?"
  - UX Designer: "Does the flow work?"
- Flag conflicts between perspectives
- Suggest resolution approaches

**Template Output:** Multi-Perspective Analysis

---

## Agent Pipeline Flows

### Flow 1: New Document Ingestion
```
Intake Agent → Analysis Agent → Gap Detection Agent → Control Point Agent
```

### Flow 2: Meeting Preparation
```
Gap Detection Agent → Meeting Prep Agent → (user reviews)
```

### Flow 3: Document Generation
```
Analysis Agent → Role Simulation Agent → Document Generator Agent
```

### Flow 4: Progress Check
```
Control Point Agent → Gap Detection Agent → (summary to user)
```

## Control Points System

Control points are **customizable per project type**. When a PO creates a new
discovery project, they select a project type template. This loads the relevant
checklist which the PO can then further customize (add, remove, reweight items).

### How It Works

```
1. PO creates project → selects project type (or starts from blank)
2. System loads matching control point template
3. PO reviews and customizes:
   - Remove items that don't apply
   - Add project-specific items
   - Adjust weights per area if needed
4. Control Point Agent evaluates against this customized checklist
```

### Project Type Templates

---

#### DEFAULT (Base Template)
Used as a starting point for all projects. Other templates extend or modify this.

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

#### GREENFIELD WEB APP
New product from scratch. Heavier on business context and architecture.

Adds to DEFAULT:
- [ ] Competitive landscape understood
- [ ] User research conducted (interviews, surveys, or market data)
- [ ] Data model / entities sketched
- [ ] API design approach agreed
- [ ] Hosting / infrastructure provider decided
- [ ] Compliance / regulatory requirements identified (GDPR, etc.)
- [ ] Scalability targets defined
- [ ] Risk register created

---

#### ADD-ON / PLUGIN (e.g., Outlook Add-in, Shopify App)
Extending an existing platform. Heavy on integration constraints.

Adds to DEFAULT:
- [ ] Host platform version / API compatibility confirmed
- [ ] Platform-specific limitations documented
- [ ] Auth integration method decided (platform SSO, OAuth, etc.)
- [ ] Deployment / distribution method defined (store, manifest, sideload)
- [ ] Platform review / approval requirements understood
- [ ] Existing platform data access points mapped

Removes from DEFAULT:
- ~~Competitive landscape understood~~ (usually not applicable)
- ~~Hosting / deployment requirements known~~ (platform dictates this)

---

#### FEATURE EXTENSION
Adding features to an existing product. Lighter discovery, focused on delta.

Adds to DEFAULT:
- [ ] Impact on existing features assessed
- [ ] Migration / backward compatibility considered
- [ ] Existing codebase constraints documented

Removes from DEFAULT:
- ~~Target market / users identified~~ (already known)
- ~~Budget and timeline constraints known~~ (usually pre-set)

---

#### API / INTEGRATION PROJECT
Building connectors, middleware, data pipelines. Heavy on technical context.

Adds to DEFAULT:
- [ ] All external API docs collected and reviewed
- [ ] API authentication methods confirmed for each integration
- [ ] Data mapping between systems defined
- [ ] Error handling / retry strategy agreed
- [ ] Rate limits and quotas documented
- [ ] Data format / schema compatibility verified
- [ ] Monitoring / alerting requirements defined

Removes from DEFAULT:
- ~~Core user personas defined~~ (often system-to-system)
- ~~Primary user flows mapped~~ (may not have a UI)

---

#### MOBILE APP
Mobile-specific concerns on top of standard discovery.

Adds to DEFAULT:
- [ ] Target platforms decided (iOS, Android, both)
- [ ] Minimum OS versions defined
- [ ] Offline capability requirements known
- [ ] Push notification requirements defined
- [ ] App store submission requirements understood
- [ ] Device-specific constraints documented (camera, GPS, etc.)
- [ ] Deep linking requirements defined

---

#### CUSTOM (Blank)
PO builds the checklist from scratch, picking items from any template.

---

### PO Customization

After selecting a template, the PO can:

| Action | Example |
|--------|---------|
| **Add items** | "Add: HIPAA compliance audit required" |
| **Remove items** | Remove "Competitive landscape" — not relevant |
| **Change weights** | Make Technical Context 40% instead of 20% for an API project |
| **Add areas** | Add a "Security" area with its own control points |
| **Mark N/A** | Mark item as not applicable (doesn't affect score) |

Customizations are **saved per project** and can also be **saved as new templates**
for reuse across future projects of the same type.
