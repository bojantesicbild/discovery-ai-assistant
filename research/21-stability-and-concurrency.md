# 21 — Stability, Concurrency, and Multi-User Design

> **Date:** 2026-03-31
> **Purpose:** Address production stability concerns for multi-user collaborative usage
> **Builds on:** research/20-revised-architecture.md

---

## 1. The Concurrency Model

### Who Uses the System

```
Project A: PO-1 (lead), PO-2 (support), BD-1 (business dev)
Project B: PO-3 (lead), PO-1 (consulting)
Project C: PO-4 (solo)
```

- Multiple users per project (2-5 typical)
- One user across multiple projects
- Concurrent uploads, skill invocations, and chat sessions
- Different time zones, async work

### Three Concurrency Zones

```
┌────────────────────────────────────────────────────────────┐
│ ZONE 1: PIPELINE (async, queue-based)                       │
│ Document uploads → processed one-at-a-time per project     │
│ No user waiting. Background processing. Status updates.     │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ ZONE 2: SKILLS (request-response, user waiting)             │
│ /gaps, /prep, /generate, /simulate, /analyze               │
│ User expects response. Can be slow (10-60s). Need streaming.│
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ ZONE 3: COLLABORATION (real-time, multi-user)               │
│ Dashboard state, chat, control point edits                  │
│ Users need to see each other's changes. Live updates.       │
└────────────────────────────────────────────────────────────┘
```

---

## 2. Zone 1: Pipeline Stability

### Problem: Concurrent Uploads to Same Project

Two users upload documents simultaneously. Both pipelines run. Both try to update readiness score. Result: race condition — last pipeline to finish overwrites the other's evaluation.

### Solution: Per-Project Queue with Sequential Processing

```python
# pipeline/worker.py

# Documents queued per project. Processed sequentially within a project.
# Different projects process in parallel.

async def enqueue_document(project_id: str, document_id: str):
    """Add document to project-specific queue."""
    await redis.lpush(f"pipeline:{project_id}", document_id)

async def worker_loop():
    """Process documents. One at a time per project."""
    while True:
        # Get next document from any project queue
        project_id, doc_id = await redis.brpop("pipeline:*")

        # Acquire project lock (prevents concurrent processing for same project)
        async with project_lock(project_id):
            try:
                await process_document(project_id, doc_id)
                await update_status(doc_id, "completed")
            except Exception as e:
                await update_status(doc_id, "failed", error=str(e))
                await notify_users(project_id, f"Document processing failed: {e}")
```

**Key rules:**
- Documents queue FIFO per project
- Only one document processes at a time per project
- Different projects process in parallel (one worker per project)
- Users see real-time status: `queued → processing → completed / failed`

### Problem: Pipeline Fails Mid-Way

RAGFlow parses the document, but Mem0 is down. Facts not stored. Readiness score not updated. Document shows "completed" but data is incomplete.

### Solution: Pipeline Stages with Checkpoints

```python
class PipelineStage(str, Enum):
    QUEUED = "queued"
    PARSING = "parsing"            # Stage 1: RAGFlow
    PARSED = "parsed"
    EXTRACTING = "extracting"      # Stage 2: Instructor
    EXTRACTED = "extracted"
    STORING = "storing"            # Stage 3: Mem0
    STORED = "stored"
    EVALUATING = "evaluating"      # Stage 4: Control points
    COMPLETED = "completed"
    FAILED = "failed"

async def process_document(project_id: str, doc_id: str):
    """Pipeline with stage tracking and retry from last checkpoint."""

    doc = await db.get_document(doc_id)
    stage = doc.pipeline_stage  # Resume from last successful stage

    try:
        if stage < PipelineStage.PARSED:
            await update_stage(doc_id, PipelineStage.PARSING)
            parsed = await ragflow.upload_and_parse(project_id, doc.file)
            await save_checkpoint(doc_id, PipelineStage.PARSED, {"ragflow_id": parsed.id})

        if stage < PipelineStage.EXTRACTED:
            await update_stage(doc_id, PipelineStage.EXTRACTING)
            text = await ragflow.get_parsed_text(doc.ragflow_id)
            extraction = await instructor.extract(text, ...)
            await save_checkpoint(doc_id, PipelineStage.EXTRACTED, {"extraction": extraction})

        if stage < PipelineStage.STORED:
            await update_stage(doc_id, PipelineStage.STORING)
            await mem0.store_facts(project_id, extraction.facts)
            await save_checkpoint(doc_id, PipelineStage.STORED)

        if stage < PipelineStage.COMPLETED:
            await update_stage(doc_id, PipelineStage.EVALUATING)
            readiness = await evaluator.evaluate(project_id)
            await update_stage(doc_id, PipelineStage.COMPLETED)

    except Exception as e:
        await update_stage(doc_id, PipelineStage.FAILED, error=str(e))
        raise
```

**Recovery:** When pipeline fails at Stage 3, admin or automatic retry resumes from Stage 3 (RAGFlow parsing not repeated). Checkpoints saved to PostgreSQL.

**User sees:**
```
Meeting-4-notes.pdf    ████████░░ Extracting facts... (Stage 2/4)
Client-email-thread.eml  ██████████ Completed (12 facts, 0 contradictions)
API-documentation.pdf    ██░░░░░░░░ Queued (2 ahead)
```

### Problem: What If RAGFlow or Mem0 Goes Down?

### Solution: Health Checks + Circuit Breaker

```python
# services/health.py

class ServiceHealth:
    """Circuit breaker pattern for external services."""

    def __init__(self, service_name: str, failure_threshold: int = 3,
                 recovery_timeout: int = 60):
        self.service_name = service_name
        self.failures = 0
        self.threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.state = "closed"  # closed (normal) | open (failing) | half-open (testing)
        self.last_failure = None

    async def call(self, func, *args, **kwargs):
        if self.state == "open":
            if time.time() - self.last_failure > self.recovery_timeout:
                self.state = "half-open"  # Try one request
            else:
                raise ServiceUnavailable(f"{self.service_name} is down. Retry in {self.remaining}s")

        try:
            result = await func(*args, **kwargs)
            self.failures = 0
            self.state = "closed"
            return result
        except Exception as e:
            self.failures += 1
            self.last_failure = time.time()
            if self.failures >= self.threshold:
                self.state = "open"
            raise

# Usage
ragflow_health = ServiceHealth("ragflow", failure_threshold=3, recovery_timeout=60)
result = await ragflow_health.call(ragflow.parse, doc)
```

**Dashboard shows service status:**
```
Services:  RAGFlow ● Online    Mem0 ● Online    Claude API ● Online
           RAGFlow ● Degraded  Mem0 ● Offline   Claude API ● Online
```

---

## 3. Zone 2: Skill Stability

### Problem: Skills Take 10-60 Seconds

`/generate-docs` might take 30-60 seconds. HTTP timeout. User retries. Double cost.

### Solution: Streaming + Async with WebSocket

```python
# api/skills.py

@app.post("/projects/{project_id}/skills/{skill_name}")
async def invoke_skill(project_id: str, skill_name: str, request: SkillRequest):
    """Start skill execution. Returns job_id for tracking."""
    job_id = str(uuid4())

    # Queue the skill job
    await redis.set(f"skill:{job_id}", json.dumps({
        "status": "running",
        "project_id": project_id,
        "skill_name": skill_name,
        "started_at": datetime.utcnow().isoformat(),
    }))

    # Run in background
    background_tasks.add_task(run_skill_job, job_id, project_id, skill_name, request)

    return {"job_id": job_id, "status": "running"}


@app.get("/skills/jobs/{job_id}")
async def get_skill_status(job_id: str):
    """Poll for skill completion."""
    job = json.loads(await redis.get(f"skill:{job_id}"))
    return job


@app.websocket("/ws/projects/{project_id}")
async def project_websocket(websocket: WebSocket, project_id: str):
    """Real-time updates for a project."""
    await websocket.accept()
    pubsub = redis.pubsub()
    await pubsub.subscribe(f"project:{project_id}:events")

    async for message in pubsub.listen():
        await websocket.send_json(message["data"])
```

**For streaming skill output (e.g., /generate-docs):**

```python
@app.post("/projects/{project_id}/skills/{skill_name}/stream")
async def invoke_skill_stream(project_id: str, skill_name: str, request: SkillRequest):
    """Stream skill output via Server-Sent Events."""

    async def event_generator():
        async for partial in skill_runner.run_streaming(project_id, skill_name, request):
            yield {"event": "partial", "data": json.dumps(partial.dict())}
        yield {"event": "complete", "data": ""}

    return EventSourceResponse(event_generator())
```

### Problem: Skill Reads Stale Data (Pipeline Running)

PO invokes `/gaps` while a new document is being processed. The skill doesn't see the new facts yet.

### Solution: Pipeline-Aware Skill Execution

```python
# skills/runner.py

async def run(self, project_id: str, skill_name: str, ...) -> SkillResult:
    # Check if pipeline is currently processing
    pending_docs = await self.db.get_pending_documents(project_id)

    if pending_docs:
        # Warn the user, don't block
        warning = f"⚠️ {len(pending_docs)} document(s) still processing. " \
                  f"Results may not include: {', '.join(d.filename for d in pending_docs)}"
    else:
        warning = None

    result = await self._execute_skill(project_id, skill_name, ...)
    result.pipeline_warning = warning

    return result
```

**User sees:**
```
Gap Analysis Results
⚠️ 1 document still processing: API-documentation.pdf
   Results may change after processing completes.

Readiness: 72%
[... rest of gap analysis ...]
```

### Problem: Claude API Rate Limits

5 POs on different projects all invoke skills. Claude API has rate limits (tokens per minute, requests per minute).

### Solution: Rate Limiter with Fair Queuing

```python
# services/rate_limiter.py

class ClaudeRateLimiter:
    """Fair rate limiting across all projects."""

    def __init__(self, max_rpm: int = 50, max_tpm: int = 100000):
        self.semaphore = asyncio.Semaphore(max_rpm)
        self.token_bucket = TokenBucket(max_tpm, refill_rate=max_tpm / 60)

    async def acquire(self, estimated_tokens: int = 5000):
        """Wait for rate limit capacity."""
        async with self.semaphore:
            await self.token_bucket.consume(estimated_tokens)

    async def call_claude(self, **kwargs):
        estimated = estimate_tokens(kwargs.get("messages", []))
        await self.acquire(estimated)
        return await self.instructor.create(**kwargs)
```

**Pipeline calls get lower priority than skill calls** (user is waiting for skills):

```python
class PriorityQueue:
    SKILL = 1      # User waiting — high priority
    PIPELINE = 2   # Background — can wait
```

---

## 4. Zone 3: Multi-User Collaboration

### Problem: Multiple Users Editing Same Project

PO-1 marks control point as N/A. PO-2 is looking at the same control point and doesn't see the change.

### Solution: WebSocket Event Bus + Optimistic Locking

```python
# Real-time events via WebSocket
class ProjectEventBus:
    """Pub-sub for project-level events."""

    async def publish(self, project_id: str, event: dict):
        """Broadcast event to all connected users."""
        await redis.publish(f"project:{project_id}:events", json.dumps({
            "type": event["type"],
            "data": event["data"],
            "user_id": event["user_id"],
            "timestamp": datetime.utcnow().isoformat(),
        }))

# Events that trigger real-time updates:
EVENTS = {
    "document.uploaded": "New document uploaded",
    "document.processed": "Document processing complete",
    "pipeline.stage_changed": "Pipeline stage update",
    "control_point.updated": "Control point status changed",
    "contradiction.found": "New contradiction detected",
    "contradiction.resolved": "Contradiction resolved",
    "readiness.changed": "Readiness score updated",
    "skill.started": "Skill invocation started",
    "skill.completed": "Skill results available",
}
```

**Optimistic locking for control points:**

```python
# api/control_points.py

@app.put("/projects/{project_id}/control-points/{cp_id}")
async def update_control_point(project_id: str, cp_id: str, update: ControlPointUpdate):
    """Update control point with optimistic locking."""

    # Read current version
    cp = await db.get_control_point(cp_id)

    if cp.version != update.expected_version:
        # Another user modified it since this user loaded it
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": f"Control point was modified by {cp.last_modified_by} at {cp.updated_at}",
                "current_version": cp.version,
                "current_value": cp.dict(),
            }
        )

    # Apply update
    await db.update_control_point(cp_id, update, version=cp.version + 1)

    # Broadcast to other users
    await event_bus.publish(project_id, {
        "type": "control_point.updated",
        "data": {"cp_id": cp_id, "new_status": update.status},
        "user_id": update.user_id,
    })
```

**Frontend handles conflicts:**
```
⚠️ This control point was updated by PO-2 just now.
Current: ✅ Covered (was: ⚠️ Partial)

[Accept their change] [Override with mine] [View diff]
```

### Problem: Chat Context Per User vs Shared Project Knowledge

User A asks "What do we know about auth?" — their chat should see latest project state.
User B asked the same thing 2 hours ago — their cached response is stale.

### Solution: Conversations Are Per-User, Knowledge Is Shared

```python
# models/database.py

class Conversation(Base):
    """Per-user chat session."""
    __tablename__ = "conversations"

    id = Column(UUID, primary_key=True)
    project_id = Column(UUID, ForeignKey("projects.id"))
    user_id = Column(UUID, ForeignKey("users.id"))
    title = Column(String)
    messages = Column(JSONB, default=[])     # User's chat history
    created_at = Column(DateTime)
    updated_at = Column(DateTime)

# Chat always queries LIVE project data, not cached
@app.post("/projects/{project_id}/chat")
async def chat(project_id: str, user_id: str, message: ChatMessage):
    """Chat with project knowledge. Always queries live data."""

    # 1. Get user's conversation history
    conversation = await db.get_or_create_conversation(project_id, user_id)

    # 2. Classify the question (which skill or knowledge layer?)
    intent = await classify_intent(message.text)

    # 3. Build context from LIVE knowledge layers (not cached)
    context = await preamble.build(project_id, intent)

    # 4. Query appropriate layers
    if intent in ("search", "what_said"):
        results = await ragflow.search(project_id, message.text)
    elif intent in ("status", "covered"):
        results = await mem0.search(message.text, user_id=project_id)
    elif intent in ("who", "relationship"):
        results = await mem0.graph_search(message.text, user_id=project_id)
    else:
        results = await search_all_layers(project_id, message.text)

    # 5. Generate response
    response = await instructor.client.chat.completions.create(
        messages=[
            {"role": "system", "content": CHAT_SYSTEM_PROMPT + context},
            *conversation.messages[-10:],  # Last 10 messages for continuity
            {"role": "user", "content": message.text + f"\n\nRelevant data:\n{results}"},
        ],
    )

    # 6. Save to conversation
    await db.append_message(conversation.id, message.text, response.content)

    return {"response": response.content, "sources": results.sources}
```

**Key principle:** Chat history is per-user (personal context). Knowledge queries are always live (shared project state).

---

## 5. Activity Feed and Audit Trail

### Problem: "What happened while I was away?"

PO-1 was offline for 2 days. 3 documents uploaded, 5 control points changed, 2 contradictions found. They need to catch up.

### Solution: Activity Feed

```python
class ActivityLog(Base):
    """Project-level activity feed."""
    __tablename__ = "activity_log"

    id = Column(UUID, primary_key=True)
    project_id = Column(UUID, ForeignKey("projects.id"))
    user_id = Column(UUID, ForeignKey("users.id"), nullable=True)  # None for system actions
    action = Column(String)        # document.uploaded, skill.completed, etc.
    summary = Column(String)       # Human-readable: "PO-2 uploaded Meeting-5-notes.pdf"
    details = Column(JSONB)        # Full structured data
    created_at = Column(DateTime)
```

**Dashboard shows:**
```
Activity (last 48 hours)
─────────────────────────
• 2h ago  PO-2 uploaded Meeting-5-notes.pdf
          → 8 facts extracted, 1 contradiction found
          → Readiness: 72% → 78%

• 5h ago  System processed Client-email-thread.eml
          → 3 facts extracted, 0 contradictions
          → Readiness: 68% → 72%

• 1d ago  PO-2 ran /gaps
          → AUTO-RESOLVED: 2 items from existing data
          → ASK-CLIENT: 3 questions generated

• 1d ago  PO-2 resolved contradiction: hosting (Azure confirmed)
          → Control point "Hosting requirements" → ✅ Covered
```

---

## 6. Concurrency-Safe Control Point Evaluation

### Problem: Two pipeline runs evaluate control points simultaneously

Document A finishes processing. Document B finishes 2 seconds later. Both trigger control point evaluation. Results overwrite each other.

### Solution: Evaluation Lock + Incremental Updates

```python
# services/control_points.py

class ControlPointEvaluator:
    async def evaluate(self, project_id: str, trigger: str = "pipeline") -> ReadinessScore:
        """Thread-safe control point evaluation."""

        # Acquire evaluation lock (only one evaluation at a time per project)
        async with self._evaluation_lock(project_id, timeout=30):

            # Get all control points
            control_points = await self.db.get_project_control_points(project_id)

            # Get all facts from Mem0
            facts = await self.mem0.get_all(user_id=project_id)

            # Evaluate each control point
            for cp in control_points:
                new_status, confidence, evidence = await self._evaluate_single(cp, facts)

                if cp.status != new_status or cp.confidence != confidence:
                    await self.db.update_control_point_status(
                        cp.id,
                        status=new_status,
                        confidence=confidence,
                        evidence_fact_ids=evidence,
                        last_evaluated=datetime.utcnow(),
                    )

                    # Broadcast change
                    await self.event_bus.publish(project_id, {
                        "type": "control_point.updated",
                        "data": {
                            "cp_id": str(cp.id),
                            "old_status": cp.status,
                            "new_status": new_status,
                            "confidence": confidence,
                        },
                        "user_id": None,  # System action
                    })

            # Calculate and save readiness score
            readiness = self._calculate_readiness(control_points)
            await self.db.save_readiness(project_id, readiness, triggered_by=trigger)

            # Broadcast readiness change
            await self.event_bus.publish(project_id, {
                "type": "readiness.changed",
                "data": {"score": readiness.score, "previous": readiness.previous_score},
                "user_id": None,
            })

            return readiness

    async def _evaluation_lock(self, project_id: str, timeout: int = 30):
        """Redis-based distributed lock for evaluation."""
        lock = self.redis.lock(f"eval_lock:{project_id}", timeout=timeout)
        return lock
```

---

## 7. Database Schema Additions (for Concurrency)

```sql
-- Add version column for optimistic locking
ALTER TABLE project_control_points ADD COLUMN version INT DEFAULT 1;
ALTER TABLE project_control_points ADD COLUMN last_modified_by UUID;

-- Activity log
CREATE TABLE activity_log (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    user_id UUID REFERENCES users(id),
    action VARCHAR NOT NULL,
    summary TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_activity_project_time ON activity_log(project_id, created_at DESC);

-- Conversations (per-user chat)
CREATE TABLE conversations (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    user_id UUID REFERENCES users(id),
    title VARCHAR,
    messages JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, user_id)  -- One active conversation per user per project
);

-- Pipeline checkpoints
CREATE TABLE pipeline_checkpoints (
    id UUID PRIMARY KEY,
    document_id UUID REFERENCES documents(id),
    stage VARCHAR NOT NULL,
    data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add pipeline stage tracking to documents
ALTER TABLE documents ADD COLUMN pipeline_stage VARCHAR DEFAULT 'queued';
ALTER TABLE documents ADD COLUMN pipeline_error TEXT;
ALTER TABLE documents ADD COLUMN pipeline_started_at TIMESTAMP;
ALTER TABLE documents ADD COLUMN pipeline_completed_at TIMESTAMP;

-- User sessions (for WebSocket tracking)
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    project_id UUID REFERENCES projects(id),
    connected_at TIMESTAMP DEFAULT NOW(),
    last_active TIMESTAMP DEFAULT NOW()
);
```

---

## 8. Caching Strategy

| Data | Cache? | TTL | Invalidation |
|------|--------|-----|-------------|
| Readiness score | Yes (Redis) | Until pipeline completes | Pipeline evaluation |
| Control points summary | Yes (Redis) | 60s | Any control point update |
| Project metadata | Yes (Redis) | 300s | Project update API |
| Mem0 fact count | Yes (Redis) | Until pipeline completes | Pipeline store stage |
| RAGFlow document list | Yes (Redis) | 60s | Document upload |
| Skill results | Yes (PostgreSQL) | No TTL | Re-run overwrites |
| Chat conversation | No | — | Always live |
| Search results | No | — | Always live (data changes) |
| Learning store | Yes (in-memory) | 600s | Skill completion |

```python
# services/cache.py

class ProjectCache:
    """Redis-based cache with event-driven invalidation."""

    async def get_readiness(self, project_id: str) -> Optional[ReadinessScore]:
        cached = await self.redis.get(f"readiness:{project_id}")
        return ReadinessScore.parse_raw(cached) if cached else None

    async def set_readiness(self, project_id: str, score: ReadinessScore):
        await self.redis.set(f"readiness:{project_id}", score.json())

    async def invalidate_project(self, project_id: str):
        """Invalidate all caches for a project."""
        keys = await self.redis.keys(f"*:{project_id}")
        if keys:
            await self.redis.delete(*keys)
```

---

## 9. Error Handling Summary

| Failure | Impact | Recovery |
|---------|--------|----------|
| RAGFlow down | Upload fails | Circuit breaker, retry after 60s, queue documents |
| Mem0 down | Facts not stored | Pipeline pauses at Stage 3, retry from checkpoint |
| Neo4j down | Graph not updated | Mem0 falls back to vector-only (graceful degradation) |
| Claude API down | Skills fail, extraction fails | Instructor supports failover to GPT-4o |
| Claude rate limit | Slow responses | Fair queue with priority (skills > pipeline) |
| Redis down | No queuing, no cache | PostgreSQL fallback for queue, no cache (slower) |
| PostgreSQL down | Everything fails | This is a hard dependency. Standard HA setup. |
| WebSocket disconnect | User misses events | Reconnect + fetch activity log since last seen |
| Pipeline timeout (>5min) | Document stuck | Auto-fail after timeout, admin retry |
| Skill timeout (>120s) | User waiting | Return partial result + "still processing" |

---

## 10. Monitoring and Observability

### Key Metrics

```python
# Instrument with Prometheus / OpenTelemetry

METRICS = {
    # Pipeline health
    "pipeline_documents_processed_total": Counter,
    "pipeline_documents_failed_total": Counter,
    "pipeline_stage_duration_seconds": Histogram,
    "pipeline_queue_depth": Gauge,

    # Skill health
    "skill_invocations_total": Counter,           # by skill_name
    "skill_duration_seconds": Histogram,          # by skill_name
    "skill_failures_total": Counter,

    # LLM usage
    "llm_calls_total": Counter,                   # by model, purpose
    "llm_tokens_total": Counter,                  # by model, direction (input/output)
    "llm_cost_dollars": Counter,                  # by model
    "llm_retries_total": Counter,                 # validation retries

    # External services
    "ragflow_request_duration_seconds": Histogram,
    "mem0_request_duration_seconds": Histogram,
    "service_circuit_breaker_state": Gauge,       # 0=closed, 1=open

    # User activity
    "active_websocket_connections": Gauge,        # by project
    "concurrent_users_per_project": Gauge,
}
```

### Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| Pipeline stuck | Document in "processing" > 5 min | Auto-fail, notify admin |
| High failure rate | > 3 pipeline failures in 10 min | Check external services |
| LLM cost spike | Daily cost > $50 | Notify admin, check for loops |
| Service down | Circuit breaker open > 5 min | Page oncall |
| Queue backup | > 20 documents queued | Scale workers |

---

## 11. Scaling Considerations

### Current Scale (MVP)

- 5-10 active projects
- 2-5 users per project
- 20-30 documents per project
- ~$2-5 LLM cost per project
- Single Docker Compose deployment

### Growth Scale (50+ projects)

| Component | Scaling Strategy |
|-----------|-----------------|
| Backend | Multiple FastAPI workers (uvicorn --workers 4) |
| Pipeline workers | Multiple workers (one per CPU core) |
| Redis | Single instance sufficient to ~1000 projects |
| PostgreSQL | Standard HA (primary + replica) |
| RAGFlow | Horizontal: add ES nodes for search, separate parse workers |
| Mem0/Qdrant | Horizontal: Qdrant supports distributed mode |
| Neo4j | Vertical first, then read replicas |
| WebSockets | Sticky sessions via load balancer, Redis pub/sub for cross-instance |

### What Doesn't Scale (and That's OK for Now)

- Per-project sequential pipeline (could add parallel stages later)
- Single Redis instance (fine to 10K+ ops/sec)
- Activity log in PostgreSQL (partition by month if it grows)

---

## 12. Revised Architecture Diagram (with Concurrency)

```
┌──────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                        │
│                                                                   │
│  Dashboard ←─── WebSocket ───→ Real-time updates                 │
│  Chat (per-user conversations)                                    │
│  Document viewer + upload                                         │
│  Skill invocation (streaming SSE)                                 │
│  Activity feed                                                    │
│  Conflict resolution UI                                           │
└──────────┬────────────────┬──────────────────┬───────────────────┘
           │ REST           │ WebSocket         │ SSE (streaming)
┌──────────▼────────────────▼──────────────────▼───────────────────┐
│                      BACKEND (FastAPI)                             │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │  Pipeline    │  │  Skills      │  │  Real-time              │ │
│  │  (async     │  │  (streaming  │  │  (WebSocket hub)        │ │
│  │  via Redis  │  │  via SSE)    │  │                         │ │
│  │  queue)     │  │              │  │  Event bus (Redis pub/  │ │
│  │             │  │  Rate-limited│  │  sub) → broadcast to    │ │
│  │  Sequential │  │  via Claude  │  │  connected users        │ │
│  │  per-project│  │  rate limiter│  │                         │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────────────────┘ │
│         │                │                 │                     │
│  ┌──────▼─────────────────▼─────────────────▼──────────────────┐ │
│  │  Shared Services                                             │ │
│  │  + ProjectCache (Redis)                                      │ │
│  │  + ProjectEventBus (Redis pub/sub)                           │ │
│  │  + ClaudeRateLimiter (semaphore + token bucket)              │ │
│  │  + ServiceHealth (circuit breakers)                          │ │
│  │  + Optimistic locking (version columns)                      │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## 13. Summary: What Changed from research/20

| Concern | Solution Added |
|---------|---------------|
| Concurrent uploads | Per-project sequential queue (Redis) |
| Pipeline failures | Stage checkpoints + retry from last stage |
| Service downtime | Circuit breaker pattern |
| Skill takes too long | Streaming (SSE) + background job |
| Stale skill data | Pipeline-aware warning |
| Rate limits | Fair queue with priority (skills > pipeline) |
| Multi-user edits | Optimistic locking (version column) |
| Real-time updates | WebSocket event bus (Redis pub/sub) |
| "What happened while I was away?" | Activity feed |
| Chat per-user vs shared knowledge | Conversations per-user, queries always live |
| Control point race conditions | Redis distributed lock |
| Caching | Redis with event-driven invalidation |
| Monitoring | Prometheus metrics + alerts |
