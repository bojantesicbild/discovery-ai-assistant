# Vector Search & Databases

## The Problem Regular Databases Can't Solve

A regular database (PostgreSQL, MySQL, MongoDB) is built for **exact
matching**: find rows where `name = "Sarah"` or `date > "2025-01-01"`.

But RAG needs **meaning-based matching**: find chunks whose meaning is
closest to the meaning of the question. This requires comparing vectors
(lists of numbers), not strings or dates.

```
Regular database query:
  SELECT * FROM documents WHERE content LIKE '%authentication%'
  → Only finds documents containing the exact word "authentication"
  → Misses: "SSO", "single sign-on", "login method", "identity management"

Vector database query:
  Find chunks with embeddings closest to embed("What auth method?")
  → Finds all of the above, because their embeddings are similar
  → Understands MEANING, not just keywords
```

---

## How Vector Search Works

### Step 1: Store

When you ingest a document, each chunk is embedded (turned into a vector)
and stored in the vector database alongside the original text and metadata.

```
Vector Database Contents:
┌──────────────────────────────────────────────────────────────┐
│  ID  │  Vector              │  Text                 │ Meta   │
├──────┼─────────────────────┼───────────────────────┼────────┤
│  1   │ [0.82, 0.15, -0.34] │ "Client wants SSO..." │ mtg 3  │
│  2   │ [0.12, -0.67, 0.45] │ "Azure hosting, ..."  │ mtg 4  │
│  3   │ [0.45, 0.33, 0.12]  │ "Budget $500/month.." │ email  │
│  ...                                                         │
└──────────────────────────────────────────────────────────────┘
```

### Step 2: Search

When a question comes in, embed it and find the K nearest vectors:

```
Question: "What auth method did the client choose?"
       │
       ▼
Question embedding: [0.80, 0.17, -0.30, ...]
       │
       ▼
Compare against every stored vector (efficiently!)
       │
       ▼
Results (sorted by similarity):
  1. [0.82, 0.15, -0.34] → "Client wants SSO..."  (similarity: 0.96)
  2. [0.71, 0.22, -0.28] → "MSAL token mgmt..."   (similarity: 0.89)
  3. [0.45, 0.33, 0.12]  → "Budget $500/month..."  (similarity: 0.23)
       │
       ▼
Return top K results (usually K=5 to 10)
```

### The Challenge: Speed

If you have 1 million chunks, you can't compare the question vector against
all 1 million vectors every time someone asks a question. That would be
too slow.

Vector databases solve this with **approximate nearest neighbor (ANN)**
algorithms. These are indexing structures that find the closest vectors
WITHOUT checking every single one.

---

## Indexing Algorithms (What You Need to Know)

You don't need to understand the math. You need to know the tradeoffs.

### HNSW (Hierarchical Navigable Small World)

The most common algorithm. Used by Qdrant, Weaviate, pgvector, and others.

```
How it works (simplified):
Think of it like a network of shortcuts.

Instead of checking every vector:
  Start at a random point → follow links to get closer → zoom in
  Like navigating a city: highway → main road → side street → address

Tradeoff:
  + Very fast search (milliseconds for millions of vectors)
  + High accuracy (finds the true nearest neighbors most of the time)
  - Uses more memory (stores the graph of connections)
  - Slower to build the index initially
```

### IVF (Inverted File Index)

Groups vectors into clusters. Searches only the most relevant clusters.

```
How it works (simplified):
  Divide all vectors into 100 clusters based on similarity.
  When searching, first find the 5 nearest clusters,
  then search only within those clusters.

Tradeoff:
  + Uses less memory than HNSW
  + Fast to build
  - Less accurate (might miss results in a neighboring cluster)
  - Needs tuning (how many clusters, how many to search)
```

### Which to choose?

**Use HNSW** unless you have a specific reason not to. It's the default
for most vector databases and gives the best quality-speed balance.

---

## Vector Databases

### What They Provide

Beyond basic vector storage and search:

- **Metadata filtering** — search only vectors matching certain criteria
  (e.g., only documents from Meeting 3)
- **Multiple indexes** — different collections for different projects
- **Persistence** — data survives restarts
- **Scaling** — handle millions or billions of vectors
- **API** — REST or gRPC endpoints for your application

### Key Players

| Database | Type | Best for | Notes |
|----------|------|----------|-------|
| **Qdrant** | Purpose-built vector DB | Production RAG systems | Rust-based, fast, good filtering. Used by many RAG frameworks. |
| **Pinecone** | Cloud-only vector DB | Teams that don't want to manage infrastructure | Fully managed, easy to start. No self-hosted option. |
| **Weaviate** | Purpose-built vector DB | Complex filtering + vector search | GraphQL API, hybrid search built-in. |
| **Milvus** | Purpose-built vector DB | Large scale (billions of vectors) | Complex to operate, built for massive scale. |
| **Chroma** | Lightweight vector DB | Prototyping, small projects | Simple, Python-native. Not built for production scale. |
| **pgvector** | PostgreSQL extension | Teams already using PostgreSQL | Add vector search to existing Postgres. Good enough for many cases. |
| **Elasticsearch** | Search engine + vector | Hybrid keyword + vector search | RAGFlow uses this. Strong keyword search, decent vector search. |

### How RAGFlow Uses Elasticsearch

In our architecture, we don't interact with a vector database directly.
RAGFlow handles this internally using Elasticsearch:

```
Our application
       │
       ▼
RAGFlow API (search endpoint)
       │
       ▼
Elasticsearch (inside RAGFlow)
├── Vector index (embeddings for semantic search)
├── Text index (keywords for BM25 search)
└── Metadata index (date, author, doc_type for filtering)
```

We call RAGFlow's API. RAGFlow calls Elasticsearch. We don't need to
manage the vector database directly.

---

## Metadata Filtering

One of the most important features for real applications. Without it,
every search looks at ALL documents. With it, you can scope searches.

```
Without metadata filtering:
  "What did the client say about hosting?"
  → Searches ALL 500 chunks from ALL meetings, emails, specs
  → Returns a mix of old and new information
  → Agent has to figure out what's current

With metadata filtering:
  "What did the client say about hosting in the last meeting?"
  → Filter: meeting_number = 4
  → Searches only 15 chunks from Meeting 4
  → Returns exactly what was said recently
```

### Common Metadata Fields for RAG

| Field | Type | Example | Use case |
|-------|------|---------|----------|
| `doc_type` | string | "meeting_notes", "email", "spec" | Filter by document type |
| `date` | date | "2025-02-10" | Temporal queries, recency |
| `source` | string | "client", "internal" | Who said it |
| `author` | string | "Sarah Chen" | Filter by speaker/writer |
| `meeting_number` | integer | 3 | Track progression |
| `project_id` | string | "nacxwan-123" | Per-project isolation |
| `confidence` | string | "confirmed", "assumed" | How reliable |

Metadata is added during ingestion (when documents are uploaded and chunked).
It can be:
- **Manual** — PO tags the document when uploading
- **Automatic** — LLM extracts metadata from the document content
- **Semi-automatic** — system suggests, PO confirms

---

## Hybrid Search: Vector + Keyword

Vector search finds meaning. Keyword search finds exact terms. Both have
blind spots. Combining them covers both.

```
Question: "What about the VisioConference API?"

Vector search finds:
  ✅ Chunks about video conferencing integration
  ✅ Chunks about API design
  ❌ May not rank "VisioConference" highly (it's a brand name,
     not a common English word — embedding might not capture it well)

Keyword (BM25) search finds:
  ✅ Chunks containing the exact word "VisioConference"
  ❌ Misses chunks that discuss the same topic without using that word

Hybrid search:
  ✅ Finds chunks about video conferencing (vector)
  ✅ Finds chunks with exact "VisioConference" mention (keyword)
  ✅ Combines and ranks both result sets
```

### How Hybrid Search Works

```
Question
   │
   ├──→ Vector search → results with similarity scores
   │
   ├──→ Keyword (BM25) search → results with relevance scores
   │
   └──→ Fusion algorithm (e.g., Reciprocal Rank Fusion)
        combines both result sets into one ranked list
```

### Configurable Weights

Most systems let you control the balance:

```
RAGFlow default: keyword weight 0.7, vector weight 0.3
(Slightly favors keyword matches — good for technical documents
 with specific terminology)

You can adjust:
  keyword 0.3, vector 0.7 → favor semantic understanding
  keyword 0.5, vector 0.5 → balanced
  keyword 0.9, vector 0.1 → mostly exact matching
```

**For discovery documents** (meeting notes with client-specific terms,
product names, acronyms), hybrid search is important. Pure vector search
might miss "NacXwan" or "VisioConference" because these aren't in the
embedding model's training vocabulary.

---

## Key Takeaways

1. **Vector databases** enable meaning-based search by comparing embedding vectors
2. **HNSW** is the standard indexing algorithm — fast and accurate
3. **Metadata filtering** is essential for real applications (scope by date, type, project)
4. **Hybrid search** (vector + keyword) catches both meaning AND exact terms
5. **You don't always manage the vector DB directly** — tools like RAGFlow handle it internally
6. **The choice of vector DB matters less than the choice of embedding model and chunking strategy** — retrieval quality comes from the pipeline, not the database
