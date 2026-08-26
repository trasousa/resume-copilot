# Resume Copilot

A small full-stack app that ties Cloudflare Workers AI + a set of resume/career skills together into one workflow: paste a job post and get a tailored CV, optimize your CV interactively, search real job postings ranked by fit, and track every application through its stages -- generating cover letters, cold emails, interview prep, and salary negotiation briefs along the way.

Runs on **Cloudflare Workers**: one Worker serves the static frontend and the API, with **D1** for structured data, **R2** for original CV files, and **Cloudflare Access (Zero Trust)** gating the whole thing at the edge.

## Quick start

```bash
npm install

# 1. Create the database, then paste the printed id into wrangler.jsonc
npm run db:create
npm run db:init:local
npm run db:init

# 2. Create the R2 bucket (optional -- keeps your original uploaded files;
#    see "Original files" below)
npm run r2:create

# 3. Local secrets. No LLM key needed -- Workers AI authenticates via the
#    "ai" binding alone. SKIP_AUTH is for `wrangler dev` only -- Access
#    doesn't run in front of localhost, so there's nothing else that could
#    gate local requests. See "Sign-in" below for the real deployment.
cat > .dev.vars <<'EOF'
SKIP_AUTH="1"
EOF

npm run dev          # http://localhost:8787
```

`npm run build:skills` runs automatically before `dev` and `deploy`.

## Development workflow

`main` is production and protected -- no direct pushes, PRs only, CI must pass. `dev` is the working branch; cut `feature/*` branches off it for anything nontrivial and PR back into `dev`. Periodically PR `dev` → `main` to release.

CI (`.github/workflows/ci.yml`) runs on every PR and push to `dev`/`main`:
- **Secret scan** -- `gitleaks detect` over the full repo history. A value that's flagged but isn't actually a secret (like the Access AUD tag above, which is an identifier, not a credential) gets a `// gitleaks:allow` comment on that line rather than a broad exemption.
- **Lint** -- `npm run lint` (`eslint.config.js`), correctness rules only (unused vars, undefined refs), not a style enforcer.
- **Build** -- `npm run build:skills` + `npm run build` (`wrangler deploy --dry-run`). No `CLOUDFLARE_API_TOKEN` needed; dry-run bundles and validates config without calling the Cloudflare API.

## What's here

- **Worker** (`src/`): [Hono](https://hono.dev) routes calling Cloudflare Workers AI with the relevant skill's `SKILL.md` injected as the system prompt. Routes import from `src/lib/llm.js`, which calls `src/lib/workersai.js` -- see "LLM provider" below.
- **Frontend** (`public/`): plain HTML/CSS/JS, no build step. Four pages -- **Tracker** (kanban by stage), **CV Store** (upload/paste CVs, mark a master, improve one via streaming chat), **Tailor** (quick job-post-vs-CV check), and **Job Search** (real postings from Arbeitnow's job board, ranked by fit and pay).
- **Skills** (`skills/`): all 22 skills from [Paramchoudhary/ResumeSkills](https://github.com/Paramchoudhary/ResumeSkills), plus two written for this app -- `job-search-matcher` and `application-tracker`. `src/lib/skills.js` holds the routing table (`SKILL_ROUTES`) mapping each task to the skills that apply.
- **Database** (`schema.sql`): D1. Eight tables -- `cvs`, `applications`, `documents`, `activity_events`, `templates`, `chat_messages`, `profile`, `token_usage`.
- **Original files** (`src/lib/r2.js`): R2. As-uploaded CV bytes, keyed by CV id.

Because Workers have no filesystem, `scripts/build-skills.mjs` inlines the skills into `src/skills.generated.js` at build time (gitignored -- regenerate with `npm run build:skills`).

## How the pieces fit together

1. **CV Store** -- your CV library. Upload or paste CVs, mark one as master, and improve any of them through a streaming chat that asks clarifying questions before proposing a full rewrite.
2. **Tailor** -- paste a job posting, pick a base CV and optionally a role "flavor" (tech/executive/academic/creative/career-change), and get a match analysis plus a tailored CV.
3. **Job Search** -- searches real, live postings from [Arbeitnow](https://www.arbeitnow.com)'s free job board API (see "Job search" below), filtered by your city/remote preference and ranked by fit and estimated compensation.
4. **Tracker** -- applications grouped by stage (Saved → Applied → Screening → Interview → Offer, plus Rejected/Withdrawn), with stalled ones flagged. Click into one to tailor a CV to that posting, or generate a cover letter, cold email, interview prep pack, negotiation brief, application-form answers, reference list, offer comparison, LinkedIn tune-up, or portfolio case study.

## Original files

Uploaded `.docx`/`.txt`/`.md` files are text-extracted for the CV store, and that extraction is lossy -- layout, tables, and fonts the parser doesn't model are gone the moment the upload completes. If an R2 bucket is bound (`ORIGINALS`), the as-uploaded bytes are kept alongside the extracted text, so you can pull the original back via the "Download original" link in CV Store.

This is optional -- routes check for the binding and just skip storing/serving originals if it's absent, so the app works without it. To enable:

```bash
npm run r2:create
```

The bucket name (`resume-copilot-originals`) and binding (`ORIGINALS`) are already wired up in `wrangler.jsonc`; `r2:create` just has to run once before you deploy (or `wrangler dev` locally, where Miniflare emulates R2 automatically).

## LLM provider

This app uses [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) exclusively -- no API key needed, since it authenticates via the `ai` binding in `wrangler.jsonc` alone. `WORKERS_AI_MODEL`/`WORKERS_AI_CHAT_MODEL` in `wrangler.jsonc`'s `vars` block select which `@cf/...` model each flow uses: `WORKERS_AI_MODEL` for one-shot tasks (tailoring, document generation), `WORKERS_AI_CHAT_MODEL` for the interactive CV-improve chat.

## Job search

Job Search combines up to six free sources, run concurrently:

- **[Arbeitnow](https://www.arbeitnow.com)** (`src/lib/arbeitnow.js`) -- free, no key. Germany/UK-heavy on-site + some remote postings, aggregated from Greenhouse/SmartRecruiters/etc, updated hourly. No server-side search, so city/region/country/remote filtering happens in-app after fetching.
- **[Himalayas](https://himalayas.app)** (`src/lib/himalayas.js`) -- free, no key. Global remote-only postings with real keyword+country search and salary data when disclosed.
- **[OpenWebNinja JSearch](https://www.openwebninja.com)** (`src/lib/jsearch.js`) -- optional, needs `OPENWEBNINJA_API_KEY` (`npx wrangler secret put OPENWEBNINJA_API_KEY`). Aggregates LinkedIn, Indeed, Glassdoor, ZipRecruiter, and other public boards via Google for Jobs. **Free tier is 200 requests/month** -- each user-initiated search costs exactly one JSearch request, so budget accordingly. Job Search works fine without this key set; you just lose that source's results.
- **[Tavily](https://tavily.com)** (`src/lib/tavily.js`) -- optional, needs `TAVILY_API_KEY` (`npx wrangler secret put TAVILY_API_KEY`). General web search scoped to LinkedIn/Indeed/Glassdoor/Lever/Greenhouse/Workable via `include_domains`, parsed best-effort since Tavily returns generic web results rather than structured postings. Also optional -- Job Search works fine without this key set.

- **[freehire](https://freehire.me)** (`src/lib/freehire.js`) -- free, no key, on by default. An open-source aggregator that normalizes postings from ~50 ATS platforms into one schema. It is the only source that returns the posting's own body text at search time, which is what lets ranking judge fit from the actual job rather than from a title; its corpus is tech-heavy. The backend is MIT-licensed and self-hostable (`strelov1/freehire`) -- set `FREEHIRE_API_URL` to point at your own instance. Note its `countries` facet wants ISO-2 codes, which `freehire.js` maps for you.
- **[LinkedIn](https://www.linkedin.com/jobs/)** (`src/lib/linkedin.js`) -- free, no key, **off unless you set `LINKEDIN_SEARCH="1"`**. Uses LinkedIn's public `jobs-guest` endpoints, the same ones a logged-out visitor sees, and returns real individual postings with company and city. **Automated access is against LinkedIn's Terms of Service**, so this is off by default and intended only for personal, low-volume use: one request per search you run yourself, no crawling, no bulk collection, no commercial use. Enabling it is your decision, which is why it takes a deliberate flag.

Results are deduplicated (`src/lib/jobdedup.js`, matched by normalized company + title + location/remote), interleaved so no single source can crowd the others out of the shortlist, and filtered against your Pipeline so roles you already saved stop reappearing. Workers AI then ranks what is left against your CV, scoring skills, experience and career fit separately and applying your language and deal-breaker gates. Search progress streams to the page as each source resolves, and results render before ranking finishes rather than waiting for it.

### Ranking gates

Two fields on the Search page shape what you are shown, both free text read by the model rather than a fixed vocabulary:

- **Languages you work in** (e.g. `English (native), Portuguese (B2)`). A posting demanding a language you have not listed at all is dropped. One demanding a higher level than you claim in a language you do list is flagged rather than hidden -- whether your B2 clears their "fluent" bar is your call, not the model's.
- **Deal-breakers** (e.g. `no relocation, no on-call`). A posting that plainly contradicts one is dropped.

Anything dropped is reported above the results with the reason, and can be expanded -- a gate the model got wrong is only fixable if you can see that it fired.

### Fetching a job posting behind a bot filter

`POST /api/jobpost/fetch` (the "Fetch" button next to a job link) pulls a posting's text so tailoring has something real to work from. Many corporate, bank and recruiter sites answer `403` to any client that doesn't look like a browser while serving the same page fine to one -- so a 403 there means the page refused the *client*, not that it's missing.

On a 403 the fetcher reads the origin's `robots.txt` first:

- **Policy allows the path** -- retry once with browser headers. That overrides a firewall default, not an expressed preference.
- **Policy disallows it** -- stop. `robots.txt` is the exact mechanism a site is told it can rely on, so retrying past it would circumvent the site's own opt-out.
- **Policy unreadable** (timeout, 5xx) -- stop. Permission you couldn't confirm isn't permission. A `404` is different: no policy published means no objection.

Everything else is unchanged: redirects are still followed by hand with the private-address guard re-run on every hop, and the content-type and size caps still apply.

## Deploy

```bash
npm run deploy
```

That's the whole deploy -- one Worker, static assets and API together, no separate Pages project. Prints a `*.workers.dev` URL you can use immediately.

### Upgrading a deployment that predates per-user data

Everything below is a one-time sequence for a deployment whose D1 database
still holds the original single-tenant rows. On a brand-new deployment,
skip it entirely: `npm run db:init` creates the shared tables, and each
user's own tables are created automatically inside their agent on first
use.

The per-user tables are no longer in `schema.sql`, so there is no
`ALTER TABLE` dance any more -- schema changes are version entries in
`src/agents/schema.js`. But the rows already sitting in D1 need adopting,
because nothing in them records who they belong to.

1. **Add the column the job-search target-role field needs**, since the
   import copies it if present:

   ```bash
   npx wrangler d1 execute resume-copilot --remote --command="ALTER TABLE profile ADD COLUMN target_role TEXT NOT NULL DEFAULT '';"
   ```

   (Older databases may likewise predate `applications.match_score` and
   `cvs.parsed_json`; add those the same way if `db:init` was never re-run
   after they were introduced. The import tolerates their absence -- it
   simply won't carry over a column that isn't there.)

2. **Apply the shared schema and deploy:**

   ```bash
   npm run db:init
   npm run deploy
   ```

3. **Find your own Access `sub`** -- sign in to the deployed app and open
   `/api/auth/me`. It returns `{ email, sub }`.

4. **Name yourself the owner** of the legacy rows: put that `sub` in
   `wrangler.jsonc`'s `LEGACY_OWNER_SUB` var and `npm run deploy` again.
   While it's empty the import route is off and answers 403 -- deliberately,
   so nobody else behind your Access policy can claim your data first.

5. **Dry-run the import, then run it**, signed in as that same account:

   ```bash
   curl -X POST https://<your-domain>/api/admin/import-legacy \
     -H 'Content-Type: application/json' -d '{"dryRun":true}'
   ```

   Check the counts, then repeat without `dryRun`. The response reports
   `imported` (rows actually written), `found` (rows read from D1),
   `dropped` (rows whose parent no longer exists) and `missing` (which
   should always be empty). Re-running is safe: it answers
   `{"skipped":"already-imported"}`.

The import never deletes anything from D1. Those tables stay as a
read-only archive; once you're confident, you can drop them by hand:

```bash
npx wrangler d1 execute resume-copilot --remote --command="DROP TABLE chat_messages; DROP TABLE documents; DROP TABLE activity_events; DROP TABLE templates; DROP TABLE applications; DROP TABLE cvs; DROP TABLE profile; DROP TABLE token_usage;"
```

## Custom domain

**Required for sign-in** -- see "Sign-in" below: Cloudflare Access can only attach to a real Cloudflare zone, never `*.workers.dev`. This app is configured to deploy to **`resume.btopencloud.com`** (`wrangler.jsonc`'s `routes` entry).

**If `btopencloud.com` is already on Cloudflare** (you manage its DNS in the Cloudflare dashboard): skip to step 2.

**If it isn't:**

1. **Add the site to Cloudflare** -- dashboard → **Add a site** → enter `btopencloud.com` → pick the Free plan (this app doesn't need anything paid). Cloudflare scans your existing DNS records and shows you two nameservers. Update the domain's nameservers to those two at your registrar (wherever you bought it). This can take anywhere from a few minutes to 24 hours to propagate; Cloudflare emails you once it's active.

   This moves DNS for the **whole domain**, not just the `resume` subdomain -- if you have email or other services on it, make sure their DNS records got imported correctly before switching nameservers (Cloudflare shows you the imported records during setup; check them).

2. **Deploy the Worker** (`npm run deploy`) -- picks up the `routes` entry already in `wrangler.jsonc` and attaches `resume.btopencloud.com` automatically, provisioning the SSL certificate too. No manual dashboard step needed once the zone is active.

The `*.workers.dev` URL keeps existing alongside the custom domain, but see "Sign-in" below -- once Access is set up, it can't protect that URL, so treat it as unusable for real traffic rather than an alternate way in.

## Sign-in

Cloudflare Access protects a hostname by intercepting traffic to it at Cloudflare's edge, before it ever reaches the Worker -- so it needs the real Cloudflare zone from "Custom domain" above to attach to. It cannot front `*.workers.dev`, which is a domain Cloudflare shares across every account, not one you control.

Everyone your Access policy lets through gets their own private workspace. Each authenticated user is routed to their own `ResumeAgent` Durable Object, keyed by the Access JWT's stable `sub` claim, and that object's SQLite holds all of their data -- so two people behind the same policy cannot see each other's CVs, applications, or chats, and deleting one account leaves the other untouched. The daily AI token budget is counted per user too.

**Set up the Access application** (one-time, in the [Zero Trust dashboard](https://one.dash.cloudflare.com/)):

1. If this is the first time you're using Zero Trust on the account, it'll prompt you to pick a team name (e.g. `yourteam`) -- that becomes `yourteam.cloudflareaccess.com`. Free for up to 50 users, which this app will never come close to.
2. **Access → Applications → Add an application → Self-hosted.**
3. **Application domain**: `resume.btopencloud.com` -- not the `*.workers.dev` URL, which Access can't protect (see above).
4. **Identity providers**: pick one under Settings → Authentication if you haven't already.
   - **Google** -- gives users a "Sign in with Google" screen; needs a Google Cloud OAuth client, but registered directly with Cloudflare -- this app has no OAuth code of its own.
   - **One-time PIN** -- Cloudflare emails a 6-digit code, no external identity provider at all. The simplest option if the goal is keeping everything inside Cloudflare.
5. **Policy**: Allow, Include → Emails → your email(s). This is the allow-list -- it's the actual authorization check: you cannot end up with a validly-signed Access JWT for this app unless this policy let you through.
6. On the application's **Overview** page, copy the **Application Audience (AUD) tag**.

**Configure the Worker** -- edit the two placeholders in `wrangler.jsonc` under `vars`:

```jsonc
"CF_ACCESS_TEAM_DOMAIN": "yourteam.cloudflareaccess.com",
"CF_ACCESS_AUD": "<the AUD tag from step 6>"
```

Neither is a secret -- they only identify which Access application's JWTs the Worker accepts, not a bearer credential, so they live in version control like the D1 database id above. Redeploy (`npm run deploy`) after editing them.

**That's the whole setup -- no `wrangler secret put` needed at all.** Visit `resume.btopencloud.com`; Access intercepts you, runs whichever identity provider you picked, and only then forwards the request to the Worker with a signed JWT proving who you are. The Worker verifies that JWT itself (`src/lib/auth.js`) rather than just trusting that traffic reaching it must be legitimate -- which is what keeps the `*.workers.dev` URL locked out automatically: Access never fronts it, so no request there can ever carry a validly-signed JWT, and the Worker rejects everything without one.

Until both `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set to real values, every request fails closed with a 401. That's the correct default while you're mid-setup, not a bug to work around.

To sign out, the nav's **Log out** button sends the browser to `/cdn-cgi/access/logout` -- a path Access reserves on every hostname it protects and intercepts itself; this app has no session of its own to clear.

**None of this can be tested locally.** Access intercepts traffic at Cloudflare's edge network, which `wrangler dev` traffic never reaches regardless of domain setup -- `SKIP_AUTH=1` in `.dev.vars` is the only local option, and it bypasses auth entirely rather than simulating it. To actually exercise the Access flow, deploy and hit `resume.btopencloud.com`.

## Notes on what's intentionally simple

- **PDF upload isn't supported** -- only `.docx`, `.txt`, `.md` (10 MB cap). Convert PDFs first.
- **CV → .docx export** uses a lightweight markdown-ish renderer (`src/lib/docxOut.js`), not a template engine.
- **Access is the only account system.** Users exist because your Access policy admits them; there's no sign-up, profile, or role model of this app's own. Data is per-user, but administration isn't.
- **Job-search coverage varies by role and location.** Four sources run in parallel (two free, two optional keys), but a niche combination can still come up thin.

## Next steps

- Turn the five one-shot routes into a single tool-using agent (tools over the CV store and tracker, skills loaded on demand rather than pasted into every prompt).
- Tests around the fence parsers (` ```CV `, ` ```JOBS `) and the stage machine.
- Move generation into the agent as typed `@callable()` methods, and put the frontend on the Agents client SDK (sub-projects 3-6 of `docs/superpowers/specs/2026-08-16-resume-agent-core-design.md`).
- Scheduled agent tasks: fire the reminders `activity_events` already stores, and run a nightly search against the saved target role.
