# MVP Scope Freeze — [PROJECT_NAME]

> Generated: [DATE]
> Readiness: [SCORE]%

## 1. Purpose & MVP Goal

- **What MVP delivers:**
- **Based on:** [source documents]
- **Intended to be:** [usable / stable / deployable / demo-able]
- **Definition of done:** [what "MVP complete" means measurably]

## 2. Supported Platforms & Entry Points

- **Platforms:** [web / iOS / Android / desktop / API-only]
- **Access points:** [URL / mobile store / SSO portal]
- **Browser matrix:** [Chrome, Firefox, Safari, Edge — versions]
- **Explicitly excluded:**

## 3. Authentication & User Identity

- **Auth method:** [CONFIRMED / ASSUMED]
- **Identity handling:**
- **Token management:**
- **Session policy:** [timeout, refresh, concurrent sessions]
- **Password / credential policy:** [complexity, rotation, MFA]

## 4. Core Functionalities (MVP)

### 4.1 [Feature name] — Priority: [MUST / SHOULD / COULD]

- **Description:**
- **User can:**
- **System behavior:**
- **Source:** [document, date] [CONFIRMED / ASSUMED]
- **Related requirements:** [BR-001, BR-003]

### 4.2 [Feature name] — Priority: [MUST / SHOULD / COULD]

…

## 5. Non-Functional Requirements

### 5.1 Performance targets

| Metric | Target | Measured where |
|---|---|---|
| P95 page load | < 2s | real-user monitoring |
| P95 API latency | < 500ms | server metrics |
| Concurrent users | [N] | load test |
| Throughput | [req/sec] | synthetic test |

### 5.2 Security baselines

- **Authentication:** [method — OAuth / SAML / JWT / session]
- **Authorization model:** [RBAC / ABAC / ACL]
- **Encryption in transit:** [TLS version]
- **Encryption at rest:** [algorithm, key rotation]
- **Secrets management:** [vault / env / KMS]
- **Audit logging:** [events captured, retention]

### 5.3 Accessibility

- **Target standard:** [WCAG 2.1 AA / AAA / none]
- **Assistive tech supported:** [screen readers, keyboard-only, high contrast]
- **Testing tool:** [axe / Lighthouse / manual]

### 5.4 Localization

- **Languages supported at MVP:** [list or "English only"]
- **Post-MVP languages:**
- **Date / number / currency formatting:** [locale strategy]

## 6. Data & Privacy Scope

- **Data collected:** [categories — PII, financial, health, usage, …]
- **Where stored:** [region, provider, service]
- **Retention policy:** [duration per category]
- **User rights supported:** [access / export / delete]
- **GDPR disposition:** [controller / processor / not applicable]
- **Legal basis:** [consent / contract / legitimate interest]
- **Data processing agreements needed:** [list]

## 7. Analytics & Telemetry Scope

- **Product analytics tool:** [Amplitude / Mixpanel / GA4 / none]
- **Events tracked at MVP:** [core funnel events, not exhaustive]
- **Error monitoring:** [Sentry / Datadog / Rollbar / none]
- **Performance monitoring:** [RUM tool / APM tool]
- **PII handling in telemetry:** [scrubbing rules]

## 8. Integration Points

| Integration | Direction | Protocol | Authentication | Criticality |
|---|---|---|---|---|
| [System] | in / out / both | REST / webhook / SFTP / SDK | OAuth / API key / mTLS | critical / nice-to-have |

## 9. Deployment & Distribution

- **Distribution method:** [direct deploy / app store / customer install]
- **Hosting model:** [cloud / on-prem / hybrid]
- **Infrastructure-as-code:** [Terraform / Pulumi / manual]
- **CI/CD:** [platform + branch strategy]
- **Environments:** [dev / staging / prod]
- **Source:** [CONFIRMED / ASSUMED]

## 10. UI/UX Scope

- **Branding elements:** [logo, colors, typography]
- **Design system / library:** [existing / new]
- **Design constraints:**
- **Responsive breakpoints:** [mobile / tablet / desktop]

## 11. Out of Scope for MVP

| Item | Rationale | Target release | Source |
|---|---|---|---|
|  |  | v1.1 / v2 / unplanned | [document, date] |

## 12. Release Criteria (quality gates)

MVP cannot ship until:

- [ ] All MUST requirements implemented and confirmed
- [ ] Test pass rate ≥ [X]%
- [ ] No BLOCKER or CRITICAL defects open
- [ ] Performance targets met (section 5.1)
- [ ] Accessibility target met (section 5.3)
- [ ] Security review passed
- [ ] Data processing agreements signed (if applicable)
- [ ] Rollback plan documented and rehearsed
- [ ] Runbooks / support docs complete

## 13. Rollback & Migration Plan

- **Data migration:** [none / one-time / incremental / dual-write]
- **Rollback trigger:** [conditions that force rollback]
- **Rollback procedure:** [steps, RTO, RPO]
- **Legacy system cutover:** [big-bang / phased / parallel running]

## 14. Support & SLA

- **Support hours:** [business / 24×7 / on-call]
- **Response SLA by severity:** [P1: 1h / P2: 4h / P3: 1d]
- **Escalation path:**
- **On-call rotation (post-launch):** [team / provider]
- **Handoff to support plan:** [documentation, training, knowledge transfer]

## 15. Assumptions & Risks

### Assumptions [NEED VALIDATION]

| ID | Assumption | Basis | Risk if wrong | Validate with |
|---|---|---|---|---|
| ASM-001 |  |  |  |  |

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 |  |  |  |  |

## 16. Sign-off

| Role | Name | Date | Status |
|---|---|---|---|
| Client |  |  | approved / pending |
| PO |  |  |  |
| Tech Lead |  |  |  |
| QA Lead |  |  |  |

---
*Prepared by Crnogochi*
