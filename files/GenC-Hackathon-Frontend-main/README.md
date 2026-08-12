# Playwright Java Test Runner (local web UI)

A small local web app that replaces `mvn test` on the CLI with a browser UI:
it scans your Maven project for JUnit 5 `@Test` methods, lets you pick which
ones to run (or run everything), and streams the live Maven output plus
pass/fail results from Surefire.

It does **not** re-implement test execution — it just shells out to your
existing `mvn test` under the hood, the same way you run it today.

## Requirements

- Node.js 16+ (for the small backend server)
- Your existing Maven + Java setup, exactly as you use it now (`mvn` on your
  PATH, Playwright browsers already installed, etc.)
- Your Playwright test project, using **Maven** + **JUnit 5** (`@Test` from
  `org.junit.jupiter.api`)
- (Optional, for AI Observer) an Anthropic API key

## Setup

1. Copy this `playwright-runner` folder anywhere on your machine — it does
   **not** need to live inside your test project.
2. Install the dependencies:

   ```bash
   cd playwright-runner
   npm install
   ```

3. (Optional) Enable the AI Observer by setting an API key:

   ```bash
   # macOS / Linux
   export ANTHROPIC_API_KEY=sk-ant-...

   # Windows (PowerShell)
   $env:ANTHROPIC_API_KEY="sk-ant-..."
   ```

   Without this set, everything still works exactly as before — tests run,
   results show up — the AI Observer panel just stays disabled (you'll see a
   note about it in the console on load).

4. Point it at your Maven project and start it:

   ```bash
   # macOS / Linux
   PROJECT_PATH=/absolute/path/to/your/playwright-project npm start

   # Windows (PowerShell)
   $env:PROJECT_PATH="C:\path\to\your\playwright-project"; npm start
   ```

   `PROJECT_PATH` must be the folder that contains `pom.xml` and
   `src/test/java`.

5. Open **http://localhost:4545** in your browser.

If you don't set `PROJECT_PATH`, it defaults to the directory you ran
`npm start` from — so running it from inside your test project also works:

```bash
cd /path/to/your/playwright-project
node /path/to/playwright-runner/server.js
```

## Using it

- The left sidebar lists every test class found under `src/test/java` that
  has `@Test` / `@ParameterizedTest` / `@RepeatedTest` methods. Click a class
  to expand its methods.
- Check individual methods and click **Run selected**, or click **Run all
  tests** to run the whole suite (equivalent to plain `mvn test`).
- The console panel streams Maven's real output live, exactly like the CLI.
- After the run finishes, each class/method gets a colored status (green =
  passed, red = failed/error, grey = skipped), pulled from
  `target/surefire-reports/*.xml`. The chips above the console show the
  totals.
- Only one run happens at a time — this mirrors running `mvn test` in a
  single terminal.

## AI Observer

The AI Observer is **not** a continuous watcher — it does nothing while tests are running or
passing. The instant a Maven run finishes, if (and only if) the results show one or more
failures, the runner:

1. Looks in `<PROJECT_PATH>/target/ai-observer/` for the evidence folders the Java test project
   leaves behind for each failed test (screenshot, DOM snapshot, step-by-step log, exception
   details — see the test project's README for how those are captured). Passing tests don't
   leave a folder, so this is naturally scoped to just the failures.
2. Sends that evidence, one failed test at a time, to Claude with instructions to act like a
   human observer reviewing the failure: decide whether it's a **functional issue** (the app is
   actually broken — something to report and hand off) or a **scripting issue** (the automation
   itself needs a fix — a stale locator, a missing wait, bad test data, etc.), and explain why.
3. Streams each result into a new **AI Observer** panel below the console, showing:
   - a Functional/Scripting badge with a confidence level
   - a plain-English summary of what happened
   - the specific evidence the observer used to reach that conclusion
   - a recommended action (who to tell / what to check, for functional issues) or a concrete
     suggested fix (which file, which locator/wait, and what to change it to, for scripting
     issues)
   - links to the raw screenshot, DOM snapshot, and step log for that test

This only runs against tests that actually failed, and it's a single API call per failed test,
made once, right after the run — not a background process.

## Configuration

Environment variables (set before `npm start`):

| Variable       | Default              | Purpose                                      |
|----------------|----------------------|-----------------------------------------------|
| `PROJECT_PATH` | current directory    | Root of the Maven project to scan/run         |
| `PORT`         | `4545`               | Port the UI is served on                      |
| `MVN_CMD`      | `mvn` (`mvn.cmd` on Windows) | Maven executable to invoke              |
| `ANTHROPIC_API_KEY` | (unset — AI Observer disabled) | Enables the AI Observer for failure analysis |

## How it works

- **Discovery**: `server.js` walks `src/test/java`, and for each `.java`
  file, records the class's fully-qualified name and every method preceded
  by a JUnit 5 test annotation. This is a lightweight source scan (not a
  compiler), so it expects fairly conventional formatting — one top-level
  class per file, standard annotation-then-method layout.
- **Running**: clicking Run sends the selected targets to `POST /api/run`,
  which spawns `mvn test -Dtest=Class1,Class2#method` in your project
  directory — the same flag you'd use by hand to run a subset of tests.
- **Live output**: the backend streams the child process's stdout/stderr
  line-by-line over a WebSocket to every connected browser tab.
- **Results**: once Maven exits, the backend parses
  `target/surefire-reports/*.xml` (the same files IDEs and CI dashboards
  read) to get per-test pass/fail/skip status and failure messages.
- **AI Observer**: if that result shows any failures, the backend then (and only then) reads
  the evidence folders the Java project left under `target/ai-observer/` and sends each one to
  Claude for a functional-vs-scripting classification — see the AI Observer section above.

## Known limitations

- One run at a time — starting a new run while one is in progress is
  blocked, matching how a single terminal behaves.
- The source scanner is regex-based, so unusual formatting (multiple public
  classes per file, test annotations from a custom/aliased import, etc.) may
  not be picked up. If a class doesn't appear, running it manually with
  `-Dtest=` still works — only the UI listing is affected, not execution.
- No authentication — this is meant to run on `localhost` for one developer,
  not to be exposed on a network.
