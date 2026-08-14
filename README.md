# Resume Copilot

A small full-stack app that ties Claude + a set of resume/career skills together into one workflow: paste a job post and get a tailored CV, optimize your CV interactively, search the live web for roles that fit you, and track every application through its stages -- generating cover letters, cold emails, interview prep, and salary negotiation briefs along the way.

Runs on **Cloudflare Workers**: one Worker serves the static frontend and the API, with **D1** for storage.

## Quick start

```bash
npm install

# 1. Create the database, then paste the printed id into wrangler.jsonc
npm run db:create

# 2. Create the tables (local + remote)
npm run db:init:local
npm run db:init

# 3. Local secrets
cat > .dev.vars <<'EOF'
ANTHROPIC_API_KEY="sk-ant-..."
APP_PASSWORD="pick-something"
SESSION_SECRET="any-long-random-string"
EOF

npm run dev          # http://localhost:8787
```

To deploy:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put APP_PASSWORD
npx wrangler secret put SESSION_SECRET
npm run deploy
```

`npm run build:skills` runs automatically before `dev` and `deploy`.

## What's here

- **Worker** (`src/`): [Hono](https://hono.dev) routes calling the Claude API with the relevant skill's `SKILL.md` injected as the system prompt. `src/lib/anthropic.js` is the only file that imports the SDK.
- **Frontend** (`public/`): plain HTML/CSS/JS, no build step. Four pages -- **Tracker** (kanban by stage), **CV Store** (upload/paste CVs, mark a master, improve one via streaming chat), **Tailor** (quick job-post-vs-CV check), and **Job Search** (live web search ranked by fit and pay).
- **Skills** (`skills/`): all 22 skills from [Paramchoudhary/ResumeSkills](https://github.com/Paramchoudhary/ResumeSkills), plus two written for this app -- `job-search-matcher` and `application-tracker`. `src/lib/skills.js` holds the routing table (`SKILL_ROUTES`) mapping each task to the skills that apply.
- **Database** (`schema.sql`): D1. Four tables -- `cvs`, `applications`, `documents`, `chat_messages`.

Because Workers have no filesystem, `scripts/build-skills.mjs` inlines the skills into `src/skills.generated.js` at build time (gitignored -- regenerate with `npm run build:skills`).

## How the pieces fit together

1. **CV Store** -- your CV library. Upload or paste CVs, mark one as master, and improve any of them through a streaming chat that asks clarifying questions before proposing a full rewrite.
2. **Tailor** -- paste a job posting, pick a base CV and optionally a role "flavor" (tech/executive/academic/creative/career-change), and get a match analysis plus a tailored CV.
3. **Job Search** -- live web search for openings matching your CV and a location, ranked by fit and estimated compensation. Every result is backed by a real search hit; sources are shown so you can check.
4. **Tracker** -- applications grouped by stage (Saved → Applied → Screening → Interview → Offer, plus Rejected/Withdrawn), with stalled ones flagged. Click into one to tailor a CV to that posting, or generate a cover letter, cold email, interview prep pack, negotiation brief, application-form answers, reference list, offer comparison, LinkedIn tune-up, or portfolio case study.

## Auth

The app requires a password before anything is reachable: `POST /api/auth/login` exchanges `APP_PASSWORD` for an HMAC-signed, HttpOnly session cookie, and every `/api/*` route except `health` and `auth/*` requires it.

If you'd rather put **Cloudflare Access** in front of the Worker, set `SKIP_AUTH=1` and let Access handle identity at the edge.

Do not deploy without one or the other. There is no per-user data separation -- it's a single-user app, and an unprotected deployment exposes your CV store and your API key to anyone who finds the URL.

## Notes on what's intentionally simple

- **PDF upload isn't supported** -- only `.docx`, `.txt`, `.md` (10 MB cap). Convert PDFs first.
- **CV → .docx export** uses a lightweight markdown-ish renderer (`src/lib/docxOut.js`), not a template engine.
- **Single user.** One password, one dataset, no accounts.
- **Job search depends on live web search** and can come up thin for a niche role/location combo -- the skill is instructed to say so rather than pad the list.

## Next steps

- Turn the five one-shot routes into a single tool-using agent (tools over the CV store and tracker, skills loaded on demand rather than pasted into every prompt).
- Tests around the fence parsers (` ```CV `, ` ```JOBS `) and the stage machine.
- R2 for retaining original uploads, if you want the source files kept rather than just extracted text.
