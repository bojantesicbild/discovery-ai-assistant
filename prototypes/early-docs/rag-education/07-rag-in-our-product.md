# RAG in Our Product — How It All Fits Together

## Quick Recap

If you've read the previous docs, you now understand:

1. **Why RAG** — LLMs don't know your data. RAG gives them relevant context. (`01`)
2. **Embeddings** — text becomes numbers that capture meaning. (`02`)
3. **Vector search** — find chunks by meaning, not just keywords. (`03`)
4. **RAG pipeline** — document → parse → chunk → embed → store → search → answer. (`04`)
5. **Advanced techniques** — reranking, HyDE, multi-query, parent-child retrieval. (`05`)
6. **Beyond vector RAG** — knowledge graphs, agentic RAG, structured fact stores. (`06`)

This document shows how all of that maps to the Discovery AI Assistant.

---

## Our Three Knowledge Layers

The Discovery AI Assistant uses three types of knowledge storage,
each powered by different RAG concepts:

``` 
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  LAYER 1: SEARCH            LAYER 2: KNOW         LAYER 3:    │
│  (RAGFlow)                  (Mem0 Facts)           CONNECT     │
│                                                    (Mem0 Graph)│
│  What: document chunks      What: extracted facts  What:       │
│  How: vector + keyword      How: LLM extraction    entities +  │
│       hybrid search              + lifecycle mgmt  relationships│
│                                                                │
│  RAG concepts used:         RAG concepts used:     RAG concepts│
│  • Embeddings (doc 02)      • Fact stores (doc 06) used:       │
│  • Vector search (doc 03)   • Deduplication        • Knowledge │
│  • Hybrid search (doc 03)   • Fact versioning        graphs    │
│  • Chunking (doc 04)        • Structured queries     (doc 06)  │
│  • Metadata filter (doc 04) •                      • Graph     │
│  • Reranking (doc 05)                                traversal │
│  • Parent-child (doc 05)                           • Entity    │
│  • HyDE (doc 05)                                     extraction│
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

Plus **Agentic RAG** (doc 06) — our agents orchestrate all three layers,
deciding what to query, evaluating results, and combining information
from multiple sources.

---

## Technology → RAG Concept Mapping

| Technology we use | RAG concept it implements | What it does for us |
|------------------|--------------------------|-------------------|
| **RAGFlow** | Full RAG pipeline (doc 04) | Document parsing, chunking, embedding, hybrid search, reranking — all in one service |
| **RAGFlow DeepDoc** | Document parsing (doc 04) | OCR, table recognition, layout analysis for messy client PDFs |
| **RAGFlow templates** | Document-type chunking (doc 04) | Meeting notes chunked by topic, emails per message, specs by section |
| **RAGFlow Elasticsearch** | Vector DB + keyword search (doc 03) | Stores embeddings and text index, enables hybrid search |
| **RAGFlow reranking** | Reranking (doc 05) | Cross-encoder re-scores results for actual relevance |
| **Mem0 fact extraction** | Structured fact store (doc 06) | LLM extracts facts, manages ADD/UPDATE/DELETE lifecycle |
| **Mem0 Neo4j** | Knowledge graph (doc 06) | Entities + relationships for traversal queries |
| **Our agents** | Agentic RAG (doc 06) | Multi-step reasoning, tool use, query routing across layers |
| **Query Router** | Query routing (doc 05) | Routes questions to the right knowledge layer |
| **Claude Code** | Code understanding (specialized retrieval) | Analyzes client repos, feeds facts and entities into layers |

---

## How Each Agent Uses RAG Concepts

### Intake Agent
```
PO uploads "Meeting 4 notes.pdf"

RAG concepts in action:
  1. Document parsing (DeepDoc) — extracts text from PDF
  2. Chunking (meeting notes template) — splits by topic
  3. Embedding — each chunk becomes a vector
  4. Storage — vectors + metadata stored in Elasticsearch
  5. Fact extraction (Mem0) — LLM pulls discrete facts
  6. Entity extraction (Mem0/Neo4j) — builds relationship graph
```

### Gap Detection Agent
```
PO asks: "What are we missing?"

RAG concepts in action:
  1. Structured queries (Mem0) — check each control point against facts
  2. Absence detection — no matching fact = gap
  3. Graph query (Neo4j) — find stakeholders to ask about each gap
  4. Multi-query — search RAGFlow with multiple phrasings to verify
     something is truly missing (not just stored under different words)
```

### Meeting Prep Agent
```
PO asks: "Prepare for next client meeting"

RAG concepts in action:
  1. Structured queries (Mem0) — list all gaps and unconfirmed facts
  2. Graph traversal (Neo4j) — map gaps to stakeholders
  3. Parent-child retrieval (RAGFlow) — pull full context around
     previous discussions for confirmation prompts
  4. Query routing — facts from Mem0, quotes from RAGFlow
```

### Document Generator Agent
```
PO asks: "Generate the MVP Scope document"

RAG concepts in action:
  1. Multi-query (RAGFlow) — for each section, search with multiple
     phrasings to gather all relevant content
  2. Reranking — ensure best chunks are used per section
  3. Structured queries (Mem0) — pull confirmed facts for tables
  4. Graph query (Neo4j) — pull stakeholder lists, decision chains
  5. Parent-child retrieval — get full context, not just matching sentences
  6. Agentic RAG — agent plans document structure, retrieves section
     by section, evaluates completeness, fills gaps
```

### Control Point Agent
```
System evaluates: "Is auth method covered?"

RAG concepts in action:
  1. Structured query (Mem0) — look for fact matching "auth method"
  2. Fact found: {value: "Microsoft SSO", status: "confirmed"}
  3. Result: ✅ Covered (deterministic, not probabilistic)

  Compare with vector RAG only:
  1. Search for "auth method" in RAGFlow
  2. Get 5 chunks mentioning auth
  3. LLM interprets: "probably covered" (probabilistic guess)
```

---

## What the Team Will Work With

The team doesn't need to build RAG internals. RAGFlow and Mem0 handle
the infrastructure. What the team builds:

### 1. Ingestion Pipeline (orchestration)
```python
# Pseudocode — what our code does

async def ingest_document(project_id, file, doc_type):
    # 1. Store original file
    file_url = await s3.upload(file)

    # 2. Send to RAGFlow for parsing + chunking + embedding
    ragflow_dataset = get_dataset(project_id)
    await ragflow.upload_document(
        dataset=ragflow_dataset,
        file=file,
        chunking_template=doc_type,  # "meeting_notes", "email", "spec"
        metadata={"date": today, "project": project_id}
    )

    # 3. Send text to Mem0 for fact extraction
    text = await ragflow.get_parsed_text(file)
    await mem0.add(
        messages=text,
        user_id=project_id,  # isolation
        metadata={"source": file.name, "date": today}
    )

    # 4. Trigger control point evaluation
    await evaluate_control_points(project_id)
```

### 2. Query Router (decides which layer to query)
```python
# Pseudocode

async def route_query(question, project_id):
    query_type = classify_query(question)
    # LLM or rule-based classification

    if query_type == "find_text":
        # "What did client say about X?"
        return await ragflow.search(
            dataset=project_id,
            query=question,
            top_k=10,
            reranking=True
        )

    elif query_type == "check_fact":
        # "Is X decided?"
        return await mem0.search(
            query=question,
            user_id=project_id,
            limit=5
        )

    elif query_type == "find_relationships":
        # "Who decided X? What depends on Y?"
        return await mem0.graph_query(
            query=question,
            user_id=project_id
        )
```

### 3. Agent Logic (the product intelligence)
```python
# Pseudocode — Gap Detection Agent

async def detect_gaps(project_id):
    # Get control points for this project
    checklist = await db.get_control_points(project_id)

    results = []
    for item in checklist:
        # Query Mem0: does a confirmed fact exist for this item?
        facts = await mem0.search(
            query=item.description,
            user_id=project_id,
            filters={"status": "confirmed"}
        )

        if facts and facts[0].score > 0.85:
            results.append({"item": item, "status": "covered", "fact": facts[0]})
        elif facts:
            results.append({"item": item, "status": "partial", "fact": facts[0]})
        else:
            # Double-check with RAGFlow (maybe it's discussed but not as a fact)
            chunks = await ragflow.search(query=item.description, dataset=project_id)
            if chunks:
                results.append({"item": item, "status": "partial", "chunks": chunks})
            else:
                results.append({"item": item, "status": "missing"})

    return results
```

**The key point:** We call RAGFlow and Mem0 via their APIs. We don't
manage embeddings, vector indices, or graph databases directly. Our code
is the business logic — what to query, when, and what to do with the results.

---

## RAG Concepts NOT Used in Our Product

Not every technique is relevant:

| Concept | Used? | Why / why not |
|---------|-------|--------------|
| Fine-tuned embeddings | Not initially | RAGFlow's default models are sufficient. Revisit if search quality is poor on client-specific terms. |
| Self-hosted LLMs | No | We use Anthropic Claude on our tenant. Strong models, data stays secure. |
| RAPTOR (hierarchical summarization) | Possible | RAGFlow supports it. Enable if projects have very large document sets. |
| Web search fallback | No | Discovery is about client-specific data, not general web knowledge. |
| Multi-modal RAG (images) | Not yet | Could be useful for diagrams and wireframes in client specs. Future consideration. |

---

## Learning Path for the Team

| Priority | What to understand | Where to learn |
|----------|-------------------|----------------|
| **Must** | Why RAG exists and how it works | `01-why-rag.md` |
| **Must** | What embeddings are (concept, not math) | `02-embeddings-explained.md` |
| **Must** | How the full pipeline works | `04-rag-pipeline-deep-dive.md` |
| **Should** | Reranking, metadata filtering, hybrid search | `03` + `05` |
| **Should** | Graph RAG and fact stores | `06-beyond-vector-rag.md` |
| **Useful** | Hands-on experimentation | https://github.com/NirDiamant/RAG_Techniques |
| **Useful** | RAGFlow docs | https://github.com/infiniflow/ragflow |
| **Useful** | Mem0 docs | https://github.com/mem0ai/mem0 |

The team doesn't need to become RAG experts. They need to understand:
1. What each knowledge layer does and why
2. How to call RAGFlow and Mem0 APIs
3. How to configure chunking templates, metadata, and search parameters
4. How to build the agent logic that orchestrates everything

The RAG infrastructure (parsing, embedding, indexing, searching) is handled
by RAGFlow and Mem0. Our job is building the product on top.
