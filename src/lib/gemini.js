// Gemini access. Same three-function contract as lib/anthropic.js
// (runTask / runChatStream / runWebSearchTask), so route files don't care
// which provider is active -- see lib/llm.js for the switch.
//
// Raw fetch against the Gemini Developer API rather than the @google/genai
// SDK: the SDK pulls in ws / google-auth-library / protobufjs, none of which
// are needed for the handful of REST calls this app makes, and all of which
// are Node-oriented weight in a Workers bundle. Request/response shapes below
// were verified against the SDK's own (un-exported) wire-format code, not
// guessed from memory.

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export const DEFAULT_MODEL = "gemini-2.5-flash";

function getApiKey(env) {
  if (!env.GOOGLE_API_KEY) {
    const err = new Error(
      "GOOGLE_API_KEY is not set. Run: npx wrangler secret put GOOGLE_API_KEY " +
        "(or add it to .dev.vars for local development)."
    );
    err.status = 500;
    throw err;
  }
  return env.GOOGLE_API_KEY;
}

const modelFor = (env) => env.GEMINI_MODEL || DEFAULT_MODEL;

/**
 * Gemini 2.5+ models cache repeated prompt prefixes automatically (implicit
 * caching, no code required) -- unlike Claude, there's no explicit
 * cache_control breakpoint to place. `stable` and `volatile` are still kept
 * as separate params for symmetry with the Anthropic provider, and to keep
 * the stable (byte-identical) text first, which is what makes the automatic
 * cache hit possible at all.
 */
function systemInstruction(stable, volatile) {
  const text = volatile ? `${stable}\n\n${volatile}` : stable;
  return { parts: [{ text }] };
}

async function callGemini(env, path, body) {
  const res = await fetch(`${BASE_URL}/models/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": getApiKey(env),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    const err = new Error(`Gemini API error (${res.status}): ${errBody.slice(0, 500)}`);
    err.status = res.status >= 400 && res.status < 500 ? 502 : 500;
    throw err;
  }
  return res.json();
}

function textOfCandidate(candidate) {
  return (candidate?.content?.parts || [])
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

/** Throw a useful error rather than returning a half-written or filtered answer. */
function assertComplete(candidate) {
  if (candidate?.finishReason === "MAX_TOKENS") {
    const err = new Error(
      "Gemini hit the output limit before finishing. Try a shorter CV or job post."
    );
    err.status = 502;
    throw err;
  }
  if (["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(candidate?.finishReason)) {
    const err = new Error("Gemini declined this request.");
    err.status = 422;
    throw err;
  }
}

function usageOf(usageMetadata) {
  return {
    input: usageMetadata?.promptTokenCount ?? 0,
    output: usageMetadata?.candidatesTokenCount ?? 0,
    // Gemini's implicit caching doesn't distinguish read vs. write the way
    // Anthropic's explicit breakpoints do -- cachedContentTokenCount is the
    // closest equivalent, surfaced as cacheRead so callers that log usage
    // (see cvs.js) don't need a provider-specific branch.
    cacheRead: usageMetadata?.cachedContentTokenCount ?? 0,
    cacheWrite: 0,
  };
}

/**
 * One-shot generation: tailoring, cover letters, interview prep.
 */
export async function runTask({ env, stable, volatile, prompt, maxTokens = 16000 }) {
  const data = await callGemini(env, `${modelFor(env)}:generateContent`, {
    systemInstruction: systemInstruction(stable, volatile),
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens },
  });

  const candidate = data.candidates?.[0];
  assertComplete(candidate);
  return { text: textOfCandidate(candidate), usage: usageOf(data.usageMetadata) };
}

/**
 * Multi-turn chat for the CV improvement flow, streamed.
 *
 * `messages` arrives in Anthropic's shape ({role: "user"|"assistant",
 * content: string}) since it comes straight out of the chat_messages table --
 * translated to Gemini's ({role: "user"|"model", parts: [{text}]}) here so
 * the DB layer and route stay provider-agnostic.
 */
export function runChatStream({ env, stable, volatile, messages, maxTokens = 8000, onDone }) {
  const model = modelFor(env);
  const encoder = new TextEncoder();
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  return new ReadableStream({
    async start(controller) {
      const send = (event, data) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );

      try {
        const res = await fetch(
          `${BASE_URL}/models/${model}:streamGenerateContent?alt=sse`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": getApiKey(env),
            },
            body: JSON.stringify({
              systemInstruction: systemInstruction(stable, volatile),
              contents,
              generationConfig: { maxOutputTokens: maxTokens },
            }),
          }
        );

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Gemini API error (${res.status}): ${errBody.slice(0, 500)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let reply = "";
        let lastUsage;
        let hitMaxTokens = false;

        // SSE frames are separated by a blank line; a frame can straddle chunks.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const dataLine = frame.match(/^data: (.+)$/m)?.[1];
            if (!dataLine) continue;

            const chunk = JSON.parse(dataLine);
            const candidate = chunk.candidates?.[0];
            if (candidate?.finishReason === "MAX_TOKENS") hitMaxTokens = true;
            if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;

            const delta = textOfCandidate(candidate);
            if (delta) {
              reply += delta;
              send("text", { text: delta });
            }
          }
        }

        if (hitMaxTokens) {
          send("error", { error: "Gemini hit the output limit before finishing this reply." });
        }

        // Persist before signalling done, so a client that reloads on `done`
        // always finds the turn already saved.
        if (onDone) await onDone(reply);

        send("done", { reply, usage: usageOf(lastUsage) });
      } catch (err) {
        send("error", { error: err?.message || "Chat failed." });
      } finally {
        controller.close();
      }
    },
  });
}

/**
 * Web-search-backed job hunting, via Gemini's built-in Google Search
 * grounding tool. Unlike Anthropic's web_search tool, this runs to
 * completion in a single turn -- there's no pause_turn/resume protocol to
 * handle. `location` is intentionally unused: the Developer API's
 * googleSearch tool takes no per-request geo config, so the caller (see
 * jobsearch.js) already folds location into the prompt text itself.
 */
export async function runWebSearchTask({ env, stable, volatile, prompt, maxTokens = 16000 }) {
  const data = await callGemini(env, `${modelFor(env)}:generateContent`, {
    systemInstruction: systemInstruction(stable, volatile),
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { maxOutputTokens: maxTokens },
  });

  const candidate = data.candidates?.[0];
  assertComplete(candidate);

  // Surface the raw hits so the UI can show what the shortlist was built from.
  const sources = (candidate?.groundingMetadata?.groundingChunks || [])
    .filter((chunk) => chunk.web?.uri)
    .map((chunk) => ({ url: chunk.web.uri, title: chunk.web.title }));

  return { text: textOfCandidate(candidate), sources, usage: usageOf(data.usageMetadata) };
}
