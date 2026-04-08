<!-- DO NOT EDIT BY HAND. Generated from assistants/.claude/schemas/stakeholder.yaml. Run assistants/.claude/scripts/render-templates.py. -->

---
name: [name]
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

_(content)_

## Interests

- 

## Requirements

- [[item]]

<!--
Extraction prompt (for the agent — strip before writing to disk):

Extract stakeholders as people who influence or care about the project.

For each stakeholder, capture:
- name: full name as it appears in the source
- role: job title (CTO, PM, end-user, etc.)
- organization: company or team
- decision_authority: final (signs off), recommender (advises), informed (kept in loop)
- interests: what they personally care about (cost, speed, security, …)

Avoid creating stakeholders for one-off mentions. Wait until someone
appears in two or more sources OR is the named decision-maker for at
least one decision.
-->
