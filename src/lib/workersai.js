// Workers AI access via the native env.AI binding -- no API key or secret
// at all, unlike anthropic.js/gemini.js. Authentication is implicit in the
// binding, tied to the Cloudflare account the Worker deploys under.
//
// Model id is a single config var (WORKERS_AI_MODEL): "swappable" here means
// picking a different @cf/... model, not a different vendor -- see
// docs/superpowers/specs/2026-08-16-resume-agent-core-design.md.
//
// glm-4.7-flash (the default) is a reasoning model: it can spend its whole
// max_tokens budget on internal <reasoning> deltas before ever emitting
// user-facing `content`, confirmed empirically against the live API with a
// small token cap. Defaults below match the generous budgets already used
// by the Anthropic/Gemini providers for exactly this reason.
//
// No real web search: Workers AI has nothing built in yet -- Cloudflare's
// own "Web Search" feature for models is still listed as "coming soon" in
// their changelog, and Workers AI is absent from AI Gateway's list of
// providers with native search proxying (confirmed by direct testing: a
// `web_search`/`web_search_preview` tool type is rejected outright, and the
// documented `web_search_options` param is silently a no-op -- the model
// says outright it has no live search access). Job Search now relies
// exclusively on Arbeitnow's free public job board API
// (src/lib/arbeitnow.js) for listings -- Workers AI is only used to rank
// those real, already-found postings against the candidate's CV, never to
// search the web itself.

export const DEFAULT_MODEL = "@cf/zai-org/glm-4.7-flash";

const modelFor = (env) => env.WORKERS_AI_MODEL || DEFAULT_MODEL;

// Separate config path so a faster non-reasoning model can be swapped in for
// interactive chat without affecting the (typically slower, higher-quality)
// tailoring model used by runTask.
const chatModelFor = (env) => env.WORKERS_AI_CHAT_MODEL || env.WORKERS_AI_MODEL || DEFAULT_MODEL;

function systemInstruction(stable, volatile) {
  return volatile ? `${stable}\n\n${volatile}` : stable;
}

function usageOf(u) {
  return {
    input: u?.prompt_tokens ?? 0,
    output: u?.completion_tokens ?? 0,
    cacheRead: u?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWrite: 0,
  };
}

/** Throw a useful error rather than returning a silently empty answer. */
function assertNotEmpty(text, maxTokens) {
  if (!text.trim()) {
    const err = new Error(
      `Workers AI returned no text -- it likely spent the whole ${maxTokens}` +
        "-token budget on internal reasoning before producing a reply. Try " +
        "again, or raise maxTokens."
    );
    err.status = 502;
    throw err;
  }
}

/**
 * One-shot generation: tailoring, cover letters, interview prep.
 */
export async function runTask({ env, stable, volatile, prompt, maxTokens = 16000 }) {
  const result = await env.AI.run(modelFor(env), {
    messages: [
      { role: "system", content: systemInstruction(stable, volatile) },
      { role: "user", content: prompt },
    ],
    max_tokens: maxTokens,
  });

  const text = result.choices?.[0]?.message?.content || result.response || "";
  assertNotEmpty(text, maxTokens);
  return { text, usage: usageOf(result.usage) };
}

/**
 * Multi-turn chat for the CV improvement flow, streamed.
 *
 * env.AI.run(..., { stream: true }) returns a raw ReadableStream of
 * OpenAI-style `data: {...}` SSE chunks (confirmed empirically) -- parsed
 * here and re-emitted in this app's own event:text/done/error protocol,
 * same shape lib/anthropic.js and lib/gemini.js already produce.
 * `delta.content` is surfaced as `event: text`. `delta.reasoning`/
 * `reasoning_content` (the model's internal chain-of-thought) is now also
 * forwarded to the client, as its own `event: reasoning` -- so the UI can
 * show real progress during the (often slow) reasoning phase instead of a
 * static placeholder. It is never appended to `reply`, which stays exactly
 * the model's final answer.
 */
export function runChatStream({ env, stable, volatile, messages, maxTokens = 8000, onDone }) {
  const encoder = new TextEncoder();
  const model = chatModelFor(env);
  const systemMessage = { role: "system", content: systemInstruction(stable, volatile) };

  return new ReadableStream({
    async start(controller) {
      const send = (event, data) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );

      try {
        const upstream = await env.AI.run(model, {
          messages: [systemMessage, ...messages],
          max_tokens: maxTokens,
          stream: true,
        });

        const reader = upstream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let reply = "";
        let usage;
        let hitLength = false;

        // Same CRLF-safety lesson as lib/gemini.js: normalize before
        // splitting so a stray \r never leaves a frame stuck in `buffer`.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const dataLine = frame.match(/^data: (.+)$/m)?.[1];
            if (!dataLine || dataLine === "[DONE]") continue;

            const chunk = JSON.parse(dataLine);
            const candidate = chunk.choices?.[0];
            const reasoningDelta = candidate?.delta?.reasoning ?? candidate?.delta?.reasoning_content;
            if (reasoningDelta) {
              send("reasoning", { text: reasoningDelta });
            }
            const delta = candidate?.delta?.content;
            if (delta) {
              reply += delta;
              send("text", { text: delta });
            }
            if (candidate?.finish_reason === "length") hitLength = true;
            if (chunk.usage) usage = chunk.usage;
          }
        }

        if (hitLength) {
          send("error", {
            error: reply.trim()
              ? "Workers AI hit the output limit before finishing this reply."
              : `Workers AI hit the output limit before producing any reply -- it ` +
                `likely spent the whole ${maxTokens}-token budget on internal reasoning.`,
          });
        }

        const normalizedUsage = usageOf(usage);
        // Persist before signalling done, so a client that reloads on `done`
        // always finds the turn already saved. Also carries `usage` so
        // lib/llm.js's wrapper can record it against the daily token cap
        // without needing to intercept the SSE stream itself.
        if (onDone) await onDone(reply, normalizedUsage);

        send("done", { reply, usage: normalizedUsage });
      } catch (err) {
        send("error", { error: err?.message || "Chat failed." });
      } finally {
        controller.close();
      }
    },
  });
}
