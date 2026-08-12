(() => {
  const treeEl = document.getElementById("tree");
  const consoleEl = document.getElementById("console");
  const runSelectedBtn = document.getElementById("run-selected-btn");
  const runAllBtn = document.getElementById("run-all-btn");
  const refreshBtn = document.getElementById("refresh-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const connDot = document.getElementById("conn-dot");
  const projectPathEl = document.getElementById("project-path");
  const summaryChipsEl = document.getElementById("summary-chips");
  const observerWrapEl = document.getElementById("observer-wrap");
  const observerListEl = document.getElementById("observer-list");
  const observerStatusTextEl = document.getElementById("observer-status-text");

  let classes = [];               // discovered test classes from /api/tests
  let selected = new Set();       // set of "fqcn" or "fqcn#method" strings
  let classStatus = new Map();    // fqcn -> status
  let methodStatus = new Map();   // "fqcn#method" -> status

  // ---------------------------------------------------------------------
  // Config + test discovery
  // ---------------------------------------------------------------------
  async function loadConfig() {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    projectPathEl.textContent = cfg.projectPath;
    projectPathEl.title = cfg.projectPath;
    if (!cfg.observerEnabled) {
      appendLine(
        "AI Observer is disabled: set ANTHROPIC_API_KEY on the runner server to enable failure analysis.",
        "hint"
      );
    }
  }

  async function loadTests() {
    treeEl.innerHTML = '<div class="tree-empty">Scanning project…</div>';
    try {
      const res = await fetch("/api/tests");
      const data = await res.json();
      classes = data.classes || [];
      renderTree();
    } catch (err) {
      treeEl.innerHTML = `<div class="tree-empty">Failed to scan project: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderTree() {
    if (classes.length === 0) {
      treeEl.innerHTML = '<div class="tree-empty">No @Test methods found under src/test/java.</div>';
      return;
    }
    treeEl.innerHTML = "";
    for (const cls of classes) {
      const wrap = document.createElement("div");
      wrap.className = "tree-class";
      wrap.dataset.fqcn = cls.fqcn;

      const row = document.createElement("div");
      row.className = "tree-class-row";
      row.innerHTML = `
        <span class="caret">▸</span>
        <span class="rail" data-rail="${escapeHtml(cls.fqcn)}"></span>
        <span class="class-name" title="${escapeHtml(cls.fqcn)}">${escapeHtml(cls.className)}</span>
        <span class="method-count">${cls.methods.length}</span>
      `;
      row.addEventListener("click", (e) => {
        wrap.classList.toggle("open");
      });

      const methodsWrap = document.createElement("div");
      methodsWrap.className = "tree-methods";
      for (const method of cls.methods) {
        const key = `${cls.fqcn}#${method}`;
        const mrow = document.createElement("label");
        mrow.className = "method-row";
        mrow.innerHTML = `
          <input type="checkbox" data-key="${escapeHtml(key)}" />
          <span class="method-status" data-status-key="${escapeHtml(key)}"></span>
          <span>${escapeHtml(method)}</span>
        `;
        const checkbox = mrow.querySelector("input");
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(key);
          else selected.delete(key);
          updateRunSelectedState();
        });
        methodsWrap.appendChild(mrow);
      }

      wrap.appendChild(row);
      wrap.appendChild(methodsWrap);
      treeEl.appendChild(wrap);
    }
    applyStatusesToDom();
  }

  function updateRunSelectedState() {
    runSelectedBtn.disabled = selected.size === 0;
    runSelectedBtn.textContent = selected.size > 0 ? `Run selected (${selected.size})` : "Run selected";
  }

  // ---------------------------------------------------------------------
  // Running tests
  // ---------------------------------------------------------------------
  async function runTargets(targets) {
    appendLine(`$ mvn test${targets.length ? " -Dtest=" + targets.join(",") : ""}`, "hint");
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      if (!res.ok) {
        const err = await res.json();
        appendLine(`Could not start run: ${err.error}`, "fail");
      }
    } catch (err) {
      appendLine(`Could not reach the runner backend: ${err.message}`, "fail");
    }
  }

  runSelectedBtn.addEventListener("click", () => {
    if (selected.size === 0) return;
    clearConsole();
    clearObserver();
    runTargets([...selected]);
  });

  runAllBtn.addEventListener("click", () => {
    clearConsole();
    clearObserver();
    runTargets([]);
  });

  refreshBtn.addEventListener("click", loadTests);
  clearBtn.addEventListener("click", clearConsole);

  // ---------------------------------------------------------------------
  // Console output
  // ---------------------------------------------------------------------
  function clearConsole() {
    consoleEl.innerHTML = "";
  }

  function appendLine(text, kind) {
    const span = document.createElement("div");
    if (kind === "fail") span.className = "line-fail";
    else if (kind === "pass") span.className = "line-pass";
    else if (kind === "hint") span.className = "console-hint";
    span.textContent = text;
    consoleEl.appendChild(span);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function classifyLine(line) {
    if (/BUILD FAILURE|ERROR|FAILED/.test(line)) return "fail";
    if (/BUILD SUCCESS/.test(line)) return "pass";
    return null;
  }

  // ---------------------------------------------------------------------
  // Status chips + rail/dot coloring
  // ---------------------------------------------------------------------
  function setRunStatus(run) {
    if (!run) {
      statusDot.className = "status-dot";
      statusText.textContent = "Idle";
      runSelectedBtn.disabled = selected.size === 0;
      runAllBtn.disabled = false;
      return;
    }
    statusDot.className = "status-dot " + run.status;
    const labels = {
      running: "Running…",
      passed: "Passed",
      failed: "Failed",
      error: "Error",
    };
    statusText.textContent = labels[run.status] || run.status;
    const isRunning = run.status === "running";
    runSelectedBtn.disabled = isRunning || selected.size === 0;
    runAllBtn.disabled = isRunning;
  }

  function renderSummary(summary) {
    summaryChipsEl.innerHTML = "";
    if (!summary || !summary.totals) return;
    const t = summary.totals;
    const passCount = t.tests - t.failures - t.errors - t.skipped;
    summaryChipsEl.innerHTML = `
      <span class="chip pass">${passCount} passed</span>
      <span class="chip fail">${t.failures + t.errors} failed</span>
      <span class="chip skip">${t.skipped} skipped</span>
    `;

    // map suite/testcase results onto the tree
    classStatus.clear();
    methodStatus.clear();
    for (const suite of summary.suites || []) {
      let worst = "passed";
      for (const c of suite.cases) {
        const methodName = c.name.replace(/\(.*\)$/, "");
        const key = `${suite.name}#${methodName}`;
        methodStatus.set(key, c.status);
        if (c.status === "failed" || c.status === "error") worst = c.status;
        else if (c.status === "skipped" && worst === "passed") worst = "skipped";
      }
      classStatus.set(suite.name, worst);
    }
    applyStatusesToDom();
  }

  function applyStatusesToDom() {
    document.querySelectorAll("[data-rail]").forEach((el) => {
      const fqcn = el.dataset.rail;
      const status = classStatus.get(fqcn);
      el.className = "rail" + (status ? " " + status : "");
    });
    document.querySelectorAll("[data-status-key]").forEach((el) => {
      const key = el.dataset.statusKey;
      const status = methodStatus.get(key);
      el.className = "method-status" + (status ? " " + status : "");
    });
  }

  // ---------------------------------------------------------------------
  // AI Observer — only ever populated after a run finishes with failures.
  // Nothing here polls or watches continuously; it just renders whatever
  // "observer" / "observer-status" messages the backend sends.
  // ---------------------------------------------------------------------
  function clearObserver() {
    observerListEl.innerHTML = "";
    observerStatusTextEl.textContent = "";
    observerWrapEl.hidden = true;
  }

  function setObserverStatus(message) {
    observerWrapEl.hidden = false;
    observerStatusTextEl.textContent = message || "";
  }

  function badgeClass(classification) {
    return ["functional", "scripting", "uncertain"].includes(classification) ? classification : "unknown";
  }

  function badgeLabel(classification) {
    if (classification === "functional") return "Functional issue";
    if (classification === "scripting") return "Scripting issue";
    if (classification === "uncertain") return "Uncertain";
    return "Unknown";
  }

  function renderObservation(obs) {
    observerWrapEl.hidden = false;
    observerStatusTextEl.textContent = "";

    const card = document.createElement("div");
    card.className = "observer-card";
    card.dataset.testId = obs.testId;

    if (obs.error) {
      card.innerHTML = `
        <div class="observer-card-head">
          <span class="observer-test-name">${escapeHtml(obs.testId)}</span>
          <span class="observer-badge unknown">Analysis failed</span>
        </div>
        <p class="observer-summary">${escapeHtml(obs.error)}</p>
      `;
      observerListEl.appendChild(card);
      return;
    }

    const a = obs.analysis || {};
    const cls = badgeClass(a.classification);
    const evidenceItems = Array.isArray(a.evidence) ? a.evidence : [];
    const evidence = obs.evidence || {};

    card.innerHTML = `
      <div class="observer-card-head">
        <span class="observer-test-name" title="${escapeHtml(obs.testId)}">${escapeHtml(obs.testId)}</span>
        <span class="observer-badge ${cls}">${badgeLabel(a.classification)}</span>
        ${a.confidence ? `<span class="observer-confidence">${escapeHtml(a.confidence)} confidence</span>` : ""}
      </div>
      <p class="observer-summary">${escapeHtml(a.summary || "No summary returned.")}</p>
      ${evidenceItems.length ? `
        <div class="observer-section-label">What the observer saw</div>
        <ul class="observer-evidence-list">
          ${evidenceItems.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}
        </ul>
      ` : ""}
      ${a.recommendedAction ? `
        <div class="observer-section-label">${a.classification === "scripting" ? "How to fix it" : "Recommended action"}</div>
        <p class="observer-action">${escapeHtml(a.recommendedAction)}</p>
      ` : ""}
      ${a.suggestedFix && a.suggestedFix.fix ? `
        <div class="observer-fix">${escapeHtml(
          [a.suggestedFix.file, a.suggestedFix.location].filter(Boolean).join(" — ")
        )}\n\n${escapeHtml(a.suggestedFix.fix)}</div>
      ` : ""}
      <div class="observer-links">
        ${evidence.screenshot ? `<a href="${evidence.screenshot}" target="_blank" rel="noopener">Screenshot</a>` : ""}
        ${evidence.dom ? `<a href="${evidence.dom}" target="_blank" rel="noopener">DOM snapshot</a>` : ""}
        ${evidence.log ? `<a href="${evidence.log}" target="_blank" rel="noopener">Step log</a>` : ""}
      </div>
    `;
    observerListEl.appendChild(card);
  }

  // ---------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------
  function connectWs() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.addEventListener("open", () => connDot.classList.add("online"));
    ws.addEventListener("close", () => {
      connDot.classList.remove("online");
      setTimeout(connectWs, 1500); // auto-reconnect for a long-lived local tool
    });
    ws.addEventListener("error", () => connDot.classList.remove("online"));

    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "status") {
        setRunStatus(msg.run);
        if (msg.run && msg.run.status === "running") {
          document.querySelectorAll("[data-rail]").forEach((el) => {
            if ((msg.run.targets || []).some((t) => t.startsWith(el.dataset.rail))) {
              el.className = "rail running";
            }
          });
        }
      } else if (msg.type === "log") {
        appendLine(msg.line, classifyLine(msg.line));
      } else if (msg.type === "summary") {
        renderSummary(msg.summary);
      } else if (msg.type === "observer-status") {
        setObserverStatus(msg.message);
      } else if (msg.type === "observer") {
        renderObservation(msg);
      } else if (msg.type === "observer-error") {
        setObserverStatus(`AI Observer error: ${msg.error}`);
      }
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  loadConfig();
  loadTests();
  connectWs();
})();
