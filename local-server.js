import fs from "node:fs";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const allowedModels = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "llama3-8b-8192",
]);

function loadLocalEnvFile() {
  const envFiles = [".env.local", ".env"];

  for (const envFile of envFiles) {
    const envPath = path.join(__dirname, envFile);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const fileContents = fs.readFileSync(envPath, "utf8");
    for (const rawLine of fileContents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (!key || process.env[key]) {
        continue;
      }

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();

function resolveSystemPrompt(mode) {
  if (mode === "recruiter_analysis") {
    return `
You are KALNET Recruiter Analysis AI.

Your job:
- Analyze only the supplied structured student metrics.
- Help recruiters decide who should be considered for full-time selection.
- Produce conservative, evidence-based reasoning.

Rules:
- Never invent missing facts.
- If attendance coverage or evidence is incomplete, explicitly say so.
- Use only the provided metrics and recommendation data.
- Keep reasons tight, recruiter-friendly, and decision oriented.
- When the caller asks for JSON, return valid JSON only.
`.trim();
  }

  return `
You are KALNET AI Mentor, an internal study and debugging assistant for the KALNET training portal.

Primary scope:
- Explain the KALNET curriculum from day 1 through the later project phases.
- Teach concepts clearly, from basics to practical usage.
- Help interns debug code they paste or upload.
- When debugging code, explain what the code is doing, identify the likely bug, explain why it happens, and suggest a corrected version.
- Keep answers focused on learning, assignments, deliverables, implementation, and software/AI engineering problems relevant to the portal.

Behavior rules:
- If the user asks for a day or topic explanation, teach it thoroughly with intuition, usage, and compact examples.
- If the user shares code, review it like a mentor: explain the bug, possible fix, and better approach.
- If the question is unrelated to the portal, company work, curriculum, code, or engineering learning, politely redirect back to KALNET-related help.
- Be supportive, practical, and clear.
`.trim();
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.post("/api/groq-chat", async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "Missing GROQ_API_KEY on the server. Create a .env file in the project root and add your Groq key there.",
    });
    return;
  }

  try {
    const body = req.body || {};
    const mode = typeof body.mode === "string" ? body.mode.trim() : "kalnet_mentor";
    const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
    const model = allowedModels.has(requestedModel)
      ? requestedModel
      : process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    const safeMessages = Array.isArray(body.messages)
      ? body.messages
          .filter((message) => message && typeof message.role === "string" && typeof message.content === "string")
          .slice(-8)
      : [];

    const apiResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: mode === "recruiter_analysis" ? 0.2 : 0.35,
        max_completion_tokens: mode === "recruiter_analysis" ? 1800 : 1400,
        messages: [
          { role: "system", content: resolveSystemPrompt(mode) },
          ...(body.curriculumSummary ? [{ role: "system", content: String(body.curriculumSummary) }] : []),
          ...safeMessages,
        ],
      }),
    });

    const payload = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      res.status(apiResponse.status).json({ error: payload.error?.message || "Groq request failed." });
      return;
    }

    res.status(200).json({
      reply: payload.choices?.[0]?.message?.content || "No response generated.",
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unexpected server error." });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`KALNET portal running on http://localhost:${port}`);
});
