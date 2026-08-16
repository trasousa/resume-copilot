# Job Search Sourcing — Brainstorm Notes

**Status:** Open question, not decided. No implementation has started on this. Written up so the research already spent (four separate investigations) isn't lost, and so a future session can pick this up without re-deriving it.

**Trigger:** While the Advocate redesign plan was executing, the user asked whether resume-copilot's Job Search page (currently a single LLM-driven web search via `src/routes/jobsearch.js`) could pull structured results from multiple job boards directly — specifically referencing [JobSpy](https://github.com/speedyapply/JobSpy), and later a related MCP wrapper and Apify's hosted actors — and whether that in turn should prompt a bigger architectural question: does this app need a general-purpose backend (beyond its current single Cloudflare Worker), and if so, would anything else (e.g. the existing `ResumeAgent`) benefit from moving there too?

## The constraint that shapes everything

resume-copilot is a single Cloudflare Worker: Hono for routing, D1 for data, R2 for original file storage, one deploy target, no CORS because frontend and API share an origin (this is called out explicitly in `src/index.js`'s own comments as a deliberate choice, not an oversight). Workers have no Python runtime and no general Node runtime — no `child_process`, no arbitrary TCP sockets (`net`/`tls`), which rules out anything relying on those, including most scraping libraries' HTTP client stacks.

`ResumeAgent` (in `src/agents/resume-agent.js`) already runs server-side via the Cloudflare Agents SDK on Durable Objects — worth being precise about this: it's not client-side logic that needs "migrating to a backend," it already is backend, just Workers-native rather than a traditional always-on server process. If "migrate agents to the backend" meant something more specific than this, that's still an open question to clarify with the user.

## Options investigated

### 1. JobSpy (Python), self-hosted
- Actively maintained (353 commits at time of research), MIT licensed, no API keys — pure scraping of LinkedIn/Indeed/Glassdoor/ZipRecruiter/Google Jobs/Bayt/Naukri.
- The project's own README warns bluntly that all these sites are "aggressive with blocking," and that proxies are "basically a must" for LinkedIn specifically (rate-limits around page 10 on a single IP without one).
- Would need a separate hosted Python service (e.g. FastAPI wrapper on Fly.io/Render) called from `src/routes/jobsearch.js` via `fetch()`. Free hosting tier is plausible for the compute itself; a working proxy pool for LinkedIn/Glassdoor realistically costs something (~$10-50+/mo) on top.
- LinkedIn/Indeed/Glassdoor/ZipRecruiter's own ToS prohibit automated scraping. JobSpy's README carries no legal disclaimer about this at all — real, if soft, legal exposure, more so for anything beyond a private personal tool.

### 2. ts-jobspy (JS/TS port), self-hosted
- A different author's TypeScript rewrite (MIT). Uses `axios`+`cheerio`, no headless browser — but `axios` and its proxy-agent dependencies need real Node `net`/`tls` sockets, so this still can't run *inside* a Cloudflare Worker; it needs a small Node process somewhere, same shape of hosting problem as JobSpy, just a different language.
- Meaningfully behind JobSpy on capability right now: only LinkedIn and Indeed actually work; Glassdoor/ZipRecruiter/Google/Bayt/Naukri are listed as "under maintenance" (non-functional). Much smaller project (16 commits, one maintainer) than upstream JobSpy.
- Same LinkedIn rate-limiting/proxy requirement, by the nature of the target site, not the library's language.
- **Verdict:** strictly worse trade than plain JobSpy today — same hosting problem, less coverage, less maturity. Only argument for it is "same language as the rest of the app," which is a real but soft factor.

### 3. jobspy-mcp-server
- A Node.js MCP server that itself shells out to the same Python JobSpy (subprocess or Docker container bundling both runtimes) — confirmed from the repo's own README ("Node.js 16+" *and* "Python 3.6+" *and* "The JobSpy tool installed" are all listed prerequisites). Does not eliminate the Python/hosting requirement; adds a layer on top of it.
- It does expose a plain HTTP/SSE `/search` endpoint underneath the MCP framing, which a backend *could* call directly, bypassing MCP's tool-invocation semantics — but at that point it's just a less-convenient way to reach the same self-hosted JobSpy.
- Worth flagging on principle: MCP is designed for an LLM agent to decide when to invoke a tool, not for one backend service to fetch structured data from another over a stable contract. It's the wrong protocol shape for `src/routes/jobsearch.js` to depend on even where it's technically reachable.
- **Verdict:** no benefit over hosting plain JobSpy directly; one extra layer, one extra runtime bundled into the deploy image, nothing gained.

### 4. Apify (hosted actors)
- Genuinely solves the *hosting* problem — plain async REST API (`POST` to run an actor, poll or fetch a dataset), callable directly from a Worker's `fetch()`, zero infrastructure on our side.
- Several job-board actors exist in the Apify Store, but quality is uneven. The specific unified "LinkedIn+Indeed+Glassdoor in one call" actor checked during research had only 207 total users, 2 monthly active users, and a 1.0-star rating — not something to build on without a better alternative vetted.
- Pricing: free tier is $5/month platform credits; that low-rated actor bills pay-per-result at $20/1,000 listings, which a realistic personal-use search pattern (dozens of searches/month × 20-50 results) would likely exceed, landing around $20-50/month.
- Two other actors ("All Jobs Scraper" — 39 platforms, "Multi-Jobboard Scraper") looked more promising on a first pass but were **not fully vetted** (ratings/pricing not confirmed) — this is the most likely next step if Apify is the direction chosen.
- **Verdict:** best-shaped option (no hosting, real REST contract) but not yet a confirmed winner — needs one more focused research pass on the two unvetted actors before it's a real recommendation, not just a plausible one.

### 5. Adzuna / JSearch (structured paid APIs)
- No hosting, no scraping/ToS risk, normalized structured data. Adzuna's free tier is roughly 1,000 calls/month; JSearch (RapidAPI, wraps Indeed/ZipRecruiter/Glassdoor/LinkedIn via Google-for-Jobs) has a small free tier then paid tiers (~$10-200/mo depending on volume), but neither covers ATS-native boards (Greenhouse/Lever/Workday) or ANY of the scraping breadth.
- Neither is open source — a real objection the user raised, and a fair one if "free and open" is a hard requirement rather than a preference.
- **Verdict:** the lowest-effort, lowest-risk option, but it's the one that costs the "open source" property the user explicitly cares about.

## Consolidated comparison

| Option | New hosting needed | Board coverage | Cost | Open source | Risk |
|---|---|---|---|---|---|
| JobSpy (Python) | Yes | Best (5+ boards) | Free + proxy $ | Yes | Scraping/ToS, proxy reliability |
| ts-jobspy (JS) | Yes | Worse (2 boards work) | Free + proxy $ | Yes | Same as above, less mature |
| jobspy-mcp-server | Yes (same as JobSpy + extra layer) | Same as JobSpy | Free + proxy $ | Yes | Same as JobSpy, no upside |
| Apify (best actor so far) | No | Unconfirmed (best candidate actor is low-quality) | ~$20-50+/mo likely | No | Third-party dependency, unvetted actor quality |
| Adzuna / JSearch | No | Good, normalized, no ATS boards | $0-200/mo | No | None beyond API cost/limits |

There is no option in this set that is simultaneously: zero new hosting, free, open source, and broad board coverage. Every path trades away at least one of those.

## The bigger architecture question — should this app take on a general backend?

Not resolved, and shouldn't be resolved as a side effect of the job-search sourcing decision. Framing for whenever this gets picked up properly:

- **The cost of a second backend is real and ongoing**, not a one-time setup tax: two deploy targets, two sets of secrets, cross-origin auth to reason about (the app currently has none of this — Cloudflare Access covers the whole single-origin surface), and a second thing that can go down independently of the Worker.
- **It's only worth paying if the payoff can't be had more cheaply.** That's exactly why Apify (or a well-vetted third-party API) matters as a comparison point: if it works, the entire "do we need a backend" question is moot for this specific feature, because the Worker just makes an outbound `fetch()` like it already does for every LLM provider.
- **If a backend does end up justified** (say, Apify's actors all turn out to be low-quality and JobSpy's coverage is judged worth the tradeoff), the right move is almost certainly *not* to also migrate `ResumeAgent` there reflexively — Durable Objects give it things (per-user isolated state, co-location with D1/R2, no separate auth surface) that a generic backend wouldn't hand back for free. Any "move X to the new backend too" question should be asked per-component, on its own merits, not as a blanket consequence of adding infrastructure for job search specifically.

## Recommended next step

Two honest options, not a decision:

1. **Spend one more focused research pass** vetting Apify's "All Jobs Scraper" and "Multi-Jobboard Scraper" actors (ratings, actual per-search cost at realistic volume, board coverage) — if either turns out solid, that's very likely the answer: real multi-board coverage, zero new hosting, bounded monthly cost, no architecture change needed at all.
2. **If Apify doesn't pan out**, this becomes a real "do we add a backend" conversation, and deserves its own planning session (brainstorming → spec → plan) rather than being bolted onto whatever else is in flight at the time — it's a genuine architectural pivot, not a feature addition.

Either way: **don't decide this mid-way through an unrelated body of work.** That's exactly why this is a notes doc and not a plan.
