# 18 — RAGFlow Technical Deep Dive

> **Date:** 2026-03-31
> **Purpose:** Understand RAGFlow's internal implementation for our Document Search layer
> **Repo:** [infiniflow/ragflow](https://github.com/infiniflow/ragflow) | **License:** Apache 2.0

---

## 1. Core Architecture

```
              +-----------+
              |   nginx   |  (reverse proxy)
              +-----+-----+
                    |
              +-----+-----+
              |  RAGFlow   |  :9380 (API) / :9381 (admin)
              |  (Python)  |
              +-----+-----+
                    |
    +-------+-------+-------+-------+
    |       |       |       |       |
+---+--+ +--+---+ +-+--+ +-+---+ +-+--------+
|  ES  | |MySQL | |MinIO| |Redis| | Sandbox  |
|:9200 | |:3306 | |:9000| |:6379| | :9385    |
+------+ +------+ +-----+ +-----+ +----------+
    |
+---+----+
|  TEI   |  :6380 (embedding service, BGE-M3 default)
+--------+
```

**Data flow:**
1. Upload → stored in **MinIO** (object storage)
2. Metadata created in **MySQL** (Peewee ORM)
3. Parsing task queued via **Redis**
4. Worker runs DeepDoc + chunking template
5. Chunks indexed into **Elasticsearch** (full-text + vector)
6. Query: hybrid search → reranking → LLM generation
7. Optional: GraphRAG entities stored in ES

---

## 2. DeepDoc: The Crown Jewel (Document Parsing)

### The PDF Parsing Pipeline (exact sequence)

DeepDoc is a multi-stage document understanding engine in `deepdoc/`:

```
PDF → __images__() → _layouts_rec() → _table_transformer_job() → _text_merge() → _concat_downward() → _filter_forpages() → _extract_table_figure()
```

**Step 1: `__images__()`** — Extract page images + character-level data via pdfplumber

**Step 2: `_layouts_rec()`** — Layout recognition model (ONNX from HuggingFace). Detects **11 layout types:**

| Layout Type | Purpose |
|-------------|---------|
| Text | Regular body text |
| Title | Headings and titles |
| Figure | Images and diagrams |
| Figure Caption | Captions for figures |
| Table | Tabular data |
| Table Caption | Captions for tables |
| Header | Page headers |
| Footer | Page footers |
| Reference | Bibliography entries |
| Equation | Mathematical formulas |
| Background | Decorative/background elements |

**Step 3: `_table_transformer_job()`** — Table structure recognition. Tests 4 rotation angles (0/90/180/270°) if `TABLE_AUTO_ROTATE=true`. Detects columns, rows, headers, spanning cells.

**Step 4: `_text_merge()`** — Horizontally merges adjacent text boxes (same layout, y-distance < mean_height/3)

**Step 5: `_concat_downward()`** — **The secret sauce: XGBoost model with a 31-element feature vector** to decide vertical text concatenation. Features include:
- Row/column alignment
- Punctuation patterns
- CJK character detection
- Geometric distances
- Tokenization metrics

**Step 6: `_filter_forpages()`** — Removes garbled pages and table-of-contents pages. Garbled detection: checks Unicode Private Use Areas (0xE000-0xF8FF), threshold at 50% invalid characters.

**Step 7: `_extract_table_figure()`** — Separates tables and figures as distinct components.

### Column Detection
K-Means clustering on x0 coordinates, testing 1-4 clusters, selected by **silhouette score**. Indent tolerance = 12% of page width.

### OCR Pipeline
**Dual-path:** pdfplumber metadata extraction + visual OCR. Falls back to visual OCR when pdfplumber text is >50% garbled characters.
- Two-stage: `TextDetector` (bounding box) + `TextRecognizer` (CTC decoding)
- Confidence threshold: 0.5
- Batch size: 16 images

### Position Tracking
Format: `@@page-list\tx0\tx1\ttop\tbottom##` — encodes exact page coordinates for every text block. **Enables source citation back to the original document.**

### Key Thresholds
- Layout detection score: 0.4 (NMS: 0.45)
- Layout-OCR box overlap: 0.4
- OCR confidence: 0.5
- Default zoom: 3x resolution

### Alternative Parsers
- `PlainParser` — pypdf text-only, no layout analysis
- `VisionParser` — sends page images to vision LLM for description
- `MinerU`, `Docling`, `PaddleOCR`, `TCADP` — pluggable alternatives

---

## 3. The 14 Chunking Templates

Each template in `rag/app/` implements domain-specific chunking logic:

| # | Template | Strategy | Key Detail |
|---|----------|----------|------------|
| 1 | **naive** | Split by delimiter, merge until token limit | General-purpose. Configurable overlap. |
| 2 | **book** | Bullet hierarchy detection | `bullets_category()` + `hierarchical_merge()`, falls back to `naive_merge()` |
| 3 | **paper** | Section hierarchy via title frequency | Extracts title, authors, abstract. Abstract kept intact. |
| 4 | **laws** | Structure-preserving, no token splitting | Sets `chunk_token_num=0`. Uses `tree_merge()` for legal articles/clauses. |
| 5 | **manual** | Hierarchical section from outlines | Min 32 tokens, merge ceiling 1024 within same section. |
| 6 | **table** | Each row = one chunk | Auto-detects column types (int, float, text, datetime, bool). Formats as `"- Field: Value"`. |
| 7 | **qa** | Extract Q&A pairs | From Excel (first two non-empty cells), PDF (bullet markers), Markdown (headers=questions). |
| 8 | **resume** | 4-phase LLM extraction | Dual-path PDF + parallel LLM for basic/work/education/projects + regex fallback + Jaccard dedup. |
| 9 | **presentation** | Each slide = one chunk | python-pptx with Tika fallback. |
| 10 | **email** | Parse EML structure | Recursive multipart handling. Attachments via `naive_chunk()`. |
| 11 | **picture** | OCR + vision LLM | If OCR text < 32 chars, sends to vision LLM for description. |
| 12 | **tag** | Two-column (content + tags) | Tags normalized as keywords. For pre-labeled content. |
| 13 | **one** | Entire document = single chunk | All content concatenated. |
| 14 | **audio** | Speech-to-text transcription | Supports wav, mp3, aac, flac, ogg via configured ASR model. |

### Core Algorithm: `naive_merge()`
```
1. Split text by delimiters ("\n!?.;!?。；！？")
2. For each piece:
   - If adding piece exceeds chunk_token_num → finalize current chunk
   - Otherwise append to current chunk
3. Overlap: trailing N% of previous chunk as prefix of next
   overlap_len = len(current) * overlapped_percent / 100
```

Default `chunk_token_num`: 128-512 (varies by template, most use 512).

### Dual-Layer Tokenization
Every chunk gets tokenized twice:
- `content_ltks` — Standard tokenization (whitespace-analyzed in ES)
- `content_sm_ltks` — Fine-grained sub-token splitting (better recall)
- Same for titles: `title_tks` / `title_sm_ltks`

---

## 4. Hybrid Search Implementation

### Initial Retrieval Weights

```python
FusionExpr("weighted_sum", topk, {"weights": "0.05, 0.95"})
```

| Component | Weight | Purpose |
|-----------|--------|---------|
| **Keyword (BM25)** | 5% | Exact term matching, names, dates |
| **Vector (cosine)** | 95% | Semantic similarity |

**Fallback logic:** If zero results → lower keyword `min_match` from 0.3 to 0.1, raise similarity threshold from 0.1 to 0.17, retry.

### Reranking Pipeline (after retrieval)

**Hybrid Similarity Reranking** combines three signals:

| Signal | Weight | Multipliers |
|--------|--------|------------|
| Token similarity | 30% | Title tokens: 2x, important keywords: 5x, question tokens: 6x |
| Vector similarity | 70% | Embedding cosine distance |
| Rank features | Additive | PageRank: 10x multiplier + tag-based features |

Combined formula: `sim = 0.3 * tksim + 0.7 * vtsim + rank_fea`

**Model-Based Reranking** (alternative): Uses external reranker model (Jina, Cohere, NVIDIA, Voyage, BGE, etc.) to replace vector similarity score.

### Citation Insertion
`insert_citations()` matches answer sentences to source chunks:
- Encodes sentences via embedding model
- Adaptive similarity threshold: starts at 0.63, decreases by 0.8x per step down to 0.3
- Max 4 citations per sentence
- Citation weights: 10% keyword / 90% vector

### Query Processing
1. Traditional-to-simplified Chinese conversion
2. Case normalization
3. Term weighting
4. **Synonym expansion** (0.25x weight)
5. **Bigram phrase boosting** (2x weight)
6. Fine-grained sub-token variants
7. Minimum-should-match thresholds

---

## 5. Knowledge Graph / GraphRAG

### Entity & Relationship Extraction

1. LLM extracts entities (name, type, description) and relationships (source, target, description, strength)
2. **Iterative gleaning**: Multiple extraction passes via `CONTINUE_PROMPT` with `LOOP_PROMPT` Y/N check (up to `max_gleanings` iterations)
3. Entity types: Person, Technology, Organization, Location, Event, Concept (configurable)

### Indexing Pipeline

1. `generate_subgraph()` — LLM extracts into NetworkX graph per chunk
2. `merge_subgraph()` — Merges into global graph, calculates **PageRank**: `nx.pagerank(new_graph)`
3. `resolve_entities()` — LLM-based entity resolution (dedup). Groups by type, checks similarity (edit distance for English, character overlap for CJK), LLM confirms matches
4. `extract_community()` — **Leiden community detection** (from Microsoft GraphRAG, default max cluster size: 12), then LLM generates community reports

### Community Reports
- Leiden algorithm partitions graph
- For each community (2+ nodes): formatted as CSV, sent to LLM
- LLM returns: title, summary, findings, rating, rating_explanation
- 180-second timeout per LLM call

### GraphRAG Search
1. LLM rewrites query → extract entity keywords + types
2. Three parallel retrieval paths: keyword matching, type filtering (PageRank-ordered), relation semantic similarity
3. Scoring: `P(E|Q) = pagerank * similarity`
4. Type-matched entities get **2x boost**
5. Community reports retrieved for higher-order context

---

## 6. Metadata Extraction

- LLM-based with **strict zero-hallucination prompt**: only extracts explicitly stated values
- Stored in per-tenant ES indices: `ragflow_doc_meta_{tenant_id}`
- Post-processing: automatic value splitting on delimiters, type detection (string/number/list/time)
- Deduplication preserving order

---

## 7. API Design (Key Endpoints)

### Datasets (Knowledge Bases)
```
POST   /datasets                    Create (name, embedding_model, chunk_method, parser_config)
GET    /datasets                    List (pagination, ordering)
PUT    /datasets/<id>               Update config
DELETE /datasets                    Delete by IDs
```

### Documents
```
POST   /datasets/<id>/documents     Upload files
POST   /datasets/<id>/chunks        Trigger parsing (document_ids)
```

### Search & Chat
```
POST   /chats                       Create assistant (dataset_ids, llm_id, prompt_config)
POST   /chats/<id>/sessions/<id>/completions    Chat (streaming SSE)
POST   /searches                    Create search app
```

### GraphRAG
```
POST   /datasets/<id>/knowledge_graph    Run extraction
GET    /datasets/<id>/knowledge_graph    Retrieve graph
DELETE /datasets/<id>/knowledge_graph    Remove
```

### Default Parameters
- `top_n=6`, `top_k=1024`
- `similarity_threshold`: configurable per dataset
- `vector_similarity_weight`: configurable

---

## 8. Configuration

### Parser Config (per dataset)
```json
{
  "chunk_token_num": 512,
  "delimiter": "\n!?。；！？",
  "layout_recognize": "DeepDOC",
  "overlapped_percent": 0,
  "table_context_size": 0,
  "image_context_size": 0
}
```

Layout recognizer options: `DeepDOC` (default), `Plain Text`, `TCADP`, `Docling`, `MinerU`, `PaddleOCR`

### Elasticsearch Index Schema
- 2 shards, 0 replicas, 1000ms refresh
- Dynamic templates: `*_int`, `*_flt`, `*_tks` (whitespace analyzer), `*_kwd` (keyword), `*_vec` (dense_vector cosine)
- Vector dimensions: 512, 768, 1024, 1536
- `*_fea` for rank_features (PageRank, tag scores)
- Custom scripted IDF similarity

### Infrastructure Options
- **ES alternatives:** OpenSearch, Infinity
- **MySQL alternatives:** OceanBase
- **MinIO alternatives:** S3, GCS, OSS, Azure Blob
- **Embedding:** BGE-M3 default, 15+ provider options

---

## 9. Key Insights for Our Discovery AI Assistant

### 9.1 What RAGFlow Gives Us Out of the Box
- Sophisticated PDF parsing (XGBoost-based text concatenation, dual-path OCR, 11 layout types)
- 14 domain-specific chunking templates
- Hybrid search (5% keyword + 95% vector initial, 30/70 reranking)
- Position tracking for source citation back to original document
- GraphRAG with Leiden communities and PageRank
- Auto metadata extraction with zero-hallucination guardrails
- 15+ reranker providers

### 9.2 Which Chunking Templates We'll Use

| Document Type in Discovery | RAGFlow Template | Why |
|---------------------------|-----------------|-----|
| Meeting notes / transcripts | **naive** or **book** | Meeting notes have bullet-point structure. Book template handles bullet hierarchies. |
| Emails / correspondence | **email** | Native EML parsing, handles attachments. |
| Technical specs / API docs | **manual** | Hierarchical section detection from outlines. |
| Contracts / legal docs | **laws** | Structure-preserving, keeps articles/clauses intact. |
| Presentations | **presentation** | Slide-per-chunk makes sense for client decks. |
| Spreadsheets / data tables | **table** | Row-per-chunk with typed fields enables structured search. |
| General business docs | **naive** | Default fallback with configurable overlap. |
| Audio recordings | **audio** | Speech-to-text + tokenization for meeting recordings. |

### 9.3 Search Configuration for Discovery

**Recommended initial settings:**
```json
{
  "chunk_token_num": 512,
  "overlapped_percent": 10,
  "similarity_threshold": 0.3,
  "vector_similarity_weight": 0.7,
  "top_n": 10,
  "top_k": 1024
}
```

**Rationale:**
- 512 tokens per chunk = enough context for paragraph-level retrieval
- 10% overlap = captures cross-boundary information
- Lower similarity threshold (0.3) = better recall for discovery (we'd rather find too much than miss something)
- 70% vector weight at reranking = semantic understanding dominates, but keywords still catch names/dates/amounts

### 9.4 Critical Detail: Position Tracking Enables Source Citations

RAGFlow stores exact page coordinates for every text block: `@@page-list\tx0\tx1\ttop\tbottom##`

This means our Document Generator Agent can cite not just "Meeting 3 notes" but "Meeting 3 notes, page 2, paragraph 3" — critical for PO trust in generated documents.

### 9.5 The "RAPTOR" Reality Check

RAGFlow's hierarchical retrieval is **NOT** true RAPTOR (embedding-based semantic clustering with recursive summarization). It's **regex-based structural hierarchy** (heading-level detection).

For our use case, structural hierarchy is actually better — meeting notes and specs have explicit sections, and we want to preserve that structure rather than creating abstract summaries.

### 9.6 GraphRAG vs Mem0 Graph — Complementary, Not Redundant

| Feature | RAGFlow GraphRAG | Mem0 Graph |
|---------|-----------------|-----------|
| **Purpose** | General knowledge extraction from documents | Fact-level entity tracking with lifecycle |
| **Entity resolution** | LLM-based, edit distance + character overlap | Embedding similarity (0.7 threshold) |
| **Community detection** | Leiden algorithm + LLM community reports | None |
| **PageRank** | Yes — central to search scoring | No |
| **Soft delete** | No | Yes (temporal reasoning) |
| **Fact lifecycle** | No (static extraction) | Yes (ADD/UPDATE/DELETE events) |
| **Auto-update on new docs** | No (manual re-extraction) | Yes (automatic dedup on add) |

**Our approach:** Use BOTH.
- RAGFlow GraphRAG for **discovery-time exploration** (community reports, entity maps)
- Mem0 Graph for **operational fact tracking** (who decided what, what depends on what, temporal changes)

### 9.7 Performance Considerations
- DeepDoc PDF parsing is CPU-intensive (ONNX models, OCR, XGBoost)
- Initial parsing is slow but one-time per document
- Search is fast (<100ms for hybrid search on ES)
- GraphRAG extraction is expensive (multiple LLM calls per chunk + entity resolution + community reports)
- Consider running GraphRAG asynchronously after initial parsing completes
