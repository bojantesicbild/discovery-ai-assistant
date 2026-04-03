# Advanced RAG Techniques

## Why Basic RAG Isn't Enough

Basic RAG (embed → search → generate) works for simple cases. But real-world
documents are messy — ambiguous terms, mixed terminology, scattered context.
These techniques each solve a specific retrieval problem.

**For hands-on experiments with all these techniques, see:**
https://github.com/NirDiamant/RAG_Techniques
This repo contains working implementations and examples for every technique
described below.

---

## Reranking

### The Problem
Vector similarity is a rough measure. Two chunks can be "similar" in
vector space but one is relevant and the other isn't.

### How It Works

```
Without reranking:
Question: "What hosting does the client want?"
Vector search returns (by similarity):
  1. "We discussed hosting options with the team"     (0.89) ← vague
  2. "The new host for the company party will be..."  (0.87) ← wrong "host"
  3. "Client confirmed Azure hosting, single region"  (0.85) ← the answer
  4. "Hosting costs should be under $500/month"       (0.84) ← useful
  5. "We hosted a demo last Tuesday"                  (0.83) ← irrelevant

With reranking:
Same results → reranker model re-scores each one for actual relevance:
  1. "Client confirmed Azure hosting, single region"  (0.95) ← promoted
  2. "Hosting costs should be under $500/month"       (0.91) ← promoted
  3. "We discussed hosting options with the team"     (0.72) ← demoted
  4. "The new host for the company party will be..."  (0.15) ← buried
  5. "We hosted a demo last Tuesday"                  (0.10) ← buried
```

### How Rerankers Work

Vector search uses **bi-encoders** — question and chunk are embedded
independently, then compared. Fast but approximate.

Rerankers use **cross-encoders** — question and chunk are processed
TOGETHER in one model pass. Slower but much more accurate.

```
Bi-encoder (vector search):          Cross-encoder (reranker):
  embed("question") → vector A        model("question", "chunk") → score
  embed("chunk")    → vector B        Sees both together, understands
  compare(A, B)     → score           the relationship between them
  Fast, but independent               Slow, but precise
```

### When to Use
Almost always. Reranking is low effort, high impact. It's a drop-in
improvement — add it between search and generation.

### Tools
- **Cohere Rerank** — API-based, high quality
- **Jina Reranker** — API-based
- **Cross-encoder models** (self-hosted) — `cross-encoder/ms-marco-MiniLM-L-6-v2`
- **RAGFlow** has built-in reranking with 13+ provider options

---

## HyDE (Hypothetical Document Embeddings)

### The Problem
Short questions produce poor embeddings. "What about auth?" is only 3 words —
the embedding doesn't carry much meaning signal.

### How It Works

Instead of embedding the question directly, generate a **hypothetical
answer** first, then search for chunks similar to that answer.

```
Step 1: User asks "What about auth?"

Step 2: LLM generates hypothetical answer:
  "The authentication method chosen for the project is Microsoft SSO
   using MSAL tokens. Users will authenticate via their organizational
   Microsoft accounts with single sign-on."

Step 3: Embed the hypothetical answer (not the original question)

Step 4: Search for chunks similar to this detailed hypothesis
  → Finds better matches because the search query now has rich context
```

### Why It Works
The hypothetical answer is in the same "language" as the document chunks
(detailed, informative), so the embedding captures more meaning than the
short question would.

### When to Use
- Short, vague questions ("What about hosting?")
- When users don't use specific terminology
- NOT useful when questions are already detailed and specific

### Tradeoff
Adds one LLM call per query (latency + cost). The hypothetical answer
might also steer the search in the wrong direction if it guesses wrong.

---

## Multi-Query

### The Problem
People use different words for the same concept. The client says "login,"
the PO writes "authentication," the spec says "identity management."
A single search query might miss results using different terminology.

### How It Works

Generate multiple versions of the question, search all of them, merge results.

```
Original question: "What about auth?"

Generated queries:
  1. "authentication method"
  2. "login approach"
  3. "SSO single sign-on"
  4. "user identity management"
  5. "MSAL tokens"

Search all 5 → merge and deduplicate results
→ Catches chunks regardless of which terminology they use
```

### When to Use
- Client projects where different people use different terminology
- Exploratory questions where you're not sure what words appear in docs
- Gap detection (searching broadly for whether a topic was discussed)

### Tradeoff
5x the search queries = slower. Results need deduplication. But retrieval
quality improves significantly for ambiguous queries.

---

## Parent-Child Retrieval

### The Problem
Small chunks match precisely but lack context. Large chunks have context
but match imprecisely.

### How It Works

Store chunks at two levels. Match on small chunks, return the larger parent.

```
Parent chunk (stored for context):
  "Auth discussion from Meeting 3. Sarah proposed SSO, John suggested
   API keys. Team decided SSO after confirming IT requirement. MSAL
   tokens chosen for Outlook add-in compatibility. Sarah to verify
   with IT. Timeline: decision final by Feb 1."

Child chunks (stored for matching):
  • "Sarah proposed Microsoft SSO"
  • "John suggested API keys instead"
  • "Team decided SSO after IT requirement confirmation"
  • "MSAL tokens chosen for Outlook add-in compatibility"

Search: "What auth method?" → matches child chunk "Team decided SSO..."
Return: the full parent chunk with complete context
```

### Why It Matters
When the LLM generates an answer, it needs CONTEXT — not just the one
matching sentence but the full picture: who decided, why, what alternatives
were considered, what's the timeline.

### When to Use
Whenever context matters (which is almost always). Particularly important
for meeting notes and discussions where a single sentence is meaningless
without surrounding context.

---

## Query Routing

### The Problem
Not all questions need the same search approach. "What auth method?" needs
a factual lookup. "Write the deployment section" needs full paragraphs.
"Who decided on SSO?" needs entity relationships.

### How It Works

A router (can be rule-based or LLM-powered) examines the question and
decides which search strategy to use.

```
"Is hosting decided?"
  → Route to: Fact store (Mem0)
  → Strategy: structured lookup

"Write the auth section of the scope document"
  → Route to: Document search (RAGFlow)
  → Strategy: broad retrieval, multiple chunks, full context

"Who is responsible for the deployment decision?"
  → Route to: Entity graph (Mem0/Neo4j)
  → Strategy: graph traversal

"What did Sarah say in Meeting 2?"
  → Route to: Document search (RAGFlow)
  → Strategy: metadata filter (author=Sarah, meeting=2) + search
```

### Why It Matters
Using the wrong search strategy wastes time and returns poor results.
A fact lookup doesn't need paragraph retrieval. A document generation
task doesn't need a yes/no fact check.

### When to Use
When you have multiple knowledge sources or multiple search strategies.
In our product, the Query Router is a core component that routes between
RAGFlow, Mem0 facts, Mem0 graph, and Claude Code.

---

## Self-RAG / Corrective RAG

### The Problem
Sometimes retrieval fails — the search returns irrelevant chunks, or the
answer needs information from a different source.

### How It Works

After retrieval, the system evaluates whether the results are good enough.
If not, it retries with a different strategy.

```
Step 1: Search for "What's the deployment timeline?"
Step 2: Retrieve 5 chunks
Step 3: LLM evaluates: "Are these chunks relevant to the question?"
Step 4a: If yes → generate answer
Step 4b: If no → try different search:
         - Rephrase query
         - Search different document collection
         - Broaden metadata filters
         - Fall back to web search
Step 5: Try again with new results
```

### When to Use
- High-stakes queries where wrong answers are costly
- Systems with multiple data sources (try source A, fall back to source B)
- When you can afford the extra latency (additional LLM call to evaluate)

### Tradeoff
More LLM calls = slower and more expensive. But catches retrieval failures
that would otherwise produce wrong answers.

---

## Step-Back Prompting

### The Problem
Specific questions sometimes need broader context first.

### How It Works

```
Question: "Can the system handle 500 concurrent users?"

Step-back: First ask broader → "What are the performance requirements?"
→ Retrieves all performance-related context

Then answer the specific question with full background.
```

### When to Use
When specific questions need surrounding context to be answered properly.
"Can it handle 500 users?" depends on architecture, hosting, budget — the
step-back retrieves all of this.

---

## Technique Selection Guide

Not every technique is needed. Choose based on your problem:

| Problem | Technique | Impact | Effort |
|---------|-----------|--------|--------|
| Search results aren't relevant enough | **Reranking** | High | Low (drop-in) |
| Short/vague questions give bad results | **HyDE** | Medium | Low |
| Different terminology across docs | **Multi-Query** | Medium | Low |
| Need context around matched text | **Parent-Child** | High | Medium |
| Different questions need different search | **Query Routing** | High | Medium |
| Need to verify retrieval quality | **Self-RAG** | Medium | High |
| Specific questions need broader context | **Step-Back** | Medium | Low |

### For Our Product

| Technique | Used in Discovery AI | Where |
|-----------|---------------------|-------|
| **Reranking** | Yes | RAGFlow (built-in, 13+ providers) |
| **HyDE** | Optional | Can enable in RAGFlow per dataset |
| **Multi-Query** | Yes | Agent framework generates multiple queries |
| **Parent-Child** | Yes | RAGFlow chunking templates support this |
| **Query Routing** | Yes | Core component — routes to RAGFlow / Mem0 / Claude Code |
| **Self-RAG** | Partial | Agents can retry with different strategies |
| **Step-Back** | Yes | Meeting Prep Agent uses this for broad context gathering |

---

## Hands-On Learning

For working code examples of all these techniques:

**RAG Techniques Repository:**
https://github.com/NirDiamant/RAG_Techniques

This repo contains implementations and explanations for every technique
covered here, plus additional advanced approaches. It's the best practical
resource for understanding how these techniques work in code.
