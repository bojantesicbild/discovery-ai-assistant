<!-- DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/stakeholder.yaml. Run assistants/.claude/scripts/render-templates.py. -->

---
name: [name]
role_title: [role_title]
role: [role]
organization: [organization]
decision_authority: informed
source_doc: [source_doc]
date: YYYY-MM-DD
category: stakeholder
tags: [stakeholder, {{decision_authority}}]
cssclasses: [stakeholder, node-purple]
---

# [Title]

## Role

_One-paragraph role narrative. Used when role_title alone doesn't capture the relationship — e.g. context like 'Client CEO with final authority on architecture + budget.' Keep to 1-2 sentences; surface specific decisions / concerns in the dedicated lists below._

## Decisions Made

- 

## Interests

- 

## Requirements

- [[item]]

<!--
Extraction prompt (for the agent — strip before writing to disk):

Extract stakeholders as people who influence or care about the project.

For each stakeholder, capture:
- name: full name as it appears in the source
- role_title: SHORT job title only (≤40 chars). 'CEO', 'CTO', 'Lead Developer',
  'Product Manager'. Do NOT pack decisions, opinions, or context into this
  field — those go into decisions[] / interests[] below.
- organization: company or team
- decision_authority: final (signs off), recommender (advises), informed (kept in loop)
- role: optional 1-2 sentence narrative if role_title alone doesn't convey
  the relationship (e.g. "Client CEO with final authority on architecture
  decisions"). Leave empty when role_title is sufficient.
- decisions: specific decisions this person has made or owns. Each entry is
  a short headline + reasoning. Examples:
    - "EU-only hosting — non-negotiable contractual requirement."
    - "€80k MVP budget ceiling — confirmed."
    - "Named RAGFlow as vector store — any swap requires amendment."
  A long sentence describing one person's behaviour usually splits into
  2-4 distinct decisions; do that split.
- interests: short keyword phrases for what they personally care about.
  Examples: "cost predictability", "data residency", "audit trail".
  Each entry under ~6 words. NEVER combine multiple interests into one
  entry separated by 'and' / commas.

WRONG (legacy free-form):
  role: "Client CEO with final authority. Imposed EU-only hosting as a
  non-negotiable contractual requirement. Confirmed the €80k MVP budget
  ceiling. Named RAGFlow as contractually specified."

RIGHT (split into role_title + decisions + interests):
  role_title: "CEO"
  role: "Client CEO with final authority on architecture + budget."
  decisions:
    - "EU-only hosting — non-negotiable contractual requirement."
    - "€80k MVP budget ceiling — confirmed."
    - "Named RAGFlow as vector store — any swap requires amendment."
  interests: ["compliance", "cost predictability"]

Avoid creating stakeholders for one-off mentions. Wait until someone
appears in two or more sources OR is the named decision-maker for at
least one decision.
-->
