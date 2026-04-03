# Beyond Vector RAG — Graph, Agentic, and Structured Knowledge

## The Limits of Vector RAG

Vector RAG (embed chunks → search by similarity → generate answer) is
powerful for finding relevant text. But it can't do everything:

```
Vector RAG can answer:
  ✅ "What did the client say about hosting?"
  ✅ "Find all mentions of authentication"
  ✅ "Summarize the deployment discussion"

Vector RAG struggles with:
  ❌ "Who decided on SSO, and what depends on that decision?"
  ❌ "If we change the auth method, what else is affected?"
  ❌ "Is hosting requirements covered?" (yes/no, not "find text")
  ❌ "What do we know vs. not know about the project?"
  ❌ "The client said X in Meeting 2 but Y in Meeting 4 — which is current?"
```

These harder questions require understanding **relationships between entities**,
**tracking facts over time**, and **reasoning across multiple steps**.
Three approaches address this: Graph RAG, Agentic RAG, and Structured
Fact Stores.

---

## Graph RAG

### What Is a Knowledge Graph?

A knowledge graph stores information as **entities** (things) and
**relationships** (connections between things).

```
Entities (nodes):
  [Sarah Chen]     type: person,    role: CTO
  [SSO Auth]       type: decision,  status: confirmed
  [MSAL Library]   type: technology
  [NacXwan]        type: project
  [Azure]          type: hosting,   region: EU

Relationships (edges):
  Sarah Chen  ──[decided]──→     SSO Auth
  SSO Auth    ──[requires]──→    MSAL Library
  NacXwan     ──[uses]──→        Azure
  NacXwan     ──[integrates]──→  VisioConference API
  Azure       ──[constrained_by]──→ Budget ($500/mo)
```

Visually:

```
  Sarah Chen ──[decided]──→ SSO Auth ──[requires]──→ MSAL Library
       │                        │
  [works_at]               [chosen_for]
       │                        │
       ▼                        ▼
  Acme Corp                 NacXwan ──[uses]──→ Azure
                                │                  │
                          [integrates]        [constrained_by]
                                │                  │
                                ▼                  ▼
                        VisioConf API        Budget ($500/mo)
```

### What Graph Queries Enable

**1. Traversal: "If we change auth, what's affected?"**
```
Start at: SSO Auth
Follow outgoing edges:
  SSO Auth ──[requires]──→ MSAL Library
  SSO Auth ──[chosen_for]──→ NacXwan
  MSAL Library ──[used_by]──→ Token Management Feature
  Token Management ──[depends_on]──→ Refresh Token Flow

Answer: "Changing auth affects MSAL Library, Token Management,
         and Refresh Token Flow."
```

**2. Stakeholder queries: "Who do I talk to about deployment?"**
```
Start at: Deployment (decision)
Follow edges:
  Deployment ──[decided_by]──→ Sarah Chen (CTO)
  Deployment ──[implemented_by]──→ John (IT Lead)
  Deployment ──[constrained_by]──→ Budget ──[approved_by]──→ Mike (CFO)

Answer: "Talk to Sarah (decided), John (implements), Mike (budget)."
```

**3. Impact analysis: "What depends on Azure?"**
```
Start at: Azure
Follow incoming edges:
  NacXwan ──[hosted_on]──→ Azure
  CI/CD Pipeline ──[deployed_to]──→ Azure
  Database ──[runs_on]──→ Azure

Answer: "NacXwan, CI/CD Pipeline, and Database all depend on Azure."
```

**Vector RAG cannot do any of these.** It can only find text that
MENTIONS these topics. It can't trace the connections between them.

### How Knowledge Graphs Are Built

Two approaches:

**Manual (traditional)**
- Humans define entities and relationships
- High quality but doesn't scale
- Used in enterprise knowledge management

**LLM-Powered (modern)**
- An LLM reads documents and extracts entities + relationships
- Automatic but needs quality checking
- This is what GraphRAG tools do

```
Input text:
  "Sarah Chen, the CTO of Acme Corp, confirmed in Meeting 3 that
   the project will use Microsoft SSO with MSAL tokens for authentication."

LLM extracts:
  Entities:
    - Sarah Chen (person, CTO)
    - Acme Corp (organization)
    - Meeting 3 (event)
    - Microsoft SSO (technology/decision)
    - MSAL tokens (technology)

  Relationships:
    - Sarah Chen ──[works_at]──→ Acme Corp
    - Sarah Chen ──[confirmed]──→ Microsoft SSO
    - Microsoft SSO ──[uses]──→ MSAL tokens
    - Microsoft SSO ──[decided_in]──→ Meeting 3
```

### Graph RAG Tools

| Tool | What it does | Notes |
|------|-------------|-------|
| **Neo4j** | Graph database | Industry standard. Stores nodes and edges. Query with Cypher language. |
| **GraphRAG (Microsoft)** | LLM-powered graph extraction | Builds a knowledge graph from documents. Creates community summaries. |
| **LightRAG** | Lightweight alternative to GraphRAG | Faster, simpler, good for smaller datasets. |
| **Mem0** | Memory layer with graph support | Uses Neo4j internally. Extracts entities + relationships as part of fact management. |
| **RAGFlow** | Includes GraphRAG | Built-in entity extraction with Org, Person, Event, Category types. |

---

## Agentic RAG

### What Is It?

Standard RAG is a single pass: search → retrieve → generate.
Agentic RAG adds a **reasoning loop**: plan → search → evaluate →
decide → maybe search again → generate.

```
Standard RAG:
  Question → Search → Top 5 chunks → LLM → Answer
  (one shot, no evaluation)

Agentic RAG:
  Question → Agent thinks: "What do I need to answer this?"
          → Agent decides: "Search for auth decisions first"
          → Search → Results
          → Agent evaluates: "Good, but I also need who decided"
          → Agent decides: "Query the entity graph for decision makers"
          → Graph query → Results
          → Agent evaluates: "Now I have everything"
          → Generate comprehensive answer
```

### Why It Matters

Real questions often need **multiple retrieval steps**:

```
"Write the auth section of the MVP Scope document"

An agent would:
  1. Search RAGFlow for all auth-related passages
  2. Query Mem0 for confirmed auth facts
  3. Query graph for auth decision chain (who, when, why)
  4. Check if there are contradictions in auth-related facts
  5. Pull repo analysis for existing auth implementation
  6. Compose the section from all gathered information

A standard RAG pipeline would just do step 1 and try to
generate the entire section from whatever 5 chunks came back.
```

### The Agent Loop

```
┌──────────────────────────────────────────┐
│              AGENT LOOP                   │
│                                          │
│  1. PLAN                                 │
│     "What information do I need?"        │
│     "Which sources should I check?"      │
│              │                           │
│              ▼                           │
│  2. ACT                                  │
│     Search RAGFlow / Query Mem0 /        │
│     Traverse graph / Analyze code        │
│              │                           │
│              ▼                           │
│  3. EVALUATE                             │
│     "Do I have enough information?"      │
│     "Are the results relevant?"          │
│     "Are there contradictions?"          │
│              │                           │
│         ┌────┴─────┐                     │
│         │          │                     │
│       No ▼        Yes ▼                  │
│     Go back      4. GENERATE             │
│     to step 1       Compose answer       │
│     (try different  from all gathered    │
│      approach)      information          │
│                                          │
└──────────────────────────────────────────┘
```

### Key Capabilities

| Capability | What it means |
|-----------|--------------|
| **Multi-step retrieval** | Agent searches multiple times, refining as it goes |
| **Tool use** | Agent calls different tools (search, graph query, calculation, code analysis) |
| **Self-evaluation** | Agent checks if its own results are sufficient |
| **Planning** | Agent decides what to do before acting |
| **Memory** | Agent remembers what it already found (doesn't re-retrieve) |

### In Our Product

Every agent in the Discovery AI Assistant is an agentic RAG pattern:
- The Gap Detection Agent plans what control points to check, queries
  Mem0 for facts, evaluates each one, and generates a gap report
- The Document Generator Agent plans the document structure, retrieves
  content from RAGFlow for each section, pulls facts from Mem0 for
  structured data, and composes the final document
- The Meeting Prep Agent identifies gaps, finds relevant context in
  RAGFlow, maps gaps to stakeholders via the graph, and generates
  a prioritized agenda

---

## Structured Fact Stores

### The Problem with Chunks

Vector RAG stores document **chunks** — paragraphs of text. When the
client says the same thing in 3 meetings, you get 3 chunks that say
roughly the same thing. When the client changes their mind, you have
old chunks AND new chunks with no way to know which is current.

```
Chunk-based knowledge (vector RAG):
  Chunk from Meeting 2: "Hosting is still undecided"
  Chunk from Meeting 3: "Leaning towards AWS"
  Chunk from Meeting 4: "Client confirmed Azure"

  Agent searches for "hosting" → gets all 3 chunks
  → Has to figure out which is current
  → Might hallucinate a mixed answer
```

### The Fact Store Approach

Instead of storing chunks, extract **discrete facts** and actively
manage them.

```
Fact-based knowledge:
  After Meeting 2: ADD fact "Hosting: undecided"
  After Meeting 3: UPDATE fact "Hosting: leaning AWS" (was: undecided)
  After Meeting 4: UPDATE fact "Hosting: Azure, confirmed" (was: leaning AWS)

  Agent queries: "What's the hosting decision?"
  → Returns: "Azure, confirmed" (single, current answer)
  → Also available: full history of changes
```

### How Fact Extraction Works

An LLM reads document text and extracts structured facts:

```
Input text:
  "Sarah confirmed in Meeting 4 that hosting will be Azure,
   single region in Europe, with a budget cap of $500/month."

Extracted facts:
  {fact: "Hosting provider: Azure", status: "confirmed",
   source: "Meeting 4", decided_by: "Sarah Chen"}

  {fact: "Hosting region: Europe, single region", status: "confirmed",
   source: "Meeting 4"}

  {fact: "Hosting budget: $500/month max", status: "confirmed",
   source: "Meeting 4"}
```

### Fact Lifecycle Management

The key innovation of tools like Mem0. When new text is ingested,
the system doesn't just ADD facts — it MANAGES them:

```
New text comes in. For each extracted fact, the system decides:

  ADD     — This is a new fact we didn't know before
            "Timeline: Q2 2025 launch" (first mention)

  UPDATE  — This fact changed from what we knew
            "Hosting: Azure" replaces "Hosting: undecided"
            Old value preserved in history

  DELETE  — This fact is no longer true
            "Feature X: in scope" → client explicitly removed it

  IGNORE  — We already know this, no change needed
            "Auth: Microsoft SSO" (confirmed in Meeting 3, mentioned again)
```

### Deduplication

Different people say the same thing differently:
- "Sarah Chen confirmed SSO"
- "The CTO said they'll use single sign-on"
- "Auth will be Microsoft SSO per S. Chen"

A fact store recognizes these as the SAME fact and stores it once,
with all source references.

### When Facts Beat Chunks

| Question | Chunk-based answer | Fact-based answer |
|----------|-------------------|-------------------|
| "Is auth decided?" | "Here are 5 chunks mentioning auth..." (you interpret) | "Yes. Microsoft SSO, confirmed, Meeting 4" |
| "What changed since last meeting?" | Requires searching + comparing chunks from different dates | Query: facts where updated_at > last_meeting |
| "How many requirements are confirmed?" | Can't count — would need to search and interpret | Count: facts where status = confirmed |
| "Any contradictions?" | Extremely hard — compare all chunks for conflicts | Built-in: facts that were UPDATE'd have old → new history |

### Tools

| Tool | Approach | Notes |
|------|---------|-------|
| **Mem0** | LLM-powered fact extraction + lifecycle management + Neo4j graph | The most complete solution. Handles ADD/UPDATE/DELETE/IGNORE automatically. |
| **Custom (MongoDB)** | Build your own fact extraction pipeline | More control, more work. Need to build dedup, versioning, lifecycle. |
| **Zep** | Memory layer for AI applications | Similar to Mem0 but different architecture. |

---

## How These Approaches Combine

These aren't competing approaches. They solve different problems and work
best together:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  VECTOR RAG          GRAPH RAG           FACT STORE         │
│  (RAGFlow)           (Mem0/Neo4j)        (Mem0)             │
│                                                             │
│  Stores: chunks      Stores: entities    Stores: facts      │
│                      + relationships     + history           │
│                                                             │
│  Answers:            Answers:            Answers:            │
│  "Find text          "How is X           "What do we         │
│   about X"           related to Y?"      know about X?"     │
│                                                             │
│  Used for:           Used for:           Used for:           │
│  • Document gen      • Impact analysis   • Control points    │
│  • Exploration       • Stakeholder maps  • Gap detection     │
│  • Full-text search  • Dependency chains • Contradiction     │
│                                            detection         │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  AGENTIC RAG (our agents)                                   │
│  Orchestrates all three: decides which to query,            │
│  combines results, reasons across sources                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Takeaways

1. **Vector RAG** finds relevant text but can't trace relationships or track facts over time
2. **Knowledge graphs** store entities + relationships, enabling traversal queries ("what depends on X?")
3. **Agentic RAG** adds a reasoning loop — agents plan, search, evaluate, and retry
4. **Fact stores** extract and manage discrete knowledge with deduplication and versioning
5. **These approaches complement each other** — use vector RAG for text retrieval, graphs for relationships, facts for structured knowledge, and agents to orchestrate them all
6. **The choice depends on your questions** — if you only need "find text about X," vector RAG is enough. If you need "what do we know, what's missing, what contradicts," you need more.
