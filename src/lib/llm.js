// LLM access -- Workers AI only (see docs/superpowers/specs/2026-08-16-resume-agent-core-design.md's
// "Model choice" paragraph: Anthropic and Gemini are dropped entirely, no
// multi-vendor abstraction here anymore). "Swappable" means swapping which
// @cf/... model id WORKERS_AI_MODEL/WORKERS_AI_CHAT_MODEL points at, not
// swapping vendors.
//
// This module also enforces a blunt daily token cap across every call:
// each call checks the UTC day's running total before starting, and
// records its own usage after finishing. The last call that pushes a day
// over the cap is still allowed to complete -- the cap blocks the *next*
// call, not mid-call.
//
// The cap is counted per user, not per deployment: callers pass their
// request's `store` (the caller's own agent -- see src/lib/store.js), and
// the running total lives in that agent's storage. Before the cutover this
// counter sat in the one shared D1, where a single user could exhaust the
// day's budget for everybody.

import * as workersai from "./workersai.js";

// Exported so src/routes/usage.js can report {used, cap} without duplicating
// the number (and risking it drifting out of sync with the actual gate).
export const DAILY_TOKEN_CAP = 100000;

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

async function assertUnderCap(store) {
  const used = await store.getTokenUsage(today());
  if (used >= DAILY_TOKEN_CAP) {
    const err = new Error(
      `Daily AI usage cap reached (${DAILY_TOKEN_CAP} tokens/day, all ` +
        `features combined). Resets at midnight UTC.`
    );
    err.status = 429;
    throw err;
  }
}

async function recordUsage(store, usage) {
  const tokens = (usage?.input ?? 0) + (usage?.output ?? 0);
  if (tokens > 0) await store.addTokenUsage(today(), tokens);
}

export async function runTask(args) {
  await assertUnderCap(args.store);
  const result = await workersai.runTask(args);
  await recordUsage(args.store, result.usage);
  return result;
}

/**
 * Streaming has no single point to await usage before returning a stream to
 * the caller, so the cap check and the byte-for-byte passthrough both live
 * inside this wrapper stream's own `start()` -- same lifecycle Cloudflare
 * already keeps alive for every provider's own stream, no ctx.waitUntil()
 * or stream-teeing required. workersai.js passes `usage` as onDone's second
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
        await assertUnderCap(args.store);
      } catch (err) {
        send("error", { error: err.message });
        controller.close();
        return;
      }

      const userOnDone = args.onDone;
      const upstream = workersai.runChatStream({
        ...args,
        onDone: async (reply, usage) => {
          await recordUsage(args.store, usage);
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
