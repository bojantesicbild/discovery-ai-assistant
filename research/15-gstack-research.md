# 15 — gstack Research (Garry Tan's Software Factory)

> **Date:** 2026-03-31
> **Purpose:** Extract patterns and approaches from gstack applicable to our Discovery AI Assistant
>
> **Repo:** [garrytan/gstack](https://github.com/garrytan/gstack) — Virtual engineering team via Claude Code
> **Version:** v0.15.0.0 | **License:** MIT | **Author:** Garry Tan (President & CEO of Y Combinator)

---

## 1. What Is gstack?

gstack turns Claude Code into a **virtual engineering team of 23+ specialists** accessible via slash commands. It's not a copilot — it's a structured process that mirrors how a real startup engineering team operates.

Garry Tan (ex-Palantir engineer, YC president) claims to ship 10,000-20,000 lines of production code per day, part-time, while running YC full-time — 600,000+ lines in 60 days across multiple projects.

**Core insight:** Each skill is not a function call — it's a **persona with a worldview**. `/office-hours` thinks like a YC partner. `/review` thinks like a paranoid staff engineer. `/cso` thinks like a CISO.

---

## 2. Architecture

### Two Halves

**Half 1: SKILL.md files (the "team")**
Each specialist is a Markdown file containing structured prompts, decision trees, and bash command sequences. The AI agent follows these step-by-step. **Prompt engineering IS the product.**

**Half 2: Persistent headless Chromium browser daemon**
Gives the AI agent "eyes" via a Bun-compiled HTTP server talking to Chromium over CDP (Chrome DevTools Protocol). Sub-100ms latency. Persistent state — login once, stay logged in.

```
Claude Code → CLI binary (Bun) → HTTP POST → Server (Bun.serve) → CDP → Chromium (headless)
```

### The Sprint Loop

```
/office-hours → /plan-ceo-review → /plan-eng-review → /plan-design-review
      ↓                ↓                  ↓                    ↓
  Reframe the     Challenge scope    Lock architecture    Rate design 0-10
  problem         Find 10-star       ASCII diagrams       AI slop detection
      ↓                ↓                  ↓                    ↓
  [Design Doc] → [Reviewed Plan] → [Eng Spec] → [Implementation]
                                                        ↓
  /review → /qa → /ship → /land-and-deploy → /canary → /retro
     ↓         ↓       ↓          ↓               ↓        ↓
  Auto-fix   Browser  Tests +   Merge +        Monitor   Analyze
  + ASK      test     PR        deploy         errors    patterns
```

### Template-as-Code System

SKILL.md files are **generated** from `.tmpl` templates via `gen-skill-docs.ts`. The generator reads command metadata directly from source code. If a command exists in code, it appears in docs. If not, it cannot appear.

Key placeholders injected into every skill:
- `{{PREAMBLE}}` — Update check, session counting, learning system, AskUserQuestion format
- `{{BROWSE_SETUP}}` — Browser binary discovery
- `{{QA_METHODOLOGY}}` — Shared QA logic
- `{{DESIGN_METHODOLOGY}}` — Shared design audit
- `{{LEARNINGS_SEARCH}}` / `{{LEARNINGS_LOG}}` — Persistent memory hooks

---

## 3. The 31 Skills (by Sprint Phase)

| Phase | Skills |
|-------|--------|
| **Think** | `/office-hours` (6 forcing questions, premise challenge, 2-3 alternatives) |
| **Plan** | `/plan-ceo-review` (4 scope modes), `/plan-eng-review` (ASCII diagrams, test matrix), `/plan-design-review` (0-10 ratings), `/autoplan` (automated pipeline) |
| **Design** | `/design-consultation` (full design system), `/design-shotgun` (multi-variant), `/design-html` (production HTML) |
| **Review** | `/review` (auto-fix + ASK), `/codex` (cross-model second opinion), `/cso` (OWASP + STRIDE security) |
| **Test** | `/qa` (real browser, finds + fixes bugs, generates regression tests), `/qa-only` (report only), `/benchmark` (perf baselines) |
| **Ship** | `/ship` (tests + coverage + PR), `/land-and-deploy` (merge + deploy + verify), `/canary` (post-deploy monitoring) |
| **Reflect** | `/retro` (per-person breakdowns, shipping streaks), `/document-release` (stale doc detection), `/learn` (persistent memory) |
| **Safety** | `/careful` (PreToolUse hook for destructive commands), `/freeze` (directory edit lock), `/guard` (both), `/investigate` (auto-freezes to module) |

---

## 4. The Secret Sauce — 12 Key Patterns

### Secret 1: Skills are Roles, Not Tools

Each skill is a **persona with a worldview**, not a function. This constrains the AI into a specific cognitive mode:

| Skill | Persona |
|-------|---------|
| `/office-hours` | YC partner doing product diagnostics |
| `/review` | Paranoid staff engineer |
| `/cso` | Chief Information Security Officer |
| `/plan-ceo-review` | CEO doing scope review |
| `/qa` | Meticulous QA engineer with a real browser |

**For our Discovery Assistant:** Each of our 7 agents should have a persona, not just a task:
- Intake Agent = "Experienced PO doing first client call"
- Analysis Agent = "Senior analyst cross-referencing intelligence"
- Gap Detection Agent = "Paranoid project manager who's seen projects fail from missing info"
- Control Point Agent = "Auditor checking compliance"

---

### Secret 2: The Universal Preamble

Every skill inherits `{{PREAMBLE}}` — a pre-flight block that:
1. Checks for updates
2. Counts active sessions (3+ triggers "ELI16 mode" for context re-grounding)
3. Injects AskUserQuestion format
4. Activates "Search Before Building" philosophy
5. Enables operational self-improvement

**For our Discovery Assistant:** Create a universal preamble for all agents:
- Which agents have already run on this matter?
- What did they find?
- Knowledge layer routing (check RAGFlow, Mem0, Neo4j in order)
- Standard question format for PO interaction
- Matter-specific learnings

---

### Secret 3: Fix-First Review (AUTO-FIX vs ASK)

`/review` doesn't just report issues — it classifies them:
- **AUTO-FIX**: Mechanical issues, apply directly
- **ASK**: Needs human judgment, present with RECOMMENDATION

Eliminates the "review found 15 issues, now what?" problem.

**For our Discovery Assistant:** Gap Detection Agent should classify gaps:
- **AUTO-RESOLVE**: Can be filled from existing knowledge layers (another doc already has this info)
- **ASK**: Needs client input, present with suggested question + priority

This is a significant improvement over just listing gaps.

---

### Secret 4: The Generation-Verification Loop

From ETHOS.md: "AI generates recommendations. The user verifies and decides. The AI never skips the verification step because it's confident."

Codified via AskUserQuestion with lettered options and a RECOMMENDATION:
```
CONTEXT: [what the agent found]
QUESTION: [what needs deciding]
RECOMMENDATION: Choose B because [evidence-based reason]
A) Option A — [trade-off]
B) Option B — [trade-off]
C) Option C — [trade-off]
```

**For our Discovery Assistant:** Every agent decision that affects the PO should follow this format. The PO should never see "I've determined that..." — they should see options with a recommendation.

---

### Secret 5: Persistent Cross-Session Learning

`/learn` + `{{LEARNINGS_SEARCH}}`/`{{LEARNINGS_LOG}}` create a feedback loop:
- Each session's failures, patterns, and discoveries are logged to a per-project JSONL file
- Searched at the start of the next session
- The agent gets smarter on YOUR codebase over time

**For our Discovery Assistant:**
- **Per-matter learnings**: "Client X prefers email over meetings," "Domain Y has regulatory requirement Z often missed"
- **Cross-matter learnings**: "Clients in industry X consistently forget compliance requirement Y"
- These compound over time, making each new discovery project faster

---

### Secret 6: The Sprint as a DAG (Skills Feed Each Other)

`/office-hours` writes a design doc that `/plan-ceo-review` reads. `/review` catches bugs that `/ship` verifies are fixed. Nothing falls through because **every step knows what came before it.**

**For our Discovery Assistant:**
```
Intake output → Analysis input
Analysis output → Gap Detection input
Gap Detection output → Meeting Prep input
Meeting results → back to Intake → loop

Each agent reads the previous agent's structured output.
```

---

### Secret 7: "Boil the Lake" Philosophy

When AI makes the marginal cost of completeness near-zero, always do the complete thing.
- A "lake" (100% coverage of a control point checklist) is boilable
- An "ocean" (rewrite the entire discovery process) is not
- **Boil lakes. Flag oceans.**

**For our Discovery Assistant:** When checking control points, don't spot-check — check ALL of them against ALL knowledge layers. The cost is just tokens, and completeness prevents the #1 discovery failure: missing something.

---

### Secret 8: Three Layers of Knowledge

Before building anything: (1) Tried-and-true, (2) New-and-popular, (3) First-principles.
Prize first-principles above all. When first-principles reasoning contradicts conventional wisdom, name the "eureka moment" and log it.

**Direct mapping to our architecture:**

| gstack Layer | Our Layer | Purpose |
|-------------|-----------|---------|
| Layer 1 (tried-and-true) | **Document Search (RAGFlow)** | What does the documentation say? |
| Layer 2 (new-and-popular) | **Fact Store (Mem0)** | What have we learned in conversations? |
| Layer 3 (first-principles) | **Entity Graph (Mem0+Neo4j)** | What relationships and patterns emerge? |

---

### Secret 9: Multi-AI Cross-Validation

`/codex` gets an independent review from a completely different AI model (OpenAI Codex). Cross-reference shows:
- Overlapping findings = high confidence
- Unique to one model = needs human review

**For our Discovery Assistant:** Run Analysis Agent (primary), then Role Simulation Agent (adversarial/different persona) on the same data. Where they agree = high confidence. Where they disagree = flag for PO review.

---

### Secret 10: Real Browser QA That Fixes What It Finds

`/qa` opens a real Chromium browser, clicks through flows, finds bugs, makes atomic commits to fix them, generates regression tests, and re-verifies. Garry calls this the "massive unlock" that let him go from 6 to 12 parallel workers.

**For our Discovery Assistant:** The pattern of "find problem → fix it → verify fix → generate test" maps to our ingestion pipeline:
- Find contradiction → flag it → suggest resolution → verify resolution with PO → log the pattern for future matters

---

### Secret 11: Safety Guardrails via Hooks

`/careful` uses PreToolUse hooks — bash scripts that run before every tool call, pattern-matching against destructive commands. `/freeze` blocks edits outside specified directories.

**For our Discovery Assistant:** Build guardrails into the orchestration:
- Prevent agents from marking control points as COVERED without evidence
- Prevent Document Generator from producing output when readiness < threshold
- Prevent any agent from silently dropping contradictions

---

### Secret 12: Anti-Sycophancy Directives

Skills explicitly ban weak phrases like "interesting approach" and "could work." Agents must push back on user framing when they disagree.

**For our Discovery Assistant:** Our agents should push back when:
- PO says "I think we're ready" but readiness score says otherwise
- PO wants to skip a control point category that's historically important
- PO interprets a vague client statement as a confirmed requirement

---

## 5. Anti-Patterns gstack Prevents

| Anti-Pattern | Prevention Mechanism | Our Equivalent |
|-------------|---------------------|----------------|
| AI sycophancy | Explicit ban on weak phrases + push-back requirement | Agents challenge PO assumptions |
| Building without searching | "Search Before Building" in every preamble | Query all 3 layers before concluding |
| Review fatigue | Fix-First (AUTO-FIX/ASK) | Gap classification (AUTO-RESOLVE/ASK) |
| Stale documentation | `/document-release` cross-refs diffs vs docs | Track when facts change, update docs |
| Scope creep | 4 explicit scope modes in plan review | Control point templates prevent scope drift |
| AI "slop" | Explicit anti-pattern lists in design skills | Anti-rationalization tables per agent |
| Fixing symptoms not causes | `/investigate` Iron Law: root cause first | Analysis Agent must cite evidence, not guess |
| Cookie-cutter output | Font blacklists, design anti-patterns | Template variety per project type |

---

## 6. Prompt Engineering Techniques

| # | Technique | How gstack Uses It | How We Apply It |
|---|-----------|-------------------|----------------|
| 1 | **Role assignment with worldview** | "You are a senior product designer with strong opinions" | "You are a paranoid project manager who's seen projects fail from missing info" |
| 2 | **Structured decision trees in prose** | "1. If X, do Y. 2. Otherwise, do Z." | Agent routing: "If fact exists in Mem0 → COVERED. If only chunks in RAGFlow → PARTIAL." |
| 3 | **AskUserQuestion standardization** | Context + Question + RECOMMENDATION + lettered options | Every PO interaction follows this format |
| 4 | **Anti-sycophancy directives** | Ban weak phrases, require push-back | Agents challenge PO when evidence conflicts with their assessment |
| 5 | **Confidence gating** | CSO requires 8/10 confidence before reporting | Control Point Agent requires evidence threshold before marking COVERED |
| 6 | **Verification of claims** | "If you claim 'handled elsewhere' — cite the code" | "If you claim 'covered' — cite the Mem0 fact ID + source doc" |
| 7 | **Three-layer synthesis** | Layer 1/2/3 analysis for every research phase | Check RAGFlow → Mem0 → Neo4j for every control point |
| 8 | **Eureka moment naming** | Name when first-principles contradicts conventional wisdom | Log when analysis reveals something unexpected about the project |
| 9 | **ELI16 mode** | 3+ concurrent sessions → re-ground context | Long discovery projects → re-ground PO on current state |
| 10 | **Escape hatches** | Allow 2 skips for impatient users | PO can override control point requirements with justification |
| 11 | **Self-contained code blocks** | Each bash block works independently | Each agent invocation works independently with focused context |

---

## 7. Concrete Improvements for Our Pipeline

### 7.1 Adopt the Preamble Pattern (P0 — immediate)

Create a universal preamble for all 7 agents:

```markdown
## PREAMBLE — Discovery AI Assistant

### Session Context
- Matter: {{matter_name}}
- Current readiness: {{readiness_percentage}}%
- Agents that have run this session: {{agent_log}}
- Previous findings: {{key_findings_summary}}

### Knowledge Layer Routing
Before answering any question:
1. Check Mem0 facts first (structured knowledge — fastest, most reliable)
2. Check Mem0 graph (entity relationships — for connection queries)
3. Check RAGFlow (document search — for full paragraphs and context)

### Question Format
When you need PO input, use this format:
CONTEXT: [what you found and why it matters]
QUESTION: [the specific decision needed]
RECOMMENDATION: Choose [X] because [evidence-based reason]
A) [Option] — [trade-off]
B) [Option] — [trade-off]
C) [Option] — [trade-off]

### Learnings
Search matter learnings before starting: {{learnings_search}}
Log significant findings when done: {{learnings_log}}
```

### 7.2 Adopt Fix-First for Gap Detection (P0 — immediate)

Redesign Gap Detection Agent output:

```markdown
## Gap Analysis — {{matter_name}}

### AUTO-RESOLVED (filled from existing knowledge)
- ✅ Hosting requirements — Found in Meeting 3 notes (Mem0 fact #47: "Azure, single region")
- ✅ Auth method — Found in email thread (Mem0 fact #52: "Microsoft SSO")

### ASK CLIENT (needs human input)
- ❓ Budget constraints — No mention in any document
  RECOMMENDED QUESTION: "What is the monthly infrastructure budget for this project?"
  PRIORITY: HIGH (blocks architecture decisions)

- ❓ Data retention policy — Mentioned vaguely in Meeting 2 ("we need to keep data")
  RECOMMENDED QUESTION: "What is the required data retention period? Are there regulatory requirements?"
  PRIORITY: MEDIUM (affects storage architecture)

### ASK PO (needs internal judgment)
- 🔶 MVP scope — Client mentioned 15 features but no prioritization
  RECOMMENDATION: Propose MoSCoW classification in next meeting
```

### 7.3 Adopt Persistent Learning (P1 — near-term)

Per-matter JSONL file:

```json
{"timestamp": "2026-03-15", "type": "pattern", "content": "Client prefers async communication over meetings — send questions via email"}
{"timestamp": "2026-03-18", "type": "contradiction", "content": "Client said 'single tenant' in Meeting 1 but 'multi-tenant' in email. Resolved: multi-tenant. Log: always confirm deployment model explicitly."}
{"timestamp": "2026-03-20", "type": "discovery", "content": "Project requires HIPAA compliance — not mentioned until Meeting 3. Log: for healthcare projects, ask about compliance in Meeting 1."}
```

Cross-matter learnings file:

```json
{"timestamp": "2026-03-20", "type": "cross-project", "industry": "healthcare", "content": "HIPAA compliance is frequently omitted until late in discovery. Add to default control points for healthcare projects."}
```

### 7.4 Adopt Autoplan for Automated Pipelines (P2 — later)

Chain agents automatically, only surfacing "taste decisions" to the PO:

```
Document uploaded →
  [auto] Intake Agent (classify, extract metadata)
  [auto] Analysis Agent (cross-reference, find contradictions)
  [auto] Gap Detection Agent (check control points)
  [auto] Control Point Agent (update readiness score)

  → ONLY surface to PO:
    - New contradictions found
    - Control points that changed status
    - Questions that need client input (ASK items)
    - Readiness score change
```

---

## 8. Implementation Priority

| Priority | Pattern | Impact | Effort |
|----------|---------|--------|--------|
| **P0** | Universal preamble for all agents | High — consistency + learning | Low — prompt engineering |
| **P0** | Fix-First gap classification (AUTO-RESOLVE/ASK) | High — actionable output | Low — prompt engineering |
| **P0** | AskUserQuestion format standardization | High — better PO experience | Low — prompt engineering |
| **P0** | Anti-sycophancy directives | High — honest assessments | Low — prompt engineering |
| **P1** | Persistent per-matter learning | High — compounds over time | Medium — storage + search |
| **P1** | Skills-as-roles (persona per agent) | Medium — better focus | Low — prompt engineering |
| **P1** | Sprint DAG (agents feed each other) | High — no gaps between agents | Medium — orchestration |
| **P2** | Cross-matter learning | High long-term — institutional knowledge | Medium — aggregation logic |
| **P2** | Autoplan (automated agent chains) | Medium — less PO overhead | Medium — pipeline design |
| **P2** | Cross-AI validation | Medium — catches blind spots | Medium — multi-model setup |
| **P3** | Template generation from config | Medium — prevents prompt drift | High — tooling |

---

## 9. Deep Dive: Exact Patterns from Source

### 9.1 ETHOS.md — The Three Principles (Full Detail)

**Principle 1: "Boil the Lake"**
AI makes marginal cost of completeness near-zero. Always do the complete thing.

Compression table from ETHOS.md:

| Task | Human team | AI-assisted | Compression |
|------|-----------|-------------|-------------|
| Boilerplate | 2 days | 15 min | ~100x |
| Test writing | 1 day | 15 min | ~50x |
| Feature implementation | 1 week | 30 min | ~30x |
| Bug fix + regression | 4 hours | 15 min | ~20x |
| Architecture/design | 2 days | 4 hours | ~5x |
| Research/exploration | 1 day | 3 hours | ~3x |

Anti-patterns:
- "Choose B — it covers 90% with less code." (If A is 70 lines more, choose A.)
- "Let's defer tests to a follow-up PR." (Tests are the cheapest lake to boil.)
- "This would take 2 weeks." (Say: "2 weeks human / ~1 hour AI-assisted.")

**Principle 2: "Search Before Building" — Three Knowledge Layers:**
- **Layer 1: Tried-and-true.** Standard patterns, battle-tested. Risk: assuming the obvious is right.
- **Layer 2: New-and-popular.** Blog posts, ecosystem trends. Scrutinize: "Mr. Market is either too fearful or too greedy."
- **Layer 3: First principles.** Original observations from reasoning. "Prize them above everything else."

The "Eureka Moment": Understanding what everyone does and WHY (L1+L2), applying first-principles reasoning (L3), discovering why the conventional approach is wrong. "This is the 11 out of 10."

**Principle 3: "User Sovereignty"**
> "AI models recommend. Users decide. This is the one rule that overrides all others."

References Karpathy's "Iron Man suit" philosophy. Rule: "When you and another model agree on something that changes the user's stated direction — present the recommendation, explain why, state what context you might be missing, and ask. Never act."

---

### 9.2 The Six Forcing Questions (/office-hours)

From the "YC partner diagnostic" skill:

1. **Demand Reality**: "What's the strongest evidence someone actually wants this — not interest, but behavior?"
2. **Status Quo**: "What are users doing right now to solve this badly?"
3. **Desperate Specificity**: "Name the actual human who needs this most. Title? What gets them promoted or fired?"
4. **Narrowest Wedge**: "What's the smallest version worth paying for this week?"
5. **Observation & Surprise**: "Have you watched someone use this? What surprised you?"
6. **Future-Fit**: "In 3 years, does your product become more essential or less?"

**For our Discovery Assistant:** Adapt these for the Intake Agent's first contact with a new project:

1. **Demand Reality**: "What's the strongest evidence this project needs to be built? Not interest — actual business need."
2. **Status Quo**: "How is the client solving this problem today? What's painful about it?"
3. **Desperate Specificity**: "Who is the primary end user? What does their day look like?"
4. **Narrowest Wedge**: "What's the absolute minimum that would deliver value?"
5. **Observation & Surprise**: "What surprised you in client conversations so far?"
6. **Future-Fit**: "In 2 years, does this product become more critical or less?"

---

### 9.3 Fix-First Classification (Exact Criteria)

From `/review` checklist.md:

**AUTO-FIX (agent fixes without asking):**
- Dead code / unused variables
- N+1 queries (missing eager loading)
- Stale comments contradicting code
- Magic numbers → named constants
- Missing LLM output validation
- Version/path mismatches
- Variables assigned but never read
- Inline styles, O(n*m) view lookups

**ASK (needs human judgment):**
- Security concerns (auth, XSS, injection)
- Race conditions
- Design decisions
- Large fixes (>20 lines)
- Enum completeness
- Removing functionality
- Anything changing user-visible behavior

**Rule of thumb**: "If the fix is mechanical and a senior engineer would apply it without discussion, it's AUTO-FIX. If reasonable engineers could disagree about the fix, it's ASK."

**For our Gap Detection Agent — adapted classification:**

**AUTO-RESOLVE (fill from existing data without asking PO):**
- Control point can be answered from another uploaded document
- Fact exists in Mem0 but wasn't linked to this control point
- Entity relationship in graph answers the question
- Information exists but was classified under a different category

**ASK-CLIENT (needs client input):**
- No information exists in any knowledge layer
- Information is vague/ambiguous (status = PARTIAL)
- Contradictory information exists
- Control point requires a decision, not just information

**ASK-PO (needs internal judgment):**
- Control point might not be applicable to this project type
- Priority/weight of a gap is unclear
- Multiple valid interpretations of existing information

---

### 9.4 Confidence Gating Thresholds

From `/review` and `/cso`:

| Confidence | Meaning | Action |
|-----------|---------|--------|
| 9-10 | Verified by reading specific evidence | Show normally |
| 7-8 | High confidence pattern match | Show normally |
| 5-6 | Moderate, could be false positive | Show with caveat |
| 3-4 | Low confidence | Suppress to appendix only |
| 1-2 | Speculation | Report only if severity is CRITICAL |

Format: `[SEVERITY] (confidence: N/10) source:location — description`

**For our Control Point Agent:** Apply confidence gating to control point evaluation:

| Confidence | Control Point Status | Evidence Requirement |
|-----------|---------------------|---------------------|
| 9-10 | ✅ COVERED | Explicit fact in Mem0, confirmed by client, with source doc |
| 7-8 | ✅ COVERED (with caveat) | Strong evidence but from inference, not explicit statement |
| 5-6 | ⚠️ PARTIAL | Some related information exists but doesn't directly answer |
| 3-4 | ⚠️ PARTIAL (weak) | Tangential mentions only |
| 1-2 | ❌ MISSING | No relevant information in any knowledge layer |

---

### 9.5 The Four Scope Modes (/plan-ceo-review)

**SCOPE EXPANSION**: "Dream big — propose the ambitious version."
- Run 10x check, platonic ideal, delight opportunities
- Each expansion presented individually for opt-in

**SELECTIVE EXPANSION**: "Hold scope as default, surface what else is possible."
- Run HOLD SCOPE first, then present cherry-pick candidates
- Neutral stance

**HOLD SCOPE**: "Scope is locked. Maximum rigor."
- Treat scope as immutable. Run complexity check. Focus on bulletproofing.

**SCOPE REDUCTION**: "Ruthless. Strip to essentials."
- Minimum viable version. Separate "must ship together" from "nice to ship together."

**Context-dependent defaults:**
- Greenfield feature → EXPANSION
- Feature enhancement → SELECTIVE EXPANSION
- Bug fix / hotfix / refactor → HOLD SCOPE
- Plan touches >15 items (unclear why) → REDUCTION

**For our Discovery Assistant:** Map to discovery phases:

| Discovery Context | Scope Mode | Agent Behavior |
|------------------|------------|----------------|
| Initial project setup | EXPANSION | Intake Agent explores broadly, captures everything |
| Mid-discovery (50-70% ready) | SELECTIVE EXPANSION | Gap Detection focuses on critical gaps, suggests nice-to-haves |
| Near completion (80%+ ready) | HOLD SCOPE | Control Point Agent locks requirements, prevents scope creep |
| Time-constrained discovery | REDUCTION | Meeting Prep Agent focuses only on blocking gaps |

---

### 9.6 Persistent Learning System (JSONL Format)

```json
{
  "skill": "learn",
  "type": "pattern|pitfall|preference|architecture|tool",
  "key": "kebab-case-identifier",
  "insight": "One-sentence description",
  "confidence": 1-10,
  "source": "skill-name|user-stated|observed|inferred|cross-model",
  "ts": "ISO-8601 timestamp",
  "files": ["optional", "file", "paths"]
}
```

Storage: `~/.gstack/projects/{slug}/learnings.jsonl`
- Deduplicated by `(key, type)` — latest timestamp wins
- Append-only (removals require rewrite)
- Cross-project: opt-in, searches patterns across all local projects

**Confidence scale:**
- 10: Explicit user statements
- 8-9: Verified observations
- 4-5: Uncertain inferences

**For our Discovery Assistant — adapted format:**

```json
{
  "agent": "gap-detection",
  "type": "pattern|pitfall|preference|domain-knowledge|client-behavior",
  "key": "healthcare-hipaa-missed-early",
  "insight": "Healthcare projects consistently omit HIPAA compliance until late discovery",
  "confidence": 9,
  "source": "observed|po-stated|cross-matter",
  "matter_id": "project-123",
  "ts": "2026-03-31T14:30:00Z"
}
```

---

### 9.7 AskUserQuestion Format (Exact Structure)

From Tier 2+ preamble:

1. **Re-ground**: Project name, branch, current plan state
2. **Simplify**: No jargon — "explain like a smart 16-year-old" (ELI16 mode)
3. **Recommend**: One-line reason + Completeness scores:
   - 10 = all edge cases covered
   - 7 = happy path solid
   - 3 = shortcut, might miss things
4. **Lettered options** showing effort scale (human hours vs. AI minutes)

Example format:
```
CONTEXT: We found 3 unresolved gaps in the authentication section.
Two can be filled from existing documents. One needs client input.

QUESTION: How should we handle the two auto-resolvable gaps?

RECOMMENDATION: Choose B — auto-resolve both and show you the results
for approval. Completeness: 8/10 (covers all evidence, may miss nuance).

A) Ask client about all 3 gaps in next meeting — 0 effort now, slower resolution
B) Auto-resolve 2 from existing docs, ask client about 1 — balanced approach ✓
C) Auto-resolve all 3 using inference — fastest, but 1 gap has low confidence (4/10)
```

---

### 9.8 AI Slop Blacklist (Design Anti-Patterns)

From `/plan-design-review`:

1. Purple/violet/indigo gradient backgrounds
2. The 3-column feature grid (icon-in-colored-circle + bold title + 2-line description, repeated 3x)
3. Icons in colored circles as section decoration
4. Centered everything
5. Uniform bubbly border-radius on every element
6. Decorative blobs, floating circles, wavy SVG dividers
7. Emoji as design elements
8. Colored left-border on cards
9. Generic hero copy ("Welcome to [X]", "Unlock the power of...")
10. Cookie-cutter section rhythm

**Hard rejections (instant-fail):** Generic SaaS card grid as first impression, beautiful image with weak brand, strong headline with no clear action, busy imagery behind text, sections repeating same mood, carousel with no narrative, app UI of stacked cards.

---

### 9.9 Review Army (Parallel Specialist Subagents)

From `/review`:

**Always-on (when diff > 50 lines):** Testing specialist, Maintainability specialist

**Conditional specialists:** Security, Performance, Data Migration, API Contract, Design

**Red Team:** Dispatched if diff > 200 lines OR any CRITICAL finding

**Deduplication:** Fingerprint = `path:line:category`. Multi-specialist confirmation boosts confidence by +1.

**For our Discovery Assistant:** Map to parallel analysis on document ingestion:

| Specialist | Trigger | Purpose |
|-----------|---------|---------|
| Fact Extraction Agent | Always | Extract structured facts from new document |
| Contradiction Detector | Always | Cross-reference new facts against existing |
| Entity Linker | Always | Extract and connect entities in graph |
| Domain Specialist | Conditional (project type) | Healthcare → compliance check, Finance → regulatory check |
| Red Team Analyst | >3 contradictions found | Adversarial review of the entire fact store |

---

### 9.10 The Autoplan Pipeline (Most Sophisticated Orchestration)

Three-phase sequential review: CEO → Design (conditional) → Eng

**Three decision classifications:**
- **Mechanical**: Auto-decide silently (formatting, naming, obvious patterns)
- **Taste**: Auto-decide per principles, surface at gate (design choices, priority ordering)
- **User Challenge**: NEVER auto-decided (scope changes, architecture pivots, risk acceptance)

**Six decision principles:** Completeness, boil lakes, pragmatic, DRY, explicit over clever, bias toward action.

Each phase runs **dual voices** (Claude subagent + Codex). Final approval gate surfaces all taste decisions and user challenges. Decision audit trail persisted to plan file.

**For our Discovery Assistant — adapted autoplan:**

```
Document uploaded →
  [auto] Intake (classify + extract) — MECHANICAL decisions only
  [auto] Analysis (cross-reference) — MECHANICAL + TASTE decisions
  [auto] Gap Detection (check control points) — MECHANICAL + TASTE decisions
  [gate] PO Review — surface all TASTE decisions + all USER CHALLENGES

PO decisions:
  - TASTE: "We classified 'SSO requirement' as CONFIRMED based on Meeting 3.
    Agree? [A) Yes B) Mark as PARTIAL — needs explicit confirmation]"
  - USER CHALLENGE: "Contradiction found: 'single tenant' vs 'multi-tenant'.
    Which is correct? [A) Single B) Multi C) Ask client]"
```

---

### 9.11 Safety Guardrails (Exact Patterns)

From `/careful`:

| Destructive Pattern | Risk |
|--------------------|------|
| `rm -rf` / `rm -r` | Recursive delete |
| `DROP TABLE` / `DROP DATABASE` | Data loss |
| `TRUNCATE` | Data loss |
| `git push --force` / `-f` | History rewrite |
| `git reset --hard` | Uncommitted work loss |
| `kubectl delete` | Production impact |
| `docker rm -f` / `docker system prune` | Container/image loss |

Safe exceptions: `rm -rf node_modules`, `.next`, `dist`, `__pycache__`, `.cache`, `build`, `.turbo`, `coverage`.

**For our Discovery Assistant — adapted guardrails:**

| Action | Risk | Guardrail |
|--------|------|-----------|
| Marking control point COVERED | False confidence | Require Mem0 fact ID + source doc |
| Generating documents at <70% readiness | Incomplete output | Block with warning |
| Deleting/overwriting a fact | Losing confirmed information | Require PO confirmation |
| Resolving contradiction automatically | Wrong resolution | Always ASK, never AUTO-RESOLVE |
| Changing control point template | Affects all future projects | Require explicit approval |

---

### 9.12 Anti-Sycophancy Directives (Exact Wording)

From ETHOS.md and multiple skills:

> "Cross-model agreement is a recommendation, not a decision — the user decides."

> "Two AI models agreeing on a change is a strong signal. It is not a mandate."

> "The user always has context that models lack."

> "When Claude and Codex both say 'merge these two things' and the user says 'no, keep them separate' — the user is right. Always."

> "Present the recommendation, explain why you both think it's better, state what context you might be missing, and ask. Never act."

Anti-pattern: "Framing your assessment as settled fact in a 'My Assessment' column."

---

### 9.13 The Preamble Tier System

| Tier | Skills | What It Adds |
|------|--------|-------------|
| T1 | browse, setup | Core bash, upgrade checks, telemetry, minimal voice |
| T2 | investigate, cso, retro | + Context recovery, AskUserQuestion format, completeness calibration |
| T3 | autoplan, codex, reviews | + Repo mode detection, search-before-building ethics |
| T4 | ship, review, qa | + Test failure triage |

**For our Discovery Assistant:** Adapt tier system:

| Tier | Agents | Preamble Content |
|------|--------|-----------------|
| T1 | Intake Agent | Matter context, document metadata, classification rules |
| T2 | Analysis, Gap Detection | + Knowledge layer routing, AskUserQuestion format, confidence calibration |
| T3 | Meeting Prep, Document Generator | + Full matter state, readiness score, control point summary |
| T4 | Control Point, Role Simulation | + Cross-matter learnings, template validation, audit trail |

---

## 10. Comparison: Superpowers vs gstack

| Dimension | Superpowers | gstack |
|-----------|-------------|--------|
| **Philosophy** | Discipline enforcement (TDD, verification) | Productivity multiplication (sprint loop) |
| **Core pattern** | Anti-rationalization tables | Skills-as-roles with personas |
| **Key innovation** | TDD for prompts + CSO | Fix-First review + persistent learning |
| **Agent model** | Controller + worker subagents | 23 specialized slash commands |
| **Quality approach** | Iron Laws + verification gates | Real browser QA + cross-model validation |
| **Learning** | None (stateless) | JSONL per-project + cross-project |
| **Safety** | "Spirit over letter" clause | PreToolUse hooks + /freeze + /careful |
| **Best for us** | Agent discipline, verification, anti-rationalization | Preamble, Fix-First, learning, sprint DAG |

**Both complement each other perfectly for our use case:**
- Superpowers gives us **agent rigor** (don't cut corners, verify claims, show evidence)
- gstack gives us **agent productivity** (fix what you find, learn over time, chain automatically)

---

## 10. Key Takeaways

1. **Skills are roles, not tools.** Each agent should have a persona that constrains its cognitive mode — not just a task description.

2. **Fix-First > Report-Only.** Gap Detection should auto-resolve what it can from existing data, only asking about genuine unknowns. This is the single biggest UX improvement we can make.

3. **Persistent learning compounds.** Per-matter and cross-matter learnings make each new discovery project faster and more thorough. This is a long-term moat.

4. **The Universal Preamble** ensures all agents inherit institutional knowledge, consistent formatting, and knowledge layer routing.

5. **"Boil the Lake."** When checking control points, check ALL of them against ALL knowledge layers. Completeness is cheap with AI — incompleteness is expensive in development.

6. **The Sprint DAG** ensures nothing falls through the cracks. Each agent's output is the next agent's input. No orphaned analysis.

7. **Anti-sycophancy matters.** Our agents should push back when the PO's assessment conflicts with the evidence. "Interesting approach" has no place in discovery.

8. **Generation-Verification Loop.** AI recommends, PO decides. Every question has context, options, and a recommendation. Never "I've determined that..."

9. **Template-as-Code prevents drift.** As our system evolves, generate agent prompts from configuration rather than hand-maintaining 7 separate prompt files.

10. **Cross-model validation** catches blind spots the primary analysis misses — our Role Simulation Agent is already positioned for this.
