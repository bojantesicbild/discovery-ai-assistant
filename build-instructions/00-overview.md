# Build Instructions Overview

## What We're Building

Add a **discovery domain** to the existing crnogochi-assistants system.
Discovery agents help POs extract structured business requirements from client
communications, track gaps, prepare meetings, and generate handoff documents.

## Build Order

Execute these instructions in order:

```
01-mock-mcp-server.md     → Create the mock MCP server (dummy data backend)
02-discovery-skill.md     → Create discovery/SKILL.md (domain orchestration)
03-discovery-agents.md    → Create 3 discovery agent definitions
04-templates-and-claude-md.md → Create templates + update CLAUDE.md + settings
```

## Architecture Summary

```
User talks to Claude Code
       │
       ▼
CLAUDE.md detects "discovery" domain
       │
       ��
discovery/SKILL.md orchestrates the workflow
       │
       ├── Extracts requirements, constraints, decisions, stakeholders,
       │   assumptions, scope items from client documents
       │
       ├── Dispatches agents for complex tasks:
       │   ├── discovery-gap-agent → structured gap analysis
       │   ├── discovery-docs-agent → 3 handoff documents
       │   └── discovery-prep-agent → meeting agenda
       │
       └── ALL data flows through MCP server:
           ├── store_requirement(), store_decision(), etc.
           ├── get_readiness(), get_gaps(), get_contradictions()
           └── search_documents(), search_requirements()
```

## Key Design Decisions

1. **MCP-first**: All discovery data goes through MCP tools. No .memory-bank/ files
   for discovery working state. This means prompts don't change when we swap the
   mock server for the real backend.

2. **Typed extraction**: Not generic "facts" but 6 typed business models:
   Requirements (with MoSCoW priority), Constraints, Decisions, Stakeholders,
   Assumptions, Scope Items.

3. **3 agents, not 6**: Gap analysis, document generation, meeting prep are agents.
   Web research, code analysis, deep search are tools the coordinator uses directly.

4. **Same prompt format as crnogochi**: SKILL.md, agent .md files, templates all
   follow the exact same patterns as coding/stories/QA domains.

## Working Directory

All files are created in: `/Users/bojantesic/git-tests/crnogochi-assistants/`

## Research Reference

Key research documents in `/Users/bojantesic/git-tests/discovery-ai-assistant/research/`:
- `00-what-is-discovery-assistant.md` — product definition, typical PO workflow
- `03-discovery-agents-design.md` — control point templates (6 project types)
- `04-output-templates.md` — handoff document formats
- `07-readiness-and-feedback.md` — readiness scoring, thresholds, feedback
- `14-superpowers-research.md` — anti-rationalization, Iron Laws, verification
- `15-gstack-research.md` — Fix-First, scope modes, AskUserQuestion format
- `32-simplification-and-requirements.md` — the 6 typed extraction models
- `33-final-clarity.md` — definitive architecture summary

## After Building

1. Configure MCP server path in `.claude/settings.json`
2. Start mock MCP server: `python mcp-server/mock_server.py`
3. Open Claude Code in any project with crnogochi installed
4. Test: "I had a client meeting, here are the notes..."
5. Test: "What are the gaps?"
6. Test: "Prepare my next meeting"
7. Test: "Generate the handoff documents"
8. Iterate on prompts based on output quality
