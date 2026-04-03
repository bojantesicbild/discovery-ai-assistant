# 24 — Remaining Decisions: Gap Analysis

> **Date:** 2026-03-31
> **Purpose:** Identify and analyze architectural gaps not yet addressed in docs 00-23
> **Status:** RESEARCH — decisions needed before and during development

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| **BEFORE CODE** | Must be decided before writing any code |
| **DURING DEV** | Can be decided during development, but needs a plan |
| **DEFER TO v2** | Safe to defer, document the intent and move on |

---

## 1. Authentication & Authorization

**Current state:** Doc 21 mentions users, projects, and roles in passing (`PO-1 (lead), PO-2 (support), BD-1`). The PostgreSQL schema has a `users` table but no columns for roles, permissions, or auth credentials. No auth system is specified anywhere. The `conversations` table references `users(id)` but there is no login flow, no token management, no session handling.

**Risk if we get it wrong:** Without auth, any user can see any project. Client A's confidential data is visible to a PO working on Client B. This is a dealbreaker for any real deployment, even internal.

**Recommended decision (BEFORE CODE):**

1. **Auth provider:** Use an external auth provider. For an internal tool with 5-15 users, the simplest option is **OAuth2 via company identity provider** (Google Workspace, Azure AD, Okta — whatever Bild already uses). FastAPI has well-supported libraries (`authlib`, `fastapi-users`). Do NOT build custom auth.

2. **Role model:** Keep it simple for v1. Three roles are enough:
   - **Project Lead** — full access to their projects (upload, run skills, edit control points, generate docs, manage project settings)
   - **Project Member** — can view, upload documents, use chat, run skills. Cannot delete documents, change templates, or archive projects.
   - **Viewer** — read-only dashboard access. For Tech Leads who need to see discovery progress but should not modify anything.

3. **Project-level scoping:** Every API endpoint must be scoped to a project. A user only sees projects they are assigned to. Assignment is stored in a `project_members` join table with a role column.

4. **Implementation:** JWT tokens issued after OAuth login. Token contains `user_id`. Backend resolves project access per request via `project_members` lookup (cached in Redis for 5 minutes).

**Open questions:**
- Does Bild have a company-wide identity provider, or do we need to support email/password?
- Should a user be able to self-assign to a project, or does a project lead invite them?
- Is there a "super admin" role for system-wide management (creating templates, viewing all projects)?

**Schema addition needed:**

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    avatar_url VARCHAR,
    auth_provider VARCHAR NOT NULL,  -- google, azure_ad, etc.
    auth_provider_id VARCHAR NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE project_members (
    project_id UUID REFERENCES projects(id),
    user_id UUID REFERENCES users(id),
    role VARCHAR NOT NULL,  -- lead, member, viewer
    added_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);
```

---

## 2. Data Privacy & Security

**Current state:** Not addressed in any document. Docker Compose exposes services on localhost ports. No mention of encryption, access controls on infrastructure services, or data handling policies.

**Risk if we get it wrong:** Client documents include business plans, financials, contracts, and internal communications. A data breach — or even a perception of insecure handling — destroys client trust. If Bild operates in the EU or handles EU client data, GDPR applies.

**Recommended decisions:**

**BEFORE CODE:**
1. **Encryption in transit:** All inter-service communication over TLS. Frontend to backend: HTTPS. Backend to RAGFlow/Neo4j/PostgreSQL: TLS connections (most Docker images support this with config). This is non-negotiable even for internal tools.

2. **Encryption at rest:** PostgreSQL `pgcrypto` for sensitive fields (client names, fact statements) is overkill for v1 if the server is properly secured. Instead: **full-disk encryption on the host machine** (standard on any modern server). MinIO supports server-side encryption for stored objects — enable it.

3. **Network isolation:** In Docker Compose, put infrastructure services (PostgreSQL, Redis, Neo4j, ES, MySQL, MinIO) on an internal network with no exposed ports. Only the backend and frontend expose ports to the host.

4. **API key management:** Anthropic API key, RAGFlow API key, database credentials — all via environment variables, never in code. Use `.env` files for dev, secrets management (Docker secrets, AWS Secrets Manager, or Vault) for production.

**DURING DEV:**
5. **Data retention:** When a project is archived, what happens to the data? Define a policy: archived projects retain data for N months, then hard-delete. Implement `project.archived_at` and a cleanup job.

6. **Audit logging:** The activity log from doc 21 partially covers this. Ensure every data access (not just writes) by users is logged for projects with sensitive clients.

7. **Document deletion:** When a PO deletes a document, it must be removed from RAGFlow (chunks), extracted facts must be flagged or removed, and the original file must be deleted from MinIO. This is a cascade that needs to be designed.

**DEFER TO v2:**
8. **GDPR compliance:** Right to erasure, data portability, processing agreements. Important if Bild handles EU client personal data, but unlikely in discovery documents (which are about projects, not individuals). Revisit when the tool is used beyond internal Bild team.

9. **SOC 2 / ISO 27001:** Only relevant if Bild wants to sell this tool externally.

**Open questions:**
- Where will production be hosted? Cloud provider and region affect data residency.
- Are there specific client contracts that mandate data handling requirements?
- Does Bild have an existing security policy that this tool must comply with?

---

## 3. RAGFlow Configuration Details

**Current state:** Doc 23 decided on two datasets per project (documents + facts). Doc 18 mapped file types to chunking templates (email for .eml, manual for specs, book for meeting notes, etc.). But the architecture does not specify HOW the pipeline selects the right template.

**Risk if we get it wrong:** Wrong chunking template = poor chunk quality = poor search results = poor extraction = cascading quality degradation through the entire pipeline. A technical spec chunked as "naive" instead of "manual" loses its hierarchical structure. A spreadsheet chunked as "book" produces garbage.

**Recommended decision (BEFORE CODE):**

1. **Two-factor template selection:**
   - **Factor 1: File extension** — deterministic mapping for unambiguous types:
     - `.eml` -> `email`
     - `.pptx/.ppt` -> `presentation`
     - `.xlsx/.xls/.csv` -> `table`
     - `.txt/.md` -> `naive`
     - `.mp3/.wav/.aac/.flac/.ogg` -> `audio`
   - **Factor 2: Classification LLM call for ambiguous types** — `.pdf` and `.docx` could be meeting notes, specs, contracts, or general documents. The haiku classification call (already in Stage 2a) should happen BEFORE parsing, and its output should determine the chunking template:
     - Meeting notes / transcripts -> `book` (bullet hierarchy)
     - Technical specs / API docs -> `manual` (hierarchical sections)
     - Contracts / legal -> `laws` (structure-preserving)
     - General business docs -> `naive` (fallback)

2. **Implementation change:** Move document classification (Stage 2a) to BEFORE RAGFlow upload, not after. The current pipeline uploads to RAGFlow first, then classifies. But RAGFlow needs the template at upload time. This means:
   - Step 1: Read the first ~2000 tokens of the raw file (before RAGFlow)
   - Step 2: Classify with haiku (file type + content sample -> template name)
   - Step 3: Upload to RAGFlow with the selected template
   - Step 4: Continue with extraction pipeline

3. **Mixed documents (email with PDF attachment):** RAGFlow's email template already handles attachments — it recursively processes multipart content and runs `naive_chunk()` on attachments. For PDFs attached to emails, the attachment content is chunked but loses the hierarchical template advantage. This is acceptable for v1. For v2, consider extracting attachments as separate documents.

4. **PO override:** Allow the PO to re-process a document with a different template if the auto-selection was wrong. This is a "re-parse" button on the document detail view that re-uploads to RAGFlow with the new template and re-runs extraction.

**Open questions:**
- Should we create the RAGFlow dataset with a default template and upload all docs to it, or create per-template datasets? RAGFlow datasets have a single `chunk_method` — so we either need multiple datasets per project (one per template) or we set the template per-document. Check if RAGFlow API supports per-document template override within a single dataset.
- What happens if a PO uploads a `.pdf` that is actually a scanned image with no text? DeepDoc's OCR pipeline handles this, but the classification call (which reads raw text) would fail. Need a fallback: if text extraction yields < 50 characters, assume scanned document and use `picture` or `naive` with OCR.

---

## 4. The Intent Classifier

**Current state:** Doc 23 defines a `ChatIntent` model classified by haiku. Intent types: `skill`, `search`, `graph_query`, `clarification`, `greeting`. No discussion of accuracy, fallback behavior, or correction mechanism.

**Risk if we get it wrong:** A misclassified intent sends the user down the wrong path silently. "What gaps do we have?" misclassified as `search` returns document passages about gaps instead of running the structured `/gaps` skill. The PO gets a worse answer and does not know why.

**Recommended decisions:**

**BEFORE CODE:**
1. **Build a test set of 50+ example queries** mapped to expected intents. Run the classifier against them. Measure accuracy. Haiku should get >90% accuracy on well-defined categories. If it does not, the categories need refinement.

2. **Show the classification to the user** (subtly). When the system routes to a skill, show "Running gap analysis..." When it routes to search, show "Searching documents..." This way, the PO can see if the system misunderstood and re-phrase.

3. **Provide a correction mechanism:** If the PO gets search results when they wanted a skill, they should be able to say "No, run the full gap analysis" and the system re-routes. This is not a formal feedback loop — it is just the intent classifier recognizing a correction pattern.

4. **Explicit commands as escape hatch:** `/gaps`, `/prep`, `/generate`, `/analyze` bypass the classifier entirely. Power users who know what they want should never be blocked by misclassification.

**DURING DEV:**
5. **Two-stage approach is NOT needed for v1.** A single haiku call with a well-crafted system prompt and 10-15 few-shot examples should be sufficient. The categories are distinct enough (skill invocation vs. document search vs. graph query vs. chit-chat) that a second classification stage adds cost without proportional benefit.

6. **Edge case handling:** Some queries are genuinely ambiguous. "Tell me about the auth approach" could be a search ("what did the client say about auth?") or a graph query ("what entities relate to auth?") or even a gap analysis trigger ("is auth covered?"). Decision: **default to search for ambiguous queries.** Search is the safest fallback — it returns relevant passages without making structural claims. The PO can then follow up with a more specific request.

7. **Log all classifications.** Store `(query, classified_intent, user_correction_if_any)` in PostgreSQL. After 100+ real queries, analyze misclassification patterns and tune the prompt/few-shot examples.

**Open questions:**
- Should the classifier also extract search parameters (query reformulation, filters)? Or should that be a separate step after classification?
- When a skill takes 30+ seconds, should the chat show intermediate progress ("Querying facts... Found 12 relevant facts... Evaluating control points...") or just a spinner?

---

## 5. Long Document Handling

**Current state:** Doc 22 (W4) flagged this as a "watch" item. The pipeline assumes documents fit in one LLM context window for extraction. No chunked extraction strategy is defined.

**Risk if we get it wrong:** The first 100-page RFP or technical spec uploaded by a PO will either: (a) fail silently (truncated input, partial extraction), (b) fail loudly (context limit exceeded), or (c) cost 10x expected (splitting into multiple calls without a merge strategy).

**Recommended decision (BEFORE CODE):**

1. **Define the threshold:** Claude Sonnet has a 200K token context. A typical page is ~500 tokens. So ~400 pages fit in context. But that does not mean we should send 400 pages — extraction quality degrades well before the limit, and cost scales linearly with input tokens. **Practical threshold: 30 pages (~15,000 tokens).** Documents under this threshold go through the standard single-pass extraction. Documents over this get chunked extraction.

2. **Chunked extraction strategy:**
   - Step 1: RAGFlow parses and chunks the document as normal (this always works regardless of size).
   - Step 2: Group RAGFlow chunks into "extraction windows" of ~10,000 tokens each, respecting section boundaries where possible.
   - Step 3: Run fact extraction on each window independently, passing a summary of previously extracted facts to avoid duplicates.
   - Step 4: Run a merge/dedup pass across all windows (this is where the existing dedup logic applies).
   - Step 5: Entity and relationship extraction runs on the merged fact set (not on raw text windows).
   - Step 6: Contradiction detection and control point coverage run once on the final merged set.

3. **The merge problem:** When extracting facts from Window 1 and Window 2 independently, the same fact may appear in both (especially if the document repeats key information across sections). The dedup function from doc 23 handles this — it compares new facts against existing via RAGFlow search + LLM judgment. The key insight: process windows sequentially, not in parallel, so each window's dedup can see facts from previous windows.

4. **Cost implication:** A 100-page document (~50,000 tokens) split into 5 windows means 5x fact extraction calls + 1 merge pass + 1 contradiction pass + 1 CP coverage pass = ~8 Sonnet calls instead of 1. Cost: ~$0.50-1.00 for the document. Acceptable for a document that dense with information.

**DURING DEV:**
5. **Implement progressively.** Start with single-pass extraction (handles 90% of discovery documents). Add chunked extraction when the first large document appears. The pipeline's stage-based architecture makes this a clean addition to Stage 2.

**Open questions:**
- Should the PO be warned before uploading a very large document? ("This 150-page document will take approximately 5 minutes to process and cost ~$0.80")
- For very large documents, should we extract from RAGFlow chunks directly (already parsed and structured) rather than from raw text? This would leverage RAGFlow's parsing but means extraction quality depends on chunk boundaries.

---

## 6. Embedding Model Choice

**Current state:** Doc 18 notes RAGFlow defaults to BGE-M3 (via TEI service). No discussion of whether this is the right model for our use case.

**Risk if we get it wrong:** Poor embeddings = poor search results = poor fact retrieval = degraded skill output quality. The embedding model is the foundation of all semantic search in the system.

**Recommended decision (DURING DEV):**

1. **BGE-M3 is a reasonable default.** It is multilingual (supports 100+ languages), produces 1024-dimensional embeddings, and handles up to 8192 tokens. For business/technical discovery documents, it performs well on benchmarks (MTEB). It is not the absolute best for English-only retrieval (where models like `text-embedding-3-large` or `voyage-3` score higher), but its multilingual support is valuable if Bild works with non-English clients.

2. **Do not overthink this for v1.** The embedding model can be swapped later without re-architecting (RAGFlow supports 15+ embedding providers). The real quality differentiator is the chunking strategy + reranking pipeline, not the base embedding model.

3. **If Bild works exclusively in English:** Consider `text-embedding-3-large` (OpenAI) or `voyage-3` (Voyage AI) for higher retrieval quality. Both are available as RAGFlow embedding providers. But this adds an external API dependency and per-query cost.

4. **If multilingual is required:** Stick with BGE-M3. It is the strongest multilingual embedding model that runs locally (no API cost per query).

**Recommended approach:** Start with BGE-M3 (local, free, multilingual). After 5-10 real projects, evaluate retrieval quality. If search results are consistently missing relevant passages, benchmark alternative models on your actual document corpus.

**Open questions:**
- What languages do Bild's clients communicate in? English only, or also German, Croatian, other?
- Is there a constraint on embedding API costs? Local BGE-M3 is free; cloud embedding models cost $0.02-0.13 per million tokens.

---

## 7. File Format Support

**Current state:** Doc 18 maps templates to file types (PDF, DOCX, XLSX, PPTX, EML, TXT, audio). No explicit list of supported/unsupported formats. No discussion of MSG, Google Docs, Notion, or other common formats.

**Risk if we get it wrong:** A PO uploads a `.msg` file from Outlook and the system either crashes or silently ignores it. They upload a Google Docs link and nothing happens. Unclear format support creates friction and erodes trust.

**Recommended decision (BEFORE CODE):**

1. **v1 Supported formats (explicit list):**

| Format | Extension | RAGFlow Template | Notes |
|--------|-----------|-----------------|-------|
| PDF | `.pdf` | auto-classified | DeepDoc parsing, OCR fallback |
| Word | `.docx`, `.doc` | auto-classified | python-docx / Tika |
| Excel | `.xlsx`, `.xls`, `.csv` | `table` | Row-per-chunk |
| PowerPoint | `.pptx`, `.ppt` | `presentation` | Slide-per-chunk |
| Email | `.eml` | `email` | Recursive multipart + attachments |
| Plain text | `.txt`, `.md` | `naive` | Direct chunking |
| Audio | `.mp3`, `.wav`, `.flac`, `.ogg`, `.aac` | `audio` | Requires ASR model config in RAGFlow |
| Images | `.png`, `.jpg`, `.jpeg` | `picture` | OCR + vision LLM |

2. **v1 NOT supported (with workaround):**

| Format | Why Not | Workaround |
|--------|---------|-----------|
| `.msg` (Outlook) | RAGFlow does not natively support MSG | PO saves as `.eml` before upload (Outlook supports this) |
| Google Docs | No local file | PO exports as `.docx` or `.pdf` |
| Notion exports | Notion exports as `.md` or `.html` | PO exports as `.md`, upload as plain text |
| `.html` | RAGFlow parses but chunking is generic | PO converts to PDF or paste content as `.txt` |
| Video (`.mp4`, etc.) | No transcription pipeline | PO uses external transcription service, uploads transcript |
| `.zip` archives | Multiple documents | PO extracts and uploads individually |

3. **Upload validation:** The backend must validate file extensions on upload and return a clear error: "File type .msg is not supported. Please save as .eml from Outlook." Do not silently fail.

4. **File size limits:** Set a reasonable limit (50MB per file for v1). RAGFlow can handle large files, but parsing time and storage add up.

**DEFER TO v2:**
- MSG support (via `extract-msg` Python library as a pre-processing step)
- URL ingestion (paste a web URL, system fetches and converts)
- Google Drive / OneDrive integration (direct import)
- Bulk upload with drag-and-drop folder

**Open questions:**
- Does RAGFlow's audio template work out of the box, or does it require a separate ASR model (Whisper)? If so, that is another container to manage. May want to defer audio to v2.
- How common are `.msg` files vs `.eml` in Bild's workflow? If POs primarily use Outlook on Windows, MSG might be more common than EML.

---

## 8. Testing Strategy

**Current state:** Doc 20 mentions a `tests/` directory with `test_pipeline/`, `test_skills/`, and `test_services/`. Doc 22 says testability is a strength (B+ grade) due to linear pipeline + independent skills. No concrete testing plan exists.

**Risk if we get it wrong:** Without tests, prompt changes break extraction quality silently. Dedup logic introduces duplicates. Control point evaluation regresses. We discover bugs from PO complaints instead of CI.

**Recommended decision (BEFORE CODE for the strategy, DURING DEV for implementation):**

### 8a. Pipeline Stage Tests (unit + integration)

| Stage | Test Type | What to Test |
|-------|-----------|-------------|
| Parse | Integration (RAGFlow) | Upload a known PDF, verify chunks exist, verify position tracking |
| Classify | Unit (mock LLM) | 20+ document samples -> expected classification. Snapshot tests. |
| Extract facts | Unit (mock LLM) + golden | 10 real documents -> expected facts. Compare extracted facts against human-labeled ground truth. |
| Dedup | Unit | Known fact pairs -> expected ADD/UPDATE/CONTRADICTION/DUPLICATE decisions |
| Store | Integration (RAGFlow + PostgreSQL) | Facts stored, retrievable via search, metadata correct |
| Evaluate | Unit | Known facts + control points -> expected coverage scores |

### 8b. Skill Prompt Quality Tests

This is the hardest part. LLM outputs are non-deterministic. Approach:

1. **Golden test suite:** For each skill, create 3-5 "golden" project states (a set of facts, control points, contradictions) with known expected outputs. Run the skill and compare against the golden output using an LLM-as-judge (a separate haiku call that scores the output on 5 criteria: completeness, accuracy, actionability, source attribution, format compliance). Score 1-5 per criterion.

2. **Regression threshold:** If a prompt change drops any golden test score below 3/5, the change is rejected. This is the "TDD for prompts" that Superpowers research referenced.

3. **Cost:** Running 5 golden tests x 5 skills = 25 Sonnet calls per CI run. At ~$0.05 each = $1.25 per CI run. Acceptable for weekly runs, expensive for every commit. Run on PR merge to main, not on every push.

### 8c. Intent Classification Accuracy

1. **Test set:** 50+ (query, expected_intent) pairs in a JSON fixture file.
2. **Accuracy target:** >90% exact match on intent type, >85% on skill/layer routing.
3. **Run on every prompt change** to the classifier (cheap — haiku, 50 calls = $0.05).

### 8d. Fact Dedup Correctness

1. **Test set:** 30+ fact pairs with expected decisions (ADD, UPDATE, CONTRADICTION, DUPLICATE).
2. **Unit test with mocked RAGFlow search** (return pre-defined similar facts).
3. **LLM decision test** with real Sonnet calls on the 30 pairs. Check agreement with human labels.

### 8e. Control Point Evaluation Accuracy

1. **Test set:** 10 control points x 5 fact sets = 50 evaluation scenarios.
2. **Expected outputs:** human-labeled (covered/partial/missing) with confidence ranges.
3. **Accuracy target:** >80% agreement with human labels on status, confidence within +/-2.

### CI Pipeline

```
Push to branch:
  - Lint + type check (mypy)
  - Unit tests (mocked LLM, mocked services)
  - Fast: ~2 minutes

PR to main:
  - All unit tests
  - Integration tests (Docker Compose with RAGFlow, PostgreSQL, Neo4j, Redis)
  - Intent classifier accuracy test (live haiku calls)
  - Dedup decision test (live sonnet calls)
  - Slow: ~10 minutes, ~$0.50 LLM cost

Weekly (scheduled):
  - Full golden test suite (all skills, all pipeline stages)
  - Cost: ~$2-3 per run
```

**Open questions:**
- Where do we store golden test fixtures? In the repo (`tests/fixtures/`) or in a separate test data repo (if they contain real client data, they cannot be in a public repo)?
- Do we need a staging environment with a separate RAGFlow instance for integration tests, or can tests share the dev instance with isolated datasets?

---

## 9. Prompt Management

**Current state:** Doc 20 defines SKILL.md files in `skills/prompts/`. Doc 22 (W6) warns about prompt drift. The Superpowers research mentioned "TDD for prompts" but did not elaborate.

**Risk if we get it wrong:** A "minor" prompt tweak to improve gap analysis for one project type breaks extraction quality for another. No one notices until a PO complains that the system "got worse."

**Recommended decision (BEFORE CODE):**

1. **Prompts live in the repo, versioned with git.** Every SKILL.md change is a PR with a diff. This is already implied but needs to be explicit policy.

2. **Prompt change checklist (enforced via PR template):**
   - What problem does this change fix? (link to specific failure example)
   - Which golden tests were affected? (before/after scores)
   - Does this change affect ALL project types or a specific one?
   - Were regression tests run? (paste CI output)

3. **Prompt structure convention:** Every prompt file follows a standard structure:
   ```
   # ROLE
   # IRON LAW (the one rule that must never be broken)
   # PROCESS (numbered steps)
   # OUTPUT FORMAT (Pydantic model reference)
   # ANTI-PATTERNS (what NOT to do)
   # FEW-SHOT EXAMPLES (2-3 input/output pairs)
   ```

4. **Environment-specific prompt overrides:** NOT recommended. All environments (dev/staging/prod) use the same prompts. If you need to experiment, create a branch.

**DURING DEV:**
5. **Prompt changelog:** Maintain a `PROMPT_CHANGELOG.md` that records every significant prompt change, the reason, and the measured impact. This is manual but invaluable for debugging when "the system used to be better."

6. **A/B testing for prompts (v2):** When you have enough usage volume, run two prompt versions in parallel and compare output quality. Not feasible for v1 with 5-10 projects.

**Open questions:**
- Should pipeline prompts (extraction, dedup, classification) use the same SKILL.md format, or are they different enough to warrant a separate `pipeline/prompts/` directory with its own conventions?
- How do we handle prompt changes that require re-processing existing documents? (e.g., improved fact extraction prompt means old documents have lower-quality facts)

---

## 10. Neo4j Schema

**Current state:** Doc 23 says "direct Neo4j" with entities (people, orgs, features, decisions, tech) and relationships (decided, depends_on, owns, requires). The `GraphService` code sample shows generic `MATCH` queries with string-based relationship types. No formal schema, no indexes, no constraints.

**Risk if we get it wrong:** Without a defined schema, entity types proliferate ("Person" vs "person" vs "People"), relationships are inconsistent ("decided" vs "made_decision" vs "approved"), and queries become fragile string matching.

**Recommended decision (BEFORE CODE):**

### Node Types

```
(:Entity {
    id: UUID,
    project_id: UUID,
    name: String,            -- "John Smith", "Auth Module", "Azure"
    type: String,            -- ENUM: person, organization, feature, decision,
                             --       technology, requirement, constraint, document
    description: String,     -- brief description from context
    first_mentioned_in: UUID, -- document ID
    mention_count: Integer,
    created_at: DateTime,
    updated_at: DateTime
})
```

### Relationship Types

| Relationship | From -> To | Example |
|-------------|-----------|---------|
| `DECIDED` | person -> decision | "CTO decided on Azure hosting" |
| `DEPENDS_ON` | feature -> feature, feature -> technology | "Auth depends on Azure AD" |
| `OWNS` | person -> feature, org -> feature | "John owns the payment module" |
| `REQUIRES` | feature -> requirement | "Dashboard requires real-time data" |
| `WORKS_AT` | person -> organization | "John works at ClientCo" |
| `MENTIONED_IN` | entity -> document | "Azure mentioned in Meeting 3" |
| `CONTRADICTS` | decision -> decision | "Single tenant contradicts multi-tenant" |
| `SUPERSEDES` | decision -> decision | "Multi-tenant supersedes single tenant" |

All relationships carry: `{evidence: String, source_doc_id: UUID, created_at: DateTime}`

### Indexes and Constraints

```cypher
CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE;
CREATE INDEX entity_project IF NOT EXISTS FOR (e:Entity) ON (e.project_id);
CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type);
CREATE INDEX entity_name IF NOT EXISTS FOR (e:Entity) ON (e.name);
CREATE FULLTEXT INDEX entity_name_fulltext IF NOT EXISTS FOR (e:Entity) ON EACH [e.name, e.description];
```

### Query Patterns (common)

```cypher
-- Who decided X?
MATCH (p:Entity {type: 'person'})-[r:DECIDED]->(d:Entity {type: 'decision'})
WHERE d.name CONTAINS $query AND d.project_id = $project_id
RETURN p.name, d.name, r.evidence

-- What depends on X?
MATCH (a:Entity)-[r:DEPENDS_ON]->(b:Entity {name: $entity_name, project_id: $project_id})
RETURN a.name, a.type, r.evidence

-- All entities for a project (for graph visualization)
MATCH (e:Entity {project_id: $project_id})-[r]-(other:Entity)
RETURN e, r, other
```

### Entity Dedup

The `GraphService.add_entity()` must check for existing entities by name similarity within the same project. Strategy:
1. Exact match on normalized name (lowercase, stripped) -> merge
2. Fuzzy match (Levenshtein distance < 2, or embedding similarity > 0.85) -> LLM confirmation
3. No match -> create new

**Open questions:**
- Should we use Neo4j labels (`:Person`, `:Feature`, `:Decision`) instead of a `type` property? Labels enable faster queries but require schema changes when adding new types. Property-based typing is more flexible for v1.
- Do we need a graph visualization in the frontend for v1, or is graph data only used internally by skills?

---

## 11. Backup & Recovery

**Current state:** Not addressed in any document. Doc 22 (W5) warns PostgreSQL is a single point of failure.

**Risk if we get it wrong:** A failed disk, a bad migration, or an accidental `DROP TABLE` loses all project data — facts, control points, readiness history, user data. RAGFlow's Elasticsearch index corruption loses all document chunks. Recovery from scratch means re-uploading and re-processing every document.

**Recommended decision (BEFORE CODE for strategy, DURING DEV for implementation):**

### What needs backup

| Data Store | What It Contains | Backup Method | Frequency |
|-----------|-----------------|---------------|-----------|
| PostgreSQL | Projects, facts, users, control points, history, activity | `pg_dump` (logical backup) | Daily + before migrations |
| RAGFlow MySQL | Document metadata, dataset config | `mysqldump` | Daily |
| RAGFlow Elasticsearch | Document chunks, embeddings, search index | ES snapshots to shared filesystem | Daily |
| RAGFlow MinIO | Original uploaded files | MinIO mirror / `mc mirror` to backup location | Daily |
| Neo4j | Entity graph | `neo4j-admin dump` | Daily |
| Redis | Queue state, cache | No backup needed (ephemeral) | - |

### Recovery priorities

1. **PostgreSQL** — most critical. Without it, the system is dead. Recovery target: < 1 hour.
2. **MinIO (original files)** — if lost, documents cannot be re-processed. Recovery target: < 4 hours.
3. **Elasticsearch** — if lost, can be rebuilt by re-parsing all documents from MinIO. Slow (hours for large datasets) but recoverable.
4. **Neo4j** — if lost, can be rebuilt by re-running entity extraction on all facts. Slow but recoverable.
5. **RAGFlow MySQL** — if lost, dataset configuration needs manual recreation, but documents can be re-uploaded.

### Implementation

**v1 (Docker Compose):** A cron job running nightly:
```bash
# backup.sh
pg_dump -h localhost -U postgres discovery > /backups/pg_$(date +%F).sql
mysqldump -h localhost -u root ragflow > /backups/mysql_$(date +%F).sql
neo4j-admin database dump neo4j --to-path=/backups/neo4j_$(date +%F).dump
mc mirror minio/ragflow /backups/minio_$(date +%F)/
# ES snapshot configured via ES API
```

Store backups on a separate volume/disk. For cloud deployments, ship backups to S3/GCS.

**Production:** Use managed services (RDS for PostgreSQL, managed Elasticsearch) that handle backups automatically. This is the strongest argument for managed services in production (see section 12).

**Open questions:**
- What is the acceptable data loss window? Daily backups mean up to 24 hours of data loss. For an internal tool with 2-3 documents uploaded per day per project, this is probably acceptable.
- Should we implement point-in-time recovery for PostgreSQL? (WAL archiving). Likely overkill for v1.

---

## 12. Deployment & DevOps

**Current state:** Doc 20 specifies Docker Compose for the full stack. No discussion of production deployment, CI/CD, or environment management.

**Risk if we get it wrong:** Docker Compose is fine for dev but risky for production (no auto-restart, no scaling, no rolling updates, no health monitoring beyond basic container status). A crashed container stays down until someone notices.

**Recommended decisions:**

**BEFORE CODE:**
1. **Dev environment:** Docker Compose as designed. Works on any developer machine. Document the setup in a `CLAUDE.md` or similar dev guide.

2. **Environment strategy:** Three environments:
   - **Local dev:** Docker Compose, local volumes, `.env` file
   - **Staging:** Same Docker Compose on a cloud VM (or lightweight Kubernetes). Shared by team for testing.
   - **Production:** See below.

**DURING DEV:**
3. **CI/CD pipeline (GitHub Actions or similar):**
   ```
   On push to any branch:
     - Lint (ruff) + type check (mypy)
     - Unit tests

   On PR to main:
     - All unit + integration tests
     - Build Docker images
     - Deploy to staging (auto)

   On merge to main:
     - Build + tag Docker images
     - Manual approval -> deploy to production
   ```

4. **Production deployment — two realistic options:**

   **Option A: Single VM with Docker Compose + managed databases**
   - Managed PostgreSQL (RDS / Cloud SQL) — handles backups, HA, scaling
   - Managed Elasticsearch (Elastic Cloud / OpenSearch Service) — handles backups, scaling
   - Self-hosted on VM: RAGFlow app + Neo4j + Redis + MinIO + backend + frontend + worker
   - Pros: Simplest migration from dev. Manageable for 5-10 projects.
   - Cons: Single point of failure for the VM. Manual scaling.

   **Option B: Kubernetes (lightweight, e.g., K3s or GKE Autopilot)**
   - All services as Kubernetes deployments
   - Managed databases where available
   - Pros: Auto-restart, rolling updates, scaling, health checks built in
   - Cons: Kubernetes overhead for a small team. Overkill for < 20 projects.

   **Recommendation:** Option A for v1. A single beefy VM (16GB RAM, 4 CPU) with managed PostgreSQL and managed Elasticsearch. Self-host RAGFlow + Neo4j + Redis + the app. This handles 10-20 concurrent projects comfortably.

5. **Resource requirements:**
   - RAGFlow + ES: ~6GB RAM (ES is the biggest consumer)
   - Neo4j: ~1GB RAM
   - PostgreSQL: ~512MB RAM (managed, separate)
   - Redis: ~256MB RAM
   - Backend + worker: ~1GB RAM
   - Frontend: ~256MB RAM (static build, minimal)
   - TEI embedding service: ~2GB RAM (BGE-M3 model)
   - **Total: ~12GB RAM minimum for all services**

**Open questions:**
- Which cloud provider does Bild use? AWS, GCP, Azure, or Hetzner/similar?
- Is there a budget constraint on infrastructure? Managed PostgreSQL + managed ES + a VM runs ~$200-400/month depending on provider.
- Does Bild have DevOps expertise in-house, or should deployment be as simple as possible (favoring managed services)?

---

## 13. Monitoring & Observability

**Current state:** Doc 21 lists Prometheus metrics (counters, histograms, gauges) and 5 alert conditions. No discussion of structured logging, distributed tracing, LLM call debugging, or cost dashboards.

**Risk if we get it wrong:** When a PO reports "the gap analysis was wrong," you need to trace: what facts did the system have? What did the LLM receive as context? What did it return? Without observability, debugging LLM-based systems is guesswork.

**Recommended decisions:**

**BEFORE CODE:**
1. **Structured logging standard:** Every log line is JSON with fields: `timestamp`, `level`, `service`, `project_id`, `user_id`, `action`, `duration_ms`, `error` (if any). Use Python's `structlog` library. This is cheap to implement upfront and painful to retrofit.

2. **LLM call logging:** Every call to Claude (via Instructor or direct) logs:
   - `model`, `purpose` (classify, extract_facts, dedup, skill_gaps, etc.)
   - `input_tokens`, `output_tokens`, `cost_usd` (calculated from model pricing)
   - `duration_ms`
   - `retries` (how many validation retries)
   - `project_id`, `document_id` or `skill_name`
   - Stored in PostgreSQL `llm_calls` table for cost tracking and debugging

**DURING DEV:**
3. **Cost tracking dashboard:** A simple page showing:
   - Total LLM cost per project (pipeline + skills + chat)
   - Cost per document (average and outliers)
   - Cost per skill invocation
   - Daily/weekly cost trend
   - This is table in PostgreSQL + a frontend page. No Prometheus needed.

4. **Pipeline tracing:** Each pipeline run gets a `trace_id`. Every stage logs with the same `trace_id`. When debugging a failed or poor-quality extraction, you can pull the full trace: parse result -> classification -> extracted facts -> dedup decisions -> stored facts -> CP evaluation.

5. **Skill debugging:** When a skill produces bad output, log the full prompt (preamble + skill prompt + retrieved context + user input) alongside the output. Store in PostgreSQL, viewable by admin. This is the single most important debugging capability for an LLM-based system.

**DEFER TO v2:**
6. **Prometheus + Grafana:** For v1 with one deployment, structured logs + the cost dashboard are sufficient. Prometheus/Grafana adds operational overhead. Add it when you have SLA requirements or multiple environments to monitor.

7. **OpenTelemetry distributed tracing:** Full request tracing across services is valuable but complex. The pipeline trace_id approach above gives 80% of the benefit for 20% of the effort.

8. **Alerting:** For v1, monitor via log aggregation (even just `docker logs` + `grep`). Set up Slack alerts for: pipeline failures, LLM cost > daily threshold, any 500 error. A cron job that checks the `llm_calls` table is simpler than Prometheus alertmanager.

**Schema addition:**

```sql
CREATE TABLE llm_calls (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    trace_id UUID,                -- groups calls within a pipeline run or skill invocation
    model VARCHAR NOT NULL,       -- claude-haiku, claude-sonnet
    purpose VARCHAR NOT NULL,     -- classify, extract_facts, dedup, skill_gaps, etc.
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd DECIMAL(10, 6),
    duration_ms INTEGER,
    retries INTEGER DEFAULT 0,
    document_id UUID,             -- if pipeline-related
    skill_name VARCHAR,           -- if skill-related
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_llm_calls_project ON llm_calls(project_id, created_at);
CREATE INDEX idx_llm_calls_trace ON llm_calls(trace_id);
```

**Open questions:**
- Should LLM call logging include the full prompt and response text? This is invaluable for debugging but generates significant storage. Recommendation: log full text in dev/staging, truncated summaries in production.
- Who has access to the cost dashboard? All POs, or only admins?

---

## 14. PO Onboarding

**Current state:** Doc 00 describes the user workflow (upload notes -> see gaps -> prepare meeting -> generate docs). No discussion of the first-time experience, project setup flow, or time-to-value.

**Risk if we get it wrong:** The PO opens the tool, sees an empty dashboard, and does not know what to do. They upload one document and wait 2 minutes for processing. They get a readiness score of 15% with no context on what that means. They close the tab and go back to their spreadsheet.

**Recommended decision (DURING DEV, but design BEFORE CODE):**

### First-Time Flow

1. **Create Project:**
   - PO enters: project name, client name, selects project type (Greenfield, Add-on, Feature Extension, API Integration, Mobile App)
   - System creates project, loads control point template for that type
   - Show: "Your project has 38 control points to track. Upload your first document to get started."

2. **First Upload:**
   - Drag-and-drop or file picker. Accept multiple files.
   - Show processing status in real-time (stage indicators, not just a spinner)
   - While processing: show a brief explanation of what the system is doing ("Parsing document... Extracting key facts... Checking for gaps...")

3. **First Results (the "aha moment"):**
   - After the first document processes, immediately show:
     - Readiness score (e.g., 18%)
     - Top 5 facts extracted (with source quotes)
     - Top 3 gaps identified
     - A call-to-action: "Upload more documents to improve coverage" or "Ask me about your project in chat"
   - Do NOT show an empty dashboard with just a score. Show the extracted content so the PO sees the system understood their document.

4. **Guided Next Steps:**
   - After each upload, suggest the next action:
     - < 30% readiness: "Upload more documents. Focus on: [top missing categories]"
     - 30-60% readiness: "Try asking 'What gaps do we have?' in chat"
     - 60-80% readiness: "Try 'Prepare my next meeting' to get a focused agenda"
     - > 80% readiness: "Consider generating your discovery documents"

### Template Selection

The project type selection at creation time determines:
- Which control point template is loaded (and which control points are pre-populated)
- Default chunking preferences (e.g., API projects might get more "manual" template usage)
- Suggested follow-up questions (different for greenfield vs. add-on)

The PO should be able to:
- Add/remove individual control points after project creation
- Switch templates entirely (with a warning that it resets control point statuses)
- Mark control points as N/A

### Time-to-Value Target

**The PO should see actionable output within 5 minutes of creating a project and uploading their first document.** This means the pipeline must process a typical 3-5 page meeting note in under 2 minutes, and the dashboard must immediately reflect the results.

**Open questions:**
- Should there be a demo/sample project pre-loaded so the PO can explore the interface before creating their own project?
- Is there a tutorial or walkthrough overlay for first-time users, or do we rely on the interface being self-explanatory?
- Should the PO be able to create a project from a template that includes sample control points and a sample document?

---

## 15. Migration & Data Portability

**Current state:** Doc 22 recommends treating RAGFlow as a "black box you might replace." The `RAGFlowClient` abstraction exists for this purpose. No discussion of data export.

**Risk if we get it wrong:** If RAGFlow breaks on an upgrade, or Bild decides to replace it, we need to migrate all document data. If a client engagement ends and the client wants their data, we need to export it cleanly.

**Recommended decisions:**

**BEFORE CODE:**
1. **The RAGFlowClient abstraction must be a genuine abstraction.** Define a `DocumentSearchService` interface with methods like `upload()`, `parse()`, `search()`, `get_chunks()`, `delete()`. The RAGFlow implementation fulfills this interface. If we swap later, we only rewrite the implementation, not every call site.

2. **Original files are always preserved.** MinIO stores the raw uploaded files. Even if RAGFlow's index is lost, we can re-parse from originals. This is the ultimate safety net.

**DURING DEV:**
3. **Project export feature:** A "Download Project Data" button that produces a ZIP containing:
   - All original uploaded documents (from MinIO)
   - All extracted facts as JSON (from PostgreSQL)
   - Control points with statuses as JSON
   - Readiness history as JSON
   - Entity graph as JSON (nodes + edges from Neo4j)
   - Generated documents (if any)
   This is useful for: client handoff, backup, and proving we can extract our data from the system.

4. **RAGFlow migration path (if needed):**
   - Facts are in PostgreSQL (fully portable)
   - Entity graph is in Neo4j (fully portable)
   - Original documents are in MinIO (fully portable)
   - The only RAGFlow-specific data is the chunked/indexed documents in Elasticsearch. To migrate, re-upload and re-parse all documents through the new system. With 20-30 documents per project, this takes minutes, not hours.
   - **Conclusion:** RAGFlow migration is manageable because the system of record for facts and entities is NOT RAGFlow. RAGFlow is the search layer, not the truth layer.

**DEFER TO v2:**
5. **Project import:** Importing a previously exported project into a new system instance. Not needed for v1 but good to keep in mind for the export format design.

6. **Cross-system data migration:** If Bild decides to move from self-hosted to a SaaS version (or vice versa), the export format should be sufficient. Design the export format to be self-contained.

**Open questions:**
- What format should the export use? A flat ZIP with JSON files is simplest. A more structured format (like a SQLite database) is more queryable. JSON ZIP is recommended for v1.
- Does the client ever need the raw extracted facts, or just the final generated documents? If only final documents, the export is much simpler.

---

## Summary: Decision Timeline

### Must Decide BEFORE Writing Code (Week 1)

| # | Decision | Complexity |
|---|----------|-----------|
| 1 | Auth provider + role model + project scoping | Medium |
| 2 | Network isolation + secret management | Low |
| 3 | RAGFlow template selection (classification before upload) | Medium |
| 5 | Long document threshold + chunked extraction strategy | Medium |
| 7 | Explicit supported file format list + validation | Low |
| 8 | Testing strategy (what to test, how, CI shape) | Medium |
| 9 | Prompt file structure + change policy | Low |
| 10 | Neo4j node types, relationships, indexes | Medium |
| 12 | Dev environment setup (Docker Compose finalized) | Low |
| 13 | Structured logging standard + LLM call logging table | Low |
| 15 | `DocumentSearchService` interface (RAGFlow abstraction) | Low |

### Decide DURING Development (Weeks 2-6)

| # | Decision | Complexity |
|---|----------|-----------|
| 4 | Intent classifier test set + accuracy benchmarks | Medium |
| 6 | Embedding model evaluation (start with BGE-M3, measure) | Low |
| 8 | Golden test suites for skills and pipeline | High |
| 11 | Backup scripts + schedule | Low |
| 12 | Production deployment (VM + managed DBs) | Medium |
| 13 | Cost tracking dashboard | Medium |
| 14 | Onboarding flow + first-time UX | Medium |
| 15 | Project export feature | Medium |

### Safe to DEFER to v2

| # | Decision | Why Defer |
|---|----------|----------|
| 2 | GDPR, SOC 2 | Internal tool, no external users yet |
| 7 | MSG support, URL ingestion, Google Drive | Workarounds exist |
| 9 | A/B testing for prompts | Need usage volume |
| 13 | Prometheus + Grafana, OpenTelemetry | Structured logs are sufficient for v1 |
| 14 | Demo project, tutorial overlay | Ship core functionality first |
| 15 | Project import, cross-system migration | Export is enough for v1 |

---

## Appendix: New Schema Objects Referenced in This Document

The following tables and indexes were referenced throughout this analysis and should be added to the PostgreSQL and Neo4j schemas defined in docs 20 and 23:

**PostgreSQL:**
- `users` (expanded with auth fields)
- `project_members` (new — role-based access)
- `llm_calls` (new — cost tracking and debugging)

**Neo4j:**
- Formal `Entity` node schema with typed properties
- 8 defined relationship types with evidence properties
- 4 indexes including full-text search

These are additive to the existing schema. No changes to previously defined tables are required.
