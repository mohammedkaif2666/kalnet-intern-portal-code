const assistantRoot = document.getElementById("ai-assistant");
const assistantLog = document.getElementById("ai-log");
const assistantInput = document.getElementById("ai-input");
const assistantFile = document.getElementById("ai-file");
const assistantAttachment = document.getElementById("ai-attachment");
const assistantModel = document.getElementById("ai-model");
const assistantSendButton = document.getElementById("ai-send");
const assistantClearButton = document.getElementById("ai-clear");

const curriculumSummary = `
KALNET portal curriculum summary:
- Phase 1A, Days 1-14: Python ML foundations, NumPy, Pandas, EDA, visualization, regression, classification, trees, XGBoost, clustering, PCA, model evaluation, feature engineering, sklearn pipelines.
- Phase 1B, Days 15-17: ML assignment execution and packaging.
- Phase 1C, Days 18-27: Deep learning foundations, backpropagation, PyTorch, CNNs, transfer learning, sequence models, transformers, BERT.
- Phase 1D, Days 28-30: Deep learning assignment delivery.
- Phase 2A, Days 31-45: LLM basics, prompt engineering, Groq or Claude-style API usage, LangChain, document loaders, embeddings, vector databases, RAG, multi-turn chat, agents, tool use, voice AI, evaluation, guardrails.
- Phase 2B, Days 46-49: LLM and agent assignment implementation.
- Phase 2C, Days 50-58: MLOps, DVC, MLflow, model registry, FastAPI serving, Docker, CI/CD, Databricks, drift detection, deployment patterns.
- Phase 2D, Days 59-60: Production MLOps assignment.
- Phase 3: Live product sprints, engineering delivery, documentation, monitoring, and demo work.
`;

let toast = () => {};
let attachedFile = null;
let messageHistory = [
  {
    role: "assistant",
    content: "Ask about any KALNET task, day, submission, concept, or paste your code and I will break it down step by step.",
  },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatAssistantText(text) {
  return escapeHtml(text).replace(/\n/g, "<br />");
}

function renderHistory() {
  if (!assistantLog) {
    return;
  }

  assistantLog.innerHTML = messageHistory
    .map(
      (message) => `
        <div class="ai-msg ${message.role === "user" ? "ai-msg-user" : "ai-msg-assistant"}">
          <div class="ai-msg-role">${message.role === "user" ? "You" : "KALNET AI Mentor"}</div>
          <div class="ai-msg-body">${formatAssistantText(message.content)}</div>
        </div>
      `,
    )
    .join("");

  assistantLog.scrollTop = assistantLog.scrollHeight;
}

function renderAttachment() {
  if (!assistantAttachment) {
    return;
  }

  if (!attachedFile) {
    assistantAttachment.innerHTML = "";
    return;
  }

  assistantAttachment.innerHTML = `
    <div class="ai-attachment-chip">
      Attached: ${escapeHtml(attachedFile.name)} (${escapeHtml(String(attachedFile.previewLength))} chars)
      <button type="button" id="ai-remove-file">x</button>
    </div>
  `;

  document.getElementById("ai-remove-file")?.addEventListener("click", () => {
    attachedFile = null;
    if (assistantFile) {
      assistantFile.value = "";
    }
    renderAttachment();
  });
}

async function readAttachedFile(file) {
  const content = await file.text();
  const trimmed = content.slice(0, 18000);
  attachedFile = {
    name: file.name,
    content: trimmed,
    previewLength: trimmed.length,
  };
  renderAttachment();
}

async function sendPrompt() {
  const userPrompt = assistantInput?.value.trim() || "";
  if (!userPrompt && !attachedFile) {
    toast("Ask a question or attach a code file first.", "error");
    return;
  }

  const composedPrompt = attachedFile
    ? `${userPrompt}\n\nAttached code/file (${attachedFile.name}):\n\`\`\`\n${attachedFile.content}\n\`\`\``
    : userPrompt;

  messageHistory.push({ role: "user", content: composedPrompt });
  renderHistory();
  assistantInput.value = "";
  assistantSendButton.disabled = true;
  assistantSendButton.textContent = "Thinking...";

  try {
    const response = await fetch("/api/groq-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "kalnet_mentor",
        model: assistantModel?.value || undefined,
        curriculumSummary,
        messages: messageHistory.slice(-8),
      }),
    });

    const rawText = await response.text();
    let payload = {};
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      const fallbackMessage = response.status === 404
        ? "The AI backend route is missing. Start the local server so /api/groq-chat is available."
        : "The AI backend returned a non-JSON response. Check the server logs and GROQ_API_KEY.";
      throw new Error(fallbackMessage);
    }

    if (!response.ok) {
      throw new Error(payload.error || "AI request failed");
    }

    messageHistory.push({
      role: "assistant",
      content: payload.reply || "I could not produce a reply for that question.",
    });
    renderHistory();
  } catch (error) {
    messageHistory.push({
      role: "assistant",
      content: `I could not complete that request right now. ${error.message}`,
    });
    renderHistory();
    toast(`AI assistant error: ${error.message}`, "error");
  } finally {
    assistantSendButton.disabled = false;
    assistantSendButton.textContent = "Ask AI Mentor";
  }
}

export function initAssistant(options = {}) {
  if (!assistantRoot) {
    return;
  }

  toast = options.toast || toast;
  renderHistory();
  renderAttachment();

  assistantSendButton?.addEventListener("click", sendPrompt);
  assistantClearButton?.addEventListener("click", () => {
    messageHistory = [
      {
        role: "assistant",
        content: "Chat cleared. Ask about any KALNET task, day, concept, or upload code for debugging.",
      },
    ];
    attachedFile = null;
    if (assistantFile) {
      assistantFile.value = "";
    }
    assistantInput.value = "";
    renderAttachment();
    renderHistory();
  });

  assistantInput?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      sendPrompt();
    }
  });

  assistantFile?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      await readAttachedFile(file);
      toast("Code file attached for the AI mentor.", "success");
    } catch (error) {
      toast(`Could not read the attached file: ${error.message}`, "error");
    }
  });
}
