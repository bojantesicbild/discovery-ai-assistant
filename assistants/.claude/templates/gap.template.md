<!-- DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/gap.yaml. Run assistants/.claude/scripts/render-templates.py. -->

---
id: [GAP-NNN identifier]
question: [question]
kind: missing_info
severity: medium
area: general
status: open
closed_at: YYYY-MM-DDTHH:MM:SSZ
closed_by: [closed_by]
assignee: [assignee]
blocked_reqs: []
source_person: [source_person]
source_doc: [source_doc]
source_raw: [source_raw]
source_origin: [source_origin]
date: YYYY-MM-DD
category: gap
tags: [gap, {{severity}}, {{status}}]
aliases: [GAP-XXX]
cssclasses: [gap, node-amber]
---

# GAP-XXX: [Title]

_What we don't know yet_

## Why it matters

_1-2 sentences in plain language on what gets blocked / put at risk if this stays open. Different from blocked_reqs (which lists which BRs are gated): impact_summary explains the consequence — re-work cost, scope risk, decision deadline. Required when blocked_reqs is non-empty._

## Default we're running on

_When kind=unvalidated_assumption only. The specific assumption being made *as if it were confirmed*, plus the cost of being wrong. E.g. 'Assuming markdown-first chunking. If invalidated: PDF + DOCX heuristics needed, +2-3 days to MVP.'_

## Options on the table

- 

## Validation plan

- 

## Blocked requirements

- [[item]]

## Source

> "[exact quote]"

## Resolution

_(content)_

<!--
Extraction prompt (for the agent — strip before writing to disk):

Extract gaps as things we don't know that we need to know.

A gap is NOT a requirement. A requirement is a known thing the system
shall do. A gap is a question whose answer would unlock requirements.

For each gap, capture the structural fields PLUS the descriptive fields
introduced in migration 038 — the descriptive fields turn a stub gap
into something a PM can read once and act on.

Structural fields (always populate when applicable):
- question: the missing information, phrased as a question
- kind: classification of the gap. Pick one:
    - missing_info (default) — the client simply never told us.
    - unvalidated_assumption — the source says "we assume X" / "we believe X"
      without confirmation; nothing in the record validates it.
    - undecided — the source says "we need to decide X" / "TBD" / "still
      open" — a call that must be made but hasn't been.
- severity: high (blocks major work), medium (slows work), low (cosmetic)
- area: which domain it lives in (business / functional / technical / scope)
- blocked_reqs: BR-NNN ids that can't be confirmed without this answer
- source_quote: if the gap was raised by a client statement, the quote

Descriptive fields (the new ones — populate to give the PM context):

- impact_summary: 1-2 sentences in PLAIN LANGUAGE on what gets blocked or
  put at risk. Different from blocked_reqs — this explains the
  *consequence* (rework cost, scope risk, decision deadline) so the PM
  can triage without reading the source. REQUIRED when blocked_reqs is
  non-empty; optional otherwise. Inference is bounded — "what does it
  mean for these BRs?" — not invention.

- validation_plan: ordered list of concrete steps to close the gap. Each
  entry is a single action: who to ask, what to measure, what to decide.
  REQUIRED when severity is medium or high. Replaces the legacy
  free-form `suggested_action` field.

- assumed_default: when kind=unvalidated_assumption ONLY. The specific
  assumption being made *as if confirmed*, plus the cost of being wrong.
  E.g. "Assuming markdown-first chunking. If invalidated: PDF + DOCX
  heuristics needed, +2-3 days to MVP."

- options: when kind=undecided ONLY. Choices being weighed, ≥2 entries.
  Each entry: "<option> — <pros / cons>". Lets the agent capture the
  tradeoff space without forcing a decision.

Anti-fabrication rules — DO NOT INVENT CONTENT:

- assumed_default and options: populate ONLY when the source EXPLICITLY
  names them. If the source doesn't say "we assume X" or "options are
  A vs B / we're considering A vs B", leave the field null. Never
  fabricate an assumption or option set the source didn't mention.
- validation_plan: requires AT LEAST ONE concrete signal in the source
  (a named person, a missing stat, a referenced doc). If none, fall
  back to the single-step plan: "Discuss with {source_person} in next
  session." Never list more steps than the source supports.
- impact_summary: bounded inference allowed when blocked_reqs is set —
  you can describe what those BRs need this gap for. Without
  blocked_reqs, leave impact_summary null rather than guess.

WRONG (sparse extraction, just the question):
  question: "80% of uploads assumed to be Markdown — unvalidated"
  severity: medium
  blocked_reqs: ["BR-024", "BR-025"]
  source_quote: "We believe 80% of uploads will be markdown..."

RIGHT (descriptive fields populated from source + bounded inference):
  question: "80% of uploads assumed to be Markdown — unvalidated"
  kind: unvalidated_assumption
  severity: medium
  area: technical
  blocked_reqs: ["BR-024", "BR-025"]
  impact_summary: "If the upload mix isn't validated, the chunking
    template selection (markdown-first vs PDF/DOCX-first) stays
    speculative. Wrong choice means re-extracting the existing
    corpus once it crosses ~50 docs. Cost: 1-2 days of pipeline
    rework + a fresh round of client review."
  assumed_default: "Assuming markdown-first chunking. If invalidated:
    PDF + DOCX heuristics needed (separate template per source
    mime-type), adds ~2-3 days to MVP scope."
  validation_plan:
    - "Ask David in next sync: pull last 30 days of upload mime-type counts."
    - "If markdown share <60%, escalate chunking-template choice to architecture review."
    - "Capture finding in client-meeting-notes-3 and resolve / convert to constraint."
  source_quote: "We believe 80% of uploads will be markdown..."

Gaps drive readiness scoring. Resolving a gap = converting it to a
confirmed requirement or constraint, or marking an unvalidated assumption
as validated.
-->
