# 17 — Mem0 Technical Deep Dive

> **Date:** 2026-03-31
> **Purpose:** Understand Mem0's internal implementation for our Fact Store + Entity Graph layers
> **Repo:** [mem0ai/mem0](https://github.com/mem0ai/mem0) | **License:** Apache 2.0

---

## 1. Core Architecture: Two-LLM-Call Pipeline

Mem0 is fundamentally a **two-phase LLM pipeline** for every `add()` operation:

```
Input text → LLM Call 1 (extract facts) → LLM Call 2 (ADD/UPDATE/DELETE/NONE) → Store
```

The graph store adds **3 more LLM calls** (entity extraction, relationship establishment, deletion assessment) = **5 LLM calls total per document** when graph is enabled.

---

## 2. Fact Extraction (LLM Call 1)

### Three Prompt Templates (selected based on context)

| Prompt | When Used | Extracts From |
|--------|-----------|--------------|
| `USER_MEMORY_EXTRACTION_PROMPT` | No agent_id or no assistant messages | User messages only |
| `AGENT_MEMORY_EXTRACTION_PROMPT` | agent_id present AND assistant messages exist | Assistant messages only |
| `FACT_RETRIEVAL_PROMPT` | Legacy/general | Both user and assistant |

**Key enforcement in user extraction prompt:**
> "YOU WILL BE PENALIZED IF YOU INCLUDE INFORMATION FROM ASSISTANT OR SYSTEM MESSAGES."

**7 fact categories:** personal preferences, personal details, plans/intentions, activity preferences, health/wellness, professional details, miscellaneous.

**Output format:** `{"facts": ["fact1", "fact2"]}` via `response_format={"type": "json_object"}`

**Custom prompts supported:** `config.custom_fact_extraction_prompt` — critical for our use case where we need to extract project discovery facts, not personal preferences.

---

## 3. Deduplication Logic (LLM Call 2) — The Secret Sauce

For each extracted fact:
1. Embed the fact
2. Search vector store for **top 5 similar** existing memories (scoped by user_id/agent_id)
3. **Map UUIDs to integer IDs** (prevents LLM from hallucinating UUIDs)
4. Send to LLM with `DEFAULT_UPDATE_MEMORY_PROMPT`

### Four Operations

| Operation | When | Example |
|-----------|------|---------|
| **ADD** | New information not in existing memory | First mention of hosting provider |
| **UPDATE** | Exists but more detailed or different | "Likes pizza" → "Loves cheese pizza with friends" |
| **DELETE** | New fact contradicts existing | "Loves pizza" → "Dislikes pizza" |
| **NONE** | Already present, no change | Duplicate mention |

**Critical nuance from the prompt:**
> "If memory contains 'Likes cheese pizza' and retrieved fact is 'Loves cheese pizza', do NOT update — they convey the same information."
> "If memory contains 'User likes to play cricket' and retrieved fact is 'Loves to play cricket with friends', then UPDATE."

**LLM response format:**
```json
{
  "memory": [
    {"id": "0", "text": "Updated text", "event": "UPDATE", "old_memory": "Original text"}
  ]
}
```

### UUID Hallucination Prevention
Real UUIDs are mapped to sequential integers (0, 1, 2...) before sending to LLM. After response, integers are mapped back to real UUIDs. This prevents the LLM from inventing or misremembering UUID strings.

---

## 4. Memory Data Model

### Vector Store Record
```
id: UUID string
vector: embedding of memory text
payload:
  data: "The actual memory text"
  hash: MD5 of text
  user_id, agent_id, run_id: scoping identifiers
  actor_id: who said it (for group chat)
  role: user/assistant
  created_at, updated_at: ISO timestamps (UTC)
  + any custom metadata
```

### History Table (SQLite — append-only audit log)
```sql
history(id, memory_id, old_memory, new_memory, event, created_at, updated_at, is_deleted, actor_id, role)
```

Every ADD/UPDATE/DELETE is recorded. Queryable via `m.history(memory_id)`.

### Memory Types
- `SEMANTIC` — default, general knowledge
- `EPISODIC` — event-based memories
- `PROCEDURAL` — agent execution summaries (uses special prompt for chronological summarization)

### No Formal State Machine
There are **no states** like "confirmed" or "discussed." The lifecycle is purely event-sourced:
- Created (ADD) → Updated (UPDATE) → Deleted (DELETE)
- All transitions recorded in history table

**Implication for our system:** We need to BUILD the fact lifecycle (new → discussed → confirmed → changed) on top of Mem0's basic ADD/UPDATE/DELETE events, using custom metadata.

---

## 5. Graph Store Integration (3 Additional LLM Calls)

### Entity Extraction (LLM Call 3)
**Prompt:** "You are a smart assistant who understands entities and their types in a given text."
**Self-reference handling:** If text contains "I", "me", "my" → use `user_id` as source entity.
**Output via function calling:**
```json
{"entity": "John", "entity_type": "person"}
```
Entities normalized: lowercased, spaces → underscores.

### Relationship Extraction (LLM Call 4)
**Prompt:** "You are an advanced algorithm designed to extract structured information to construct knowledge graphs."
**Key rules:**
- Use consistent, general, timeless relationship types
- Prefer "professor" over "became_professor"
- Use USER_ID for self-references
**Output via function calling:**
```json
{"source": "john", "relationship": "works_at", "destination": "acme_corp"}
```

### Deletion Assessment (LLM Call 5)
Compares new info against existing graph relationships. Only deletes if contradictory.
**Critical rule:** "DO NOT DELETE if there is a possibility of same type of relationship but different destination nodes" (e.g., "Alice loves pizza" should NOT be deleted when "Alice loves burger" is added).

### Node Matching via Embedding Similarity
Before adding entities, each entity name is embedded and searched via Neo4j vector similarity:
```cypher
WITH n, round(2 * vector.similarity.cosine(n.embedding, $n_embedding) - 1, 4) AS similarity
WHERE similarity >= $threshold
```
Default threshold: **0.7** (configurable).

Four matching cases:
1. Both source + destination found → MERGE relationship between existing nodes
2. Only source found → Create destination, link to existing source
3. Only destination found → Create source, link to existing destination
4. Neither found → Create both nodes + relationship

### Graph Soft-Delete Pattern
Relationships are marked `valid=false` with `invalidated_at=datetime()` rather than removed. This preserves historical graph state for temporal reasoning.

### Node Properties in Neo4j
- `name`, `user_id`, `agent_id`, `run_id`
- `embedding` (vector property)
- `created` (timestamp)
- `mentions` (counter, incremented on each reference)

### Relationship Properties
- `created_at`, `updated_at`, `mentions`, `valid` (boolean)

---

## 6. Search & Retrieval

### Vector Search
1. Embed query
2. Search vector store with filters (user_id, agent_id, etc.)
3. Optional threshold cutoff
4. Optional reranking (Cohere, HuggingFace, Sentence Transformers, LLM-based)

### Graph Search
1. Extract entities from query (LLM call)
2. Embed each entity, find similar nodes via cosine similarity
3. Retrieve all `valid=true` relationships for matched nodes
4. **BM25 reranking** (rank_bm25 library) on relationship triples

### Parallel Execution
Both `add()` and `search()` use `ThreadPoolExecutor` to run vector and graph operations concurrently.

### Filter Operators
Rich metadata filtering: `eq`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `contains`, `icontains`, wildcard `*`, logical `AND`/`OR`/`NOT`.

---

## 7. Multi-Tenancy

**Filter-based, not physically isolated.** All data in the same vector store collection and graph database.

- At least ONE of `user_id`, `agent_id`, or `run_id` required for every operation
- Stored as metadata on every record
- Every query auto-scopes by these IDs
- Qdrant creates payload indexes on scoping fields

**No `project_id` in open-source version** — that's a platform feature.

**For our system:** Use `user_id` = PO identifier, `agent_id` = agent name, and create our own `project_id` scoping via custom metadata.

---

## 8. API Surface

```python
from mem0 import Memory

m = Memory.from_config({
    "llm": {"provider": "anthropic", "config": {"model": "claude-sonnet-4-20250514"}},
    "embedder": {"provider": "openai", "config": {"model": "text-embedding-3-small"}},
    "vector_store": {"provider": "qdrant", "config": {"host": "localhost", "port": 6333}},
    "graph_store": {
        "provider": "neo4j",
        "config": {"url": "bolt://localhost:7687", "username": "neo4j", "password": "..."},
        "threshold": 0.7,
        "custom_prompt": "Extract entities relevant to software project discovery..."
    },
    "custom_fact_extraction_prompt": "Your custom prompt here..."
})

# Core operations
m.add(messages, user_id="po-1")                              # Extract + store
m.add("Client wants Azure hosting", user_id="po-1", metadata={"matter_id": "proj-1"})
m.search("hosting requirements", user_id="po-1", limit=10)   # Search
m.get(memory_id="uuid")                                       # Single memory
m.get_all(user_id="po-1")                                     # All memories for user
m.update(memory_id="uuid", data="New text")                   # Manual update
m.delete(memory_id="uuid")                                     # Delete
m.history(memory_id="uuid")                                    # Change history
```

### Return Formats
```python
# add() returns:
{"results": [{"id": "...", "memory": "...", "event": "ADD"}], "relations": {...}}

# search() returns:
{"results": [{"id": "...", "memory": "...", "score": 0.85}],
 "relations": [{"source": "...", "relationship": "...", "destination": "..."}]}
```

---

## 9. Configuration Options

### LLM Providers (18): openai, anthropic, ollama, groq, together, aws_bedrock, litellm, azure_openai, gemini, deepseek, minimax, xai, sarvam, lmstudio, vllm, langchain, + structured variants

### Vector Stores (27): qdrant (default), chroma, pinecone, faiss, weaviate, pgvector, milvus, mongodb, elasticsearch, opensearch, redis, azure_ai_search, supabase, cassandra, upstash_vector, valkey, databricks, s3_vectors, turbopuffer, baidu, azure_mysql, neptune_analytics, langchain, vertex_ai_vector_search

### Graph Stores (5): neo4j (default), memgraph, neptune, kuzu, apache_age

### Embedding Providers (12): openai (default), ollama, huggingface, azure_openai, gemini, vertexai, together, lmstudio, langchain, aws_bedrock, fastembed, mock

### Rerankers (5): cohere, huggingface, sentence_transformer, llm, zero_entropy

---

## 10. Key Insights for Our Discovery AI Assistant

### 10.1 What Mem0 Gives Us Out of the Box
- Automatic fact extraction from text (customizable prompts)
- ADD/UPDATE/DELETE deduplication (the hardest part to build ourselves)
- Entity + relationship graph construction
- Parallel vector + graph search
- Full change history (audit trail)
- Soft-delete on graph relationships (temporal reasoning)
- 18 LLM providers, 27 vector stores, 5 graph stores

### 10.2 What We Need to Build on Top
- **Fact lifecycle states** (new → discussed → confirmed → changed) — Mem0 has no state machine, only events. Use custom metadata fields.
- **Project-level isolation** — Mem0 has user_id/agent_id but no project_id. Use metadata filtering.
- **Control point linking** — Need to map facts to control points. Use metadata field `control_points: [...]`.
- **Confidence scoring** — Mem0 doesn't track confidence. Add as custom metadata.
- **Contradiction detection** — Mem0's DELETE handles contradictions, but we want to FLAG them for PO review, not auto-delete. Need to customize the update prompt.
- **Custom extraction prompts** — Replace personal-preference extraction with project discovery extraction. The `custom_fact_extraction_prompt` config is our hook.
- **Custom relationship types** — Define discovery-specific: `decided`, `depends_on`, `requires`, `owns`, `raised_concern`, `integrates_with`.

### 10.3 Critical Customizations Needed

**Custom Fact Extraction Prompt (replace default):**
```
You are a project discovery analyst. Extract discrete facts from client
communications about a software project. Focus on:
- Business requirements (goals, metrics, constraints)
- Technical decisions (hosting, auth, architecture)
- Functional requirements (features, user roles, integrations)
- Organizational context (stakeholders, timelines, budgets)
- Scope decisions (in-scope, out-of-scope, deferred)

For each fact, include the exact quote that supports it.
Output: {"facts": ["fact1", "fact2", ...]}
```

**Custom Update Prompt (modify to FLAG contradictions instead of DELETE):**
Instead of DELETE when a contradiction is found, we want:
- Event: `CONTRADICTION` (new event type)
- Keep BOTH the old and new fact
- Flag for PO resolution

This requires modifying the update prompt or post-processing the DELETE events.

**Custom Graph Extraction Prompt:**
```
Extract entities and relationships relevant to software project discovery:
- People (with roles: CTO, PM, developer, stakeholder)
- Organizations (client company, partners, vendors)
- Features (with priority: must-have, nice-to-have, deferred)
- Integrations (external systems, APIs, services)
- Decisions (with status: proposed, confirmed, changed)
- Technologies (frameworks, platforms, tools)
```

### 10.4 Performance Considerations

- **5 LLM calls per document** (with graph enabled) — batch processing recommended
- **Parallel execution** already built in (ThreadPoolExecutor) for vector + graph
- **Embedding cost** — every fact and entity gets embedded separately
- **BM25 reranking** on graph search is CPU-only (rank_bm25 library), no LLM cost
- **Model tiering opportunity** — use cheaper models for extraction (LLM calls 1, 3, 4), capable models for dedup decisions (LLM call 2) and deletion assessment (LLM call 5)

### 10.5 The "UUID Hallucination Prevention" Pattern
Map real UUIDs to sequential integers before sending to LLM. Map back after. This is a generally useful pattern for any system that needs LLMs to reference specific records — applicable to our control point IDs, fact IDs, etc.
