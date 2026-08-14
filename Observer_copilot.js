const fs = require("fs");
const path = require("path");
const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");

// The model behind Copilot Chat
const MODEL = "gpt-4o"; 

// ... [Keep your SYSTEM_PROMPT and helper functions exactly as they are] ...

/**
 * Sends one failure's evidence bundle to GitHub Models (Copilot's engine).
 */
async function analyzeFailure(bundle, opts = {}) {
  // Use your GitHub PAT here
  const apiKey = opts.apiKey || process.env.GITHUB_TOKEN;
  if (!apiKey) {
    return {
      classification: "unknown",
      confidence: "low",
      summary: "AI Observer is disabled: GITHUB_TOKEN is not set on the server.",
      evidence: [],
      recommendedAction: "Set GITHUB_TOKEN and restart the runner.",
      suggestedFix: null,
      testId: bundle.manifest.testId,
      disabled: true,
    };
  }

  // Initialize the LangChain OpenAI Model pointed at GitHub's servers
  const model = new ChatOpenAI({
    modelName: MODEL,
    openAIApiKey: apiKey,
    maxTokens: 1500,
    temperature: 0,
    configuration: {
      baseURL: "https://models.inference.ai.azure.com", // GitHub's inference endpoint
    }
  });

  const { manifest } = bundle;
  const domExcerpt = truncate(bundle.dom, 12000);
  const logExcerpt = truncate(bundle.stepLog, 8000);

  // Construct the Multimodal content array
  const contentBlocks = [
    { 
      type: "text", 
      text: buildUserPrompt(manifest, domExcerpt, logExcerpt) 
    }
  ];

  if (bundle.screenshotBase64) {
    contentBlocks.push({
      type: "image_url",
      image_url: `data:image/png;base64,${bundle.screenshotBase64}`,
    });
  }

  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage({ content: contentBlocks })
  ];

  try {
    const response = await model.invoke(messages);
    
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
  } catch (error) {
    console.error("[AI Observer] GitHub Models API failed:", error.message);
    return {
      classification: "unknown",
      confidence: "low",
      summary: `Failed to connect to GitHub Models. Error: ${error.message}`,
      evidence: [],
      recommendedAction: "Ensure your GITHUB_TOKEN is valid and you haven't hit the free rate limits.",
      suggestedFix: null,
      testId: bundle.manifest.testId,
      parseError: true,
    };
  }
}

module.exports = { findFailureDirs, readFailureBundle, analyzeFailure, MODEL };
