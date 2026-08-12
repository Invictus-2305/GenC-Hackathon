// AI Observer (LangChain + Gemini Implementation)
// -----------------------------------------------------------------------------
// This is intentionally NOT a continuous watcher. It only ever runs after a Maven
// test run finishes and only for tests that failed. It never touches passing tests.[cite: 1]
//
// How it finds work:
//   The Java project writes one folder per FAILED test to <PROJECT_PATH>/target/ai-observer/<testId>/:
//     steps.log      - chronological log of every @Step + browser console/network event[cite: 1]
//     screenshot.png - full-page screenshot at the moment of failure[cite: 1]
//     dom.html       - the live DOM at the moment of failure[cite: 1]
//     failure.json   - manifest: test id, exception, stack trace, URL, file pointers[cite: 1]
//   Passing tests clean their own folder up, so anything left here after a run is,
//   by construction, a failure that needs a look.[cite: 1]

const fs = require("fs");
const path = require("path");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");

const MODEL = "gemini-3.5-flash-lite";

const SYSTEM_PROMPT = `You are an AI test observer sitting next to a QA engineer who just ran an
automated Playwright + JUnit5 UI test suite against a web application (Page Object Model style).[cite: 1]
One test has failed. You are given:
  - the exception/assertion that JUnit reported[cite: 1]
  - a step-by-step log of what the test did right up to the failure (from Allure @Step
    annotations on Page Object methods, plus browser console errors, failed network
    requests, and HTTP error responses observed during the test)[cite: 1]
  - the live page DOM at the moment of failure[cite: 1]
  - a full-page screenshot at the moment of failure[cite: 1]

Your job is to determine, like an experienced human observer watching over the engineer's
shoulder, whether this failure is:

  "functional" — the web application itself is behaving incorrectly (a real bug: a broken
      feature, a server error, a validation that shouldn't have fired, missing data, a UI
      element that is genuinely broken or absent) — something a developer needs to fix.[cite: 1]

  "scripting" — the application is fine, but the test automation is at fault (a stale or wrong
      locator, a race condition/missing wait, hardcoded test data that collided, an outdated
      assumption about the page's structure, a timeout too short for a slow page) — something
      the test author needs to fix.[cite: 1]

Use the DOM and screenshot to check: does the element the test was looking for exist under a
different selector, is there a visible error/validation message from the app, is the app on an
unexpected page/state, etc. Be decisive: pick "uncertain" only if the evidence genuinely does
not point either way after considering DOM + screenshot + log together.[cite: 1]

Respond with ONLY a single fenced json code block, no prose outside of it, matching exactly
this shape:[cite: 1]

\`\`\`json
{
  "classification": "functional" | "scripting" | "uncertain",
  "confidence": "high" | "medium" | "low",
  "summary": "2-4 sentences in plain English explaining what went wrong and why you classified it this way",
  "evidence": ["short bullet citing a specific observation from the log/DOM/screenshot", "..."],
  "recommendedAction": "If functional: what to tell the person running the suite, and what should happen next (e.g. who to notify, what to check on the app side). If scripting: the concrete fix — which file/method, what's wrong with the locator/wait/assertion, and what to change it to.",
  "suggestedFix": {
    "file": "e.g. src/test/java/pages/LeavePage.java",
    "location": "e.g. applyLeave() - the date input locator",
    "fix": "concrete code-level suggestion, or null if classification is functional"
  }
}
\`\`\`
If classification is "functional", set "suggestedFix" to null.`; //[cite: 1]

/**
 * Scans <projectPath>/target/ai-observer for failure folders whose manifest (failure.json)
 * was written at or after `sinceTs`.[cite: 1] Only tests that failed have a folder at all — passing
 * tests clean up after themselves on the Java side.[cite: 1]
 */
function findFailureDirs(projectPath, sinceTs = 0) {
  const evidenceRoot = path.join(projectPath, "target", "ai-observer");
  if (!fs.existsSync(evidenceRoot)) return [];
  return fs
    .readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(evidenceRoot, d.name))
    .filter((dir) => {
      const manifestPath = path.join(dir, "failure.json");
      if (!fs.existsSync(manifestPath)) return false;
      try {
        return fs.statSync(manifestPath).mtimeMs >= sinceTs;
      } catch {
        return false;
      }
    });
}

function readFailureBundle(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "failure.json"), "utf8"));
  const bundle = { dir, manifest };

  if (manifest.screenshotFile) {
    const p = path.join(dir, manifest.screenshotFile);
    if (fs.existsSync(p)) bundle.screenshotBase64 = fs.readFileSync(p).toString("base64");
  }
  if (manifest.domFile) {
    const p = path.join(dir, manifest.domFile);
    if (fs.existsSync(p)) bundle.dom = fs.readFileSync(p, "utf8");
  }
  const logPath = path.join(dir, manifest.stepLogFile || "steps.log");
  if (fs.existsSync(logPath)) bundle.stepLog = fs.readFileSync(logPath, "utf8");

  return bundle;
}

function truncate(str, max) {
  if (!str) return str;
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n...[truncated ${str.length - max} more characters]...`;
}

function buildUserPrompt(manifest, domExcerpt, logExcerpt) {
  return [
    `Test: ${manifest.testId} (${manifest.displayName || ""})`,
    `URL at time of failure: ${manifest.url}`,
    `Exception type: ${manifest.exceptionType}`,
    `Exception message: ${manifest.exceptionMessage}`,
    ``,
    `Stack trace:`,
    manifest.stackTrace || "(none)",
    ``,
    `Step-by-step log leading up to the failure (page actions + browser console/network events):`,
    logExcerpt || "(no log captured)",
    ``,
    `Page DOM at the moment of failure (may be truncated):`,
    domExcerpt || "(no DOM captured)",
    ``,
    `A full-page screenshot at the moment of failure is attached below as an image.`
  ].join("\n");
}

function parseAnalysis(text, manifest) {
  const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      return { ...parsed, testId: manifest.testId };
    } catch {
      // fall through to raw-text fallback below
    }
  }
  return {
    classification: "uncertain",
    confidence: "low",
    summary: text.slice(0, 2000) || "The AI Observer did not return a parseable response.",
    evidence: [],
    recommendedAction: "Review manually — the observer's response could not be parsed.",
    suggestedFix: null,
    testId: manifest.testId,
    parseError: true,
  };
}

/**
 * Sends one failure's evidence bundle to Gemini via LangChain and returns the parsed classification.
 * This is the only place an API call happens — one call per failed test, only after a run.[cite: 1]
 */
async function analyzeFailure(bundle, opts = {}) {
  // Checks for GOOGLE_API_KEY standard to standard Langchain/Google implementations
  const apiKey = opts.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      classification: "unknown",
      confidence: "low",
      summary: "AI Observer is disabled: GOOGLE_API_KEY is not set on the server.",
      evidence: [],
      recommendedAction: "Set GOOGLE_API_KEY and restart the runner to enable failure analysis.",
      suggestedFix: null,
      testId: bundle.manifest.testId,
      disabled: true,
    };
  }

  // Initialize the LangChain Google Generative AI Chat Model
  const model = new ChatGoogleGenerativeAI({
    apiKey: apiKey,
    model: MODEL, // <--- CHANGED: Use 'model' instead of 'modelName'
    maxOutputTokens: 1500,
  });

  const { manifest } = bundle;
  const domExcerpt = truncate(bundle.dom, 12000);
  const logExcerpt = truncate(bundle.stepLog, 8000);

  // Construct the Multimodal content array for LangChain standard format
  const contentBlocks = [
    { 
      type: "text", 
      text: buildUserPrompt(manifest, domExcerpt, logExcerpt) 
    }
  ];

  if (bundle.screenshotBase64) {
    contentBlocks.push({
      type: "image_url",
      // <--- CHANGED: Pass the base64 string directly instead of a nested object
      image_url: `data:image/png;base64,${bundle.screenshotBase64}`, 
    });
  }

  // Build the message array with System and Human messages
  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage({ content: contentBlocks })
  ];

  // Invoke the model
  const response = await model.invoke(messages);
  
  // Extract text safely depending on what LangChain returns (string or complex block)
  let text = "";
  if (typeof response.content === "string") {
    text = response.content;
  } else if (Array.isArray(response.content)) {
    text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }

  return parseAnalysis(text, manifest);
}

module.exports = { findFailureDirs, readFailureBundle, analyzeFailure, MODEL };