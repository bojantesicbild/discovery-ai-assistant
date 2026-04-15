## 2. The Integration Points

### What Discovery AI WRITES (→ consumed by crnogochi)

Discovery AI produces 3 handoff documents + seed files. The Unified Assistant
picks them up automatically via its Context Loading protocol. only 3 documents 

| Discovery AI Output | Where It Goes in crnogochi | Consumed By |
|--------------------|---------------------------|-------------|
| **Discovery Brief** | `.memory-bank/docs/discovery/discovery-brief.md` | All domains (context loading) |
| **MVP Scope Freeze** | `.memory-bank/docs/discovery/mvp-scope-freeze.md` | All domains (context loading) |
| **Functional Requirements** | `.memory-bank/docs/discovery/functional-requirements.md` | tech-stories (story-tech-agent input) |
