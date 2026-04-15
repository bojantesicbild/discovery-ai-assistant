# 36 — Monorepo: Shared Agent Definitions + Web Backend

> **Date:** 2026-04-03
> **Purpose:** Define how agent definitions are shared between local Claude Code and web backend
> **Key Decision:** One repo, one set of prompts, two runtimes

---

## 1. The Problem

We have agent definitions (SKILL.md, agent prompts, templates) that need to work in:
- **Local Claude Code** — developers install into project repos, Claude reads `.claude/` files
- **Web backend** — Pydantic AI reads the same prompts for the coordinator + subagents

If these live in separate repos, they drift. Prompt updates in one place don't reach the other.

---

## 2. The Solution: Monorepo

Everything in one repo. Agent definitions are shared. Both runtimes read from the same source.

```
bild-ai-assistants/                        # ONE REPO
│
├── agents/                                # SHARED AGENT CORE
│   ├── CLAUDE.md                          # Domain detection (coding, stories, QA, discovery)
│   ├── install.sh                         # Install agents into any project repo
│   ├── install.ps1                        # Windows installer
│   ├── .claude/
│   │   ├── agents/                        # All agent definitions (12 agents)
│   │   │   ├── setup-agent.md             # [shared] Project initialization
│   │   │   ├── research-agent.md          # [shared] Research + analysis
│   │   │   ├── story-tech-agent.md        # [stories] Tech doc generation
│   │   │   ├── story-story-agent.md       # [stories] Story breakdown
│   │   │   ├── story-dashboard-agent.md   # [stories] Sprint dashboard
│   │   │   ├── qa-analysis-planning-agent.md   # [qa] Test analysis
│   │   │   ├── qa-automation-agent.md     # [qa] Playwright generation
│   │   │   ├── qa-reporting-agent.md      # [qa] Test reporting
│   │   │   ├── qa-defect-management-agent.md   # [qa] Defect filing
│   │   │   ├── discovery-gap-agent.md     # [discovery] Gap analysis
│   │   │   ├── discovery-docs-agent.md    # [discovery] Document generation
│   │   │   └── discovery-prep-agent.md    # [discovery] Meeting preparation
│   │   │
│   │   ├── skills/                        # Domain skill orchestration
│   │   │   ├── coding/SKILL.md
│   │   │   ├── tech-stories/SKILL.md
│   │   │   ├── qa/SKILL.md
│   │   │   └── discovery/SKILL.md         # Discovery domain
│   │   │
│   │   ├── templates/                     # All output templates (28+ files)
│   │   │   ├── active-task-router.template.md
│   │   │   ├── active-task-coding.template.md
│   │   │   ├── active-task-stories.template.md
│   │   │   ├── active-task-qa.template.md
│   │   │   ├── active-task-discovery.template.md       # NEW
│   │   │   ├── discovery-brief.template.md             # NEW
│   │   │   ├── mvp-scope-freeze.template.md            # NEW
│   │   │   ├── functional-requirements.template.md     # NEW
│   │   │   ├── tech-doc-template.md
│   │   │   ├── sprint-dashboard-template.html
│   │   │   ├── decision.template.md
│   │   │   ├── error.template.md
│   │   │   ├── pattern.template.md
│   │   │   ├── practice.template.md
│   │   │   ├── research.template.md
│   │   │   ├── testing-standards.template.md
│   │   │   ├── phase1-analysis-report.template.md
│   │   │   ├── ... (other QA templates)
│   │   │   └── automation-readme.template.md
│   │   │
│   │   ├── scripts/
│   │   │   └── update-archive-stats.sh
│   │   │
│   │   └── settings.json                  # MCP configs (context7, atlassian, discovery)
│   │
│   ├── .memory-bank/                      # Template for project initialization
│   │   ├── active-task.md
│   │   ├── active-tasks/
│   │   │   ├── coding.md
│   │   │   ├── tech-stories.md
│   │   │   ├── qa.md
│   │   │   └── discovery.md               # NEW
│   │   ├── docs/
│   │   │   ├── discovery/                 # NEW (handoff docs go here)
│   │   │   └── ... (other existing dirs)
│   │   └── learnings.jsonl
│   │
│   └── tests/                             # Agent prompt quality tests
│       ├── test_discovery_gap_agent.py    # Golden tests for gap analysis
│       ├── test_discovery_docs_agent.py   # Golden tests for doc generation
│       ├── test_discovery_prep_agent.py   # Golden tests for meeting prep
│       ├── test_coding_skill.py           # Existing coding tests
│       ├── fixtures/                      # Test data (sample projects, facts)
│       └── conftest.py                    # Shared test setup
│
├── discovery-web/                         # WEB APPLICATION
│   ├── backend/
│   │   ├── app/
│   │   │   ├── main.py
│   │   │   ├── config.py
│   │   │   ├── api/
│   │   │   │   ├── projects.py
│   │   │   │   ├── documents.py
│   │   │   │   ├── chat.py
│   │   │   │   ├── dashboard.py
│   │   │   │   ├── control_points.py
│   │   │   │   └── webhooks.py
│   │   │   ├── pipeline/
│   │   │   │   ├── service.py
│   │   │   │   ├── stages/
│   │   │   │   └── worker.py
│   │   │   ├── agent/
│   │   │   │   ├── coordinator.py         # Reads prompts from agents/
│   │   │   │   ├── tools/
│   │   │   │   ├── subagents.py           # Loads agent .md from agents/
│   │   │   │   └── capabilities/
│   │   │   ├── services/
│   │   │   ├── models/
│   │   │   └── db/
│   │   ├── tests/
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   ├── frontend/
│   │   └── ... (Next.js)
│   └── docker-compose.yml
│
├── mcp-server/                            # MCP SERVER (Claude Code → web backend)
│   ├── server.py                          # ~100 lines
│   ├── package.json
│   └── README.md
│
└── docs/
    ├── research/                          # All 36 research documents
    ├── work-log-day-1.md
    ├── work-log-day-2.md
    └── ARCHITECTURE.md                    # Master architecture reference
```

---

## 3. How Each Runtime Reads the Same Prompts

### Local Claude Code (Developer)

```bash
# Install into project repo
cd my-project/
/path/to/bild-ai-assistants/agents/install.sh

# install.sh copies:
#   agents/.claude/    → my-project/.claude/
#   agents/CLAUDE.md   → my-project/CLAUDE.md
#   agents/.memory-bank/ (template) → my-project/.memory-bank/ (if not exists)

# Claude Code reads .claude/skills/discovery/SKILL.md
# Claude Code reads .claude/agents/discovery-gap-agent.md
# Discovery queries go through MCP → web backend
```

### Web Backend (PO via browser)

```python
# discovery-web/backend/app/agent/subagents.py

from pathlib import Path

# Read agent prompts from the shared agents/ directory
AGENTS_DIR = Path(__file__).parent.parent.parent.parent.parent / "agents" / ".claude"

def load_agent_prompt(agent_name: str) -> str:
    """Load an agent prompt from the shared agents directory."""
    prompt_file = AGENTS_DIR / "agents" / f"{agent_name}.md"
    return prompt_file.read_text()

def load_skill_prompt(domain: str) -> str:
    """Load a domain SKILL.md from the shared agents directory."""
    skill_file = AGENTS_DIR / "skills" / domain / "SKILL.md"
    return skill_file.read_text()

def load_template(template_name: str) -> str:
    """Load an output template from the shared agents directory."""
    template_file = AGENTS_DIR / "templates" / template_name
    return template_file.read_text()

# Pydantic AI subagents use the shared prompts
gap_analyzer = Agent(
    'anthropic:claude-sonnet-4-20250514',
    deps_type=Deps,
    system_prompt=load_agent_prompt("discovery-gap-agent"),
    output_type=GapAnalysisResult,
)

doc_generator = Agent(
    'anthropic:claude-sonnet-4-20250514',
    deps_type=Deps,
    system_prompt=load_agent_prompt("discovery-docs-agent"),
    output_type=DiscoveryDocuments,
)

meeting_prep = Agent(
    'anthropic:claude-sonnet-4-20250514',
    deps_type=Deps,
    system_prompt=load_agent_prompt("discovery-prep-agent"),
    output_type=MeetingAgenda,
)
```

### Docker Build (Production)

```dockerfile
# discovery-web/backend/Dockerfile

FROM python:3.12-slim

# Copy shared agents into the container
COPY agents/.claude /app/agents/.claude

# Copy web backend
COPY discovery-web/backend /app/backend

WORKDIR /app/backend
RUN pip install -e .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0"]
```

The Docker image includes both `agents/.claude/` and the backend code.
Prompt updates require a new Docker build — same as any code change.

---

## 4. What Changes in CLAUDE.md (Discovery Domain)

Add to the domain detection table:

```markdown
| discovery, readiness, gaps, requirements, client said, meeting prep, handoff | discovery | `.claude/skills/discovery/SKILL.md` |
```

Add to active task router:

```markdown
| discovery | idle | -- | [active-tasks/discovery.md](active-tasks/discovery.md) |
```

Add to shared agents table:

```markdown
| discovery-gap-agent | User asks about gaps, readiness, what's missing |
| discovery-docs-agent | User requests handoff documents |
| discovery-prep-agent | User asks to prepare meeting agenda |
```

---

## 5. The Discovery SKILL.md

```markdown
# Discovery Skill

[DISCOVERY-SKILL-LOADED]

## When to Use
Activated when user asks about: discovery status, requirements, client
information, gaps, readiness, meeting preparation, handoff documents,
or anything about what the client said/decided.

## How It Works
This skill connects to the Discovery AI backend via MCP server.
All client documents, extracted requirements, decisions, and contradictions
live on the server — not in local .memory-bank/ files.

## Anti-Patterns (NEVER do these)
- "Reading local .memory-bank/ for discovery data" (Use MCP — server has latest)
- "Guessing requirements without checking backend" (Query first, then reason)
- "Generating handoff docs locally" (Use MCP — server generates with full context)

## Available Actions

### Query Discovery Data
- "What are the gaps?" → MCP: get_gaps(project_id)
- "What are the requirements for auth?" → MCP: search_requirements(project_id, "auth")
- "What's the readiness score?" → MCP: get_readiness(project_id)
- "Any contradictions?" → MCP: get_contradictions(project_id)
- "What did client say about hosting?" → MCP: search_documents(project_id, "hosting")

### Report Findings Back
- "Auth doesn't cover MFA" → MCP: store_finding(project_id, "MFA not specified", ...)
  Findings are stored as pending PO review on the server.

### Handoff
- "Generate handoff documents" → MCP: generate_handoff(project_id)
  Server generates docs and commits to .memory-bank/docs/discovery/

## Checkpoints
Before reporting a finding, confirm with user:
> "I'll report this finding to the Discovery AI: [finding].
> The PO will review it. Proceed? (yes/no)"

## Anti-Rationalization
Do NOT skip the MCP check because:
| Excuse | Why It's Wrong |
|--------|---------------|
| "I can see the requirements in local files" | Local files may be stale. Server has latest extracted data. |
| "The requirement is obvious from the code" | Discovery requirements have priority, confidence, source citations. Code doesn't have that. |
| "I'll just assume the requirement" | Assumptions without checking create rework. One MCP call takes 1 second. |
```

---

## 6. Testing Strategy

### Prompt Quality Tests (shared agents/tests/)

```python
# agents/tests/test_discovery_gap_agent.py

from pathlib import Path

def load_prompt():
    return (Path(__file__).parent.parent / ".claude/agents/discovery-gap-agent.md").read_text()

def test_prompt_has_anti_rationalization():
    prompt = load_prompt()
    assert "Anti-Rationalization" in prompt or "anti-rationalization" in prompt

def test_prompt_has_output_format():
    prompt = load_prompt()
    assert "GapAnalysisResult" in prompt or "output" in prompt.lower()

def test_prompt_has_iron_law():
    prompt = load_prompt()
    assert "IRON LAW" in prompt or "Iron Law" in prompt

# Golden test: run the prompt against test data, score with LLM-as-judge
async def test_gap_analysis_quality():
    """Run gap-analyzer against a known project state, verify output quality."""
    prompt = load_prompt()
    test_project = load_fixture("test-project-with-gaps.json")

    result = await run_agent_with_test_model(prompt, test_project)

    # LLM-as-judge scores on 5 criteria
    score = await judge_output(result, criteria=[
        "completeness",    # Did it find all gaps?
        "classification",  # AUTO-RESOLVE/ASK-CLIENT/ASK-PO correct?
        "evidence",        # Does each gap cite sources?
        "actionability",   # Are suggested questions specific?
        "format",          # Matches GapAnalysisResult schema?
    ])

    assert all(s >= 3 for s in score.values()), f"Quality below threshold: {score}"
```

### Web Backend Tests (discovery-web/backend/tests/)

```python
# Tests that the backend correctly loads and uses shared prompts

def test_subagents_load_shared_prompts():
    """Verify web backend reads prompts from agents/ directory."""
    from app.agent.subagents import gap_analyzer, doc_generator, meeting_prep

    assert "gap" in gap_analyzer.system_prompt.lower()
    assert "document" in doc_generator.system_prompt.lower() or "handoff" in doc_generator.system_prompt.lower()
    assert "meeting" in meeting_prep.system_prompt.lower() or "agenda" in meeting_prep.system_prompt.lower()

def test_templates_exist():
    """Verify all required templates exist in shared agents/ directory."""
    from app.agent.subagents import AGENTS_DIR

    assert (AGENTS_DIR / "templates" / "discovery-brief.template.md").exists()
    assert (AGENTS_DIR / "templates" / "mvp-scope-freeze.template.md").exists()
    assert (AGENTS_DIR / "templates" / "functional-requirements.template.md").exists()
```

---

## 7. Update Workflow

### Updating a Prompt

```
Developer edits agents/.claude/agents/discovery-gap-agent.md
  → Runs: pytest agents/tests/test_discovery_gap_agent.py (golden tests)
  → Runs: pytest discovery-web/backend/tests/ (integration tests)
  → Both pass → merge PR
  → CI builds new Docker image (includes updated prompts)
  → Deploy web backend → web UI gets updated prompt
  → Developers run install.sh → local Claude Code gets updated prompt
```

### Updating a Template

```
Developer edits agents/.claude/templates/discovery-brief.template.md
  → Same CI pipeline
  → Template used by both:
    - Web backend's doc-generator subagent (via load_template())
    - Claude Code's discovery-docs-agent (reads .claude/templates/ locally)
```

---

## 8. Benefits of This Approach

| Benefit | How |
|---------|-----|
| **One source of truth** | All prompts in agents/.claude/ — never duplicated |
| **Both runtimes stay in sync** | Web reads directly, local via install.sh |
| **Easy to test** | Golden tests in agents/tests/ run against the actual prompts |
| **Easy to update** | Change one file, both environments get it |
| **Easy to version** | Git history shows every prompt change |
| **Easy to install** | `install.sh` copies to any project — unchanged from current crnogochi |
| **Easy to containerize** | Docker COPY includes agents/.claude/ in the build |
| **Existing crnogochi works** | Just adds discovery domain — no breaking changes |
