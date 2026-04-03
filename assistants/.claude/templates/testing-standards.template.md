# Testing Standards

<!-- TEMPLATE_STATUS: UNCONFIGURED -->

## 1. Browser & Platform Matrix

### Desktop

| Browser | Min Version | Automation |
|---------|-------------|------------|
| Chrome | 120+ | YES (default) |
| Edge | 120+ | NO |
| Firefox | 115+ | NO |
| Safari | 17+ | NO |

### Mobile & Screen Resolutions

| Platform / Resolution | Type | Priority | Automation |
|-----------------------|------|----------|------------|
| 1920x1080 | Desktop FHD | P1 | YES (default) |
| 1366x768 | Desktop HD | P2 | NO |
| iOS Safari 375x667 | Mobile (iPhone SE) | P2 | NO |
| Android Chrome 360x740 | Mobile (Android) | P2 | NO |

## 2. Exit Criteria

| Metric | Threshold | Blocking |
|--------|-----------|----------|
| Pass Rate | [95%] | < [90%] |
| AC Coverage | 100% | < 100% |
| Blocker Defects | 0 | > 0 |

## 3. Auth

**Method**: [SESSION|OAUTH|JWT|NONE]
**Credentials Location**: e2e/.env

## 4. ReportPortal

**Enabled**: [YES|NO]
**Project**: [RP_PROJECT_NAME]
