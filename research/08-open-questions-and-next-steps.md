# Open Questions & Next Steps

## Status: Pre-Build Gap Analysis

Before starting implementation, these items need resolution.

---

## DECISION 1: Rowboat Spike (Blocking)

**Question:** Does Rowboat actually support what we've designed?

**What we need to verify:**
- Rowboat repo contains TWO products (server app + desktop app). We plan to use
  the server app (`apps/rowboat/`). Verify this is the right choice.
- Can agents chain: Intake → Analysis → Gap Detection → Control Point?
- How do agents share state between each other?
- What is the MongoDB data model? Can we extend it for control points + entity tracking?
- Does RAG handle DOCX, PDFs, meeting transcripts?
- Per-agent RAG queries — can different agents search differently?
- What extension points exist for custom features?
- Can we borrow the desktop app's knowledge graph concept (entity extraction,
  structured markdown notes) and implement it on the server side using MongoDB?
- Evaluate the desktop app's entity extraction approach (LLM-powered, batch processing,
  3-step resolution) — is it suitable for our discovery entities (stakeholders,
  features, decisions, integrations, assumptions)?

**Action:** Clone Rowboat, run both apps locally, explore internals. 1-2 days.

**Risk if skipped:** We design a system that doesn't fit the platform and have
to rewrite or abandon Rowboat entirely.

---

## DECISION 2: Chat-first vs Dashboard-first UX (Blocking)

**Question:** How do POs primarily interact with the system?

**Option A: Chat-first**
- User talks to agents via chat: "What's missing?" "Prepare meeting agenda"
- Dashboard is secondary, shows status at a glance
- Faster to build (Rowboat chat UI already exists)
- Feels like an AI assistant

**Option B: Dashboard-first**
- User sees project status screen with scores, checklists, actions
- Chat is a secondary tool for deeper exploration
- More to build (custom frontend on top of Rowboat)
- Feels like a project management tool

**Option C: Hybrid**
- Dashboard as home screen (status, scores, quick actions)
- Chat embedded in dashboard for agent interaction
- Best experience but most work

**Recommendation:** Start with Option A (chat-first) for MVP, add dashboard
elements incrementally. Chat is the core value; status can be a simple page.

**Action:** Quick wireframe session or decision from product owner.

---

## DECISION 3: Phase 2 Input Format (Blocking)

**Question:** What does the existing Story/Tech Doc Assistant accept?

**What we need to know:**
- What file format? (Markdown, JSON, Word, Confluence page?)
- What structure does it expect?
- Is there an API, or does a human copy-paste the docs?
- Are our templates (Discovery Brief, MVP Scope, Functional Reqs) compatible?

**Action:** Talk to the team that owns the Story/Tech Doc Assistant.
Get the exact input spec. Adjust our templates to match.

**Risk if skipped:** Discovery produces beautiful docs that Phase 2 can't use,
requiring manual reformatting that defeats the purpose.

---

## DECISION 4: MVP Agent Scope (Important, Not Blocking)

**Question:** Which agents do we build first?

**Full vision:** 7 agents
**Proposed MVP:** 4 agents

| Agent | MVP? | Rationale |
|-------|------|-----------|
| Intake Agent | ✅ Yes | Needed to ingest and classify docs |
| Analysis Agent | ❌ No | Fold into Gap Detection for MVP |
| Gap Detection Agent | ✅ Yes | Core value — identifies what's missing |
| Meeting Prep Agent | ✅ Yes | High-value, directly useful to POs |
| Document Generator | ✅ Yes | Produces the deliverables |
| Control Point Agent | ⚠️ Partial | Build as a tool/function, not full agent |
| Role Simulation Agent | ❌ No | Post-MVP — nice to have, not essential |

**Action:** Confirm this prioritization. Can adjust based on Rowboat spike findings.

---

## DECISION 5: LLM Provider (Important, Not Blocking)

**Question:** OpenAI or Claude for MVP?

**Considerations:**
- Rowboat defaults to OpenAI (gpt-4.1)
- Changing to Claude means modifying Rowboat's LLM layer
- Different prompt engineering needed per model
- Cost differences for heavy agent use (control point evaluation = many calls)

**Recommendation:** Start with OpenAI (path of least resistance with Rowboat).
Abstract the LLM layer so we can switch later. Don't optimize for model choice now.

**Action:** Decide and move on. Can revisit after MVP.

---

## DECISION 6: Email Ingestion Scope (Quick Decision)

**Question:** Is email ingestion in MVP?

**Recommendation:** No. Explicitly out of scope for MVP.

MVP ingestion: manual document upload (PDF, DOCX, TXT, meeting transcripts).
Email can be copy-pasted as text files if needed.
Proper email integration (Gmail/Outlook API) is Phase 2+ work.

**Action:** Confirm and document as out of scope.

---

## DECISION 7: Auth Scope (Quick Decision)

**Question:** Who uses this system?

**Option A: Internal only (Bild employees)**
- Simple auth, maybe just SSO with company identity
- No multi-tenant complexity
- Fastest to build

**Option B: Internal + Client access (for reviews/sign-off)**
- Need proper multi-tenant auth
- Role-based access (PO can edit, client can view/comment)
- More complex

**Recommendation:** Option A for MVP. Internal only. Clients get exported PDFs
to review, not system access.

**Action:** Confirm.

---

## Priority Order for Resolution

| # | Decision | Effort | Blocks Building? |
|---|----------|--------|-----------------|
| 1 | Rowboat Spike | 1-2 days | YES — validates entire approach |
| 2 | Chat vs Dashboard UX | 1 hour decision | YES — shapes frontend work |
| 3 | Phase 2 Input Format | 1 conversation | YES — shapes template design |
| 4 | MVP Agent Scope | Quick decision | No, but saves time |
| 5 | LLM Provider | Quick decision | No, default to OpenAI |
| 6 | Email out of MVP | Quick decision | No, just confirm |
| 7 | Auth scope | Quick decision | No, default to internal |

## Suggested Plan

**This week:**
- Decisions 2-7 can be made in a single meeting (30 min)
- Start Rowboat spike in parallel (clone, run, explore)

**After spike:**
- Update research docs with Rowboat findings
- Finalize agent design based on what Rowboat actually supports
- Start building
