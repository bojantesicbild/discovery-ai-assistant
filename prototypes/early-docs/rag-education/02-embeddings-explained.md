# Embeddings Explained

## What Is an Embedding?

An embedding is a way to represent text as a **list of numbers** (a vector)
that captures the **meaning** of that text.

```
"The client wants Microsoft SSO"
       │
       ▼  (embedding model)
       │
[0.023, -0.156, 0.891, 0.034, ..., -0.445]
          (typically 384 to 3072 numbers)
```

Why numbers? Because computers can't understand meaning directly, but they
CAN compare lists of numbers very efficiently. If two pieces of text have
similar meaning, their embedding vectors will be close together in
mathematical space.

---

## How Similarity Works

### The Core Idea

```
Text A: "The client wants Microsoft SSO for authentication"
Text B: "Authentication should use Microsoft single sign-on"
Text C: "The meeting is scheduled for Tuesday at 3pm"

Embedding A: [0.82, 0.15, -0.34, 0.91, ...]
Embedding B: [0.79, 0.18, -0.31, 0.88, ...]  ← very close to A
Embedding C: [0.12, -0.67, 0.45, 0.03, ...]  ← far from A and B
```

Text A and B say the same thing in different words. Their vectors are
almost identical. Text C is about something completely different — its
vector points in a different direction.

### Cosine Similarity

The standard way to measure how close two vectors are. It measures the
angle between them:

- **1.0** = identical meaning (same direction)
- **0.0** = completely unrelated (perpendicular)
- **-1.0** = opposite meaning (opposite direction, rare in practice)

```
"Microsoft SSO" vs "Single sign-on with Microsoft"  → 0.95 (very similar)
"Microsoft SSO" vs "Authentication method"           → 0.72 (related topic)
"Microsoft SSO" vs "Tuesday meeting at 3pm"          → 0.08 (unrelated)
```

You don't need to understand the math. The key insight is: **embedding
models turn the fuzzy concept of "meaning" into precise numbers that
computers can compare.**

---

## Visual Intuition

Imagine a 2D space (real embeddings have hundreds of dimensions, but
the concept is the same):

```
                    ▲
                    │
        "Azure     │    "Microsoft SSO"
         hosting"  │  ●  ●  "Single sign-on"
                   │
     "Cloud        │     "OAuth tokens"
      deployment" ●│   ●
                   │
  ─────────────────┼──────────────────────►
                   │
                   │  ●  "Budget is $500/month"
                   │
         ●         │        ● "Timeline Q2 2025"
  "Meeting on      │
   Tuesday"        │
                   │
```

Points that are close together have similar meanings. Clusters form around
topics. When you search for "What authentication method?", the embedding
of your question lands near the SSO/OAuth cluster, and the system returns
those chunks.

---

## Embedding Models

An embedding model is a neural network trained specifically to produce
these meaning-capturing vectors. Different models make different tradeoffs.

### Key Properties

| Property | What it means | Impact |
|----------|-------------|--------|
| **Dimensions** | Length of the output vector (384, 768, 1024, 1536, 3072) | More dimensions = more nuance captured, but more storage and slower search |
| **Max tokens** | How much text the model can embed at once (typically 512-8192 tokens) | Affects chunk size limits |
| **Quality** | How well the model captures meaning (measured by benchmarks like MTEB) | Better quality = more relevant search results |
| **Speed** | How fast the model produces embeddings | Matters for ingestion of large document sets |
| **Cost** | Free (open source) vs. per-token pricing (commercial) | Matters at scale |

### Model Categories

#### Commercial (API-based)

| Model | Provider | Dimensions | Notes |
|-------|----------|-----------|-------|
| `text-embedding-3-large` | OpenAI | 3072 | High quality, widely used |
| `text-embedding-3-small` | OpenAI | 1536 | Cheaper, good quality |
| `voyage-3` | Voyage AI | 1024 | Strong on code and technical content |
| `embed-v4.0` | Cohere | 1024 | Good multilingual support |

#### Open Source (self-hosted)

| Model | Provider | Dimensions | Notes |
|-------|----------|-----------|-------|
| `bge-large-en-v1.5` | BAAI | 1024 | Top open-source quality |
| `e5-large-v2` | Microsoft | 1024 | Strong general purpose |
| `all-MiniLM-L6-v2` | Sentence-Transformers | 384 | Fast, lightweight, good for prototyping |
| `nomic-embed-text` | Nomic AI | 768 | Good balance of quality and size |
| `gte-large` | Alibaba | 1024 | High benchmark scores |

#### How to Choose

```
Need best quality + don't mind API costs?
  → OpenAI text-embedding-3-large or Voyage

Need self-hosted + good quality?
  → BGE-large or E5-large

Need fast + lightweight for prototyping?
  → all-MiniLM-L6-v2

Working with code / technical content?
  → Voyage (specifically trained for code)

Need multilingual?
  → Cohere embed-v4.0 or multilingual-e5-large
```

**Important:** Once you choose an embedding model, you can't easily switch.
All documents need to be re-embedded if you change models, because different
models produce incompatible vectors. Choose carefully at the start.

---

## Fine-Tuning Embeddings

### What It Is

Taking an existing embedding model and training it further on YOUR specific
data so it better captures the meaning of YOUR domain vocabulary.

### When You Need It

```
Out-of-the-box model:
  "NacXwan" — model has never seen this word
  → Embeds it as something vaguely related to its characters
  → Searching for "NacXwan" may not find "the NacXwan project"

After fine-tuning on your domain:
  "NacXwan" — model learned this is a project name
  → Embeds it near "project", "Outlook add-in", "client product"
  → Searching works correctly
```

### When You DON'T Need It

Most of the time. Modern embedding models are good enough for general text.
Fine-tuning helps when you have:
- Domain-specific jargon (medical, legal, client-specific terms)
- Abbreviations and acronyms that are ambiguous
- A large corpus of domain text to train on (thousands of documents)

### How It Works (Simplified)

1. Collect pairs of text that should be similar:
   - ("NacXwan project", "Outlook add-in for video conferencing")
   - ("SSO", "single sign-on authentication")
2. Train the model to produce closer vectors for these pairs
3. The model learns your domain vocabulary while keeping general ability

**For most projects, you don't need fine-tuning.** Start with a good
off-the-shelf model. Fine-tune later only if search quality is poor
on your specific terms.

---

## Chunking: Why It Matters for Embeddings

Embedding models have a maximum input length (typically 512-8192 tokens).
A full meeting note might be 5000 words. You can't embed the whole thing
as one vector — and even if you could, it would be a poor representation
(too much mixed content in one vector).

**Solution: split documents into smaller chunks, embed each chunk separately.**

```
Meeting notes (3000 words)
       │
       ▼  (chunking)
       │
  ┌────────────┐  ┌────────────┐  ┌────────────┐
  │ Chunk 1:    │  │ Chunk 2:    │  │ Chunk 3:    │
  │ Auth        │  │ Hosting     │  │ Timeline    │
  │ discussion  │  │ discussion  │  │ discussion  │
  │ (400 words) │  │ (350 words) │  │ (250 words) │
  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
        │               │               │
        ▼               ▼               ▼
  [0.82, 0.15,..] [0.12, -0.67,..] [0.45, 0.33,..]
  (auth-related)  (hosting-related) (timeline-related)
```

Now when someone asks "What about auth?", the search finds Chunk 1
specifically — not the entire meeting note.

**How you chunk affects everything downstream.** Bad chunking (splitting
mid-sentence, mixing topics in one chunk) leads to bad embeddings leads
to bad retrieval leads to bad answers. Chunking strategy is covered in
detail in `04-rag-pipeline-deep-dive.md`.

---

## Key Takeaways

1. **Embeddings turn text into numbers** that capture meaning
2. **Similar meanings = similar numbers**, which computers can compare efficiently
3. **Embedding models** vary in quality, speed, dimensions, and cost — choose based on your needs
4. **Fine-tuning** customizes a model for your domain vocabulary — usually not needed at the start
5. **Chunking** splits documents into embeddable pieces — how you chunk determines retrieval quality
6. **Model choice is sticky** — switching models means re-embedding everything. Decide early.
