# Phase 1: Analysis Report - [JIRA_STORY_ID]

**Feature**: [JIRA_STORY_TITLE]
**Analyst**: [ANALYST_NAME]
**Analysis Date**: [ANALYSIS_DATE]
**Status**: [DRAFT/REVIEW/FINAL]

---

## 1. Inputs Reviewed

### User Story & Acceptance Criteria
- **Story ID**: [JIRA_STORY_ID] - "[STORY_TITLE]"
- **Goal**: [USER_STORY_GOAL]
- **Acceptance Criteria Count**: [NUMBER] documented

**Acceptance Criteria Summary**:
1. [AC_1_SUMMARY]
2. [AC_2_SUMMARY]
3. [AC_3_SUMMARY]
4. [AC_4_SUMMARY]
5. [AC_5_SUMMARY]

### Technical Specification
- **Confluence Page**: [CONFLUENCE_PAGE_TITLE]
- **URL**: [CONFLUENCE_URL]
- **Key Technical Details**:
  - [TECHNICAL_DETAIL_1]
  - [TECHNICAL_DETAIL_2]
  - [TECHNICAL_DETAIL_3]

### Figma Prototype (Optional)
- **Design File**: [FIGMA_FILE_NAME]
- **URL**: [FIGMA_URL]
- **Screens Reviewed**: [NUMBER] screens
- **Key Design Elements**:
  - [DESIGN_ELEMENT_1]
  - [DESIGN_ELEMENT_2]

---

## 2. Requirement Breakdown

| Area | Key Requirement | Validation Focus |
| --- | --- | --- |
| **UI/UX** | [UI_REQUIREMENT_1] | [UI_VALIDATION_FOCUS_1] |
| **Functional** | [FUNCTIONAL_REQUIREMENT_1] | [FUNCTIONAL_VALIDATION_FOCUS_1] |
| **Accessibility** | [ACCESSIBILITY_REQUIREMENT] | [ACCESSIBILITY_VALIDATION] |
| **Responsiveness** | [RESPONSIVE_REQUIREMENT] | [RESPONSIVE_VALIDATION] |
| **Performance** | [PERFORMANCE_REQUIREMENT] | [PERFORMANCE_VALIDATION] |
| **Security** | [SECURITY_REQUIREMENT] | [SECURITY_VALIDATION] |

---

## 3. Test Environments

| Layer | Config |
| --- | --- |
| **Desktop Browsers** | Chrome [VERSION]+, Edge [VERSION]+, Firefox [VERSION]+ |
| **Mobile Web** | iOS Safari [VERSION]+ / Android Chrome [VERSION]+ |
| **Viewports** | Desktop: [MIN_WIDTH]×[MIN_HEIGHT] – [MAX_WIDTH]×[MAX_HEIGHT]; Tablet: [TABLET_SIZE]; Mobile: [MOBILE_SIZES] |
| **Data** | [DATA_SOURCE_DESCRIPTION] |
| **Test Environment URL** | [TEST_ENVIRONMENT_URL] |
| **Authentication** | [AUTH_MECHANISM] |

---

## 4. Entry / Exit Criteria

### Entry Criteria
- ✅ User story + acceptance criteria finalized in Jira
- ✅ [ADDITIONAL_ENTRY_CRITERION_1]
- ✅ [ADDITIONAL_ENTRY_CRITERION_2]
- ✅ [ADDITIONAL_ENTRY_CRITERION_3]

### Exit Criteria
- 🎯 All test cases executed and passed on [PLATFORMS]
- 🎯 0 Blocker defects, 0 Critical defects, [ACCEPTABLE_MAJOR_COUNT] Major defects
- 🎯 [ADDITIONAL_EXIT_CRITERION_1]
- 🎯 [ADDITIONAL_EXIT_CRITERION_2]
- 🎯 Analysis report reviewed with Product Owner

---

## 5. Test Case Mapping (Functional Coverage)

| TC ID | Title | Objective / Coverage | Expected Result |
| --- | --- | --- | --- |
| **TC1** | **[TEST_CASE_1_TITLE]** | [TEST_CASE_1_OBJECTIVE] | [TEST_CASE_1_EXPECTED_RESULT] |
| **TC2** | **[TEST_CASE_2_TITLE]** | [TEST_CASE_2_OBJECTIVE] | [TEST_CASE_2_EXPECTED_RESULT] |
| **TC3** | **[TEST_CASE_3_TITLE]** | [TEST_CASE_3_OBJECTIVE] | [TEST_CASE_3_EXPECTED_RESULT] |
| **TC4** | **[TEST_CASE_4_TITLE]** | [TEST_CASE_4_OBJECTIVE] | [TEST_CASE_4_EXPECTED_RESULT] |
| **TC5** | **[TEST_CASE_5_TITLE]** | [TEST_CASE_5_OBJECTIVE] | [TEST_CASE_5_EXPECTED_RESULT] |

*Note: This is high-level test case mapping. Detailed step-by-step test plans will be generated in Phase 2.*

---

## 5.5. AC Triage

| AC # | AC Summary | Score | Classification | Merge Group | Rationale |
|------|------------|-------|---------------|-------------|-----------|
| AC[N] | [AC_SUMMARY] | [0-4] | [TEST/MERGE/SKIP/GAP] | [TARGET_AC or -] | [BRIEF_REASON] |

**Triage Summary:**
- TEST: [T] ACs → [T] tests
- MERGE: [M] ACs → [MG] tests (in [MG] groups)
- SKIP: [S] ACs → 0 tests
- GAP: [G] scenarios → [G] tests
- **Effective Test Budget: [T + MG + G] tests** (from [TOTAL_AC] ACs)
- Safety Net (upper bound): [TOTAL_AC × 1.5] = [MAX] tests

---

## 6. Risk Analysis (Optional - for high-risk or backend features)

| Risk | Description | Mitigation |
| --- | --- | --- |
| **[RISK_1_NAME]** | [RISK_1_DESCRIPTION] | [RISK_1_MITIGATION] |
| **[RISK_2_NAME]** | [RISK_2_DESCRIPTION] | [RISK_2_MITIGATION] |
| **[RISK_3_NAME]** | [RISK_3_DESCRIPTION] | [RISK_3_MITIGATION] |

---

## 7. Gap Analysis

### Critical Gaps Found ([NUMBER])
1. **[GAP_1_TITLE]**: [GAP_1_DESCRIPTION]
   - **Impact**: [HIGH/MEDIUM/LOW]
   - **Recommendation**: [GAP_1_RECOMMENDATION]

2. **[GAP_2_TITLE]**: [GAP_2_DESCRIPTION]
   - **Impact**: [HIGH/MEDIUM/LOW]
   - **Recommendation**: [GAP_2_RECOMMENDATION]

3. **[GAP_3_TITLE]**: [GAP_3_DESCRIPTION]
   - **Impact**: [HIGH/MEDIUM/LOW]
   - **Recommendation**: [GAP_3_RECOMMENDATION]

### Missing Edge Cases ([NUMBER])
1. **[EDGE_CASE_1]**: [EDGE_CASE_1_DESCRIPTION]
2. **[EDGE_CASE_2]**: [EDGE_CASE_2_DESCRIPTION]
3. **[EDGE_CASE_3]**: [EDGE_CASE_3_DESCRIPTION]
4. **[EDGE_CASE_4]**: [EDGE_CASE_4_DESCRIPTION]
5. **[EDGE_CASE_5]**: [EDGE_CASE_5_DESCRIPTION]

### Recommendations
1. **[RECOMMENDATION_1]**: [RECOMMENDATION_1_DETAILS]
2. **[RECOMMENDATION_2]**: [RECOMMENDATION_2_DETAILS]
3. **[RECOMMENDATION_3]**: [RECOMMENDATION_3_DETAILS]

---

## 8. Overall Assessment

**Completeness Score**: [SCORE]/100
- **Acceptance Criteria Clarity**: [SCORE]/25
- **Technical Specification Depth**: [SCORE]/25
- **Edge Case Coverage**: [SCORE]/25
- **Testability**: [SCORE]/25

**Risk Level**: [LOW/MEDIUM/HIGH] ([RISK_SCORE]/10)
- **Defect Density (Historical)**: [PERCENTAGE]% in similar features
- **Complexity Score**: [SCORE]/10
- **Integration Points**: [NUMBER]
- **Team Experience**: [HIGH/MEDIUM/LOW]

**Recommended Action**: [REQUEST_CLARIFICATION/PROCEED_WITH_CAUTION/APPROVED_FOR_DEVELOPMENT]

---

## Metadata

**Template Used**: `.claude/templates/phase1-analysis-report.template.md`
**Report Saved To**: `.memory-bank/docs/qa-analysis-reports/[JIRA_STORY_ID]_phase1_analysis_[DATE].md`
**Jira Link**: [JIRA_STORY_URL]
**Confluence Link**: [CONFLUENCE_PAGE_URL]
**Figma Link**: [FIGMA_URL]

**Related Stories**: [RELATED_STORY_1], [RELATED_STORY_2]
**Dependencies**: [DEPENDENCY_1], [DEPENDENCY_2]

---

## Next Steps

1. [ ] Review gap analysis findings with Product Owner
2. [ ] Clarify [NUMBER] unclear acceptance criteria
3. [ ] Update technical specification with missing details
4. [ ] Proceed to Phase 2: Test Planning once gaps addressed
5. [ ] Update Jira custom field "QA Analysis Status" to "Reviewed"

---

*This analysis report was generated by the AI QA Assistant Analysis QA Agent (Phase 1). For questions or feedback, consult the QA team lead.*
