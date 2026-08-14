import Anthropic from "@anthropic-ai/sdk";

let client = null;

export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key from https://console.anthropic.com/"
    );
    err.status = 500;
    throw err;
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

/**
 * Plain text-in, text-out call: system prompt (skill instructions + task
 * framing) plus a single user message. Used for one-shot generation tasks
 * (tailoring, cover letters, emails, etc).
 */
export async function runTask({ system, prompt, maxTokens = 4096 }) {
  const anthropic = getClient();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Multi-turn chat call, used for the interactive CV improvement flow so the
 * model can ask the user clarifying questions and refine over several turns.
 */
export async function runChat({ system, messages, maxTokens = 2048 }) {
  const anthropic = getClient();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
  });
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Web-search-enabled call for job hunting. Uses Claude's server-side
 * web_search tool so results are real, current postings with real URLs
 * rather than the model guessing.
 */
export async function runWebSearchTask({ system, prompt, location, maxTokens = 4096 }) {
  const anthropic = getClient();
  const tool = {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 8,
  };
  if (location && (location.city || location.region || location.country)) {
    tool.user_location = { type: "approximate", ...location };
  }

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    tools: [tool],
    messages: [{ role: "user", content: prompt }],
  });

  // Collect both the model's prose and the raw search result URLs/titles it
  // was actually shown, so the UI can double check nothing was fabricated.
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const sources = [];
  for (const block of res.content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const item of block.content) {
        if (item.url) sources.push({ url: item.url, title: item.title });
      }
    }
  }

  return { text, sources };
}
