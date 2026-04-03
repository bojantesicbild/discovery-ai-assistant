# Discovery MCP Server (Mock)

Mock MCP server returning dummy data for the NacXwan project.
Lets you test discovery agents end-to-end without a real backend.

## Setup

```bash
cd mcp-server
pip install -r requirements.txt
```

## Configure in Claude Code

Add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "discovery": {
      "command": "python",
      "args": ["/absolute/path/to/mcp-server/mock_server.py"]
    }
  }
}
```

Or if working from the monorepo root:

```json
{
  "mcpServers": {
    "discovery": {
      "command": "python",
      "args": ["../../mcp-server/mock_server.py"]
    }
  }
}
```

## Available Tools (21)

### Read Tools
| Tool | Description |
|------|-------------|
| `search_documents` | Search client document passages |
| `search_requirements` | Search/filter requirements by priority and status |
| `get_readiness` | Readiness score + per-area breakdown |
| `get_gaps` | Gaps with classification (auto_resolve/ask_client/ask_po) |
| `get_contradictions` | Unresolved conflicts |
| `get_stakeholders` | People with roles and decision authority |
| `get_decisions` | Who decided what, when, why |
| `get_assumptions` | Unvalidated assumptions with risk |
| `get_scope` | In/out of MVP scope items |
| `get_constraints` | Budget, timeline, technology constraints |
| `get_control_points` | Control point checklist with status |
| `get_project_context` | Full project overview |

### Write Tools
| Tool | Description |
|------|-------------|
| `store_requirement` | Save a new requirement |
| `store_constraint` | Save a constraint |
| `store_decision` | Save a decision |
| `store_stakeholder` | Save a stakeholder |
| `store_assumption` | Save an assumption |
| `store_scope_item` | Save a scope decision |
| `store_contradiction` | Flag a contradiction |
| `update_requirement_status` | Change requirement status |
| `generate_handoff` | Generate 3 handoff documents |
| `web_research` | Research a topic online |

## Mock Data

Uses the "NacXwan Outlook Add-in" project:
- 7 requirements (5 functional, 2 non-functional)
- 4 constraints (tech, budget, timeline, regulatory)
- 3 decisions (SSO, platform, sidebar)
- 4 stakeholders (CTO, PM, IT Director, Lead Dev)
- 3 assumptions (API delegation, concurrency, app store review)
- 7 scope items (4 in, 3 out)
- 1 contradiction (meeting panel time range)
- 21 control points with mixed coverage
- Readiness: 65% (conditional)

## When Real Backend Ships

Replace `mock_server.py` with `real_server.py` that proxies to the FastAPI backend.
Zero changes needed in agent prompts — same tool names, same parameters.
