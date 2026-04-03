# Build Instruction: Mock Discovery MCP Server

## Goal

Create a mock MCP server that returns dummy data for all discovery tools.
This lets us test discovery agents end-to-end without a real backend.
When the real backend ships, we swap this mock for a real server — zero prompt changes.

## What to Build

A Python MCP server using the `mcp` package that exposes these tools:

### Tools to Implement

```
1. search_documents(project_id: str, query: str, top_n: int = 5) -> str
   Purpose: Search client documents (meetings, emails, specs)
   Mock: Return 2-3 dummy document passages with source citations

2. search_requirements(project_id: str, query: str = None, priority: str = None, status: str = None) -> str
   Purpose: Search extracted requirements, optionally filter by priority/status
   Mock: Return 5-8 dummy requirements in JSON format

3. get_readiness(project_id: str) -> str
   Purpose: Get discovery readiness score and per-area breakdown
   Mock: Return readiness object with score + 4 area scores

4. get_gaps(project_id: str) -> str
   Purpose: Get all identified gaps with priority and classification
   Mock: Return 4-6 dummy gaps classified as auto_resolve/ask_client/ask_po

5. get_contradictions(project_id: str) -> str
   Purpose: Get unresolved contradictions between requirements/decisions
   Mock: Return 1-2 dummy contradictions

6. get_stakeholders(project_id: str) -> str
   Purpose: Get all identified stakeholders with roles and authority
   Mock: Return 3-4 dummy stakeholders

7. get_decisions(project_id: str) -> str
   Purpose: Get all decisions with who/when/why/status
   Mock: Return 2-3 dummy decisions

8. get_assumptions(project_id: str) -> str
   Purpose: Get unvalidated assumptions with risk assessment
   Mock: Return 2-3 dummy assumptions

9. get_scope(project_id: str) -> str
   Purpose: Get scope items (in/out of MVP)
   Mock: Return 3-4 dummy scope items (mix of in and out)

10. get_control_points(project_id: str) -> str
    Purpose: Get all control points with current status and confidence
    Mock: Return 15-20 control points with mix of covered/partial/missing

11. get_project_context(project_id: str) -> str
    Purpose: Get full project context (name, client, type, readiness, recent activity)
    Mock: Return a complete project context object

12. store_requirement(project_id: str, title: str, type: str, priority: str,
                      description: str, source_doc: str, source_quote: str) -> str
    Purpose: Store a newly extracted requirement
    Mock: Return success with generated ID

13. store_constraint(project_id: str, type: str, description: str,
                     impact: str, source_doc: str, source_quote: str) -> str
    Purpose: Store a newly extracted constraint
    Mock: Return success

14. store_decision(project_id: str, title: str, decided_by: str,
                   rationale: str, source_doc: str) -> str
    Purpose: Store a decision made during discovery
    Mock: Return success

15. store_stakeholder(project_id: str, name: str, role: str,
                      organization: str, decision_authority: str) -> str
    Purpose: Store a stakeholder
    Mock: Return success

16. store_assumption(project_id: str, statement: str, basis: str,
                     risk_if_wrong: str) -> str
    Purpose: Store an assumption
    Mock: Return success

17. store_scope_item(project_id: str, description: str, in_scope: bool,
                     rationale: str, source_doc: str) -> str
    Purpose: Store a scope decision
    Mock: Return success

18. store_contradiction(project_id: str, item_a: str, item_b: str,
                        explanation: str) -> str
    Purpose: Flag a contradiction between two items
    Mock: Return success

19. update_requirement_status(project_id: str, requirement_id: str,
                              status: str) -> str
    Purpose: Update a requirement's status (proposed/discussed/confirmed/changed/dropped)
    Mock: Return success

20. generate_handoff(project_id: str) -> str
    Purpose: Generate the 3 handoff documents
    Mock: Return paths to generated dummy documents

21. web_research(query: str) -> str
    Purpose: Research a topic online (company info, competitors, industry)
    Mock: Return dummy research results with URLs
```

### Mock Data

Use realistic dummy data for a project called "NacXwan Outlook Add-in":
- Client: NacXwan Technologies
- Project type: Add-on / Plugin
- Business: Building an Outlook add-in for VisioConference integration
- Mix of confirmed/proposed/assumed requirements
- A few contradictions and unresolved items
- Readiness around 65% (conditionally ready)

### Technical Requirements

- Python 3.12+
- Use `mcp` Python package (pip install mcp)
- Stdio transport (Claude Code communicates via stdin/stdout)
- All tools return JSON strings
- Include docstrings on every tool (Claude uses these to decide when to call)
- Store tools should log what was "stored" to console (for debugging)
- Include a `--project-id` CLI argument to set the default project

### File Location

```
mcp-server/
├── mock_server.py          # The mock MCP server
├── mock_data.py            # Dummy data for NacXwan project
├── requirements.txt        # mcp, pydantic
└── README.md               # How to run it
```

### How It Connects to Claude Code

In `.claude/settings.json`:
```json
{
  "mcpServers": {
    "discovery": {
      "command": "python",
      "args": ["/path/to/mcp-server/mock_server.py"],
      "env": {}
    }
  }
}
```

### Success Criteria

- [ ] All 21 tools are callable from Claude Code
- [ ] Tools return valid JSON that agents can parse
- [ ] Store tools log to console but return success
- [ ] Mock data is realistic enough to test agent workflows
- [ ] Server starts in < 2 seconds
- [ ] No external dependencies beyond `mcp` and `pydantic`
