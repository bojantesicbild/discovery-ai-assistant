# [PROJECT_NAME] - Test Automation Suite

**Story**: [JIRA_STORY_ID]
**Generated**: [GENERATION_DATE]
**Framework**: Playwright + TypeScript
**Agent**: qa-automation-agent

---

## 📋 Table of Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running Tests](#running-tests)
- [Test Configuration](#test-configuration)
- [Page Object Model](#page-object-model)
- [Test Data & Fixtures](#test-data--fixtures)
- [CI/CD Integration](#cicd-integration)
- [Reporting](#reporting)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

---

## Overview

This test automation suite provides comprehensive end-to-end testing for [FEATURE_NAME] using Playwright and TypeScript.

**Coverage:**
- ✅ [X] test cases automated
- ✅ Cross-browser testing (Chrome, Firefox, Safari)
- ✅ Mobile/tablet testing (iOS, Android)
- ✅ Self-healing selectors for maintainability
- ✅ Page Object Model for code reusability
- ✅ CI/CD ready with GitHub Actions/Jenkins

**Test Categories:**
- Functional tests: [X] tests
- UI tests: [X] tests
- Integration tests: [X] tests
- Regression tests: [X] tests

---

## Project Structure

```
tests/
├── [feature-name]/
│   ├── [test-suite-1].spec.ts         # Test files
│   ├── [test-suite-2].spec.ts
│   └── [test-suite-3].spec.ts
│
pages/
├── [Page1]Page.ts                      # Page Object Model classes
├── [Page2]Page.ts
└── BasePage.ts                         # Base page with common methods
│
fixtures/
├── test-fixtures.ts                    # Custom Playwright fixtures
├── test-data.json                      # Test data
└── auth-state.json                     # Saved authentication state
│
test-results/                           # Test execution results
├── results.json                        # JSON results
├── junit.xml                           # JUnit XML for CI
└── screenshots/                        # Failure screenshots
│
playwright-report/                      # HTML test report
│
playwright.config.ts                    # Playwright configuration
package.json                            # Dependencies
tsconfig.json                           # TypeScript configuration
└── README.md                           # This file
```

---

## Prerequisites

**Required:**
- Node.js >= 16.x
- npm >= 8.x

**Optional:**
- Docker (for containerized testing)
- ReportPortal (for centralized reporting)

---

## Installation

### 1. Install Dependencies

```bash
# Install all dependencies including Playwright browsers
npm install

# Install Playwright browsers only
npx playwright install

# Install Playwright with system dependencies (Linux)
npx playwright install --with-deps
```

### 2. Environment Setup

Create `.env` file in project root:

```bash
# Application URLs
BASE_URL=https://staging.example.com
API_BASE_URL=https://api.staging.example.com

# Test credentials
TEST_USER_EMAIL=[TEST_EMAIL]
TEST_USER_PASSWORD=[TEST_PASSWORD]

# API keys (if needed)
API_KEY=[YOUR_API_KEY]

# ReportPortal (optional)
REPORTPORTAL_API_KEY=[YOUR_RP_API_KEY]
REPORTPORTAL_ENDPOINT=https://reportportal.example.com
REPORTPORTAL_PROJECT=[PROJECT_NAME]
```

### 3. Verify Installation

```bash
# Run sample test to verify setup
npx playwright test tests/example.spec.ts --headed
```

---

## Running Tests

### Basic Commands

```bash
# Run all tests
npm run test

# Run all tests (alias)
npx playwright test

# Run specific test file
npx playwright test tests/[feature-name]/[test-file].spec.ts

# Run tests matching pattern
npx playwright test [test-file-pattern]

# Run tests in headed mode (see browser)
npx playwright test --headed

# Run tests in debug mode
npx playwright test --debug

# Run tests in specific browser
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit

# Run mobile tests
npx playwright test --project="Mobile Chrome"
npx playwright test --project="Mobile Safari"
```

### Advanced Commands

```bash
# Run tests with tag
npx playwright test --grep @smoke

# Run tests excluding tag
npx playwright test --grep-invert @slow

# Run tests in parallel with 4 workers
npx playwright test --workers=4

# Run tests and update snapshots
npx playwright test --update-snapshots

# Run last failed tests only
npx playwright test --last-failed

# Run tests with trace
npx playwright test --trace on
```

### Package.json Scripts

```bash
# Run all tests
npm run test

# Run tests in CI mode
npm run test:ci

# Run tests with UI
npm run test:ui

# Run smoke tests only
npm run test:smoke

# Run regression suite
npm run test:regression

# Generate HTML report
npm run test:report
```

---

## Test Configuration

Configuration is managed in `playwright.config.ts`.

### Key Settings

```typescript
{
  timeout: 30000,              // Test timeout: 30 seconds
  retries: 2,                  // Retry failed tests 2 times (CI only)
  workers: 4,                  // Run 4 tests in parallel
  reporter: 'html',            // HTML report
  use: {
    baseURL: process.env.BASE_URL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  }
}
```

### Browser Projects

Tests run on:
- **Desktop**: Chromium, Firefox, WebKit
- **Mobile**: Pixel 5 (Chrome), iPhone 13 (Safari)
- **Tablet**: iPad Pro

Modify `playwright.config.ts` to add/remove browsers.

---

## Page Object Model

This project uses the **Page Object Model (POM)** design pattern.

### Structure

Each page is represented by a class in `pages/` directory:

```typescript
// pages/LoginPage.ts
export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.submitButton = page.getByRole('button', { name: 'Sign In' });
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
```

### Self-Healing Selectors

Locators use a **hierarchical fallback strategy** for resilience:

**Priority 1: Semantic Role** (most stable)
```typescript
page.getByRole('button', { name: 'Submit' })
```

**Priority 2: Test ID** (requires `data-testid`)
```typescript
page.getByTestId('submit-button')
```

**Priority 3: Text Content**
```typescript
page.getByText('Submit')
```

**Priority 4: CSS Selector** (fallback only)
```typescript
page.locator('.submit-btn')
```

### Usage in Tests

```typescript
import { LoginPage } from '../pages/LoginPage';

test('User can login', async ({ page }) => {
  const loginPage = new LoginPage(page);

  await loginPage.goto();
  await loginPage.login('user@example.com', 'password123');

  await expect(page).toHaveURL('/dashboard');
});
```

---

## Test Data & Fixtures

### Test Data Files

JSON fixtures stored in `fixtures/test-data.json`:

```json
{
  "users": [
    {
      "email": "test.user@example.com",
      "password": "Test123!",
      "name": "Test User"
    }
  ],
  "products": [
    {
      "id": "PROD-001",
      "name": "Test Product",
      "price": 99.99
    }
  ]
}
```

### Custom Fixtures

Reusable setup/teardown in `fixtures/test-fixtures.ts`:

```typescript
import { test, expect } from './test-fixtures';

test('Test with authenticated user', async ({ authenticatedPage, testUser }) => {
  // Page is already logged in
  // testUser data is available
});
```

Available fixtures:
- `authenticatedPage` - Pre-authenticated user session
- `testUser` - Test user data
- `testProduct` - Test product data
- `apiClient` - API client for backend calls

---

## CI/CD Integration

### GitHub Actions

`.github/workflows/playwright.yml`:

```yaml
name: Playwright Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Run tests
        run: npm run test:ci
        env:
          BASE_URL: ${{ secrets.STAGING_URL }}

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
```

### Jenkins Pipeline

`Jenkinsfile`:

```groovy
pipeline {
  agent any

  environment {
    BASE_URL = credentials('staging-url')
  }

  stages {
    stage('Install') {
      steps {
        sh 'npm ci'
        sh 'npx playwright install --with-deps'
      }
    }

    stage('Test') {
      steps {
        sh 'npm run test:ci'
      }
    }

    stage('Report') {
      steps {
        publishHTML([
          reportDir: 'playwright-report',
          reportFiles: 'index.html',
          reportName: 'Playwright Report'
        ])
      }
    }
  }

  post {
    always {
      junit 'test-results/junit.xml'
      archiveArtifacts artifacts: 'test-results/**/*'
    }
  }
}
```

---

## Reporting

### HTML Report

```bash
# Generate and open HTML report
npx playwright show-report
```

View at: `playwright-report/index.html`

### JSON Results

Results saved to: `test-results/results.json`

### JUnit XML

CI-compatible XML: `test-results/junit.xml`

### ReportPortal Integration

Configure in `playwright.config.ts` and run:

```bash
npm run test:reportportal
```

View dashboard at your ReportPortal instance.

---

## Troubleshooting

### Common Issues

#### Issue: "Browser not found"
**Solution:**
```bash
npx playwright install chromium
```

#### Issue: "Test timeout"
**Solutions:**
- Increase timeout in `playwright.config.ts`
- Check if app is slow/unavailable
- Add explicit waits: `await page.waitForLoadState('networkidle')`

#### Issue: "Element not found"
**Solutions:**
- Verify selector in Playwright Inspector: `npx playwright test --debug`
- Check if element exists on page
- Use fallback selectors

#### Issue: "Flaky tests"
**Solutions:**
- Avoid hard-coded waits (`page.waitForTimeout`)
- Use Playwright's auto-waiting
- Check for race conditions
- Enable retries for CI

### Debug Mode

```bash
# Run test in debug mode
npx playwright test --debug

# Run specific test in debug mode
npx playwright test tests/login.spec.ts --debug

# Open Playwright Inspector
npx playwright codegen [BASE_URL]
```

### Trace Viewer

```bash
# Run test with trace
npx playwright test --trace on

# View trace
npx playwright show-trace trace.zip
```

---

## Best Practices

### 1. Test Design
- ✅ One test = one objective
- ✅ Use AAA pattern (Arrange, Act, Assert)
- ✅ Descriptive test names
- ✅ Independent tests (no dependencies)

### 2. Selectors
- ✅ Prefer `getByRole()` and `getByLabel()`
- ✅ Add `data-testid` for unique elements
- ✅ Avoid CSS selectors
- ✅ Use Page Object Model

### 3. Waits
- ✅ Trust Playwright's auto-waiting
- ❌ Avoid `waitForTimeout()`
- ✅ Use `waitForLoadState()` for navigation
- ✅ Use `waitFor()` for specific conditions

### 4. Test Data
- ✅ Generate unique data per test
- ✅ Clean up test data after tests
- ✅ Use fixtures for reusable data
- ✅ Use Faker.js for realistic data

### 5. Maintainability
- ✅ Keep tests DRY (Don't Repeat Yourself)
- ✅ Use Page Objects
- ✅ Extract common logic to utilities
- ✅ Version control test artifacts

---

## 📞 Support

**Documentation:** https://playwright.dev/docs/intro
**Team Contact:** [QA_TEAM_CONTACT]
**Jira Story:** [JIRA_STORY_URL]

---

**Generated by**: qa-automation-agent
**Last Updated**: [GENERATION_DATE]
