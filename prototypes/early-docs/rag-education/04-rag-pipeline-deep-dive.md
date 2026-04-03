# RAG Pipeline Deep Dive

## The Two Pipelines

Every RAG system has two pipelines that work together:

```
INGESTION PIPELINE (runs when documents are added)
──────────────────────────────────────────────────
  Document → Parse → Chunk → Embed → Store

QUERY PIPELINE (runs when someone asks a question)
──────────────────────────────────────────────────
  Question → Embed → Search → (Rerank) → Context Assembly → LLM → Answer
```

Both pipelines affect quality. A mistake in either one degrades the final answer.

---

## Ingestion Pipeline

### Step 1: Document Parsing

Before you can chunk and embed text, you need to EXTRACT the text from
the document. This is harder than it sounds.

```
Easy:
  .txt file → text is already there
  .md file  → text with simple formatting

Medium:
  .docx file → text embedded in XML structure, need to extract
  .html file → text mixed with tags, scripts, styles

Hard:
  .pdf file  → text might be:
               - Selectable text (easier)
               - Scanned image (needs OCR)
               - Mix of text + tables + images + headers/footers
               - Multi-column layout
               - Embedded charts or diagrams

Very Hard:
  Scanned documents, handwritten notes, complex table structures,
  documents with mixed languages
```

**This is why document parsing matters.** If you can't extract the text
correctly, everything downstream fails.

**RAGFlow's DeepDoc** handles this with:
- 4 PDF parsers including OCR (optical character recognition)
- Table structure recognition (understands rows, columns, headers)
- Layout analysis (distinguishes main text from headers, footers, sidebars)
- Image extraction and description

### Step 2: Chunking

After extracting text, split it into smaller pieces for embedding.

#### Why Chunk?

1. Embedding models have input limits (512-8192 tokens)
2. Smaller, focused chunks produce better embeddings than large, mixed ones
3. When retrieving, you want specific passages, not entire documents

#### Chunking Strategies

**Fixed-Size Chunking** (simplest)
```
Split every 500 tokens with 50 token overlap.

Pros: Simple, predictable
Cons: Splits mid-sentence, mid-topic. A decision about auth might
      be cut in half across two chunks.

"...Sarah said the auth should use Microsoft SSO. John disagre|
|ed and suggested API keys instead. The team decided to..."
  Chunk 1                                    Chunk 2
  (incomplete thought)                       (incomplete thought)
```

**Semantic Chunking** (better)
```
Split at topic boundaries. Keep related content together.

Pros: Each chunk is a coherent topic
Cons: Harder to implement, variable chunk sizes

Chunk 1: "Auth discussion: Sarah proposed Microsoft SSO.
          John suggested API keys. Team decided on SSO
          with MSAL. Sarah to confirm with client IT."

Chunk 2: "Hosting discussion: Client wants Azure, single
          region Europe. Budget max $500/month. DevOps
          team available from March."
```

**Document-Type-Specific Chunking** (best)
```
Different document types have different natural boundaries.

Meeting notes   → chunk by agenda item / topic
Emails          → chunk per email in a thread
Client specs    → chunk by section heading
Transcripts     → chunk by speaker turn or topic shift
Presentations   → chunk per slide
Tables          → chunk per row or logical group of rows
```

This is what RAGFlow's 12 chunking templates provide. You select
the template when uploading a document, and it applies the right
strategy automatically.

**Parent-Child Chunking** (advanced)
```
Create two levels:
  - Small "child" chunks for precise matching
  - Larger "parent" chunks for context

Child chunk: "Auth method: Microsoft SSO with MSAL tokens"
  (matches the question "What auth method?" very precisely)

Parent chunk: "Auth discussion from Meeting 3. Sarah proposed
  SSO, John suggested API keys. Team decided SSO after
  confirming IT department requirement. MSAL tokens chosen
  for Outlook add-in compatibility. Sarah to verify with IT."
  (gives the full context when retrieved)

On search: match on child, return parent.
Result: precise matching + full context.
```

### Step 3: Embedding

Each chunk is converted to a vector using the embedding model.
(See `02-embeddings-explained.md` for details.)

```
Chunk: "Client confirmed Azure hosting, single region Europe"
       │
       ▼  (embedding model)
       │
Vector: [0.12, -0.67, 0.45, 0.03, -0.89, ...]  (1536 dimensions)
```

### Step 4: Storage

The vector, original text, and metadata are stored together:

```
┌─────────────────────────────────────────────────────────────┐
│  Stored record:                                              │
│                                                             │
│  vector:    [0.12, -0.67, 0.45, 0.03, ...]                 │
│  text:      "Client confirmed Azure hosting, single region" │
│  metadata:  {                                               │
│    doc_type: "meeting_notes",                               │
│    date: "2025-02-10",                                      │
│    meeting_number: 4,                                       │
│    author: "Sarah Chen",                                    │
│    project_id: "nacxwan-123"                                │
│  }                                                          │
│  parent_id: "chunk_parent_42"  (for parent-child retrieval) │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Query Pipeline

### Step 1: Question Embedding

The user's question is embedded using the same model used for chunks:

```
"What hosting does the client want?"
       │
       ▼  (same embedding model as ingestion)
       │
[0.15, -0.62, 0.41, 0.07, ...]
```

**Critical:** You MUST use the same embedding model for questions and
chunks. Different models produce incompatible vectors.

### Step 2: Search

The question vector is compared against all stored chunk vectors.
The most similar chunks are returned.

```
Question vector: [0.15, -0.62, 0.41, 0.07, ...]

Compare against stored chunks:
  Chunk 42: similarity 0.94 → "Client confirmed Azure hosting..."
  Chunk 87: similarity 0.89 → "Hosting budget max $500/month..."
  Chunk 15: similarity 0.85 → "Discussed hosting options..."
  Chunk 3:  similarity 0.72 → "Azure region selection..."
  ...

Return top 5 results (configurable K)
```

With hybrid search, keyword results are also retrieved and merged.
With metadata filtering, only chunks matching the filter are searched.

### Step 3: Reranking (Optional but Recommended)

Vector similarity is a rough measure. Reranking uses a more powerful
model to re-score results for actual relevance to the question.

```
Before reranking (ordered by vector similarity):
  1. "We discussed hosting options with the team"      (0.89)
  2. "The new host for the company party will be..."   (0.87)
  3. "Client confirmed Azure hosting, single region"   (0.85)

After reranking (ordered by actual relevance):
  1. "Client confirmed Azure hosting, single region"   (0.95)
  2. "We discussed hosting options with the team"      (0.72)
  3. "The new host for the company party will be..."   (0.15)
```

The reranker caught that result #2 was about "hosting a party" not
"hosting infrastructure" and demoted it. This significantly improves
the quality of context sent to the LLM.

(More on reranking in `05-advanced-rag-techniques.md`)

### Step 4: Context Assembly

The top chunks are assembled into a context block that's sent to the LLM
along with the question:

```
┌──────────────────────────────────────────────────────┐
│  PROMPT TO LLM:                                       │
│                                                      │
│  Context (retrieved from project documents):         │
│                                                      │
│  [From Meeting 4, Feb 10, 2025]:                     │
│  "Client confirmed Azure hosting, single region      │
│   Europe. Budget max $500/month for production."     │
│                                                      │
│  [From Email, Feb 5, 2025]:                          │
│  "IT department confirmed Azure is approved on       │
│   their infrastructure. EU region preferred for       │
│   GDPR compliance."                                   │
│                                                      │
│  [From Meeting 3, Jan 24, 2025]:                     │
│  "Discussed AWS vs Azure. Client prefers Azure       │
│   due to existing Microsoft enterprise agreement."   │
│                                                      │
│  Question: What hosting does the client want?        │
│                                                      │
│  Answer based on the context above.                  │
│  Cite which document each fact comes from.           │
└──────────────────────────────────────────────────────┘
```

### Step 5: LLM Generation

The LLM reads the context and generates a grounded answer:

```
"The client wants Azure hosting in a single region in Europe.
 This was confirmed in Meeting 4 (Feb 10) with a budget cap
 of $500/month. Azure was chosen over AWS due to the client's
 existing Microsoft enterprise agreement (discussed in Meeting 3,
 Jan 24). The IT department confirmed Azure is approved and
 EU region is preferred for GDPR compliance (email, Feb 5)."
```

The answer is grounded in actual documents, cites its sources, and
synthesizes information from multiple sources.

---

## The Retrieval-Generation Gap

The quality of the final answer depends on both retrieval and generation.
But retrieval is the bottleneck:

```
Great retrieval + mediocre LLM = decent answers
  (LLM has the right information to work with)

Bad retrieval + great LLM = bad answers
  (LLM is smart but has wrong/incomplete information)

Great retrieval + great LLM = great answers
  (this is what we want)
```

**Implication:** Spend more time optimizing your ingestion pipeline
(parsing, chunking, metadata, embedding model) than optimizing LLM
prompts. The LLM can only work with what retrieval gives it.

---

## Common Failure Modes

| Problem | Cause | Fix |
|---------|-------|-----|
| Irrelevant results | Bad chunking (topics mixed in one chunk) | Use semantic or document-type-specific chunking |
| Missing results | Vocabulary gap (question uses different words than document) | Add hybrid search (keyword + vector) |
| Outdated results | No temporal awareness | Add date metadata + recency weighting |
| Wrong document type | No filtering | Add doc_type metadata + filtering |
| Partial context | Chunk too small, missing surrounding info | Use parent-child chunking |
| Too much noise | K too high, returning marginally relevant chunks | Lower K, add reranking |
| "I don't know" when answer exists | Embedding model doesn't capture domain terms well | Consider fine-tuning embeddings or hybrid search |

---

## Key Takeaways

1. **Two pipelines:** Ingestion (document → chunks → vectors → stored) and Query (question → search → context → answer)
2. **Document parsing** is the first bottleneck — if you can't extract text from PDFs correctly, everything fails
3. **Chunking strategy matters more than most people think** — different document types need different chunking
4. **Metadata filtering** turns a general search into a precise, scoped query
5. **Reranking** catches errors that vector similarity misses
6. **Retrieval quality > LLM quality** — the LLM is only as good as the context it receives
