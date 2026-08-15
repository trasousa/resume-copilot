// LLM provider switch. Route files import runTask/runChatStream/
// runWebSearchTask from here rather than from lib/anthropic.js or
// lib/gemini.js directly, so they stay provider-agnostic -- both providers
// implement the exact same three-function contract.

import * as anthropic from "./anthropic.js";
import * as gemini from "./gemini.js";

const PROVIDERS = { anthropic, gemini };

function providerFor(env) {
  const name = (env.LLM_PROVIDER || "anthropic").toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    const err = new Error(
      `Unknown LLM_PROVIDER "${env.LLM_PROVIDER}". Use "anthropic" or "gemini".`
    );
    err.status = 500;
    throw err;
  }
  return provider;
}

export function runTask(args) {
  return providerFor(args.env).runTask(args);
}

export function runChatStream(args) {
  return providerFor(args.env).runChatStream(args);
}

export function runWebSearchTask(args) {
  return providerFor(args.env).runWebSearchTask(args);
}
