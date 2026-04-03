# Phase 2: Detailed Test Plan - [JIRA_STORY_ID]

**Feature**: [JIRA_STORY_TITLE]
**Test Designer**: [QA_ENGINEER_NAME]
**Test Plan Date**: [PLAN_DATE]
**Status**: [DRAFT/REVIEW/APPROVED]

---

## Standards Reference

**Project Standards**: `.memory-bank/testing-standards.md`

### Inherited from Project Standards

| Section | Value |
|---------|-------|
| Browser Matrix | [FROM_STANDARDS: Default Automation Target] |
| Exit Criteria | [FROM_STANDARDS: Pass Rate, AC Coverage] |
| Auth Method | [FROM_STANDARDS: Auth Method] |

### Story-Specific Overrides (if any)

| Section | Default | Override | Justification |
|---------|---------|----------|---------------|
| [SECTION] | [DEFAULT] | [OVERRIDE] | [REASON] |

> **Note**: Only include rows in this table if the story requires deviation from project standards. Delete this section if no overrides needed.

---

## Test Case Overview

**Total Test Cases**: [TOTAL_COUNT]
**Priority Breakdown**:
- HIGH: [HIGH_COUNT] test cases
- MEDIUM: [MEDIUM_COUNT] test cases
- LOW: [LOW_COUNT] test cases

**Test Type Breakdown**:
- Functional: [FUNCTIONAL_COUNT]
- Integration: [INTEGRATION_COUNT]
- Boundary/Edge Case: [EDGE_CASE_COUNT]
- Negative/Error Handling: [NEGATIVE_COUNT]

**Automation Candidates**: [AUTOMATION_COUNT] (Manual: [MANUAL_COUNT])

**Triage Source**:
- From TEST ACs: [T_COUNT]
- From MERGE groups: [M_COUNT]
- From GAPs: [G_COUNT]

---

## TC[NUMBER] – [TEST_CASE_TITLE]

**Priority**: [HIGH/MEDIUM/LOW]
**Category**: [FUNCTIONAL/UI/INTEGRATION/PERFORMANCE/SECURITY]
**Preconditions**: [SETUP_REQUIREMENTS]

| Step | Action | Expected Result |
| --- | --- | --- |
| 1 | [ACTION_STEP_1] | [EXPECTED_RESULT_1] |
| 2 | [ACTION_STEP_2] | [EXPECTED_RESULT_2] |
| 3 | [ACTION_STEP_3] | [EXPECTED_RESULT_3] |
| 4 | [ACTION_STEP_4] | [EXPECTED_RESULT_4] |
| 5 | [ACTION_STEP_5] | [EXPECTED_RESULT_5] |

**Postconditions**: [CLEANUP_OR_STATE_AFTER_TEST]

---

[REPEAT_FOR_ADDITIONAL_TEST_CASES]

---

## Test Data Requirements

| Data Type | Description | Source | Status |
| --- | --- | --- | --- |
| **[DATA_TYPE_1]** | [DESCRIPTION] | [SOURCE/GENERATION_METHOD] | [READY/PENDING/BLOCKED] |
| **[DATA_TYPE_2]** | [DESCRIPTION] | [SOURCE/GENERATION_METHOD] | [READY/PENDING/BLOCKED] |

---

## Traceability Matrix

| Test Case ID | Triage Source | AC(s) Covered | Coverage Status |
|---|---|---|---|
| TC[NUMBER] | TEST | AC[N] - [SUMMARY] | ✅ Covered |
| TC[NUMBER] | MERGE | AC[N] + AC[M] - [COMBINED] | ✅ Covered (merged) |
| TC[NUMBER] | GAP | [GAP_DESCRIPTION] | ✅ Gap coverage |
| - | SKIP | AC[N] - [SUMMARY] | ⏭️ Skipped: [REASON] |

**Coverage Summary**:
- ACs with direct TEST coverage: [T] of [TOTAL_AC]
- ACs absorbed via MERGE: [M] of [TOTAL_AC]
- ACs skipped (non-testable): [S] of [TOTAL_AC]
- GAPs added: [G]
- **Effective coverage**: [T + M] / [TOTAL_AC] = [PERCENTAGE]%

---

## Metadata

**Template Used**: `.claude/templates/phase2-test-plan.template.md`
**Report Saved To**: `.memory-bank/docs/test-cases/[DATE]_[JIRA_STORY_ID]_phase2_test-plan.md`
**Phase 1 Analysis Report**: [LINK_TO_PHASE1_REPORT]
**Jira Story**: [JIRA_STORY_URL]

---

## Notes

**Key Differences from Phase 1**:
- Phase 1 provides high-level test case mapping (TC ID | Title | Objective | Expected Result)
- Phase 2 breaks each test case into granular, actionable steps (Step | Action | Expected Result)

---

*Phase 2 - Test Planning Agent*
