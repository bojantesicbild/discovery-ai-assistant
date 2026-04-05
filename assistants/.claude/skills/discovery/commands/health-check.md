---
name: health-check
description: Audit memory-bank — structure integrity, frontmatter consistency, stale docs, index completeness
user_invocable: true
---

# Health Check

Audit the memory-bank for structural issues, inconsistencies, stale data, and missing indexes.

## When to Use
- Periodic maintenance (recommended weekly or after major changes)
- User suspects data inconsistencies
- Before generating handoff documents
- After importing data from external sources

## Steps

1. **Check directory structure** — Verify all expected directories exist:
   - `.memory-bank/docs/discovery/`
   - `.memory-bank/docs/discovery/meetings/`
   - `.memory-bank/docs/completed-tasks/`
   - `.memory-bank/docs/decisions/`
   - `.memory-bank/docs/errors/`
   - `.memory-bank/docs/research-sessions/`
   - `.memory-bank/active-tasks/`
   - `.memory-bank/.logs/`
2. **Validate core files** — Check that these files exist and are non-empty:
   - `.memory-bank/active-task.md`
   - `.memory-bank/project-brief.md`
   - `.memory-bank/key-decisions.md`
   - `.memory-bank/gotchas.md`
   - `.memory-bank/active-tasks/discovery.md`
3. **Frontmatter consistency** — For each file in `docs/discovery/`:
   - Verify frontmatter exists (YAML between `---` delimiters)
   - Check required fields are present (date, category, status at minimum)
   - Flag files missing frontmatter
4. **Stale document detection** — Flag documents where:
   - Last-validated date is more than 90 days ago
   - Status is "draft" for more than 30 days
   - Requirements with confidence=low that have not been updated in 14+ days
5. **Contradiction audit** — Read `.memory-bank/docs/discovery/contradictions.md`:
   - Count open vs resolved contradictions
   - Flag contradictions older than 14 days without resolution
6. **Index completeness** — Check `.memory-bank/archive-index.md`:
   - Verify all files in `docs/completed-tasks/` are indexed
   - Flag orphaned entries (index references non-existent files)
   - Flag unindexed files (files not in the index)
7. **Requirement ID uniqueness** — Scan requirements for duplicate IDs (FR-xxx, NFR-xxx)
8. **Cross-reference integrity** — Check that referenced files in decisions and requirements actually exist
9. **Present health report**

## Files Read
- All files in `.memory-bank/docs/discovery/`
- `.memory-bank/active-task.md`
- `.memory-bank/project-brief.md`
- `.memory-bank/key-decisions.md`
- `.memory-bank/gotchas.md`
- `.memory-bank/active-tasks/discovery.md`
- `.memory-bank/archive-index.md`
- `.memory-bank/docs/completed-tasks/*`

## Files Written
- None (read-only audit) — issues are reported, not auto-fixed

## Output Format

```
Memory Bank Health Check
════════════════════════
Date: YYYY-MM-DD

Structure:           [PASS/WARN/FAIL]
  Missing dirs:      [list or "none"]
  Missing core files:[list or "none"]

Frontmatter:         [PASS/WARN/FAIL]
  Files checked:     X
  Missing frontmatter: Y
  Incomplete fields:   Z
  [list problematic files]

Staleness:           [PASS/WARN/FAIL]
  Stale docs (>90d): X
  Draft docs (>30d): Y
  Low-confidence reqs (>14d): Z
  [list stale items]

Contradictions:      [PASS/WARN/FAIL]
  Open: X | Resolved: Y
  Overdue (>14d): Z
  [list overdue contradictions]

Index:               [PASS/WARN/FAIL]
  Orphaned entries:  X
  Unindexed files:   Y

ID Uniqueness:       [PASS/WARN/FAIL]
  Duplicate IDs:     [list or "none"]

Cross-References:    [PASS/WARN/FAIL]
  Broken links:      X
  [list broken references]

Overall Health: [HEALTHY / NEEDS ATTENTION / CRITICAL]

Recommended Actions:
  1. [highest priority fix]
  2. [second priority fix]
  3. [third priority fix]
```

## Rules
- This is a read-only audit — never auto-fix issues without user approval
- Report all issues, even minor ones — let the user decide what to fix
- Use PASS/WARN/FAIL consistently: PASS = no issues, WARN = minor issues, FAIL = blocking issues
- If memory-bank directory does not exist at all, report "Memory bank not initialized — run setup first"
