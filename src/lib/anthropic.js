// Claude access. One seam -- nothing else in the app imports the SDK.
//
// Changes from the Express version, all of them fixes from the review:
//   * claude-opus-5 (was claude-sonnet-4-5)
//   * prompt caching on the skill text, which is the bulk of every request
//   * stop_reason checked, so truncation reports as truncation
//   * web_search_20260209, which filters results before they hit the context
//   * streaming, so a 60s+ job search isn't a blank spinner
//   * pause_turn handled, so a capped server-tool turn isn't silently partial

import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-opus-5";

export function getClient(env) {
  if (!env.ANTHROPIC_API_KEY) {
    const err = new Error(
      "ANTHROPIC_API_KEY is not set. Run: npx wrangler secret put ANTHROPIC_API_KEY " +
        "(or add it to .dev.vars for local development)."
    );
    err.status = 500;
    throw err;
  }
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

const modelFor = (env) => env.ANTHROPIC_MODEL || DEFAULT_MODEL;

/**
 * Build the system parameter with a cache breakpoint after the stable text.
 *
 * Caching is a prefix match, so ordering is load-bearing: `stable` (the skill
 * bodies -- up to ~15k tokens, byte-identical across turns) has to come first,
 * with `volatile` (the CV, the job post) after the breakpoint. The old code
 * interpolated the CV *ahead* of the skills, which would have invalidated the
 * cache on every single turn even if caching had been switched on.
 */
function cachedSystem(stable, volatile) {
  const blocks = [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
  ];
  if (volatile) blocks.push({ type: "text", text: volatile });
  return blocks;
}

function textOf(content) {
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/** Throw a useful error rather than returning a half-written answer. */
function assertComplete(message) {
  if (message.stop_reason === "max_tokens") {
    const err = new Error(
      "Claude hit the output limit before finishing. Try a shorter CV or job post."
    );
    err.status = 502;
    throw err;
  }
  if (message.stop_reason === "refusal") {
    const err = new Error("Claude declined this request.");
    err.status = 422;
    throw err;
  }
}

/**
 * One-shot generation: tailoring, cover letters, interview prep.
 * `stable` is cached; `volatile` is not.
 */
export async function runTask({
  env,
  stable,
  volatile,
  prompt,
  maxTokens = 16000,
}) {
  const message = await getClient(env).messages.create({
    model: modelFor(env),
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    system: cachedSystem(stable, volatile),
    messages: [{ role: "user", content: prompt }],
  });

  assertComplete(message);
  return { text: textOf(message.content), usage: message.usage };
}

/**
 * Multi-turn chat for the CV improvement flow, streamed.
 *
 * Returns a ReadableStream of SSE frames rather than a completed string: these
 * turns run long enough that a blank spinner was the worst part of the UX.
 */
export function runChatStream({
  env,
  stable,
  volatile,
  messages,
  maxTokens = 8000,
  onDone,
}) {
  const client = getClient(env);
  const model = modelFor(env);
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const send = (event, data) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );

      try {
        const stream = client.messages.stream({
          model,
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          system: cachedSystem(stable, volatile),
          messages,
        });

        stream.on("text", (delta) => send("text", { text: delta }));

        const message = await stream.finalMessage();

        if (message.stop_reason === "max_tokens") {
          send("error", {
            error: "Claude hit the output limit before finishing this reply.",
          });
        }

        const reply = textOf(message.content);
        // Persist before signalling done, so a client that reloads on `done`
        // always finds the turn already saved.
        if (onDone) await onDone(reply);

        send("done", {
          reply,
          usage: {
            cacheRead: message.usage?.cache_read_input_tokens ?? 0,
            cacheWrite: message.usage?.cache_creation_input_tokens ?? 0,
            input: message.usage?.input_tokens ?? 0,
            output: message.usage?.output_tokens ?? 0,
          },
        });
      } catch (err) {
        send("error", { error: err?.message || "Chat failed." });
      } finally {
        controller.close();
      }
    },
  });
}

/**
 * Web-search-backed job hunting.
 *
 * Server-side search means Anthropic runs the queries and returns real results
 * with citations, so the model can't invent a posting. The turn stops with
 * `pause_turn` when the internal tool loop hits its cap -- resume rather than
 * returning a half-finished search as if it were complete.
 */
export async function runWebSearchTask({
  env,
  stable,
  volatile,
  prompt,
  location,
  maxTokens = 16000,
  maxResumes = 3,
}) {
  const client = getClient(env);
  const model = modelFor(env);

  const tool = { type: "web_search_20260209", name: "web_search", max_uses: 8 };
  if (location && (location.city || location.region || location.country)) {
    tool.user_location = { type: "approximate", ...location };
  }

  const messages = [{ role: "user", content: prompt }];
  let message;

  for (let i = 0; i <= maxResumes; i++) {
    message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: cachedSystem(stable, volatile),
      tools: [tool],
      messages,
    });

    if (message.stop_reason !== "pause_turn") break;
    // Re-send the paused turn; the server picks the search loop back up.
    messages.push({ role: "assistant", content: message.content });
  }

  assertComplete(message);

  // Surface the raw hits so the UI can show what the shortlist was built from.
  const sources = [];
  for (const block of message.content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const item of block.content) {
        if (item.url) sources.push({ url: item.url, title: item.title });
      }
    }
  }

  return { text: textOf(message.content), sources, usage: message.usage };
}
