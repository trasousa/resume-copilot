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

Job Search combines three free sources, run concurrently:

- **[Arbeitnow](https://www.arbeitnow.com)** (`src/lib/arbeitnow.js`) -- free, no key. Germany/UK-heavy on-site + some remote postings, aggregated from Greenhouse/SmartRecruiters/etc, updated hourly. No server-side search, so city/region/country/remote filtering happens in-app after fetching.
- **[Himalayas](https://himalayas.app)** (`src/lib/himalayas.js`) -- free, no key. Global remote-only postings with real keyword+country search and salary data when disclosed.
- **[OpenWebNinja JSearch](https://www.openwebninja.com)** (`src/lib/jsearch.js`) -- optional, needs `OPENWEBNINJA_API_KEY`. Aggregates LinkedIn, Indeed, Glassdoor, ZipRecruiter, and other public boards via Google for Jobs. **Free tier is 200 requests/month** -- each user-initiated search costs exactly one JSearch request, so budget accordingly. Job Search works fine without this key set; you just lose that source's results.

Results from all three are deduplicated (`src/lib/jobdedup.js`, matched by normalized company + title + location/remote) before Workers AI ranks the merged list against your CV. Search progress streams to the page as each source resolves, rather than waiting for all three before showing anything.

## Deploy

```bash
npm run deploy
```

That's the whole deploy -- one Worker, static assets and API together, no separate Pages project. Prints a `*.workers.dev` URL you can use immediately.

**Upgrading an existing deployment** (a remote D1 database created before the `match_score` column was added to `applications`): `npm run db:init`'s `CREATE TABLE IF NOT EXISTS` is a no-op against a table that already exists, so it won't backfill the new column on its own. Run this once against remote before `npm run db:init`:

```bash
npx wrangler d1 execute resume-copilot --remote --command="ALTER TABLE applications ADD COLUMN match_score INTEGER;"
```

Skip this on a brand-new database -- `db:init`/`db:init:local` already creates `applications` with `match_score` included.

**Upgrading an existing deployment** (a remote D1 database created before the `parsed_json` column was added to `cvs`): same story -- `CREATE TABLE IF NOT EXISTS` won't backfill the new column on a table that already exists. Run this once against remote before `npm run db:init`:

```bash
npx wrangler d1 execute resume-copilot --remote --command="ALTER TABLE cvs ADD COLUMN parsed_json TEXT;"
```

Skip this on a brand-new database -- `db:init`/`db:init:local` already creates `cvs` with `parsed_json` included.

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

Single-tenant, same as this app has been throughout: whoever your Access policy lets through shares one CV store, tracker, and everything else. There's no per-user data. If you want that, it's a bigger change than this app makes -- ask if you want it built.

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
- **Single-tenant.** One allow-list, one shared dataset, no per-user accounts.
- **Job search depends on Arbeitnow's coverage** and can come up thin for a niche role/location combo -- there's no fallback source.

## Next steps

- Turn the five one-shot routes into a single tool-using agent (tools over the CV store and tracker, skills loaded on demand rather than pasted into every prompt).
- Tests around the fence parsers (` ```CV `, ` ```JOBS `) and the stage machine.
- Real multi-user accounts with per-user data, if this ever needs to serve more than one person's CVs.
