# Resume Copilot

A small full-stack app that ties Claude + a set of resume/career skills together into one workflow: paste a job post and get a tailored CV, optimize your CV interactively, search the live web for roles that fit you, and track every application through its stages -- generating cover letters, cold emails, interview prep, and salary negotiation briefs along the way.

Runs on **Cloudflare Workers**: one Worker serves the static frontend and the API, with **D1** for structured data, **R2** for original CV files, and **Google sign-in** gating the whole thing.

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

# 3. Google OAuth client -- see "Sign-in" below for the Console steps
# 4. Local secrets
cat > .dev.vars <<'EOF'
ANTHROPIC_API_KEY="sk-ant-..."
GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="..."
ALLOWED_EMAILS="you@gmail.com"
SESSION_SECRET="any-long-random-string"
EOF

npm run dev          # http://localhost:8787
```

`npm run build:skills` runs automatically before `dev` and `deploy`.

## What's here

- **Worker** (`src/`): [Hono](https://hono.dev) routes calling the Claude API with the relevant skill's `SKILL.md` injected as the system prompt. `src/lib/anthropic.js` is the only file that imports the SDK.
- **Frontend** (`public/`): plain HTML/CSS/JS, no build step. Four pages -- **Tracker** (kanban by stage), **CV Store** (upload/paste CVs, mark a master, improve one via streaming chat), **Tailor** (quick job-post-vs-CV check), and **Job Search** (live web search ranked by fit and pay).
- **Skills** (`skills/`): all 22 skills from [Paramchoudhary/ResumeSkills](https://github.com/Paramchoudhary/ResumeSkills), plus two written for this app -- `job-search-matcher` and `application-tracker`. `src/lib/skills.js` holds the routing table (`SKILL_ROUTES`) mapping each task to the skills that apply.
- **Database** (`schema.sql`): D1. Four tables -- `cvs`, `applications`, `documents`, `chat_messages`.
- **Original files** (`src/lib/r2.js`): R2. As-uploaded CV bytes, keyed by CV id.

Because Workers have no filesystem, `scripts/build-skills.mjs` inlines the skills into `src/skills.generated.js` at build time (gitignored -- regenerate with `npm run build:skills`).

## How the pieces fit together

1. **CV Store** -- your CV library. Upload or paste CVs, mark one as master, and improve any of them through a streaming chat that asks clarifying questions before proposing a full rewrite.
2. **Tailor** -- paste a job posting, pick a base CV and optionally a role "flavor" (tech/executive/academic/creative/career-change), and get a match analysis plus a tailored CV.
3. **Job Search** -- live web search for openings matching your CV and a location, ranked by fit and estimated compensation. Every result is backed by a real search hit; sources are shown so you can check.
4. **Tracker** -- applications grouped by stage (Saved → Applied → Screening → Interview → Offer, plus Rejected/Withdrawn), with stalled ones flagged. Click into one to tailor a CV to that posting, or generate a cover letter, cold email, interview prep pack, negotiation brief, application-form answers, reference list, offer comparison, LinkedIn tune-up, or portfolio case study.

## Sign-in

Google OAuth, gated to an allow-list -- not a full accounts system. Anyone can start the sign-in flow, but a session is only issued if the verified email is in `ALLOWED_EMAILS`. There's no per-user data: everyone on the allow-list shares one CV store, tracker, and everything else. If you want separate data per person, that's a bigger change than this app makes -- ask if you want it built.

**Set up the OAuth client** (one-time, in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)):

1. Create a project if you don't have one already.
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Under **Authorized redirect URIs**, add one entry per host you'll actually use it from:
   - `https://resume-copilot.<your-subdomain>.workers.dev/api/auth/google/callback` (always works, no domain needed)
   - `https://resume.yourdomain.com/api/auth/google/callback` (once you've set up the custom domain below)
   - `http://localhost:8787/api/auth/google/callback` (for `wrangler dev`)
5. Save. You'll get a **Client ID** and **Client secret**.
6. If prompted to configure the OAuth consent screen, "External" + "Testing" mode is enough for personal use -- add your own email under **Test users**.

**Set the secrets:**

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ALLOWED_EMAILS      # comma-separated, e.g. "you@gmail.com"
npx wrangler secret put SESSION_SECRET      # openssl rand -base64 32
npx wrangler secret put ANTHROPIC_API_KEY
```

If you'd rather not manage OAuth at all, put **Cloudflare Access** in front of the Worker instead and set `SKIP_AUTH=1` -- Access then handles identity at the edge and this app trusts it completely.

**Do not deploy without one of the two.** There's no other protection: an unprotected deployment exposes your CV store and your Anthropic API key to anyone who finds the URL.

## Original files

Uploaded `.docx`/`.txt`/`.md` files are text-extracted for the CV store, and that extraction is lossy -- layout, tables, and fonts the parser doesn't model are gone the moment the upload completes. If an R2 bucket is bound (`ORIGINALS`), the as-uploaded bytes are kept alongside the extracted text, so you can pull the original back via the "Download original" link in CV Store.

This is optional -- routes check for the binding and just skip storing/serving originals if it's absent, so the app works without it. To enable:

```bash
npm run r2:create
```

The bucket name (`resume-copilot-originals`) and binding (`ORIGINALS`) are already wired up in `wrangler.jsonc`; `r2:create` just has to run once before you deploy (or `wrangler dev` locally, where Miniflare emulates R2 automatically).

## Deploy

```bash
npm run deploy
```

That's the whole deploy -- one Worker, static assets and API together, no separate Pages project. Prints a `*.workers.dev` URL you can use immediately.

## Custom domain

Cloudflare Workers custom domains require the domain's DNS to be on Cloudflare -- a Worker executes at Cloudflare's edge, so traffic for the hostname has to be routed through Cloudflare to reach it. There's no way to point a plain CNAME at a `*.workers.dev` URL from a domain hosted elsewhere and have it work.

**If your domain is already on Cloudflare** (you manage its DNS in the Cloudflare dashboard): skip to step 2.

**If it isn't:**

1. **Add the site to Cloudflare** -- dashboard → **Add a site** → enter your domain → pick the Free plan (this app doesn't need anything paid). Cloudflare scans your existing DNS records and shows you two nameservers. Update your domain's nameservers to those two at your registrar (wherever you bought the domain). This can take anywhere from a few minutes to 24 hours to propagate; Cloudflare emails you once it's active.

   This moves DNS for the **whole domain**, not just a subdomain -- if you have email or other services on it, make sure their DNS records got imported correctly before switching nameservers (Cloudflare shows you the imported records during setup; check them).

2. **Deploy the Worker** (`npm run deploy`) if you haven't already.

3. **Attach the domain** -- dashboard → **Workers & Pages** → `resume-copilot` → **Settings** → **Domains & Routes** → **Add** → enter e.g. `resume.yourdomain.com`. Cloudflare provisions the SSL certificate automatically; this usually takes under a minute.

   A subdomain (`resume.yourdomain.com`) is the easy path and won't conflict with anything else on the apex domain. Using the bare apex (`yourdomain.com`) works too if that's what you want.

4. **Make it reproducible** -- once you know the hostname, add it to `wrangler.jsonc` so it's re-applied on every future deploy instead of being a manual dashboard step:

   ```jsonc
   "routes": [
     { "pattern": "resume.yourdomain.com", "custom_domain": true }
   ]
   ```

5. **Add the new callback URL to the Google OAuth client** -- back in Google Cloud Console, add `https://resume.yourdomain.com/api/auth/google/callback` to Authorized redirect URIs (see "Sign-in" above). Sign-in will fail with "redirect_uri_mismatch" until you do this -- Google checks it exactly.

The `*.workers.dev` URL keeps working alongside the custom domain; there's no need to remove it.

## Notes on what's intentionally simple

- **PDF upload isn't supported** -- only `.docx`, `.txt`, `.md` (10 MB cap). Convert PDFs first.
- **CV → .docx export** uses a lightweight markdown-ish renderer (`src/lib/docxOut.js`), not a template engine.
- **Single-tenant.** One allow-list, one shared dataset, no per-user accounts.
- **Job search depends on live web search** and can come up thin for a niche role/location combo -- the skill is instructed to say so rather than pad the list.

## Next steps

- Turn the five one-shot routes into a single tool-using agent (tools over the CV store and tracker, skills loaded on demand rather than pasted into every prompt).
- Tests around the fence parsers (` ```CV `, ` ```JOBS `) and the stage machine.
- Real multi-user accounts with per-user data, if this ever needs to serve more than one person's CVs.
