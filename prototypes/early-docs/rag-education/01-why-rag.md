# Why RAG — The Problem It Solves

## LLMs Are Powerful But Incomplete

Large Language Models (GPT-4, Claude, Llama) are trained on massive amounts
of text. They can reason, write, summarize, and answer questions remarkably
well. But they have three fundamental limitations:

### 1. They Don't Know Your Data

An LLM knows about Python, JavaScript, and software architecture in general.
It does NOT know:
- What your client said in yesterday's meeting
- What's in the NacXwan project spec document
- What decisions were made in the email thread from February
- What's in the client's codebase

**The LLM is smart but uninformed about your specific context.**

### 2. Their Knowledge Has a Cutoff

Models are trained on data up to a certain date. They don't know about:
- Events or documents created after their training cutoff
- Changes to APIs, frameworks, or tools released recently
- Your company's internal processes or documentation

### 3. They Hallucinate

When an LLM doesn't know something, it doesn't say "I don't know." It
generates a plausible-sounding answer that may be completely wrong. This
is called **hallucination**.

```
Without RAG:
  You: "What auth method did the client want?"
  LLM: "Based on common patterns, the client likely wants OAuth 2.0
        with JWT tokens for their web application."

  This sounds reasonable. It's also completely made up.
  The client actually said "Microsoft SSO" in Meeting 3.
```

---

## What RAG Does

RAG stands for **Retrieval-Augmented Generation**. The idea is simple:

**Before the LLM answers, give it the relevant information from your data.**

```
With RAG:
  You: "What auth method did the client want?"

  System retrieves from your documents:
  - Meeting 3 notes: "Sarah confirmed Microsoft SSO with MSAL tokens"
  - Email Feb 5: "SSO is a hard requirement from IT department"

  LLM reads your question + these retrieved passages:
  "The client wants Microsoft SSO with MSAL tokens. This was confirmed
   by Sarah in Meeting 3 and reinforced as a hard requirement by the
   IT department in the Feb 5 email."

  This is grounded in actual data. The LLM cites its sources.
```

---

## How RAG Works (High Level)

Three steps:

```
STEP 1: STORE (happens once, when documents are uploaded)
─────────────────────────────────────────────────────────
  Your documents (PDFs, meeting notes, emails, code)
       │
       ▼
  Break into small pieces ("chunks")
       │
       ▼
  Convert each chunk into a mathematical representation
  called an "embedding" — a vector of numbers that
  captures the MEANING of the text
       │
       ▼
  Store these vectors in a special database
  (vector database)


STEP 2: RETRIEVE (happens every time someone asks a question)
─────────────────────────────────────────────────────────────
  User asks: "What auth method did the client want?"
       │
       ▼
  Convert the question into the same kind of vector
       │
       ▼
  Search the vector database for chunks whose meaning
  is closest to the question's meaning
       │
       ▼
  Return the top 5-10 most relevant chunks


STEP 3: GENERATE (happens right after retrieval)
─────────────────────────────────────────────────
  Send to the LLM:
  - The user's question
  - The retrieved chunks (as context)
       │
       ▼
  LLM reads the chunks and answers based on YOUR data,
  not its general training knowledge
       │
       ▼
  User gets a grounded, accurate answer with sources
```

---

## Before RAG vs. After RAG

| Scenario | Without RAG | With RAG |
|----------|------------|---------|
| "What did the client say about hosting?" | LLM guesses based on common patterns | Returns exact quotes from Meeting 4 notes |
| "Is auth decided?" | "I don't have that information" or hallucinates | "Yes, Microsoft SSO, confirmed by Sarah in Meeting 3" |
| "Write the deployment section of the scope doc" | Generic template with placeholder text | Actual content from client discussions about Azure, single-region, $500/mo budget |
| "Are there any contradictions?" | Can't know — has no access to the documents | Compares information across all meetings and flags conflicts |

---

## Why Not Just Paste Documents Into the LLM?

You could copy-paste a document into ChatGPT's context window. This works
for small amounts of text but fails for real projects:

| Problem | Paste approach | RAG approach |
|---------|---------------|-------------|
| **Volume** | Context windows have limits (even large ones). 50 documents don't fit. | Vector DB stores unlimited documents. Retrieves only what's relevant. |
| **Relevance** | LLM reads everything, even irrelevant parts. Wastes tokens, dilutes attention. | Only the most relevant chunks are retrieved. Focused context. |
| **Cost** | Sending 100 pages of text = expensive per query. | Sending 5-10 relevant paragraphs = much cheaper per query. |
| **Updates** | Every time a new document arrives, you'd need to re-paste everything. | New documents are indexed once. Immediately searchable. |
| **Structure** | No metadata, no filtering. "Find what Sarah said in Meeting 2" requires reading everything. | Metadata filtering: search only Meeting 2, only Sarah's statements. |

---

## Where RAG Fits in the AI Application Stack

```
┌──────────────────────────────────────────┐
│            YOUR APPLICATION               │
│                                          │
│  User Interface (chat, dashboard, etc.)  │
│              │                           │
│              ▼                           │
│  Application Logic                       │
│  (agents, workflows, business rules)     │
│              │                           │
│              ▼                           │
│  ┌──────────────────────────────────┐    │
│  │           RAG LAYER               │    │
│  │                                  │    │
│  │  1. Document ingestion + storage │    │
│  │  2. Retrieval (search)           │    │
│  │  3. Context assembly             │    │
│  └──────────────┬───────────────────┘    │
│                 │                         │
│                 ▼                         │
│  ┌──────────────────────────────────┐    │
│  │           LLM LAYER               │    │
│  │                                  │    │
│  │  Receives: question + context    │    │
│  │  Returns: grounded answer        │    │
│  └──────────────────────────────────┘    │
│                                          │
└──────────────────────────────────────────┘
```

RAG sits between your application and the LLM. Your application doesn't
need to know how retrieval works — it sends a question, RAG finds the
relevant context, and the LLM generates an answer grounded in your data.

---

## Key Takeaway

RAG is not a product or a tool — it's an **architecture pattern**. It says:
"Before asking the AI to answer, find the relevant information first."

Everything that follows in this series — embeddings, vector databases,
chunking strategies, reranking, graph RAG — is about making that retrieval
step better. Better retrieval = better context = better answers.

The quality of a RAG system is determined primarily by retrieval quality,
not by which LLM you use. A mediocre LLM with great retrieval beats a
great LLM with bad retrieval every time.
