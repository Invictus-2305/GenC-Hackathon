// Playwright Java Test Runner — local web backend
//
// Responsibilities:
//   1. Scan a Maven project's src/test/java for JUnit 5 test classes/methods
//   2. Run `mvn test -Dtest=...` as a child process on demand
//   3. Stream live stdout/stderr to the browser over WebSocket
//   4. Parse target/surefire-reports/*.xml after each run for pass/fail results
//
// Configure via environment variables (see README.md):
//   PROJECT_PATH  - absolute path to the Maven project root (default: cwd)
//   PORT          - port to serve the UI on (default: 4545)
//   MVN_CMD       - maven executable name (default: "mvn", use "mvn.cmd" on Windows)

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const express = require("express");
const { WebSocketServer } = require("ws");
const observer = require("./observer");

const PROJECT_PATH = path.resolve(process.env.PROJECT_PATH || process.cwd());
const PORT = parseInt(process.env.PORT || "4545", 10);
const MVN_CMD = process.env.MVN_CMD || (process.platform === "win32" ? "mvn.cmd" : "mvn");
const TEST_SRC_DIR = path.join(PROJECT_PATH, "src", "test", "java");
const SUREFIRE_DIR = path.join(PROJECT_PATH, "target", "surefire-reports");
const EVIDENCE_DIR = path.join(PROJECT_PATH, "target", "ai-observer");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
// Lets the browser load failure screenshots directly, e.g. /evidence/<testId>/screenshot.png
app.use("/evidence", express.static(EVIDENCE_DIR));

// ---------------------------------------------------------------------------
// In-memory run state (single active run at a time — this is a local dev tool)
// ---------------------------------------------------------------------------
let currentRun = null; // { id, status, targets, startedAt, finishedAt, log: [], summary }
const wsClients = new Set();

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const ws of wsClients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

// ---------------------------------------------------------------------------
// Test discovery — walks src/test/java, extracts classes + @Test methods
// ---------------------------------------------------------------------------
function walkJavaFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walkJavaFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".java")) {
      results.push(full);
    }
  }
  return results;
}

const TEST_ANNOTATIONS = new Set(["@Test", "@ParameterizedTest", "@RepeatedTest", "@TestFactory"]);

function countChar(str, ch) {
  let n = 0;
  for (const c of str) if (c === ch) n++;
  return n;
}

function parseJavaTestFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  const packageMatch = content.match(/^\s*package\s+([\w.]+)\s*;/m);
  const pkg = packageMatch ? packageMatch[1] : "";

  const classMatch = content.match(/(?:public|final|abstract|\s)*class\s+(\w+)/);
  if (!classMatch) return null;
  const className = classMatch[1];
  const fqcn = pkg ? `${pkg}.${className}` : className;

  const methods = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const isTestAnnotation = [...TEST_ANNOTATIONS].some((a) => trimmed === a || trimmed.startsWith(a + "("));
    if (!isTestAnnotation) continue;

    // Look ahead past any additional annotations for the method signature. Annotation
    // arguments can span multiple lines (e.g. a @Description(...) built from string
    // concatenation), so we track paren depth to know when we're still inside one.
    let depth = 0;
    for (let j = i + 1; j < Math.min(i + 25, lines.length); j++) {
      const line = lines[j];
      const t = line.trim();

      if (depth > 0) {
        depth += countChar(line, "(") - countChar(line, ")");
        if (depth < 0) depth = 0;
        continue; // still inside a multi-line annotation argument
      }
      if (t === "") continue;
      if (t.startsWith("@")) {
        depth = countChar(line, "(") - countChar(line, ")");
        if (depth < 0) depth = 0;
        continue;
      }

      const methodMatch = t.match(
        /(?:public|protected|private|static|final|synchronized|\s)*[\w<>,\s\[\]]+?\s+(\w+)\s*\([^)]*\)/
      );
      if (methodMatch) {
        methods.push(methodMatch[1]);
      }
      break;
    }
  }

  if (methods.length === 0) return null; // not a test class we care about

  return {
    fqcn,
    className,
    package: pkg,
    file: path.relative(PROJECT_PATH, filePath),
    methods,
  };
}

function discoverTests() {
  const files = walkJavaFiles(TEST_SRC_DIR);
  const classes = [];
  for (const file of files) {
    try {
      const parsed = parseJavaTestFile(file);
      if (parsed) classes.push(parsed);
    } catch (err) {
      console.error(`Failed to parse ${file}:`, err.message);
    }
  }
  classes.sort((a, b) => a.fqcn.localeCompare(b.fqcn));
  return classes;
}

// ---------------------------------------------------------------------------
// Surefire XML parsing (lightweight, regex based — surefire output is flat)
// ---------------------------------------------------------------------------
function parseSurefireReports(fqcnFilter) {
  if (!fs.existsSync(SUREFIRE_DIR)) return { suites: [], totals: null };

  const files = fs
    .readdirSync(SUREFIRE_DIR)
    .filter((f) => f.endsWith(".xml"))
    .filter((f) => !fqcnFilter || fqcnFilter.some((fqcn) => f.includes(fqcn)));

  const suites = [];
  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };

  for (const file of files) {
    const xml = fs.readFileSync(path.join(SUREFIRE_DIR, file), "utf8");

    // Extract attributes individually to prevent strict-ordering regex failures
    const suiteNameMatch = xml.match(/<testsuite[^>]*\bname="([^"]*)"/);
    const suiteTestsMatch = xml.match(/<testsuite[^>]*\btests="(\d+)"/);
    const suiteErrorsMatch = xml.match(/<testsuite[^>]*\berrors="(\d+)"/);
    const suiteSkippedMatch = xml.match(/<testsuite[^>]*\bskipped="(\d+)"/);
    const suiteFailuresMatch = xml.match(/<testsuite[^>]*\bfailures="(\d+)"/);
    const suiteTimeMatch = xml.match(/<testsuite[^>]*\btime="([\d.]+)"/);

    const suiteName = suiteNameMatch ? suiteNameMatch[1] : file.replace(/\.xml$/, "");

    const testcaseRegex = /<testcase\b([^>]*)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    const cases = [];
    let m;
    while ((m = testcaseRegex.exec(xml)) !== null) {
      const attrs = m[1];
      const inner = m[2] || "";
      const nameMatch = attrs.match(/\bname="([^"]*)"/);
      const timeMatch = attrs.match(/\btime="([\d.]+)"/);
      const name = nameMatch ? nameMatch[1] : "unknown";
      const time = timeMatch ? parseFloat(timeMatch[1]) : 0;

      let status = "passed";
      let message = null;
      const failMatch = inner.match(/<failure\b([^>]*?)(?:\/>|>([\s\S]*?)<\/failure>)/);
      const errMatch = inner.match(/<error\b([^>]*?)(?:\/>|>([\s\S]*?)<\/error>)/);
      const skipMatch = inner.match(/<skipped\b/);
      if (failMatch) {
        status = "failed";
        const msgAttr = failMatch[1].match(/\bmessage="([^"]*)"/);
        message = (msgAttr ? msgAttr[1] : "") + (failMatch[2] ? "\n" + failMatch[2].trim() : "");
      } else if (errMatch) {
        status = "error";
        const msgAttr = errMatch[1].match(/\bmessage="([^"]*)"/);
        message = (msgAttr ? msgAttr[1] : "") + (errMatch[2] ? "\n" + errMatch[2].trim() : "");
      } else if (skipMatch) {
        status = "skipped";
      }

      cases.push({ name, time, status, message });
    }

    suites.push({ name: suiteName, cases });

    // Increment totals securely based on individual matches
    if (suiteTestsMatch) totals.tests += parseInt(suiteTestsMatch[1], 10);
    if (suiteErrorsMatch) totals.errors += parseInt(suiteErrorsMatch[1], 10);
    if (suiteSkippedMatch) totals.skipped += parseInt(suiteSkippedMatch[1], 10);
    if (suiteFailuresMatch) totals.failures += parseInt(suiteFailuresMatch[1], 10);
    if (suiteTimeMatch) totals.time += parseFloat(suiteTimeMatch[1]);
  }

  return { suites, totals };
}

// ---------------------------------------------------------------------------
// Run execution
// ---------------------------------------------------------------------------
function buildDtest(targets) {
  // targets: array of strings like "com.foo.LoginTest" or "com.foo.LoginTest#testLogin"
  return targets.join(",");
}

function startRun(targets) {
  if (currentRun && currentRun.status === "running") {
    throw new Error("A run is already in progress");
  }

  const id = Date.now().toString(36);
  const args = ["test"];
  if (targets && targets.length > 0) {
    args.push(`-Dtest=${buildDtest(targets)}`);
  }
  args.push("-Dsurefire.failIfNoSpecifiedTests=false");

  currentRun = {
    id,
    status: "running",
    targets: targets || [],
    startedAt: Date.now(),
    finishedAt: null,
    log: [],
    summary: null,
    observations: [], // AI Observer results, populated only for tests that failed
  };

  broadcast({ type: "status", run: publicRunState() });

  const proc = spawn(MVN_CMD, args, { cwd: PROJECT_PATH, shell: process.platform === "win32" });

  const onData = (streamName) => (chunk) => {
    const text = chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue;
      currentRun.log.push(line);
      broadcast({ type: "log", runId: id, line });
    }
  };

  proc.stdout.on("data", onData("stdout"));
  proc.stderr.on("data", onData("stderr"));

  proc.on("error", (err) => {
    currentRun.status = "error";
    currentRun.finishedAt = Date.now();
    currentRun.log.push(`[runner] Failed to start Maven: ${err.message}`);
    broadcast({ type: "log", runId: id, line: `[runner] Failed to start Maven: ${err.message}` });
    broadcast({ type: "status", run: publicRunState() });
  });

  proc.on("close", (code) => {
    currentRun.finishedAt = Date.now();
    const fqcnFilter = (targets || []).map((t) => t.split("#")[0]);
    const parsed = parseSurefireReports(targets && targets.length > 0 ? fqcnFilter : null);
    currentRun.summary = parsed;

    if (code === 0) {
      currentRun.status = "passed";
    } else if (parsed.totals && (parsed.totals.failures > 0 || parsed.totals.errors > 0)) {
      currentRun.status = "failed";
    } else {
      currentRun.status = "error";
    }

    broadcast({ type: "status", run: publicRunState() });
    broadcast({ type: "summary", runId: id, summary: parsed });

    // AI Observer: only launched here, only for a run that actually failed. This is the one
    // and only trigger point — nothing watches the suite continuously.
    const hasFailures = parsed.totals && (parsed.totals.failures > 0 || parsed.totals.errors > 0);
    if (hasFailures) {
      runObserverForFailures(id, currentRun.startedAt).catch((err) => {
        broadcast({ type: "observer-error", runId: id, error: err.message });
      });
    }
  });

  return id;
}

// ---------------------------------------------------------------------------
// AI Observer trigger — evidence -> Claude, only for failed tests, only after a run
// ---------------------------------------------------------------------------
async function runObserverForFailures(runId, sinceTs) {
  const dirs = observer.findFailureDirs(PROJECT_PATH, sinceTs);
  if (dirs.length === 0) return;

  broadcast({ type: "observer-status", runId, message: `Analyzing ${dirs.length} failure(s)…` });

  for (const dir of dirs) {
    const testId = path.basename(dir);
    try {
      const bundle = observer.readFailureBundle(dir);
      broadcast({ type: "observer-status", runId, testId, message: `Reviewing ${bundle.manifest.testId}…` });

      const analysis = await observer.analyzeFailure(bundle);
      const evidenceUrls = {
        screenshot: bundle.manifest.screenshotFile
          ? `/evidence/${testId}/${bundle.manifest.screenshotFile}`
          : null,
        dom: bundle.manifest.domFile ? `/evidence/${testId}/${bundle.manifest.domFile}` : null,
        log: `/evidence/${testId}/steps.log`,
      };

      const result = { runId, testId, manifest: bundle.manifest, evidence: evidenceUrls, analysis };
      if (currentRun && currentRun.id === runId) currentRun.observations.push(result);
      broadcast({ type: "observer", ...result });
    } catch (err) {
      const result = { runId, testId, error: err.message };
      if (currentRun && currentRun.id === runId) currentRun.observations.push(result);
      broadcast({ type: "observer", ...result });
    }
  }
}

function publicRunState() {
  if (!currentRun) return null;
  return {
    id: currentRun.id,
    status: currentRun.status,
    targets: currentRun.targets,
    startedAt: currentRun.startedAt,
    finishedAt: currentRun.finishedAt,
  };
}

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------
app.get("/api/config", (req, res) => {
  res.json({
    projectPath: PROJECT_PATH,
    mvnCmd: MVN_CMD,
    // Updated to check for the Google/Gemini key instead of Anthropic
    observerEnabled: Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
  });
});

app.get("/api/tests", (req, res) => {
  try {
    const classes = discoverTests();
    res.json({ classes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/run", (req, res) => {
  const { targets } = req.body || {};
  try {
    const id = startRun(Array.isArray(targets) ? targets : []);
    res.json({ runId: id });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.get("/api/run/current", (req, res) => {
  res.json({
    run: publicRunState(),
    log: currentRun ? currentRun.log : [],
    summary: currentRun ? currentRun.summary : null,
    observations: currentRun ? currentRun.observations : [],
  });
});

const server = app.listen(PORT, () => {
  console.log(`Playwright test runner UI:  http://localhost:${PORT}`);
  console.log(`Project path:               ${PROJECT_PATH}`);
  console.log(`Maven command:              ${MVN_CMD}`);
  if (!fs.existsSync(TEST_SRC_DIR)) {
    console.warn(`Warning: ${TEST_SRC_DIR} does not exist. Set PROJECT_PATH to your Maven project root.`);
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.send(JSON.stringify({ type: "status", run: publicRunState() }));
  if (currentRun && currentRun.observations.length > 0) {
    for (const obs of currentRun.observations) {
      ws.send(JSON.stringify({ type: "observer", ...obs }));
    }
  }
  ws.on("close", () => wsClients.delete(ws));
});
