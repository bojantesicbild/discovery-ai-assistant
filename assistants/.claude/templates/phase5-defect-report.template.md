# Defect Report: [DEFECT_ID] - [BUG_TITLE]

**Severity**: [BLOCKER/CRITICAL/MAJOR/MINOR/TRIVIAL]
**Priority**: [URGENT/HIGH/MEDIUM/LOW]
**Status**: [OPEN/IN_PROGRESS/RESOLVED/CLOSED]
**Reported By**: [QA_ENGINEER_NAME]
**Report Date**: [DATE]
**Affected Version**: [VERSION]

---

## Summary

[BRIEF_1-2_SENTENCE_DESCRIPTION_OF_THE_DEFECT]

---

## Steps to Reproduce

1. Navigate to [URL or PAGE]
2. [ACTION_STEP_2]
3. [ACTION_STEP_3]
4. [ACTION_STEP_4]
5. Observe [FAILURE_CONDITION]

**Preconditions**:
- [PRECONDITION_1]
- [PRECONDITION_2]

---

## Actual Results

[DETAILED_DESCRIPTION_OF_WHAT_ACTUALLY_HAPPENS]

**Error Message** (if applicable):
```
[ERROR_MESSAGE_TEXT_OR_STACK_TRACE]
```

---

## Expected Results

**From Acceptance Criterion [AC_NUMBER]**:
```
[EXACT_AC_TEXT_FROM_JIRA_STORY]
```

[DETAILED_DESCRIPTION_OF_EXPECTED_BEHAVIOR]

---

## Environment Details

| Attribute | Value |
| --- | --- |
| **Environment** | [STAGING/PRODUCTION/DEV] |
| **URL** | [ENVIRONMENT_URL] |
| **Browser** | [CHROME_VERSION/FIREFOX_VERSION/SAFARI_VERSION] |
| **OS** | [macOS_VERSION/Windows_VERSION/iOS_VERSION/Android_VERSION] |
| **Device** | [DEVICE_TYPE if mobile] |
| **Screen Resolution** | [RESOLUTION if relevant] |
| **Build/Version** | [BUILD_NUMBER or COMMIT_HASH] |

---

## Evidence & Attachments

**Screenshots**:
- [SCREENSHOT_1_DESCRIPTION]: [PATH or LINK]
- [SCREENSHOT_2_DESCRIPTION]: [PATH or LINK]

**Videos**:
- [VIDEO_RECORDING_DESCRIPTION]: [PATH or LINK]

**Logs**:
- Console logs: [CONSOLE_LOG_FILE or TEXT]
- Network trace: [HAR_FILE or LINK]
- Server logs: [LOG_FILE_LOCATION]

---

## Technical Details

**Test Case**: [TEST_CASE_ID] - "[TEST_CASE_TITLE]"

**Error Type**: [TIMEOUT/NULL_POINTER/API_FAILURE/VALIDATION_ERROR/UI_RENDERING/etc.]

**API Endpoint** (if applicable):
- Method: [GET/POST/PUT/DELETE]
- URL: [API_ENDPOINT_URL]
- Response Status: [HTTP_STATUS_CODE]
- Response Time: [RESPONSE_TIME_MS]

**Component/Module**: [AFFECTED_COMPONENT]

**Affected Feature Area**: [CHECKOUT/AUTHENTICATION/PAYMENT/REPORTING/etc.]

---

## Root Cause Analysis (Optional)

**Suspected Cause**: [HYPOTHESIS_ABOUT_ROOT_CAUSE]

**Affected Code** (if known):
- File: [FILE_PATH]
- Function/Method: [FUNCTION_NAME]
- Line: [LINE_NUMBER]

**Similar Defects** (from historical data):
- [SIMILAR_BUG_ID_1]: [BRIEF_DESCRIPTION and RESOLUTION]
- [SIMILAR_BUG_ID_2]: [BRIEF_DESCRIPTION and RESOLUTION]

**Suggested Investigation Steps**:
1. [INVESTIGATION_STEP_1]
2. [INVESTIGATION_STEP_2]
3. [INVESTIGATION_STEP_3]

---

## Impact Assessment

**User Impact**: [DESCRIPTION_OF_HOW_THIS_AFFECTS_USERS]

**Frequency**: [ALWAYS/OFTEN/SOMETIMES/RARELY/ONCE]
- Occurs in [PERCENTAGE]% of test runs
- First observed: [FIRST_OCCURRENCE_DATE]

**Workaround Available**: [YES/NO]
- If yes: [WORKAROUND_DESCRIPTION]

**Blocks**:
- [ ] Deployment to production
- [ ] Core user flow ([FLOW_NAME])
- [ ] Other test cases ([TC_IDS])
- [ ] Feature sign-off

---

## Duplicate Check

**Search Performed**: ✅ Semantic search in Mem0 for similar error messages and stack traces

**Similar Bugs Found**:
- [BUG_ID_1]: [SIMILARITY_DESCRIPTION] - Status: [OPEN/RESOLVED]
- [BUG_ID_2]: [SIMILARITY_DESCRIPTION] - Status: [OPEN/RESOLVED]

**Duplicate Assessment**: [NOT_A_DUPLICATE / POSSIBLE_DUPLICATE_OF_[BUG_ID] / CONFIRMED_DUPLICATE]

---

## Verification Steps

**How to Verify Fix**:
1. [VERIFICATION_STEP_1]
2. [VERIFICATION_STEP_2]
3. [VERIFICATION_STEP_3]

**Success Criteria**:
- [ ] Steps to reproduce no longer cause the error
- [ ] [ADDITIONAL_SUCCESS_CRITERION_1]
- [ ] [ADDITIONAL_SUCCESS_CRITERION_2]
- [ ] Regression tests pass ([TEST_SUITE_NAME])

---

## Related Items

**Jira Story**: [JIRA_STORY_ID] - "[STORY_TITLE]"
**Test Plan**: [LINK_TO_PHASE2_TEST_PLAN]
**Analysis Report**: [LINK_TO_PHASE1_ANALYSIS_IF_RELEVANT]

**Related Bugs**:
- [RELATED_BUG_1]: [RELATIONSHIP_DESCRIPTION]
- [RELATED_BUG_2]: [RELATIONSHIP_DESCRIPTION]

**Dependencies**:
- Depends on: [BUG_OR_STORY_ID]
- Blocks: [BUG_OR_STORY_ID]

---

## Metadata

**Template Used**: `.claude/templates/phase4-defect-report.template.md`
**Report Saved To**: `.memory-bank/docs/qa-analysis-reports/defects/[DEFECT_ID]_[DATE].md`
**Auto-Created**: [YES (by defect-management-agent) / NO (manual)]
**Jira Ticket**: [JIRA_BUG_URL]

---

*Phase 4 - Defect Management Agent - To be fully implemented in future phases*
