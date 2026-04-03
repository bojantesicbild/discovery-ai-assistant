# Phase 3: Test Execution Report - [JIRA_STORY_ID]

**Feature**: [JIRA_STORY_TITLE]
**Test Executor**: [QA_ENGINEER_NAME]
**Execution Date**: [EXECUTION_DATE]
**Status**: [IN_PROGRESS/COMPLETED/BLOCKED]

---

## Executive Summary

**Total Test Cases**: [TOTAL_COUNT]
**Executed**: [EXECUTED_COUNT]
**Pass Rate**: [PASS_RATE]%

**Results Breakdown**:
- ✅ **PASSED**: [PASSED_COUNT] ([PASS_PERCENTAGE]%)
- ❌ **FAILED**: [FAILED_COUNT] ([FAIL_PERCENTAGE]%)
- ⛔ **BLOCKED**: [BLOCKED_COUNT] ([BLOCKED_PERCENTAGE]%)
- ⏸️ **TO DO**: [TODO_COUNT] ([TODO_PERCENTAGE]%)

**Defects Raised**: [DEFECT_COUNT] ([BLOCKER_COUNT] Blocker, [CRITICAL_COUNT] Critical, [MAJOR_COUNT] Major)

**Story Status**: [TEAM_DONE/QA_FAILED/BLOCKED]

---

## Test Execution Results

| TC ID | Title | Status | Summary | Defect ID |
| --- | --- | --- | --- | --- |
| **TC1** | [TEST_CASE_1_TITLE] | [PASSED/FAILED/BLOCKED/TO DO] | [BRIEF_EXECUTION_SUMMARY] | [JIRA_BUG_ID or N/A] |
| **TC2** | [TEST_CASE_2_TITLE] | [PASSED/FAILED/BLOCKED/TO DO] | [BRIEF_EXECUTION_SUMMARY] | [JIRA_BUG_ID or N/A] |
| **TC3** | [TEST_CASE_3_TITLE] | [PASSED/FAILED/BLOCKED/TO DO] | [BRIEF_EXECUTION_SUMMARY] | [JIRA_BUG_ID or N/A] |

---

## Detailed Failure Analysis

### TC[NUMBER] - [TEST_CASE_TITLE] (FAILED)

**Priority**: [HIGH/MEDIUM/LOW]
**Executed On**: [DATE_TIME]
**Environment**: [BROWSER/DEVICE_CONFIG]

**Steps to Reproduce**:
1. [STEP_1]
2. [STEP_2]
3. [STEP_3]

**Actual Result**: [WHAT_ACTUALLY_HAPPENED]
**Expected Result**: [WHAT_SHOULD_HAVE_HAPPENED]

**Evidence**:
- Screenshot: [SCREENSHOT_PATH or LINK]
- Video: [VIDEO_PATH or LINK]
- Logs: [LOG_FILE_PATH]

**Defect Raised**: [JIRA_BUG_ID] - "[BUG_TITLE]"

---

[REPEAT_FOR_ADDITIONAL_FAILURES]

---

## Test Environment Details

| Layer | Configuration | Status |
| --- | --- | --- |
| **Desktop Browsers** | Chrome [VERSION], Edge [VERSION], Firefox [VERSION] | ✅ Tested |
| **Mobile Web** | iOS Safari [VERSION], Android Chrome [VERSION] | ✅ Tested |
| **Environment URL** | [TEST_ENVIRONMENT_URL] | ✅ Accessible |
| **Test Data** | [DATA_SOURCE] | ✅ Available |

---

## Coverage Analysis

| Acceptance Criterion | Test Cases | Execution Status | Result |
| --- | --- | --- | --- |
| AC1: [AC_SUMMARY] | TC1, TC2 | ✅ Executed | ✅ Passed |
| AC2: [AC_SUMMARY] | TC3 | ✅ Executed | ❌ Failed (BUG-123) |
| AC3: [AC_SUMMARY] | TC4, TC5 | ✅ Executed | ✅ Passed |

**Coverage**: [COVERED_AC_COUNT]/[TOTAL_AC_COUNT] acceptance criteria tested ([PERCENTAGE]%)

---

## Sign-Off Criteria Assessment

### Exit Criteria Status
- [ ] All test cases executed on Web + Mobile Web
- [ ] 0 Blocker defects (**Current**: [BLOCKER_COUNT])
- [ ] 0 Critical defects (**Current**: [CRITICAL_COUNT])
- [ ] 0 Major defects (**Current**: [MAJOR_COUNT])
- [ ] All gaps from Phase 1 analysis addressed

### Story Status Determination
**Result**: [TEAM_DONE / QA_FAILED]

**Rationale**: [EXPLANATION_OF_STATUS_DECISION]

---

## Metadata

**Template Used**: `.claude/templates/phase3-execution-report.template.md`
**Report Saved To**: `.memory-bank/docs/qa-analysis-reports/[JIRA_STORY_ID]_phase3_execution_[DATE].md`
**Test Plan**: [LINK_TO_PHASE2_TEST_PLAN]
**Jira Story**: [JIRA_STORY_URL]

---

*Phase 3 - Test Execution - To be fully implemented in future phases*
