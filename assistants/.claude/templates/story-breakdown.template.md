# Story breakdown — [Feature name]

## Project Overview

**Project:** [Title]
**Description:** [one-paragraph summary of the feature]
**Total Effort:** [Range estimate — e.g., "8–12h" or "2 days"]
**Complexity:** Low | Medium | High

## Development Stories

| ID | Title | Category | Priority | Effort | Dependencies |
|---|---|---|---|---|---|
| STORY-001 | FE \| UI Components \| [Feature] | ui | high | 2h | — |
| STORY-002 | BE \| API \| [Feature] | api | high | 1h | STORY-001 |
| STORY-003 | DevOps \| Environment \| [Feature] | environment | medium | 30m | STORY-002 |

> **Title format:** `[LAYER] | [CATEGORY] | [Short description]`.
> **LAYER:** FE · BE · DevOps · Data · Mobile · Infra.
> **CATEGORY:** UI Components · API · Integration · Mocked Integration · Data · Environment · Pipeline · Migration · Configuration · Testing · Documentation.

**Effort guidance:** hours for small tasks, days for large; **max 1 day per story**. Stories longer than 1 day should be split.
