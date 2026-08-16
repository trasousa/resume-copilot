// LLM provider switch. Route files import runTask/runChatStream/
// runWebSearchTask from here rather than from lib/anthropic.js,
// lib/gemini.js, or lib/workersai.js directly, so they stay
// provider-agnostic -- all three providers implement the exact same
// three-function contract, including a normalized
// {input, output, cacheRead, cacheWrite} usage shape.
//
// This module also enforces a blunt daily token cap across every provider
// alike (a runaway-cost guard, not a precise rate limiter): each call checks
// the UTC day's running total before starting, and records its own usage
// after finishing. The last call that pushes a day over the cap is still
// allowed to complete -- the cap blocks the *next* call, not mid-call.

import * as anthropic from "./anthropic.js";
import * as gemini from "./gemini.js";
import * as workersai from "./workersai.js";
import * as db from "./db.js";

const PROVIDERS = { anthropic, gemini, workersai };

// A runaway-cost/bug guard, not a tight budget -- glm-4.7-flash's reasoning
// overhead plus the skill-prompt-heavy input means a single real tailoring
// call already runs ~13K tokens (confirmed empirically), so anything much
// lower than this blocks nearly all real use after one request.
const DAILY_TOKEN_CAP = 100000;

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

async function assertUnderCap(env) {
  const used = await db.getTokenUsage(env.DB, today());
  if (used >= DAILY_TOKEN_CAP) {
    const err = new Error(
      `Daily AI usage cap reached (${DAILY_TOKEN_CAP} tokens/day, all ` +
        `features combined). Resets at midnight UTC.`
    );
    err.status = 429;
    throw err;
  }
}

async function recordUsage(env, usage) {
  const tokens = (usage?.input ?? 0) + (usage?.output ?? 0);
  if (tokens > 0) await db.addTokenUsage(env.DB, today(), tokens);
}

function providerFor(env) {
  const name = (env.LLM_PROVIDER || "anthropic").toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    const err = new Error(
      `Unknown LLM_PROVIDER "${env.LLM_PROVIDER}". Use "anthropic", "gemini", or "workersai".`
    );
    err.status = 500;
    throw err;
  }
  return provider;
}

export async function runTask(args) {
  await assertUnderCap(args.env);
  const result = await providerFor(args.env).runTask(args);
  await recordUsage(args.env, result.usage);
  return result;
}

export async function runWebSearchTask(args) {
  await assertUnderCap(args.env);
  const result = await providerFor(args.env).runWebSearchTask(args);
  await recordUsage(args.env, result.usage);
  return result;
}

/**
 * Streaming has no single point to await usage before returning a stream to
 * the caller, so the cap check and the byte-for-byte passthrough both live
 * inside this wrapper stream's own `start()` -- same lifecycle Cloudflare
 * already keeps alive for every provider's own stream, no ctx.waitUntil()
 * or stream-teeing required. Providers pass `usage` as onDone's second
 * argument specifically so this can record it without parsing SSE itself.
 */
export function runChatStream(args) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const send = (event, data) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );

      try {
        await assertUnderCap(args.env);
      } catch (err) {
        send("error", { error: err.message });
        controller.close();
        return;
      }

      const userOnDone = args.onDone;
      const upstream = providerFor(args.env).runChatStream({
        ...args,
        onDone: async (reply, usage) => {
          await recordUsage(args.env, usage);
          if (userOnDone) await userOnDone(reply);
        },
      });

      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } finally {
        controller.close();
      }
    },
  });
}
