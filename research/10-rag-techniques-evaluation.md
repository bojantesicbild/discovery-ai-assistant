# RAG Techniques — What Matters for Discovery

## The Basic Problem

Rowboat's vector RAG does this:
1. User asks a question
2. System converts question to a vector
3. Finds the top 5-10 most similar chunks
4. Sends those chunks + question to the LLM
5. LLM answers based on those chunks

This works, but it has problems. The techniques below each solve a specific problem.

---

## Technique 1: Reranking

### What it does
After vector search returns results, a **reranker model** re-scores them
for actual relevance. Vector similarity ≠ relevance. Two chunks can be
"similar" in vector space but one is actually useful and the other isn't.

### How it works
```
Without reranking:
Question: "What hosting does the client want?"
Vector search returns (by similarity score):
  1. "We discussed hosting options with the team" (0.89) ← vague, not useful
  2. "The new host for the company party will be..." (0.87) ← wrong "host"
  3. "Client confirmed Azure hosting, single region" (0.85) ← the actual answer
  4. "Hosting costs should be under $500/month" (0.84) ← useful context
  5. "We hosted a demo last Tuesday" (0.83) ← irrelevant

With reranking:
Same vector results → reranker re-scores for relevance to question:
  1. "Client confirmed Azure hosting, single region" (0.95) ← now #1
  2. "Hosting costs should be under $500/month" (0.91) ← relevant context
  3. "We discussed hosting options with the team" (0.72) ← demoted
  4. "The new host for the company party will be..." (0.15) ← buried
  5. "We hosted a demo last Tuesday" (0.10) ← buried
```

### Impact for our project: MEDIUM-HIGH
Discovery docs are messy — meeting notes, emails, informal language.
Lots of ambiguous terms. Reranking would significantly improve the quality
of chunks our agents receive, which means better answers, fewer hallucinations.

### Effort: LOW
Drop-in improvement. Add a reranker (Cohere Rerank, or a cross-encoder model)
between vector search and LLM. Doesn't change the architecture.

---

## Technique 2: Metadata Filtering

### What it does
Before vector search, filter documents by **metadata** — date, type, source,
meeting number, author, etc.

### How it works
```
Without metadata filtering:
Question: "What did the client say in the last meeting about auth?"
Vector search looks across ALL chunks from ALL documents from ALL time.
Returns chunks from meeting 1, email from January, and a client spec doc.
The agent has no idea which is most recent.

With metadata filtering:
System knows: last meeting = Meeting 4, date = Feb 10
Filters to: only chunks from documents tagged as meeting_4 or date >= Feb 5
Returns only relevant, recent chunks.
The agent gets exactly what was said recently.
```

### Impact for our project: HIGH
This is critical for discovery because:
- **Temporal awareness** — "What changed since last meeting?" requires filtering by date
- **Source filtering** — "What did the client say?" vs "What did our team assume?"
  requires knowing who authored the document
- **Document type** — Meeting Prep Agent should prioritize meeting notes,
  Document Generator should search everything
- **Contradiction detection** — needs to compare older vs newer statements,
  which requires knowing document timestamps

### Effort: MEDIUM
Requires adding metadata at ingestion time (document type, date, source,
meeting number). Qdrant supports metadata filtering natively — we just
need to tag documents when they're uploaded.

### What metadata to capture per document:
| Field | Example | Why |
|-------|---------|-----|
| `doc_type` | meeting_notes, email, client_spec, internal_note | Filter by source type |
| `date` | 2025-02-10 | Temporal queries, recency |
| `source` | client, internal, third_party | Who said it |
| `meeting_number` | 3 | Track progression |
| `author` | "Sarah Chen" | Who wrote/said this |
| `confidence` | confirmed, assumed, discussed | How reliable is this info |

---

## Technique 3: Hybrid Search (Vector + Keyword)

### What it does
Combines semantic vector search with traditional keyword (BM25) search.
Vector search finds meaning; keyword search finds exact terms.

### How it works
```
Question: "What about the VisioConference API?"

Vector search finds: chunks about video conferencing, meeting links, API integration
(semantically related — good)

Keyword search finds: chunks containing the exact word "VisioConference"
(exact match — catches things vector search might rank lower)

Hybrid: merges both result sets, giving you semantic + exact matches.
```

### Impact for our project: MEDIUM
Client projects often have specific product names, technical terms, and
acronyms that vector search might not rank highly. "VisioConference" is a
brand name — keyword search catches it precisely. Same for API endpoint
names, specific technologies, client company names.

### Effort: LOW-MEDIUM
Qdrant supports hybrid search natively (sparse + dense vectors).
Needs configuration but no major architecture change.

---

## Technique 4: Chunking Strategy

### What it does
Controls HOW documents are split into chunks. Default is usually fixed-size
(e.g., 500 tokens per chunk). But different document types need different chunking.

### How it works
```
Bad chunking (fixed size, 500 tokens):
A meeting note gets split mid-sentence:
  Chunk 1: "...Sarah said the auth should use Microsoft SSO. John disagre"
  Chunk 2: "ed and suggested API keys instead. The team decided to..."
Neither chunk has the full picture.

Better chunking (by section/topic):
  Chunk 1: "Auth discussion: Sarah proposed Microsoft SSO. John suggested
            API keys. Team decided on SSO with MSAL. Sarah to confirm
            with client IT team."
  Chunk 2: "Hosting discussion: Client wants Azure, single region Europe.
            Budget max $500/month. DevOps team available from March."
Each chunk is a complete topic.
```

### Impact for our project: HIGH
Our documents are diverse:
- **Meeting notes** — should chunk by topic/agenda item, not by size
- **Emails** — should chunk per email in a thread (each email = one chunk)
- **Client specs** — should chunk by section/heading
- **Transcripts** — should chunk by speaker turn or topic shift

Wrong chunking = agents get incomplete or noisy context = bad outputs.

### Effort: MEDIUM
Need custom chunking logic per document type. Not hard to build but
needs testing with real documents to get right.

---

## Technique 5: Parent-Child Retrieval

### What it does
When a chunk matches, also return its **parent context** — the surrounding
section, the full document, or a summary of the document.

### How it works
```
Standard retrieval:
  Match: "Client confirmed Azure hosting"
  → Agent gets just this one sentence. No surrounding context.

Parent-child retrieval:
  Match: "Client confirmed Azure hosting"
  → Agent also gets the full "Hosting Discussion" section from that meeting note,
    including who was present, what alternatives were discussed, and what
    the next steps were.
```

### Impact for our project: MEDIUM-HIGH
Discovery context matters a lot. Knowing "client confirmed Azure" is useful.
But knowing it was confirmed in Meeting 3, after discussing AWS as an
alternative, by the CTO, with a budget of $500/month — that's the full picture.

### Effort: LOW-MEDIUM
Store chunks with references to parent sections. On retrieval, optionally
fetch the parent. Qdrant payload can store parent references.

---

## Technique 6: Query Transformation

### What it does
Before searching, the system **rewrites the query** to get better results.
Several approaches:

### Approaches
```
HyDE (Hypothetical Document Embeddings):
  User asks: "What about auth?"
  System generates a hypothetical answer: "The authentication method chosen
  is Microsoft SSO using MSAL tokens with single sign-on."
  Then searches for chunks similar to this hypothetical answer.
  Often finds better matches than searching for the short question.

Multi-Query:
  User asks: "What about auth?"
  System generates multiple search queries:
  - "authentication method"
  - "login approach"
  - "SSO single sign-on"
  - "user identity management"
  - "MSAL tokens"
  Searches all of them, merges results.
  Catches different terminology the client might have used.

Step-Back:
  User asks: "Can the system handle 500 concurrent users?"
  System first asks broader: "What are the performance requirements?"
  Gets broader context, then narrows down.
```

### Impact for our project: MEDIUM
Useful because clients and POs use different terminology. Client says
"login," PO writes "authentication," spec says "identity management."
Multi-query helps bridge this vocabulary gap.

### Effort: LOW-MEDIUM
Extra LLM call per query. Adds latency and cost. Worth it for complex
queries (document generation, gap analysis) but probably overkill for
simple lookups.

---

## The Wiki-Link Approach: What It Actually Does and Why It Matters

### The Concept (from Rowboat Desktop)

Instead of just storing document chunks, you also extract **entities**
(people, features, decisions) and create **links between them**.

Think of it like Wikipedia — every important concept has its own page,
and pages link to each other.

### Simple Example

After 3 meetings and 5 emails, the system has processed everything
and created these entity notes:

```
📁 People/
   Sarah Chen.md ──────────┐
   "CTO at Acme Corp"      │
   Links to: Acme Corp,    │
   NacXwan Project,        │  All linked
   SSO Decision            │  bidirectionally
                            │
📁 Organizations/           │
   Acme Corp.md ◄──────────┤
   "Video conferencing"    │
   Links to: Sarah Chen,   │
   NacXwan Project         │
                            │
📁 Projects/                │
   NacXwan.md ◄─────────────┤
   "Outlook Add-in"        │
   Links to: Sarah Chen,   │
   Acme Corp, SSO Decision,│
   VisioConf API           │
                            │
📁 Decisions/               │
   SSO Decision.md ◄────────┘
   "Use Microsoft SSO"
   Decided by: Sarah Chen
   Date: Meeting 3
   Links to: Sarah Chen,
   NacXwan Project
```

### What This Enables (That Vector RAG Cannot Do)

**1. Connected Navigation**

PO asks: "Tell me everything about the auth decision"

Without wiki-links (vector RAG only):
→ Searches for "auth decision" → finds 3 chunks from different docs
→ Agent pieces together an answer from fragments
→ May miss that Sarah was the decision maker, or that IT team disagreed in a later email

With wiki-links:
→ Finds the "SSO Decision" entity
→ Follows links to: Sarah Chen (who decided), Meeting 3 (when),
  NacXwan Project (which project), VisioConf API (related integration)
→ Agent can also check if any linked entity has conflicting info
→ Complete, structured answer with full context

**2. Impact Analysis**

PO asks: "If we change the auth approach, what else is affected?"

Without wiki-links:
→ No way to trace dependencies. Agent guesses based on chunk search.

With wiki-links:
→ SSO Decision links to: NacXwan Project, VisioConf API, Token Management
→ Token Management links to: MSAL Library, Refresh Token Flow
→ Agent can trace the full impact chain and list everything affected.

**3. Stakeholder Mapping**

PO asks: "Who do I need to talk to about the deployment decision?"

Without wiki-links:
→ Searches for "deployment" → finds chunks mentioning deployment
→ Agent extracts names from chunks (if mentioned in the same chunk)

With wiki-links:
→ Finds "Deployment" topic/decision entity
→ Follows links to all related people: Sarah (decided), IT Team (will implement),
  Jan (raised concerns in email), Mike (DevOps lead mentioned in meeting 2)
→ Complete stakeholder list with their specific involvement

**4. Completeness Checking**

Control Point Agent checks: "Do we know the key stakeholders?"

Without wiki-links:
→ Searches for "stakeholder" → hopes to find relevant chunks → unreliable

With wiki-links:
→ Counts entities in People/ folder for this project
→ Checks each person has: role, email, organization, decision authority
→ Can definitively say: "5 stakeholders identified. 3 have roles defined.
   2 are missing decision authority information."
→ This is precise, not probabilistic.

### The Key Insight

**Vector RAG answers: "Here are chunks related to your question."**
**Wiki-links/entities answer: "Here is the structured knowledge about your project."**

For discovery, we need both:
- Vector RAG for exploratory questions ("what did we discuss about performance?")
- Structured entities for precise questions ("who decided what, and is anything missing?")

### Practical Impact on Our Project

| Feature | Vector RAG Alone | Vector RAG + Entity Tracking |
|---------|-----------------|------------------------------|
| Gap Detection | Searches for topics, guesses if covered | Checks entity records, knows definitively |
| Contradiction Detection | Finds similar chunks, LLM compares | Compares same entity across sources with timestamps |
| Meeting Prep | Finds recent chunks about open topics | Lists all open questions linked to stakeholders |
| Document Generation | Retrieves chunks per template section | Pulls structured entity data + supporting chunks |
| Control Points | Probabilistic (LLM interprets chunks) | Deterministic (entity exists or it doesn't) |
| Stakeholder Management | Extracted from text each time | Maintained as living records |

### Do We Need Full Wiki-Links?

**For MVP: No.** Full wiki-links (Obsidian-style markdown vault with backlinks)
are elegant but complex to build and maintain.

**What we DO need:** The concept — structured entity records with references
between them. Implemented as MongoDB documents, not markdown files.

```
// Simpler than wiki-links, same benefit
{
  type: "decision",
  name: "Authentication Method",
  value: "Microsoft SSO with MSAL",
  decided_by: "stakeholder_id_sarah",     // reference
  project: "project_id_nacxwan",          // reference
  date: "2025-01-24",
  source: "Meeting 3",
  status: "confirmed",
  related_features: ["feature_id_login"], // references
  related_integrations: ["integration_id_visioconf"],
  notes: "IT team raised concerns about firewall compatibility in email Feb 3"
}
```

This gives us the connected navigation and completeness checking benefits
without the complexity of maintaining a full wiki-link graph.

---

## Recommendation: What to Use for Discovery MVP

### Must Have (build into MVP)

| Technique | Why | Effort |
|-----------|-----|--------|
| **Metadata filtering** | Temporal awareness, source filtering — critical for discovery | Medium |
| **Smart chunking** | Different doc types need different chunking — directly affects output quality | Medium |
| **Entity tracking (MongoDB)** | Control points, gap detection, stakeholder mapping — the core differentiator | Medium-High |

### Should Have (add early, high value)

| Technique | Why | Effort |
|-----------|-----|--------|
| **Reranking** | Significantly better retrieval quality for messy discovery docs | Low |
| **Parent-child retrieval** | Context matters — "who said it, when, in what discussion" | Low-Medium |

### Nice to Have (add later)

| Technique | Why | Effort |
|-----------|-----|--------|
| **Hybrid search** | Catches exact terms vector search misses | Low-Medium |
| **Query transformation** | Bridges vocabulary gap between PO and client | Low-Medium |
| **Full wiki-links / graph** | Maximum connected navigation — evaluate after MVP | High |

### Architecture Summary

```
┌──────────────────────────────────────────────────────────────┐
│                    DISCOVERY PROJECT                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ INGESTION PIPELINE                                    │    │
│  │                                                      │    │
│  │  Upload doc → detect type → apply smart chunking     │    │
│  │       → tag with metadata (date, source, type)       │    │
│  │       → embed chunks → store in Qdrant               │    │
│  │       → Analysis Agent extracts entities → MongoDB    │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────┐  ┌──────────────────────────────┐  │
│  │ VECTOR RAG (Qdrant)  │  │ ENTITY STORE (MongoDB)       │  │
│  │                     │  │                              │  │
│  │ Chunks with metadata │  │ Stakeholders                 │  │
│  │ Semantic search      │  │ Features + priorities        │  │
│  │ Metadata filtering   │  │ Decisions + who/when         │  │
│  │ Reranking            │  │ Integrations + status        │  │
│  │ Parent-child refs    │  │ Assumptions + validated?     │  │
│  │                     │  │ Open Questions + assigned to  │  │
│  │ Used for:           │  │ Constraints + source         │  │
│  │ "find relevant text" │  │                              │  │
│  │                     │  │ Used for:                    │  │
│  │                     │  │ "what do we know/not know"   │  │
│  └─────────┬───────────┘  └──────────────┬───────────────┘  │
│            │                              │                  │
│            └──────────┬───────────────────┘                  │
│                       │                                      │
│              ┌────────▼────────┐                             │
│              │   AGENTS        │                             │
│              │                 │                             │
│              │  Query both     │                             │
│              │  layers based   │                             │
│              │  on the task    │                             │
│              └─────────────────┘                             │
└──────────────────────────────────────────────────────────────┘
```
