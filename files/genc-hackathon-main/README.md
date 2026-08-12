# OrangeHRM End-to-End Tests — Playwright + Java + Allure

Tests the public OrangeHRM demo (`https://opensource-demo.orangehrmlive.com`)
using the standard demo credentials `Admin / admin123`.

Stack: **Playwright for Java**, **JUnit 5**, **Maven**, **Allure Reports**,
Page Object Model.

## Folder structure — what goes where

```
orangehrm-java-allure/
├── pom.xml                                    # all dependencies + Allure/Surefire config
├── README.md
└── src/test/
    ├── java/
    │   ├── pages/                             # one file per app page/module
    │   │   ├── LoginPage.java                 # login form, error state
    │   │   ├── DashboardPage.java             # widgets, logout
    │   │   ├── PimPage.java                   # add employee, search employee
    │   │   └── LeavePage.java                 # apply leave
    │   ├── tests/
    │   │   ├── BaseTest.java                  # Playwright/Browser lifecycle
    │   │   │                                   # + auto screenshot-on-failure hook
    │   │   │                                   # + AI Observer evidence capture on failure
    │   │   └── OrangeHrmE2ETest.java          # actual test scenarios (@Order 1-7)
    │   └── utils/
    │       ├── ScreenshotUtils.java           # attaches PNGs to Allure report
    │       ├── EvidenceLogger.java            # per-test steps.log for the AI Observer
    │       ├── AllureStepLogger.java          # mirrors @Step events into steps.log
    │       └── FailureEvidence.java           # screenshot + DOM + manifest on failure
    └── resources/
        ├── allure.properties                  # tells Allure where results go
        ├── junit-platform.properties          # JUnit runtime config
        └── META-INF/services/
            io.qameta.allure.listener.StepLifecycleListener  # registers AllureStepLogger
```

**Rule of thumb for adding new tests:**
- New page/module of the app → new file in `pages/`
- New test scenario → new `@Test` method in `tests/OrangeHrmE2ETest.java`
  (or a new `*Test.java` class in `tests/` extending `BaseTest`)
- Reusable helper (screenshots, data generators, API calls) → `utils/`

## Prerequisites

- Java 17+
- Maven 3.8+
- Allure CLI (only needed for `allure serve`/`allure generate` — see below)
  - Mac: `brew install allure`
  - Windows: `scoop install allure`
  - Or use the Maven plugin (`mvn allure:serve`) which needs no separate install

## Setup

```bash
mvn install
mvn exec:java -e -D exec.mainClass=com.microsoft.playwright.CLI -D exec.args="install --with-deps chromium"
```

## Run tests

```bash
mvn test                              # headless, all tests
mvn test -Dheaded=true                # see the browser
mvn test -Dtest=OrangeHrmE2ETest#applyForLeave   # single test method
mvn test -DbaseUrl=https://your-instance.com     # different environment
```

Raw Allure result JSON files land in `target/allure-results/` after every run.

## View the Allure report

**Option A — one-shot, opens in browser automatically:**
```bash
mvn allure:serve
```

**Option B — generate static HTML you can share/host:**
```bash
mvn allure:report
# open target/allure-report/index.html
```

**Option C — if you installed the Allure CLI separately:**
```bash
allure serve target/allure-results
```

The report includes:
- Pass/fail/broken breakdown by `@Epic` → `@Feature` → `@Story`
- Step-by-step breakdown of each test (from the `@Step` annotations in Page Objects)
- Screenshots auto-attached on any failure
- Playwright trace files also saved separately to `target/traces/*.zip`
  (open with `mvn exec:java -D exec.mainClass=com.microsoft.playwright.CLI -D exec.args="show-trace target/traces/<file>.zip"`)

## Scenarios covered

| # | Scenario | Story | Severity |
|---|----------|-------|----------|
| 1 | Invalid login | Login | Normal |
| 2 | Valid login → Dashboard | Login | Blocker |
| 3 | Add employee (PIM) | PIM - Employee management | Critical |
| 4 | Verify employee in list | PIM - Employee management | Normal |
| 5 | Apply leave | Leave management | Critical |
| 6 | Logout | Login | Normal |
| 7 | Full journey (login→add→leave→logout) | Full user journey | Blocker |

## AI Observer

When a test fails, the suite doesn't just screenshot and quit — it captures a full evidence
bundle *before* the browser closes, and leaves it in `target/ai-observer/<TestClass>.<method>/`:

| File | What it is |
|---|---|
| `steps.log` | Timestamped trail of every `@Step` action (auto-captured from the existing Allure `@Step` annotations on your Page Objects — no code changes needed there), plus browser console errors, failed network requests, and HTTP 4xx/5xx responses observed during the test. |
| `screenshot.png` | Full-page screenshot at the moment of failure. |
| `dom.html` | The live page DOM at the moment of failure. |
| `failure.json` | Manifest: test id, exception type/message, stack trace, URL, and pointers to the files above. |

This is evidence collection only — nothing here calls an AI model. Passing tests get their
`target/ai-observer/<test>/` folder deleted automatically during cleanup, so only genuine
failures leave anything behind. The actual analysis (functional vs. scripting classification)
happens in the companion **Test Runner** web UI (`GenC-Hackathon-Frontend`), which is triggered
once, only after a run finishes, only for tests that failed — see that project's README for
setup (it needs `ANTHROPIC_API_KEY`).

You can also just open these files by hand if you're not using the UI — `steps.log` and
`dom.html` are plain text, `screenshot.png` opens in any image viewer.

## Notes

- Employee names include a timestamp suffix so re-runs don't collide with
  previously created demo records.
- Tests run in explicit `@Order` since steps 3/4 and 7 depend on data
  created earlier in the same class run.
- `BaseTest`'s `FailureWatcher` automatically screenshots the page the
  instant a test fails, before context teardown — no need to add manual
  try/catch screenshot code in every test.
- For CI, publish `target/allure-results/` as a build artifact, then run
  the Allure report-generation step in your pipeline (most CI systems —
  Jenkins, GitHub Actions, GitLab — have a ready-made Allure plugin/action).
