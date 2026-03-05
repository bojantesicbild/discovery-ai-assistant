# RAG System — The Knowledge Base Behind Discovery

## What is RAG?

RAG stands for **Retrieval-Augmented Generation**. It solves a fundamental problem
with AI assistants: they only know what they were trained on. They don't know
anything about your specific project, client, or company.

RAG gives the AI **your data** to work with, at the moment it needs it.

### How it Works (Simple Version)

```
STEP 1: STORE
You upload documents (PDFs, meeting notes, emails, etc.)
The system breaks them into small chunks and converts each chunk
into a mathematical representation (called an "embedding" — a vector
of numbers that captures the meaning of the text).
These vectors are stored in a vector database.

STEP 2: RETRIEVE
When you ask a question like "What auth method did the client want?"
The system converts your question into the same kind of vector,
then searches for the chunks whose meaning is closest to your question.
It finds the 5-10 most relevant chunks across ALL your uploaded documents.

STEP 3: GENERATE
The AI receives your question PLUS the relevant chunks as context.
It answers based on your actual project data, not general knowledge.
```

```
                    ┌──────────────┐
                    │  You ask:    │
                    │  "What auth  │
                    │  method?"    │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   RETRIEVE   │  Search vector DB for
                    │   relevant   │  chunks matching the question
                    │   chunks     │
                    └──────┬───────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
     ┌──────▼──────┐ ┌────▼──────┐ ┌─────▼─────┐
     │ Meeting 1   │ │ Email     │ │ Client    │
     │ notes chunk │ │ thread    │ │ spec doc  │
     │ about auth  │ │ about SSO │ │ section 3 │
     └──────┬──────┘ └────┬──────┘ └─────┬─────┘
            │              │              │
            └──────────────┼──────────────┘
                           │
                    ┌──────▼───────┐
                    │   GENERATE   │  AI reads the chunks and
                    │   answer     │  gives a grounded answer
                    └──────┬───────┘
                           │
                    ┌──────▼───────────────────────────────────┐
                    │  "Based on meeting 1 and the email from  │
                    │  Jan 15, the client wants Microsoft SSO  │
                    │  with MSAL token handling. No separate   │
                    │  login."                                 │
                    └──────────────────────────────────────────┘
```

### Key Point

Without RAG, the AI would say: "I don't know what auth method your client wants."
With RAG, the AI searches your actual project documents and gives a specific,
sourced answer.

## Types of RAG

Not all RAG systems work the same way. There are two main approaches, and
Rowboat actually implements both — in two separate products.

### Vector RAG (what most people mean by "RAG")

This is the standard approach described above. Documents are chunked, embedded
as vectors, stored in a vector database, and retrieved by semantic similarity.

**Good for:** "Find me everything related to authentication across all documents"
**Limitation:** No understanding of entities or relationships. It finds relevant
text chunks but doesn't know that "Sarah from Acme" mentioned in meeting 1 is
the same person as "S. Chen" in the email. It doesn't track that Feature A
depends on Integration B.

### Knowledge Graph RAG (Graph RAG)

Instead of (or in addition to) vector search, a knowledge graph extracts
**entities** (people, organizations, features, systems) and **relationships**
between them, storing them as structured, linked data.

```
┌──────────────┐  works at  ┌──────────────┐  builds    ┌──────────────┐
│ Sarah Chen   │───────────▶│ Acme Corp    │───────────▶│ NacXwan      │
│ (Person)     │            │ (Org)        │            │ (Project)    │
│ VP Eng       │            │ Video conf   │            │ Outlook Add  │
└──────┬───────┘            └──────────────┘            └──────┬───────┘
       │ decided                                               │ requires
       ▼                                                       ▼
┌──────────────┐                                        ┌──────────────┐
│ Microsoft    │                                        │ VisioConf    │
│ SSO auth     │                                        │ API          │
│ (Decision)   │                                        │ (Integration)│
└──────────────┘                                        └──────────────┘
```

**Good for:** "Who is responsible for the auth decision?" "What integrations
does the project depend on?" "Show me all decisions made by Sarah."
**Limitation:** Requires entity extraction (LLM-powered, can make mistakes).
More complex to build and maintain.

### Hybrid Approach

Use both: vector RAG for general document search + knowledge graph for
structured entity/relationship tracking. This is the most powerful approach
for discovery, where you need both:
- "Find all mentions of deployment" (vector search)
- "What are all the decisions that are still pending?" (graph query)

## Rowboat: Two Products, Two Approaches

**Important:** Rowboat's repo contains two separate products.

| | Server App (`apps/rowboat/`) | Desktop App (`apps/x/`) |
|---|---|---|
| **Type** | Web app (Next.js) | Electron desktop app |
| **RAG approach** | Vector RAG | Knowledge Graph |
| **Search** | Qdrant vector similarity | Grep-based text search |
| **Storage** | MongoDB + S3 + Qdrant | Local filesystem (markdown) |
| **Graph DB** | None | None (wiki-links between .md files) |
| **Entity extraction** | None | LLM-powered |
| **Data sources** | File uploads, web scraping | Gmail, Fireflies, Granola, Calendar |
| **Multi-agent** | Yes (4 agent types) | Yes (different agent system) |
| **Deployment** | Docker Compose (cloud) | Local install |

### Server App — Vector RAG (what we'd use as our platform)

| Component | Technology | Role |
|-----------|-----------|------|
| **Document Storage** | AWS S3 (or MinIO) | Stores uploaded files (PDFs, DOCX, TXT) |
| **Web Scraping** | Firecrawl | Crawls URLs and extracts text content |
| **Embedding Model** | OpenAI `text-embedding-3-small` | Converts text chunks into vectors |
| **Vector Database** | Qdrant | Stores and searches vectors by similarity |
| **RAG Worker** | Background process | Handles async indexing of new documents |

Per-agent RAG configuration:
- Which data sources to search (not all agents need all docs)
- How many results to return (`ragK` — top-K parameter)
- Return type: `chunks` (raw text pieces) or `content` (full document content)

Data source types:
- **Document uploads** — PDFs, DOCX, TXT uploaded to S3
- **Web sources** — URLs crawled via Firecrawl, with re-crawl to keep content fresh

Modular activation:
- `USE_RAG=true` — enables the vector database
- `USE_RAG_UPLOADS=true` — enables file uploads
- `USE_RAG_SCRAPING=true` — enables web scraping

### Desktop App — Knowledge Graph (inspiration for our entity layer)

The desktop app's "knowledge graph" is NOT a graph database. It's an
**Obsidian-compatible vault of structured markdown files with wiki-link backlinks**.

**How entities are stored:**
```
~/.rowboat/knowledge/
├── People/
│   └── Sarah Chen.md        ← entity note
├── Organizations/
│   └── Acme Corp.md         ← entity note
├── Projects/
│   └── NacXwan.md           ← entity note
└── Topics/
    └── Authentication.md    ← entity note
```

**Each entity file looks like:**
```markdown
## Info
**Role:** VP of Engineering
**Organization:** [[Organizations/Acme Corp]]
**Email:** sarah@acme.com

## Summary
Sarah is the VP of Engineering at Acme Corp...

## Connected to
- [[Organizations/Acme Corp]]
- [[Projects/NacXwan]]
- [[People/John Smith]]

## Activity
- **2025-01-15** (email) Discussed timeline for Q2 launch
- **2025-01-10** (meeting) Reviewed architecture proposal

## Key facts
- Budget approved for $500K
- Prefers async communication

## Open items
- [ ] Send revised proposal by Friday
```

**How it accumulates:**
1. Every 30 seconds, polls for new source files (emails, transcripts, notes)
2. Batches new files (10 per batch) and sends to an LLM agent
3. LLM extracts entities (people, orgs, projects, topics) with a 3-step
   resolution process (variant collection → index lookup → canonical mapping)
4. Creates or updates markdown notes with bidirectional wiki-links
5. All changes are version-controlled via embedded git

**Entity types:**

| Type | Folder | Key Fields |
|------|--------|-----------|
| People | `People/` | name, email, organization, role |
| Organizations | `Organizations/` | name, domain |
| Projects | `Projects/` | name, status (planning/active/completed) |
| Topics | `Topics/` | name, keywords |

**The "graph" is the link topology** — Person A links to Organization B,
Organization B links back to Person A. Traversal is done by reading files
and following links, not by graph queries.

## What This Means for Discovery Assistant

We'd build on the **server app** (vector RAG, multi-agent, Docker deployment)
but we can **borrow the knowledge graph concept** from the desktop app for
entity tracking.

### Our Approach: Vector RAG + Lightweight Entity Tracking

```
┌──────────────────────────────────────────────────────────┐
│                    DISCOVERY PROJECT                      │
│                                                          │
│  LAYER 1: Vector RAG (Rowboat server, out of the box)    │
│  ─────────────────────────────────────────────────        │
│  All uploaded documents → chunked → embedded → Qdrant    │
│  Used for: general search, document generation,          │
│            finding relevant information                   │
│                                                          │
│  LAYER 2: Entity Tracking (we build this)                │
│  ─────────────────────────────────────────────────        │
│  Extracted from documents by Analysis Agent:             │
│  • Stakeholders (who, role, org, contact)                │
│  • Features (name, priority, status, owner)              │
│  • Decisions (what, who decided, when, context)          │
│  • Integrations (system, type, status)                   │
│  • Assumptions (claim, source, validated?)               │
│  • Open Questions (question, assigned to, blocking?)     │
│                                                          │
│  Used for: control points evaluation, gap detection,     │
│            contradiction finding, relationship tracking   │
└──────────────────────────────────────────────────────────┘
```

### Why Both Layers Matter for Discovery

**Vector RAG alone can answer:** "What did the client say about authentication?"
→ Searches all docs, returns relevant chunks.

**Entity tracking adds:** "Who made the auth decision? When? Does it conflict
with what someone else said?"
→ Knows Sarah decided on SSO in meeting 2, but the email from IT team
  on Feb 3 questions whether SSO is compatible with their firewall.

**Discovery-specific entities we'd track:**

| Entity Type | Why It Matters for Discovery |
|-------------|----------------------------|
| **Stakeholders** | Who to ask about what. Decision authority. |
| **Features** | What's been discussed, priority, completeness |
| **Decisions** | What was decided, by whom, when — the audit trail |
| **Integrations** | External systems, APIs, dependencies |
| **Assumptions** | Things we think are true but haven't confirmed |
| **Open Questions** | Unanswered questions, who should answer them |
| **Constraints** | Budget, timeline, technical, regulatory |

### Implementation Options for Entity Tracking

**Option A: Markdown files (like Rowboat desktop)**
- Store entities as structured markdown in the project folder
- Simple, human-readable, version-controlled
- Limited querying — grep-based
- Good enough for MVP

**Option B: MongoDB collection (extend Rowboat server)**
- Store entities as documents in MongoDB alongside existing project data
- Proper querying, filtering, aggregation
- More structured, easier for the dashboard to consume
- Better for control point evaluation

**Option C: Full graph database (Neo4j or similar)**
- True graph traversal and relationship queries
- Most powerful for "show me all connections to Feature X"
- Adds significant infrastructure complexity
- Probably overkill for MVP

**Recommendation:** Option B for MVP. MongoDB is already in the stack.
Entities are stored as structured documents with references between them.
If we need graph queries later, we can add Neo4j or use MongoDB's
`$graphLookup` aggregation.

### Example: How Entity Tracking Helps Control Points

Without entity tracking, the Control Point Agent searches RAG for
"hosting requirements" and gets text chunks. It has to guess whether
the chunks are sufficient.

With entity tracking:
```
Constraints collection:
{
  type: "hosting",
  value: "Client-hosted on Azure",
  source: "Meeting 3, Jan 24",
  decided_by: "Sarah Chen (CTO)",
  status: "confirmed",
  related_features: ["deployment", "ci-cd"]
}
```

The Control Point Agent can now check: is there a constraint record of type
"hosting" with status "confirmed"? Yes → ✅ Covered. No need to interpret
text chunks.

## RAG's Role in the Discovery Assistant

RAG is the **memory of the project**. It's where all client information lives.
Every agent draws from it. Without it, agents have no context about the project.

```
┌──────────────────────────────────────────────────────────────┐
│                     PROJECT RAG (per client)                  │
│                                                              │
│  📄 Meeting notes (Jan 10, Jan 17, Jan 24...)               │
│  📧 Email threads with client                                │
│  📋 Client-provided documents (specs, API docs, contracts)   │
│  🌐 Client website content (scraped)                         │
│  📝 Previous discovery outputs (briefs, scope docs)          │
│                                                              │
│  All chunked, embedded, searchable                           │
└──────────────────────┬───────────────────────────────────────┘
                       │
          ┌────────────┼────────────────┬──────────────┐
          │            │                │              │
    ┌─────▼────┐ ┌─────▼─────┐  ┌──────▼─────┐ ┌─────▼──────┐
    │ Gap      │ │ Meeting   │  │ Document   │ │ Control    │
    │ Detection│ │ Prep      │  │ Generator  │ │ Point      │
    │ Agent    │ │ Agent     │  │ Agent      │ │ Agent      │
    └──────────┘ └───────────┘  └────────────┘ └────────────┘
    Searches for  Searches for   Searches for   Searches for
    what's        what we know   all relevant   evidence that
    missing       vs. don't know data to fill   checklist items
                                 templates      are covered
```

## High-Impact Examples

### Example 1: Contradiction Detection

**Scenario:** Over 3 weeks, the client said different things about the same topic.

**What's in RAG:**
- Meeting 1 notes: "The system should support single tenant deployment"
- Email from Feb 3: "We'll need multi-tenant support for our regional offices"
- Client spec doc: no mention of tenancy model

**What happens:**
PO asks the Gap Detection Agent: "Are there any contradictions in what the client told us?"

The agent searches RAG, finds both chunks, and responds:
> "Contradiction found regarding deployment model.
> Meeting 1 (Jan 10) states single-tenant. Email from Feb 3 mentions multi-tenant
> for regional offices. The client's spec document doesn't address this.
> Suggested question for next meeting: 'Can you clarify whether regional offices
> need separate tenants or shared access within a single tenant?'"

**Impact:** Without RAG, this contradiction sits buried in separate documents.
Nobody notices until development is underway and the architecture doesn't fit.

---

### Example 2: Meeting Preparation from Accumulated Knowledge

**Scenario:** PO has a 4th meeting with the client tomorrow. Needs a focused agenda.

**What's in RAG:**
- 3 previous meeting notes
- 8 email exchanges
- 2 client-provided documents
- Client website content

**What happens:**
PO asks the Meeting Prep Agent: "Prepare my agenda for tomorrow's meeting."

The agent:
1. Queries RAG for all information collected so far
2. Cross-references with the control points checklist
3. Identifies the biggest remaining gaps

Response:
> "Suggested agenda for Meeting 4 (45 min):
>
> 1. **Confirm understanding** (10 min)
>    Recap: based on our discussions, the MVP includes [X, Y, Z features].
>    Is this correct? Anything missing?
>
> 2. **Authentication approach** (10 min) — BLOCKING GAP
>    We still don't have a decision on auth. Options discussed were Microsoft
>    SSO (meeting 2) and API keys (email Feb 5). Which direction?
>
> 3. **User roles and permissions** (10 min) — HIGH PRIORITY GAP
>    We know there are 'admin' and 'regular' users (meeting 1), but no details
>    on what each role can do. Need permission matrix.
>
> 4. **Deployment timeline** (5 min) — MISSING
>    No timeline discussed yet. Need at least a target quarter.
>
> 5. **Open questions from last meeting** (10 min)
>    - Data retention policy (asked in email, no response yet)
>    - Third-party API rate limits (client was going to check)"

**Impact:** Instead of PO spending 30 min reviewing all previous notes to figure
out what to ask, the agent does it in seconds and prioritizes by what actually
matters for moving discovery forward.

---

### Example 3: Document Generation from Scattered Sources

**Scenario:** Discovery is 85% complete. PO needs to generate the MVP Scope Freeze doc.

**What's in RAG:**
- 5 meeting notes
- 12 emails
- 3 client documents
- Client website

The information needed for the MVP Scope doc is scattered across all of these.
No single document has the full picture.

**What happens:**
PO asks the Document Generator Agent: "Generate the MVP Scope Freeze document."

The agent:
1. Takes the MVP Scope Freeze template
2. For each section, queries RAG for relevant information
3. Assembles the document, citing sources

Response:
> "# MVP Scope Freeze — Project NacXwan
>
> ## 1. Purpose & MVP Goal
> Deliver a client-hosted Outlook Add-in for single-tenant deployment
> allowing users to schedule meetings with integrated VisioConference links.
> *(Source: Meeting 1, Jan 10 + Client requirements doc)*
>
> ## 2. Supported Platforms
> - Outlook Desktop (Windows, macOS)
> - Outlook Web
> - **Excluded:** Outlook Mobile *(Source: Meeting 2, Jan 17 — client confirmed)*
>
> ## 3. Authentication
> Microsoft account SSO with MSAL token handling. No separate login.
> *(Source: Email Feb 3 + Meeting 3, Jan 24)*
>
> ...
>
> ## 8. Out of Scope
> - Microsoft Store publication *(Meeting 2)*
> - Multi-tenant deployment *(Meeting 1 — confirmed single tenant)*
> - Calendar availability checks *(Email Feb 10 — deferred to v2)*
>
> ## 9. Assumptions (⚠️ not yet validated)
> - Client IT team will handle Azure deployment (discussed but not confirmed)
> - Maximum 500 concurrent users (PO estimate, not from client)"

**Impact:** The PO gets a first draft in minutes instead of spending half a day
going through all documents and assembling the scope doc manually. The draft
cites sources so the PO can verify. Assumptions are clearly flagged.

---

### Example 4: Control Point Evaluation

**Scenario:** After ingesting new meeting notes, the system auto-evaluates
discovery completeness.

**What happens:**
The Control Point Agent runs through each checklist item and queries RAG.

For "Authentication method decided":
- Searches RAG → finds 3 chunks mentioning auth
- All three consistently say "Microsoft SSO with MSAL"
- Result: ✅ **Covered**

For "Data retention policy":
- Searches RAG → finds 1 chunk: "We asked about data retention in email Feb 5"
- No response from client found
- Result: ⚠️ **Partial** — question asked but not answered

For "Compliance requirements":
- Searches RAG → no chunks mention compliance, GDPR, regulations
- Result: ❌ **Missing**

The dashboard updates: readiness moves from 72% to 78% after the new meeting
notes were ingested. Two new items became Covered, one remains Partial.

**Impact:** The PO doesn't have to manually track what's been answered and what
hasn't. The system does it continuously, and surfaces what's still missing.

---

### Example 5: Client Website Analysis

**Scenario:** New client engagement starts. Before the first meeting, PO wants
to understand what the client's product does.

**What happens:**
PO adds the client's website as a RAG web source. Firecrawl scrapes it.

PO asks: "What does this client's product do? Who are their users?"

The agent searches the scraped website content and responds:
> "Based on their website, NacXwan is a video conferencing platform targeting
> enterprise clients. Key products include: [X, Y, Z]. Their users appear to
> be business professionals who schedule frequent video meetings.
> They emphasize security and single-tenant deployment for enterprise clients."

PO goes into the first meeting already informed, asks better questions, and
doesn't waste time on basics the website already answers.

**Impact:** Discovery starts faster. PO has context from day one instead of
spending the entire first meeting on "so tell me about your company."

---

### Example 6: Cross-Project Knowledge (Memory Bank)

**Scenario:** Bild starts a new project that's similar to one done last year.

**What's in RAG:**
- Current project: 2 meetings so far
- Previous similar project: full discovery docs (imported as reference)

PO asks: "Based on similar projects we've done, what should I make sure to ask
about early?"

The agent searches both the current project data AND the reference project:
> "Based on the NacXwan project (similar Outlook add-in), key items that
> came up late and caused delays were:
> 1. Client API availability — they promised APIs in week 2 but delivered in week 6
> 2. Manifest deployment — required client IT involvement earlier than expected
> 3. Token refresh edge cases — not discussed until QA phase
>
> Recommend asking about these in your next meeting to avoid the same delays."

**Impact:** The company learns from past projects and doesn't repeat the same discovery mistakes.

## RAG Configuration Per Agent

Not every agent needs to search the same way:

| Agent | What it searches | RAG Settings |
|-------|-----------------|--------------|
| **Gap Detection** | Everything — needs the full picture | All sources, chunks, K=10 |
| **Meeting Prep** | Recent meetings + current gaps | All sources, chunks, K=8 |
| **Document Generator** | Specific sections relevant to template | All sources, content, K=15 |
| **Control Point** | Targeted per checklist item | All sources, chunks, K=5 |
| **Intake** | Existing data to classify new input against | All sources, chunks, K=5 |

## What Makes RAG Work Well (and What Breaks It)

### Works well when:
- Documents are text-heavy (meeting notes, specs, emails)
- Questions are specific ("What auth method?" vs. "Tell me everything")
- Chunks are the right size (not too small = no context, not too big = noise)
- Documents are consistently uploaded (nothing left in someone's inbox)

### Breaks down when:
- Information is in images/diagrams (RAG is text-based)
- Meeting transcripts are very noisy (filler words, cross-talk)
- Key info was discussed verbally but never written down
- Documents contradict each other and the system can't tell which is newer

### For our MVP:
- Start with clean document types: PDFs, DOCX, pasted meeting notes
- Defer noisy sources (raw transcripts, email threads) until we tune chunking
- Encourage POs to upload structured notes rather than raw recordings
- Test with real project docs early to calibrate chunk size and K values
