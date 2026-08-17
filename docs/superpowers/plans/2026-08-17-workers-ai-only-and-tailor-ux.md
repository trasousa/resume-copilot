# Workers-AI-Only Provider, Job Search Fix, and Tailor Studio UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commit resume-copilot fully to Cloudflare Workers AI (dropping the Anthropic/Gemini multi-provider abstraction, per the design spec's already-settled decision), fix the resulting "no live web search" gap in Job Search by relying on the already-built Apify ATS source instead, add lightweight markdown rendering to the two places that need it, give the chat assistant real visual feedback during its slow reasoning phase, and improve the Tailor Studio's layout (collapsible sections, expandable Match Analysis, side-by-side CV comparison) plus its prompt (less emoji).

**Architecture:** Seven mostly-independent changes to the existing single-Worker resume-copilot app (Hono, D1, R2, plain ES-module frontend, no build step). Task 1 (provider consolidation) touches the most files but is mechanical deletion + simplification. Tasks 2-7 build on the simplified, single-provider foundation Task 1 leaves behind.

**Tech Stack:** Hono, Cloudflare Workers + D1 + R2 + Workers AI (`env.AI` binding), vanilla ES modules, hand-written CSS. No new npm dependencies — this plan *removes* one (`@anthropic-ai/sdk`).

**Spec:** `docs/superpowers/specs/2026-08-16-resume-agent-core-design.md` — its "Model choice (settled...)" paragraph is the authority for Task 1: *"Workers AI only... Anthropic and Gemini are dropped entirely -- no more `ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`, no multi-vendor abstraction in `lib/llm.js`."* That same spec's sub-project 5 (Browser Rendering-based search) is explicitly **not** what this plan implements for Job Search — it's a much larger, separate effort involving Cloudflare's Agents SDK; this plan instead uses the Apify ATS integration that already shipped in a merged PR, which needs no new infrastructure and directly fixes the error the user hit.

## Global Constraints

- **Workers AI only, everywhere.** No code path may reference `LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_MODEL`, or `GEMINI_MODEL` after this plan. The only model-selection knobs left are `WORKERS_AI_MODEL` (tailoring/one-shot tasks) and a new, separate `WORKERS_AI_CHAT_MODEL` (the interactive chat assistant) — see Task 1 and Task 4.
- **No new npm dependencies.** The markdown renderer (Task 3) is hand-written, consistent with this project's existing `renderDocHtml`-style heuristic parsers in `public/js/cv-doc.js`.
- **No test framework in this repo.** Verify with `npm run lint` + `npm run dev` + live curl/browser checks, per this project's established convention.
- **This app is live in production.** Nothing in this plan requires a schema or remote-DB migration, so there's no production-migration risk here — but Task 1's env-var removal means `wrangler.jsonc`'s `vars` block changes shape; the already-deployed Worker's current secrets (`ANTHROPIC_API_KEY` if set) become unused, not broken — removing an unused secret is optional cleanup, not required for this plan to work.
- **Escaping discipline:** the new markdown renderer (Task 3) must escape all raw text before applying any markdown transform — it renders LLM-generated content, the same class of input this codebase has consistently protected against XSS in every prior redesign.

---

## Task 1: Drop the Anthropic/Gemini multi-provider abstraction

**Files:**
- Delete: `src/lib/anthropic.js`
- Delete: `src/lib/gemini.js`
- Modify: `src/lib/llm.js`
- Modify: `src/index.js`
- Modify: `wrangler.jsonc`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `public/js/app.js`

**Interfaces:**
- `runTask`, `runWebSearchTask`, `runChatStream` (exported from `src/lib/llm.js`) keep their exact existing call signatures — every route file that imports them (`src/routes/tailor.js`, `applications.js`, `documents.js`, `outreach.js`, `cvs.js`, and Task 2's rewritten `jobsearch.js`) needs zero changes to how it calls these three functions. Only `llm.js`'s internal implementation changes (no more provider dispatch table).
- `GET /api/health`'s response shape simplifies to `{ok, model, chatModel, authRequired}` — drops `provider`, `hasApiKey`, `apiKeyName` (there's no key to check anymore; Workers AI auths via the binding alone). `public/js/app.js`'s `checkApiKey()` is updated to match (Step 6).

- [ ] **Step 1: Delete the two provider files**

```bash
rm src/lib/anthropic.js src/lib/gemini.js
```

- [ ] **Step 2: Rewrite `src/lib/llm.js` to call `workersai.js` directly, no provider switch**

Replace the whole file:

```js
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

import * as workersai from "./workersai.js";
import * as db from "./db.js";

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

export async function runTask(args) {
  await assertUnderCap(args.env);
  const result = await workersai.runTask(args);
  await recordUsage(args.env, result.usage);
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
        await assertUnderCap(args.env);
      } catch (err) {
        send("error", { error: err.message });
        controller.close();
        return;
      }

      const userOnDone = args.onDone;
      const upstream = workersai.runChatStream({
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
```

Note `runWebSearchTask` is intentionally NOT re-exported here — Task 2 removes every caller of it (Job Search was the only feature that used it), so it has no remaining callers after this plan. Leave `workersai.js`'s own `runWebSearchTask` function in place for now (Task 2 deletes it once nothing calls it).

- [ ] **Step 3: Simplify `GET /api/health` in `src/index.js`**

Find the current handler (searches for `app.get("/api/health"`) and replace its body:

```js
app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    model: c.env.WORKERS_AI_MODEL || "@cf/zai-org/glm-4.7-flash",
    chatModel: c.env.WORKERS_AI_CHAT_MODEL || c.env.WORKERS_AI_MODEL || "@cf/zai-org/glm-4.7-flash",
    authRequired: c.env.SKIP_AUTH !== "1",
  });
});
```

- [ ] **Step 4: Update `wrangler.jsonc`**

Replace the `"vars"` block's `LLM_PROVIDER`/`ANTHROPIC_MODEL`/`GEMINI_MODEL` entries and the surrounding comment. Find:

```jsonc
  "vars": {
    // "workersai" (default, cheapest, no secret needed), "anthropic", or
    // "gemini" -- see src/lib/llm.js. Whichever is active, only that
    // provider's API key (if it has one) needs to be set as a secret.
    //
    // Known gap: workersai has no live web search, so Job Search will error
    // with a clear message telling you to switch LLM_PROVIDER to
    // "anthropic" or "gemini" until Browser Rendering-based search lands
    // (see the design spec's sub-project 5) -- see src/lib/workersai.js.
    "LLM_PROVIDER": "workersai",
    "WORKERS_AI_MODEL": "@cf/zai-org/glm-4.7-flash",
    "ANTHROPIC_MODEL": "claude-sonnet-5",
    "GEMINI_MODEL": "gemini-3.5-flash-lite",
    "CF_ACCESS_TEAM_DOMAIN": "trasousa.cloudflareaccess.com",
    "CF_ACCESS_AUD": "a55647e511b1d3a8932fb682a628af9901b8eccf2befb5f02aee35779d437c78" // gitleaks:allow -- not a bearer credential, see comment above
  },
```

Replace with:

```jsonc
  "vars": {
    // Workers AI only -- see docs/superpowers/specs/2026-08-16-resume-agent-core-design.md's
    // "Model choice" paragraph. No secret needed; auth is the AI binding
    // above. WORKERS_AI_MODEL is for one-shot tasks (tailoring, document
    // generation); WORKERS_AI_CHAT_MODEL is for the interactive CV-improve
    // chat and can be set to a faster/non-reasoning model since chat
    // latency matters more there than depth -- see src/lib/workersai.js.
    "WORKERS_AI_MODEL": "@cf/zai-org/glm-4.7-flash",
    "WORKERS_AI_CHAT_MODEL": "@cf/zai-org/glm-4.7-flash",
    "CF_ACCESS_TEAM_DOMAIN": "trasousa.cloudflareaccess.com",
    "CF_ACCESS_AUD": "a55647e511b1d3a8932fb682a628af9901b8eccf2befb5f02aee35779d437c78" // gitleaks:allow -- not a bearer credential, see comment above
  },
```

Also find and remove the secrets comment block that references `ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`:

```jsonc
  // Secrets are NOT set here -- they go in the encrypted store:
  //   npx wrangler secret put ANTHROPIC_API_KEY
  //   npx wrangler secret put GOOGLE_API_KEY   (only if LLM_PROVIDER is "gemini")
  // For local dev, put the same key(s) in .dev.vars (gitignored). Also set
  // SKIP_AUTH="1" there -- Access never runs in front of `wrangler dev`.
```

Replace with:

```jsonc
  // No LLM secret to set -- Workers AI authenticates via the "ai" binding
  // above alone, tied to the account this Worker deploys under. For local
  // dev, set SKIP_AUTH="1" in .dev.vars (gitignored) -- Access never runs
  // in front of `wrangler dev`.
```

- [ ] **Step 5: Update `.env.example`**

Replace its entire contents (it currently documents `ANTHROPIC_API_KEY` as the primary local-dev requirement, which is no longer true — Workers AI's binding works locally under `wrangler dev` with zero configuration):

```
# No LLM API key needed -- Workers AI authenticates via the "ai" binding in
# wrangler.jsonc alone, which works locally under `wrangler dev` with zero
# extra setup.

# Required for local dev only -- Cloudflare Access never runs in front of
# `wrangler dev`, so this bypasses auth locally. Never set in production.
SKIP_AUTH=1

# Optional overrides
PORT=4173
WORKERS_AI_MODEL=@cf/zai-org/glm-4.7-flash
WORKERS_AI_CHAT_MODEL=@cf/zai-org/glm-4.7-flash

# Optional -- enables a second, deterministic job-search source (Apify's
# fantastic-jobs/jobs-scraper actor, reads ATS platforms' public APIs
# directly). Get a token at https://console.apify.com/settings/integrations.
APIFY_API_TOKEN=

# Optional, only used if APIFY_API_TOKEN is set -- a JSON array of company
# career pages to scrape via the actor above, e.g.:
# [{"url":"https://boards.greenhouse.io/yourcompany","company":"Your Company"}]
APIFY_WATCHLIST=[]
```

- [ ] **Step 6: Update `public/js/app.js`'s `checkApiKey()`**

Find `checkApiKey()` (currently reads `health.hasApiKey`/`health.apiKeyName`). Since Workers AI needs no key, this function's entire premise (warn if no API key is set) no longer applies. Replace the whole function:

```js
export async function checkApiKey() {
  // Workers AI needs no API key (auth is the "ai" binding alone), so there
  // is nothing left for this check to warn about. Kept as a no-op export
  // rather than removed, since every page still imports and calls it --
  // removing it would mean touching all 7 page scripts for no behavior
  // change.
}
```

(Every page still calls `checkApiKey()` at module load — leaving it as a harmless no-op avoids a 7-file touch for zero behavioral gain. If a future task wants to remove those call sites too, that's a separate, purely-cosmetic cleanup, not required here.)

- [ ] **Step 7: Remove the `@anthropic-ai/sdk` dependency**

In `package.json`, remove this line from `"dependencies"`:
```json
    "@anthropic-ai/sdk": "^0.117.1",
```
Run: `npm install` (updates `package-lock.json` to match).

- [ ] **Step 8: Update README.md**

Find the "LLM provider" section (search for `LLM_PROVIDER` or the paragraph describing Claude/Gemini switching) and replace it with a short paragraph stating: this app uses Cloudflare Workers AI exclusively, no API key needed, `WORKERS_AI_MODEL`/`WORKERS_AI_CHAT_MODEL` in `wrangler.jsonc`'s `vars` block select which `@cf/...` model each flow uses. Remove any remaining `ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`/`LLM_PROVIDER` mentions elsewhere in the file (grep for them first).

- [ ] **Step 9: Verify**

Run: `grep -rn "anthropic\|gemini\|LLM_PROVIDER\|ANTHROPIC_API_KEY\|GOOGLE_API_KEY" src/ public/ wrangler.jsonc .env.example README.md -i`
Expected: no functional matches remain (a couple of comment-only references in unrelated files like `src/lib/skills.js`'s docstring or `src/lib/jobpost.js`'s "keeps this out of lib/anthropic.js" comment are fine to leave or clean up while you're there, but no code should still import or branch on either provider).

Run: `npm run lint` — must be clean (this also catches any now-dangling import of the deleted files).

Run: `npm run dev`, then `curl -s localhost:8787/api/health | jq` — expected: `{"ok":true,"model":"@cf/zai-org/glm-4.7-flash","chatModel":"@cf/zai-org/glm-4.7-flash","authRequired":false}` (assuming `SKIP_AUTH=1` locally). Exercise one existing AI-backed route (e.g. `POST /api/tailor/quick` with a real CV) to confirm `runTask` still works end to end through the simplified `llm.js`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: drop Anthropic/Gemini providers, commit fully to Workers AI"
```

---

## Task 2: Job Search — Apify-only listings, Workers AI for ranking only

**Files:**
- Modify: `src/routes/jobsearch.js`
- Modify: `src/lib/workersai.js` (remove `runWebSearchTask`, now unused)
- Modify: `public/js/job-search.js`

**Interfaces:**
- `POST /api/jobsearch/search`'s response shape changes: drops `sources` (was web-search citations, meaningless for a deterministic scraper) and `atsError`'s meaning narrows (now the ONLY thing that can fail, since there's no second source to fall back on). New shape: `{ text: string, jobs: Array<{title, company, location, url, compEstimate, source: "ats", matchScore?: number, fitNote?: string}>, atsError: string|null }`. `text` becomes a short LLM-written summary/ranking rationale (still markdown-ish prose), not the old "Match Analysis"-style report — see Step 1.
- Consumes: `runApifyAtsSearch` from `src/lib/apify.js` (unchanged, already built).

- [ ] **Step 1: Rewrite the search route**

Replace `src/routes/jobsearch.js`'s `router.post("/search", ...)` handler entirely (keep the file's `parseWatchlist` helper and imports from the prior plan as-is; only the route body changes):

```js
router.post("/search", async (c) => {
  const { cvId, city, region, country, remote, minComp, notes } = await c.req.json();

  const cv = await db.resolveCv(c.env.DB, cvId);
  if (!cv)
    return c.json({ error: "No CV available. Upload or set a master CV first." }, 400);

  const watchlist = parseWatchlist(c.env);
  if (!watchlist.length) {
    return c.json({
      text: "No companies configured to search yet. Add at least one to APIFY_WATCHLIST to see results here.",
      jobs: [],
      atsError: null,
    });
  }

  const ats = await runApifyAtsSearch({ apiToken: c.env.APIFY_API_TOKEN, watchlist });
  if (ats.error) {
    return c.json({ text: "", jobs: [], atsError: ats.error });
  }
  if (!ats.jobs.length) {
    return c.json({ text: "No open roles found at your watchlisted companies right now.", jobs: [], atsError: null });
  }

  // Rank the real, scraped listings against the candidate's CV -- this is
  // a plain LLM call (no search capability needed), which Workers AI
  // handles fine; it's live web search specifically that Workers AI lacks.
  const stable =
    `You are a job-matching assistant. You will be given a candidate's CV ` +
    `and a list of real, already-found job postings. Rank them by fit for ` +
    `this candidate and explain briefly why. Never invent postings or ` +
    `details not present in the list you were given. Do not use emojis.`;

  const locationLine = remote
    ? `Remote (${[city, region, country].filter(Boolean).join(", ") || "any location"})`
    : [city, region, country].filter(Boolean).join(", ");

  const prompt =
    `Candidate's CV:\n"""\n${cv.content}\n"""\n\n` +
    `Target location: ${locationLine || "any"}\n` +
    (minComp ? `Minimum target compensation: ${minComp}\n` : "") +
    (notes ? `Additional preferences: ${notes}\n` : "") +
    `\nJob postings found:\n${JSON.stringify(ats.jobs, null, 2)}\n\n` +
    `Return two things:\n` +
    `1. A short markdown summary (2-4 sentences) of the overall fit of this batch.\n` +
    `2. A fenced block starting with \`\`\`RANKED and ending with \`\`\` containing ` +
    `a JSON array, same jobs, reordered best-fit-first, each with an added ` +
    `"matchScore" (integer 0-100) and "fitNote" (one sentence) field.`;

  const { text } = await runTask({ env: c.env, stable, prompt, maxTokens: 4000 });

  let rankedJobs = ats.jobs;
  const rankedMatch = text.match(/```RANKED\n([\s\S]*?)\n```/);
  if (rankedMatch) {
    try {
      const parsed = JSON.parse(rankedMatch[1]);
      if (Array.isArray(parsed)) rankedJobs = parsed;
    } catch {
      // Fall through to the unranked (but still real) job list.
    }
  }

  const summary = text.replace(/```RANKED\n[\s\S]*?\n```/, "").trim();
  return c.json({ text: summary, jobs: rankedJobs, atsError: null });
});
```

Update the imports at the top of the file to include `runTask` from `../lib/llm.js` (it likely doesn't import this yet, since the old route only used `runWebSearchTask`):
```js
import { runTask } from "../lib/llm.js";
```
Remove the now-unused `runWebSearchTask` import if present.

- [ ] **Step 2: Remove the now-dead `runWebSearchTask` from `workersai.js`**

In `src/lib/workersai.js`, delete the entire `runWebSearchTask` function (the one that always throws a 501 "no live web search" error) — it has no remaining callers after Step 1. Also update the module's header comment block (the one explaining "No real web search: Workers AI has nothing built in yet...") to drop the now-stale forward-reference to "runWebSearchTask below throws rather than fabricating results" — replace that sentence with a note that Job Search now uses the Apify ATS source exclusively, not live web search at all.

- [ ] **Step 3: Update the frontend to match the new response shape**

In `public/js/job-search.js`, find the `render(data, cvId)` function. The old version parsed a `\`\`\`JOBS` block out of `data.text` via `extractJobs()`; the new backend already returns a structured `jobs` array directly, so simplify:

Replace the top of `render`:
```js
function render(data, cvId) {
  const jobs = data.jobs || [];
  const analysisText = data.text || "";
```
(Remove the old `extractJobs(data.text)` call and the `analysisText.replace(/\`\`\`JOBS.../, "")` line — `data.text` is already the clean summary, no fenced block to strip.)

Remove the "Search sources" card block entirely (the one keyed off `data.sources` — that field no longer exists; a `data.sources?.length` check will just be falsy and render nothing if left in place, but delete it for clarity rather than leaving dead code).

Everything else in `render` (the job-grid template, the `matchScore`/`ATS listing` badges, the `data-idx` Tailor Resume handler) stays as-is — `jobs[i].matchScore`, `.company`, `.title`, `.url`, `.compEstimate`, `.location`, `.fitNote`, `.source` are all still present on each job object in the new shape.

- [ ] **Step 4: Verify**

Run: `npm run lint`. Run: `npm run dev`. Without `APIFY_WATCHLIST` set (or set to `[]`), search and confirm you get the "No companies configured..." message with zero errors (not the old "ATS search unavailable... Workers AI has no live web search" message — that error class is now impossible, since nothing calls `runWebSearchTask` anymore). If you have a real `APIFY_API_TOKEN` + `APIFY_WATCHLIST`, run a real search and confirm: real jobs come back, each has a `matchScore`/`fitNote` from the ranking step, and the summary text reads as a short paragraph, not a JSON dump.

- [ ] **Step 5: Commit**

```bash
git add src/routes/jobsearch.js src/lib/workersai.js public/js/job-search.js
git commit -m "fix: make Apify the sole Job Search source, Workers AI only for ranking"
```

---

## Task 3: Shared markdown renderer

**Files:**
- Create: `public/js/markdown.js`

**Interfaces:**
- New: `renderMarkdown(text: string) -> string` (returns HTML). Escapes all raw text first (via `escapeHtml`, imported from `app.js`), then applies markdown transforms to the *already-escaped* string — this ordering is deliberate and load-bearing: transforming the raw string first and escaping after would let markdown-inserted tags get escaped away; escaping first means the transform regexes only ever see literal `&lt;`/`&gt;`/etc., never real `<`/`>`, so there is no way for LLM-generated text to inject markup through this function.

- [ ] **Step 1: Write the renderer**

```js
// public/js/markdown.js
//
// Small, dependency-free markdown-to-HTML renderer for LLM-generated text
// (chat replies, match analysis). Escapes first, transforms second -- see
// this module's own tests-by-inspection below for why that order matters:
// escaping after transforming would let a markdown-inserted <tag> survive
// as real markup; escaping first means every transform regex only ever
// sees literal &lt;/&gt;, so there's no way for model output to inject
// markup through this function no matter what it contains.
//
// Deliberately supports only the handful of constructs LLM output actually
// uses in this app's prompts (headings, bold/italic, inline code, lists,
// paragraphs, links) -- not a full CommonMark implementation.

import { escapeHtml, safeUrl } from "./app.js";

export function renderMarkdown(text) {
  if (!text) return "";

  let html = escapeHtml(text);

  // Headings (### / ## / #) -- must run before bold/italic so a heading
  // like "### **Foo**" doesn't confuse the line-start anchor.
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

  // Bold, then italic (order matters: **x** before *x*, else the two
  // leading asterisks of "**x**" would each get consumed as italic first).
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Inline code.
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links: [text](url) -- safeUrl() rejects non-http(s) schemes the same
  // way every other link-rendering path in this app already does.
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    const safe = safeUrl(url);
    return safe ? `<a href="${safe}" target="_blank" rel="noopener">${linkText}</a>` : linkText;
  });

  // Lists: group consecutive "- " or "1. " lines into <ul>/<ol>.
  const lines = html.split("\n");
  const out = [];
  let listType = null; // "ul" | "ol" | null
  for (const line of lines) {
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (bulletMatch) {
      if (listType !== "ul") { if (listType) out.push(`</${listType}>`); out.push("<ul>"); listType = "ul"; }
      out.push(`<li>${bulletMatch[1]}</li>`);
    } else if (numberedMatch) {
      if (listType !== "ol") { if (listType) out.push(`</${listType}>`); out.push("<ol>"); listType = "ol"; }
      out.push(`<li>${numberedMatch[1]}</li>`);
    } else {
      if (listType) { out.push(`</${listType}>`); listType = null; }
      out.push(line);
    }
  }
  if (listType) out.push(`</${listType}>`);
  html = out.join("\n");

  // Remaining blank-line-separated chunks become paragraphs, skipping
  // anything that's already a block element (heading/list) from above.
  html = html
    .split(/\n{2,}/)
    .map((chunk) => {
      const trimmed = chunk.trim();
      if (!trimmed) return "";
      if (/^<(h2|h3|ul|ol)/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return html;
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint`. This module has no route/page to load it yet (Tasks 4 and 6 wire it in) — verify it in isolation via a quick Node smoke check instead: create a scratch script that imports `renderMarkdown` with a jsdom-free stub of `escapeHtml`/`safeUrl` (or, simpler, temporarily paste the function into a browser console against a few sample strings during `npm run dev`) and confirm: `"**bold** and *italic*"` → `<strong>bold</strong> and <em>italic</em>`; `"- a\n- b"` → a `<ul>` with two `<li>`s; `"<script>alert(1)</script>"` → renders as inert escaped text, no real `<script>` tag in the output (this is the one check that must not be skipped — paste that exact string through and inspect the output HTML directly, not just visually in a rendered page).

- [ ] **Step 3: Commit**

```bash
git add public/js/markdown.js
git commit -m "feat: add a dependency-free markdown-to-HTML renderer"
```

---

## Task 4: Chat assistant — markdown rendering, visible reasoning feedback, configurable model

**Files:**
- Modify: `src/lib/workersai.js`
- Modify: `public/js/cv-doc.js`
- Modify: `public/js/cv-store.js`
- Modify: `public/css/styles.css`

**Interfaces:**
- `workersai.js`'s `modelFor(env)` (used by `runTask`) stays as-is for one-shot tasks. New: `chatModelFor(env) -> string`, reading `WORKERS_AI_CHAT_MODEL` (falling back to `WORKERS_AI_MODEL`, then the same hardcoded default) — used only by `runChatStream`.
- `runChatStream`'s SSE protocol gains a new event type: `event: reasoning` with `data: {text: string}` (a delta of the model's internal chain-of-thought, previously silently dropped). The existing `text`/`done`/`error` events are unchanged in shape.
- `mountCvDocument`'s `assistant` object (in `cv-doc.js`) gains: `setReasoningText(el, text) -> void` — updates a distinct, visually subdued "thinking" line inside a note element, separate from its main text. `addNote(role, text)` is unchanged in signature but now renders via `renderMarkdown(text)` instead of `el.textContent = text`.

- [ ] **Step 1: Add a separate chat model config and surface reasoning deltas in `workersai.js`**

Add near `modelFor`:
```js
const chatModelFor = (env) => env.WORKERS_AI_CHAT_MODEL || env.WORKERS_AI_MODEL || DEFAULT_MODEL;
```

In `runChatStream`, change `const model = modelFor(env);` to `const model = chatModelFor(env);`.

In the SSE parsing loop inside `runChatStream`, find:
```js
            const chunk = JSON.parse(dataLine);
            const candidate = chunk.choices?.[0];
            const delta = candidate?.delta?.content;
            if (delta) {
              reply += delta;
              send("text", { text: delta });
            }
```
Change to also forward reasoning deltas as their own event, without adding them to `reply` (the saved/returned text must stay exactly the model's final answer, not include chain-of-thought):
```js
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
```

Update the module's header comment (the one that says "`delta.reasoning`/`reasoning_content`... is intentionally never sent to the client") to reflect the new behavior — it's now sent, as its own distinct event, specifically so the UI can show real progress during the slow phase instead of a static placeholder.

- [ ] **Step 2: Render markdown and add a reasoning-feedback line in `cv-doc.js`**

Add the import at the top:
```js
import { renderMarkdown } from "./markdown.js";
```

In the `assistant` object returned by `mountCvDocument`, find `addNote(role, text)`:
```js
          addNote(role, text) {
            const log = container.querySelector("#assistantLog");
            const el = document.createElement("div");
            el.className = `assistant-note ${role}`;
            el.textContent = text;
            log.appendChild(el);
            log.scrollTop = log.scrollHeight;
            return el;
          },
```
Change to render markdown (only for the assistant's own messages — user messages stay plain text, since they're the user's own input, not model output, and markdown-rendering a user's literal `*` characters would be surprising):
```js
          addNote(role, text) {
            const log = container.querySelector("#assistantLog");
            const el = document.createElement("div");
            el.className = `assistant-note ${role}`;
            if (role === "assistant") el.innerHTML = renderMarkdown(text);
            else el.textContent = text;
            log.appendChild(el);
            log.scrollTop = log.scrollHeight;
            return el;
          },
```

Find `setNoteText(el, text)` and apply the same markdown treatment (this is always called for assistant notes, since only assistant replies stream):
```js
          setNoteText(el, text) {
            el.innerHTML = renderMarkdown(text);
            const log = container.querySelector("#assistantLog");
            log.scrollTop = log.scrollHeight;
          },
```

Add a new method right after `setNoteText` for the reasoning-phase indicator:
```js
          setReasoningText(el, text) {
            let reasoningEl = el.querySelector(".assistant-reasoning");
            if (!reasoningEl) {
              reasoningEl = document.createElement("div");
              reasoningEl.className = "assistant-reasoning";
              el.prepend(reasoningEl);
            }
            reasoningEl.textContent = text;
            const log = container.querySelector("#assistantLog");
            log.scrollTop = log.scrollHeight;
          },
```

- [ ] **Step 3: Wire the reasoning event into the chat UI in `cv-store.js`**

In `sendChat(message)`, find the SSE event-handling loop:
```js
        const data = JSON.parse(dataLine);
        if (event === "text") {
          reply += data.text;
          doc.assistant.setNoteText(pending, stripCvBlock(reply));
        } else if (event === "done") {
          reply = data.reply;
        } else if (event === "error") {
          streamError = data.error;
        }
```
Add a branch for the new event, and track accumulated reasoning text separately so it doesn't leak into the saved reply:
```js
        const data = JSON.parse(dataLine);
        if (event === "reasoning") {
          reasoningSoFar += data.text;
          doc.assistant.setReasoningText(pending, reasoningSoFar);
        } else if (event === "text") {
          reply += data.text;
          doc.assistant.setNoteText(pending, stripCvBlock(reply));
        } else if (event === "done") {
          reply = data.reply;
        } else if (event === "error") {
          streamError = data.error;
        }
```
Declare `let reasoningSoFar = "";` alongside the existing `let reply = "";` declaration a few lines above this loop.

Also change the initial placeholder text (currently `doc.assistant.addNote("assistant", "thinking…")`) — leave it as-is, it's still the right first-paint state before any reasoning delta arrives; `setReasoningText`'s first call will prepend real content above it once the model starts producing reasoning tokens, and `setNoteText`'s first `text`-event call replaces the whole note (including the placeholder) once the model starts producing its actual answer, at which point the reasoning line naturally stops updating (still visible above the growing answer until the note's next full `innerHTML` replacement clears it — note that `setNoteText`'s `el.innerHTML = renderMarkdown(text)` REPLACES the whole element including the reasoning div once real content starts, which is the correct behavior: once the real answer begins, the reasoning scratch-space it's no longer useful to keep on screen).

- [ ] **Step 4: Style the reasoning indicator**

Append to `public/css/styles.css`:
```css
.assistant-reasoning {
  font-size: 12px; font-style: italic; color: var(--ink-soft); opacity: 0.8;
  margin-bottom: 4px; white-space: pre-wrap; max-height: 60px; overflow-y: auto;
}
```

- [ ] **Step 5: Verify**

Run: `npm run lint`. Run: `npm run dev`, open CV Store, click "Improve" on a CV, send a chat message. Expected: a subdued italic line appears and grows/updates while the model is in its reasoning phase (visible feedback that something is happening, not a static unchanging "thinking…"), then is replaced by the actual rendered answer (with real `<strong>`/`<ul>`/etc. formatting if the model used markdown) once real content starts streaming. Confirm the saved chat history (`GET /cvs/:id/chat`, reloaded on next open) contains only the final answer text, no reasoning content leaked in.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workersai.js public/js/cv-doc.js public/js/cv-store.js public/css/styles.css
git commit -m "feat: render chat markdown, surface live reasoning feedback, separate chat model config"
```

---

## Task 5: Make the Outreach Studio link visible

**Files:**
- Modify: `public/tailor.html`
- Modify: `public/css/styles.css`

**Interfaces:** None.

- [ ] **Step 1: Restyle the link**

In `public/tailor.html`, find:
```html
        <a class="muted" href="outreach.html" style="display:inline-block; margin-top:14px;">Need a cover letter or cold email instead? Open the Outreach Studio &rarr;</a>
```
Replace with a visually distinct callout instead of a low-contrast muted-gray inline link:
```html
        <a class="outreach-callout" href="outreach.html">
          <span>Need a cover letter or cold email instead?<br><strong>Open the Outreach Studio →</strong></span>
        </a>
```

- [ ] **Step 2: Style it**

Append to `public/css/styles.css`:
```css
.outreach-callout {
  display: flex; align-items: center; gap: 10px;
  margin-top: 16px; padding: 12px 14px; border-radius: var(--radius);
  background: var(--advocate-primary-container); color: var(--advocate-primary);
  text-decoration: none; font-size: 13.5px; line-height: 1.4;
  border: 1px solid var(--advocate-primary-container);
  transition: background-color 0.15s ease;
}
.outreach-callout:hover { background: var(--advocate-surface-container-high); }
.outreach-callout strong { display: block; margin-top: 2px; }
```

- [ ] **Step 3: Verify**

Run: `npm run dev`, open `tailor.html`. Expected: the Outreach Studio link now renders as a filled, colored callout box (using the primary-container teal tint) rather than small gray text — clearly visible without hunting for it, and still navigates to `outreach.html` on click.

- [ ] **Step 4: Commit**

```bash
git add public/tailor.html public/css/styles.css
git commit -m "style: make the Outreach Studio callout on Tailor page actually visible"
```

---

## Task 6: Tailor Studio — expandable Match Analysis card, markdown rendering, emoji-free prompt

**Files:**
- Modify: `src/routes/tailor.js`
- Modify: `src/routes/applications.js`
- Modify: `public/js/tailor.js`
- Modify: `public/css/styles.css`

**Interfaces:**
- Consumes: `renderMarkdown` from `public/js/markdown.js` (Task 3).
- No backend response-shape changes — `analysis`/`tailoredText`/`keywords`/`baseCvId` from `POST /api/tailor/quick` (and the equivalent fields from `POST /api/applications/:id/tailor`) are unchanged; only the *prompt* text changes (one added sentence) and the *frontend rendering* of `analysis` changes.

- [ ] **Step 1: Add an emoji-free instruction to both tailoring prompts**

In `src/routes/tailor.js`'s `router.post("/quick", ...)`, find the `stable` prompt:
```js
  const stable =
    `You are a resume-tailoring copilot. Follow the skills below precisely, and ` +
    `never fabricate experience the candidate doesn't have -- only reorder, ` +
    `reframe, and emphasize what's true.\n\n` +
```
Add one sentence:
```js
  const stable =
    `You are a resume-tailoring copilot. Follow the skills below precisely, and ` +
    `never fabricate experience the candidate doesn't have -- only reorder, ` +
    `reframe, and emphasize what's true. Do not use emojis anywhere in your ` +
    `response.\n\n` +
```

Apply the identical one-sentence addition to `src/routes/applications.js`'s `router.post("/:id/tailor", ...)` handler's own `stable` prompt (same opening sentence structure, same insertion point — right before the `Follow the skills below` sentence ends and the skill-prompt concatenation begins).

- [ ] **Step 2: Wrap Match Analysis in an expandable card with markdown rendering**

In `public/js/tailor.js`, add the import:
```js
import { renderMarkdown } from "./markdown.js";
```

Find `render(data)`'s current Match Analysis markup:
```js
  resultEl.innerHTML = `
    <div class="card">
      <h2>Match analysis</h2>
      <div class="doc-content">${escapeHtml(analysisText)}</div>
    </div>
    <div id="tailoredCvMount"></div>
  `;
```
Replace with a `<details>`-based expandable card, markdown-rendered:
```js
  resultEl.innerHTML = `
    <details class="card" open>
      <summary><h2 style="display:inline;">Match analysis</h2></summary>
      <div class="doc-content markdown-body">${renderMarkdown(analysisText)}</div>
    </details>
    <div id="tailoredCvMount"></div>
  `;
```
(`open` by default so the analysis is visible immediately after a run, matching current behavior — the user can collapse it themselves via the native `<summary>` click target once they've read it.)

- [ ] **Step 3: Style the expandable card and markdown body**

Append to `public/css/styles.css`:
```css
details.card summary { cursor: pointer; list-style: none; }
details.card summary::-webkit-details-marker { display: none; }
details.card summary::before {
  content: "▸"; display: inline-block; margin-right: 8px; color: var(--ink-soft);
  transition: transform 0.15s ease;
}
details.card[open] summary::before { transform: rotate(90deg); }

.markdown-body { margin-top: 10px; }
.markdown-body h2, .markdown-body h3 { margin: 14px 0 6px; }
.markdown-body h2:first-child, .markdown-body h3:first-child { margin-top: 0; }
.markdown-body p { margin: 0 0 10px; }
.markdown-body ul, .markdown-body ol { margin: 0 0 10px; padding-left: 22px; }
.markdown-body li { margin-bottom: 4px; }
.markdown-body code { background: var(--advocate-surface-container-low); padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
```

- [ ] **Step 4: Verify**

Run: `npm run lint`. Run: `npm run dev`, run a tailoring analysis. Expected: the Match Analysis card has a clickable `▸`/`▾` disclosure triangle in its header, starts expanded, collapses/expands on click; its content renders real markdown formatting (headings, bold, lists) instead of an escaped plain-text blob; a handful of manual runs should show no emoji in the output (this is a prompt-tuning request, not a hard guarantee — the model may occasionally still slip one in; that's expected, not a bug to chase further in this task).

- [ ] **Step 5: Commit**

```bash
git add src/routes/tailor.js src/routes/applications.js public/js/tailor.js public/css/styles.css
git commit -m "feat: expandable markdown Match Analysis card, emoji-free tailoring prompt"
```

---

## Task 7: Tailor Studio — collapsible JD pane + side-by-side original/tailored CV comparison

**Files:**
- Modify: `public/tailor.html`
- Modify: `public/js/tailor.js`
- Modify: `public/css/styles.css`

**Interfaces:**
- Consumes: `mountCvDocument` from `public/js/cv-doc.js` (unchanged signature; this task mounts it twice — once read-only for the original CV, once editable as before for the tailored CV).

- [ ] **Step 1: Wrap the JD pane in a collapsible `<details>` and add a comparison grid container**

In `public/tailor.html`, find the left pane:
```html
      <div class="card studio-pane">
        <h2>Target Job Description</h2>
        <label>Base CV</label>
        ...
        <a class="outreach-callout" href="outreach.html">
          ...
        </a>
      </div>
      <div class="studio-pane" id="result"></div>
```
Wrap it in a `<details>` with an id so JS can toggle it, and give the whole split container an id so JS can add a "collapsed" class to it:
```html
      <details class="card studio-pane" id="jdPane" open>
        <summary><h2 style="display:inline;">Target Job Description</h2></summary>
        <label>Base CV</label>
        <select id="cvSelect"></select>
        <label>Role flavor</label>
        <select id="flavor">
          <option value="">General</option>
          <option value="tech">Tech / Engineering / PM</option>
          <option value="executive">Executive / C-suite</option>
          <option value="academic">Academic</option>
          <option value="creative">Creative / Design</option>
          <option value="careerChange">Career change</option>
        </select>
        <label>Job posting link (optional)</label>
        <div class="row">
          <input type="text" id="jobPostLink" style="flex:1;" placeholder="https://..." />
          <button type="button" class="btn secondary small" id="fetchJobPost">Fetch job post</button>
        </div>
        <span id="fetchStatus" class="muted"></span>
        <label>Job posting text</label>
        <textarea id="jobPost" rows="14" placeholder="Paste the full job description here, or fetch it from the link above" style="flex:1;"></textarea>
        <div class="row" style="margin-top:12px;">
          <button class="btn" id="runBtn">Analyze &amp; Tailor</button>
          <span id="status" class="muted"></span>
        </div>
        <a class="outreach-callout" href="outreach.html">
          <span>Need a cover letter or cold email instead?<br><strong>Open the Outreach Studio →</strong></span>
        </a>
      </details>
      <div class="studio-pane" id="result"></div>
```
And give the wrapping `.studio-split` element an id:
```html
    <div class="studio-split" id="studioSplit">
```
(Find the existing `<div class="studio-split">` opening tag and add `id="studioSplit"` to it.)

- [ ] **Step 2: Collapse the JD pane automatically after a successful run, and add a two-column CV comparison**

In `public/js/tailor.js`, at the top of `render(data)` (right after the function signature, before building `resultEl.innerHTML`), add:
```js
  document.getElementById("jdPane").open = false;
  document.getElementById("studioSplit").classList.add("jd-collapsed");
```

Find the end of `render(data)` where the tailored CV is mounted:
```js
  const doc = mountCvDocument(document.getElementById("tailoredCvMount"), {
    content: data.tailoredText,
    editable: true,
    saveLabel: "Save as new CV version",
    highlightTerms: data.keywords || [],
    onSave: (text) => api("/tailor/quick/save", { method: "POST", body: { baseCvId: data.baseCvId, content: text } }),
  });
```
Before that block, change the mount point markup to a two-column grid and add the original-CV fetch + mount. Replace:
```js
  resultEl.innerHTML = `
    <details class="card" open>
      <summary><h2 style="display:inline;">Match analysis</h2></summary>
      <div class="doc-content markdown-body">${renderMarkdown(analysisText)}</div>
    </details>
    <div id="tailoredCvMount"></div>
  `;

  if (!data.tailoredText) {
    document.getElementById("tailoredCvMount").innerHTML =
      `<p class="muted">No structured tailored CV was returned — try again, or refine the job posting text.</p>`;
    return;
  }
```
with:
```js
  resultEl.innerHTML = `
    <details class="card" open>
      <summary><h2 style="display:inline;">Match analysis</h2></summary>
      <div class="doc-content markdown-body">${renderMarkdown(analysisText)}</div>
    </details>
    <div class="compare-grid">
      <div>
        <h3 class="muted" style="margin-bottom:8px;">Current</h3>
        <div id="originalCvMount"></div>
      </div>
      <div>
        <h3 class="muted" style="margin-bottom:8px;">Tailored</h3>
        <div id="tailoredCvMount"></div>
      </div>
    </div>
  `;

  if (!data.tailoredText) {
    document.getElementById("tailoredCvMount").innerHTML =
      `<p class="muted">No structured tailored CV was returned — try again, or refine the job posting text.</p>`;
    return;
  }

  api(`/cvs/${data.baseCvId}`)
    .then((baseCv) => {
      mountCvDocument(document.getElementById("originalCvMount"), {
        content: baseCv.content,
        editable: false,
      });
    })
    .catch(() => {
      document.getElementById("originalCvMount").innerHTML = `<p class="muted">Couldn't load the original CV for comparison.</p>`;
    });
```

- [ ] **Step 3: Style the collapsed JD pane and the comparison grid**

Append to `public/css/styles.css`:
```css
#studioSplit.jd-collapsed { grid-template-columns: 320px 1fr; }
#studioSplit.jd-collapsed #jdPane:not([open]) textarea,
#studioSplit.jd-collapsed #jdPane:not([open]) .row,
#studioSplit.jd-collapsed #jdPane:not([open]) label,
#studioSplit.jd-collapsed #jdPane:not([open]) select { display: none; }
#studioSplit.jd-collapsed #jdPane:not([open]) .outreach-callout { margin-top: 10px; }

.compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
@media (max-width: 1100px) { .compare-grid { grid-template-columns: 1fr; } }
```

Note: `#jdPane:not([open]) label/select/textarea/.row` hides the form controls when collapsed, leaving just the `<summary>` (JD title, clickable to re-expand) and the Outreach callout visible in the narrow 320px column — the user can still click the summary to re-expand and edit the job posting/CV selection without losing anything (the `<details>` element preserves its children's state/values across open/close, since they're never removed from the DOM, only visually hidden via CSS).

- [ ] **Step 4: Verify**

Run: `npm run lint`. Run: `npm run dev`, run a tailoring analysis. Expected: immediately after the result renders, the Target Job Description pane collapses to a narrow column showing just its title (re-expandable by clicking); the result area shows two CV columns side by side, "Current" (read-only, unhighlighted, the original base CV) on the left and "Tailored" (editable, keyword-highlighted, as before) on the right. Confirm re-expanding the JD pane (clicking its summary) still shows the previously-entered job posting text and CV selection intact, and that running a second analysis re-collapses it again.

- [ ] **Step 5: Commit**

```bash
git add public/tailor.html public/js/tailor.js public/css/styles.css
git commit -m "feat: collapsible Target Job Description pane, side-by-side CV comparison"
```
