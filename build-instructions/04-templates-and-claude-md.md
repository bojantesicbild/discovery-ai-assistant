# Build Instruction: Templates + CLAUDE.md Updates

## Goal

1. Create discovery output templates in `.claude/templates/`
2. Create active task template for discovery domain
3. Update CLAUDE.md to add discovery domain detection
4. Update .memory-bank/ structure for discovery
5. Update settings.json with discovery MCP server config

---

## Part 1: Discovery Output Templates

### Location
`/Users/bojantesic/git-tests/crnogochi-assistants/.claude/templates/`

### Template 1: discovery-brief.template.md

```markdown
# Project Discovery Brief - [PROJECT_NAME]

> Generated: [DATE]
> Readiness: [SCORE]%
> Status: [READY/CONDITIONAL/NOT READY]

## 1. Client Overview
- Company: [COMPANY_NAME]
- Industry: [INDUSTRY]
- Company size: [SIZE]
- Key contacts:

| Name | Role | Email | Decision Authority |
|------|------|-------|--------------------|
| | | | final/recommender/informed |

## 2. Business Context
- Current situation / pain point: [CONFIRMED/ASSUMED]
- Business objectives:
- Success metrics (KPIs):
- Timeline expectations:
- Budget range:

## 3. Target Users
### Primary Persona
- Who:
- Goals:
- Pain points:
- Technical proficiency:

### Secondary Persona(s)
-

## 4. Competitive / Market Context
- Existing solutions client uses:
- Competitor products:
- Key differentiators needed:

## 5. Discovery Status
- Completeness: [SCORE]%
- Assumptions (not yet validated):
  - [ASSUMED] [assumption text] — Risk: [risk if wrong]
- Open questions:
  - [question] — Priority: [CRITICAL/HIGH/MEDIUM]
```

### Template 2: mvp-scope-freeze.template.md

```markdown
# MVP Scope Freeze Summary - [PROJECT_NAME]

> Generated: [DATE]
> Readiness: [SCORE]%

## 1. Purpose & MVP Goal
- What MVP delivers:
- Based on: [source documents]
- Intended to be: [usable, stable, deployable...]

## 2. Supported Platforms & Entry Points
- Platforms:
- Access points:
- Explicitly excluded:

## 3. Authentication & User Identity
- Auth method: [CONFIRMED/ASSUMED]
- Identity handling:
- Token management:

## 4. Core Functionalities (MVP)

### 4.1 [Feature Name] — Priority: [MUST/SHOULD/COULD]
- Description:
- User can:
- System behavior:
- Source: [document, date] [CONFIRMED/ASSUMED]

### 4.2 [Feature Name] — Priority: [MUST/SHOULD/COULD]
...

## 5. Integration Points
- External APIs:
- Third-party services:
- Dependencies:

## 6. Deployment & Distribution
- Distribution method:
- Hosting model:
- Source: [CONFIRMED/ASSUMED]

## 7. UI/UX Scope
- Branding elements:
- Design constraints:

## 8. Out of Scope for MVP
| Item | Rationale | Source |
|------|-----------|--------|
| | | [document, date] |

## 9. Assumptions & Risks
### Assumptions [NEED VALIDATION]
| Assumption | Basis | Risk if Wrong | Validate With |
|-----------|-------|---------------|---------------|
| | | | |

### Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| | | | |

## 10. Sign-off
- Client: [Name] | [Date] | [Status]
- PO: [Name] | [Date] | [Status]
- TL: [Name] | [Date] | [Status]
```

### Template 3: functional-requirements.template.md

```markdown
# Functional Requirements - [PROJECT_NAME]

> Generated: [DATE]
> Total requirements: [N] (Must: [N] | Should: [N] | Could: [N] | Won't: [N])

## 1. Overview
- Project description:
- Business objective:
- Target users:

## 2. User Roles & Permissions

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| | | |

## 3. Functional Requirements

### FR-001: [Feature Name]
- **Priority:** [MUST/SHOULD/COULD/WON'T]
- **Status:** [CONFIRMED/PROPOSED/ASSUMED]
- **Description:** [What the system shall do]
- **User perspective:** As a [role], I want to [action], so that [benefit]
- **Key business rules:**
  - [rule] — Source: [document] [CONFIRMED/ASSUMED]
- **Known edge cases:**
  - [edge case]
- **UI/UX notes:**
- **Source:** [document, date, quote]

### FR-002: [Feature Name]
...

## 4. Non-Functional Requirements

### NFR-001: [Requirement Name]
- **Category:** [Performance/Security/Scalability/Accessibility]
- **Description:**
- **Acceptance criteria:**
- **Source:** [CONFIRMED/ASSUMED]

## 5. Technical Context
- Existing systems / integrations:
- Technical constraints from client:
- Hosting / deployment requirements:

## 6. Assumptions [NEED VALIDATION]

| # | Assumption | Basis | Risk if Wrong |
|---|-----------|-------|---------------|
| | | | |

## 7. Dependencies

| Dependency | Type | Status | Impact if Unavailable |
|-----------|------|--------|----------------------|
| | External API / Service / Team | | |

## 8. Out of Scope

| Item | Rationale |
|------|-----------|
| | |

## 9. Glossary

| Term | Definition |
|------|-----------|
| | |
```

### Template 4: active-task-discovery.template.md

Follow the pattern of existing active task templates at:
`/Users/bojantesic/git-tests/crnogochi-assistants/.claude/templates/active-task-coding.template.md`

```markdown
# Active Discovery Task

## Status: idle
## Started: --
## Project: --
## Client: --

### Checklist
- [ ] Context loaded (MCP get_project_context called)
- [ ] Document received/identified
- [ ] Extraction complete
- [ ] User approved extraction
- [ ] Items stored via MCP
- [ ] Readiness updated
- [ ] Completion prompt shown
- [ ] Archived

### Current Activity
--

### Documents Processed This Session
--

### Extraction Summary
--

### Cross-References
--

### Progress Log
--
```

---

## Part 2: CLAUDE.md Updates

### Location
`/Users/bojantesic/git-tests/crnogochi-assistants/CLAUDE.md`

### Change 1: Add discovery domain to detection table

In the Domain Detection table, add a new row:

```markdown
| discovery, readiness, gaps, requirements, client said, meeting prep, handoff, constraints, stakeholders, scope | discovery | `.claude/skills/discovery/SKILL.md` |
```

### Change 2: Add docs/discovery/ to Knowledge Search

In the Knowledge Search section, add to the search locations:

```markdown
- `docs/discovery/` — Discovery phase handoff documents
```

### Change 3: Add discovery agents to Shared Agents table (or create new section)

```markdown
| discovery-gap-agent | User asks about gaps, readiness, what's missing |
| discovery-docs-agent | User requests handoff documents |
| discovery-prep-agent | User asks to prepare for client meeting |
```

### Change 4: Add discovery to Active Task Router domain status table

In the router template and any references:

```markdown
| discovery | idle | -- | [active-tasks/discovery.md](active-tasks/discovery.md) |
```

---

## Part 3: Memory Bank Updates

### Add discovery active task file

Create: `.memory-bank/active-tasks/discovery.md`
Content: Copy from `active-task-discovery.template.md`

### Add discovery docs directory

Create: `.memory-bank/docs/discovery/` with a `.gitkeep` file

### Update active-task.md router template

Add discovery row to the Domain Status table in `.memory-bank/active-task.md`:

```markdown
| discovery | idle | -- | [active-tasks/discovery.md](active-tasks/discovery.md) |
```

Also update `.claude/templates/active-task-router.template.md` to include the discovery row.

---

## Part 4: Settings.json — MCP Server Config

### Location
`/Users/bojantesic/git-tests/crnogochi-assistants/.claude/settings.json`

### Add discovery MCP server

Add to the `mcpServers` object:

```json
{
  "mcpServers": {
    "discovery": {
      "command": "python",
      "args": ["/path/to/mcp-server/mock_server.py"],
      "env": {
        "DISCOVERY_PROJECT_ID": "default"
      }
    }
  }
}
```

Note: The path will need to be updated per installation. The install.sh script
should handle this — either by prompting for the path or using a relative path
from the project root.

---

## Part 5: Install Script Updates

### install.sh / install.ps1

Update to include:
1. New discovery templates in the copy list
2. `.memory-bank/active-tasks/discovery.md` initialization
3. `.memory-bank/docs/discovery/` directory creation
4. Updated active-task router with discovery row
5. MCP server path configuration prompt (or skip if not configured)

---

## Reference Materials

- Existing templates at `/Users/bojantesic/git-tests/crnogochi-assistants/.claude/templates/`
- Existing CLAUDE.md at `/Users/bojantesic/git-tests/crnogochi-assistants/CLAUDE.md`
- Output template specs: `research/04-output-templates.md`
- Readiness system: `research/07-readiness-and-feedback.md`
- Active task patterns: study existing `active-task-coding.template.md`

## Success Criteria

- [ ] 3 discovery output templates created (brief, scope, requirements)
- [ ] Active task template matches crnogochi pattern
- [ ] CLAUDE.md has discovery in domain detection (verified by testing)
- [ ] Knowledge search includes docs/discovery/
- [ ] Router template includes discovery row
- [ ] .memory-bank/ has discovery active-task + docs/discovery/ directory
- [ ] settings.json has discovery MCP server config
- [ ] Templates use [CONFIRMED]/[ASSUMED] markers consistently
- [ ] Templates include source attribution fields in every section
