---
id: CON-005
title: "budget: Claude Haiku must be used for extraction instead o"
type: budget
status: confirmed
date: 2026-04-08
category: constraint
tags: [constraint, budget, confirmed]
aliases: [CON-005]
cssclasses: [constraint, node-cyan]
---

# CON-005: budget constraint

Claude Haiku must be used for extraction instead of Sonnet to reduce per-run costs.

## Impact
May reduce extraction quality; conflicts with earlier architecture decision to use Sonnet for accuracy.

## Source
> "Haiku is 10x cheaper and good enough for structured extraction."

## Affected Requirements
- [[BR-008]] — constrained
- [[BR-009]] — constrained
- [[BR-010]] — constrained
