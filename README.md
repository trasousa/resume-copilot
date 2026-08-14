# Resume Copilot

A small full-stack app that ties Claude + a set of resume/career skills together into one workflow: paste a job post and get a tailored CV, optimize your CV interactively with no job post, search the live web for high-income roles that fit you, and track every application through its stages -- generating cover letters, cold emails, interview prep, and salary negotiation briefs along the way.

This was scaffolded end-to-end (backend, frontend, skill routing) in a Cowork session and is meant to be run locally or handed to Claude Code to keep extending and deploy properly.

## What's here

- **Backend**: Node.js + Express, calling the Claude API (`@anthropic-ai/sdk`) with the relevant skill's `SKILL.md` instructions injected as the system prompt for each task. Storage is a single JSON file (via `lowdb`) -- fine for one person running this locally; swap for a real database (Postgres, SQLite via a proper driver, etc.) before putting this in front of more than one user.
- **Frontend**: plain HTML/CSS/JS (no build step) -- four pages: the application **Tracker** (kanban by stage), the **CV Store** (upload/paste CVs, mark a master, improve one interactively via chat), **Tailor** (quick one-off job-post-vs-CV check), and **Job Search** (live web search for roles matching your CV + location, ranked by fit and estimated pay).
- **Skills**: `skills/` contains all 22 skills from [Paramchoudhary/ResumeSkills](https://github.com/Paramchoudhary/ResumeSkills), plus two new ones drafted for this app that didn't exist in that collection:
  - `job-search-matcher` -- turns a resume + location into a live, ranked job search (used by the Job Search page)
  - `application-tracker` -- the stage model and behavior the Tracker page is built around
  `server/lib/skills.js` has the routing table (`SKILL_ROUTES`) mapping each task in the app to the skill(s) that apply -- that's the one place to look if you want to see or change which skill fires for what.

## Setup

```bash
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY (get one at https://console.anthropic.com/)
npm install
npm start
```

Then open `http://localhost:4173`.

Your CV is already seeded in `data/db.json` as the master CV, pulled from the Resume project. Upload additional CVs (`.docx`, `.txt`, `.md`) from the CV Store page any time -- each upload/edit is kept as its own version, nothing is overwritten.

## How the pieces fit together

1. **CV Store** -- your CV library. Upload or paste CVs, mark one as master (used as the default everywhere else), and improve any of them through an interactive chat that asks clarifying questions before proposing a full rewrite (`resume-formatter`, `resume-bullet-writer`, `resume-quantifier`, `resume-section-builder`, `resume-ats-optimizer`).
2. **Tailor** -- paste a job posting, pick a base CV (and optionally a role "flavor" like tech/executive/academic/creative/career-change), and get a match analysis plus a tailored CV (`job-description-analyzer`, `resume-tailor`, `resume-ats-optimizer`, `resume-bullet-writer`, + the flavor skill). This is a quick check -- it doesn't require a tracked application.
3. **Job Search** -- trigger a live web search for openings matching your CV and a location (or "remote"), ranked by fit and estimated compensation (`job-search-matcher`). Every result is backed by a real search hit; sources are shown so you can double-check. Save any result straight into the Tracker.
4. **Tracker** -- every application, grouped by stage (Saved -> Applied -> Screening -> Interview -> Offer, plus Rejected/Withdrawn), with stalled ones flagged automatically (`application-tracker`). Click into one to:
   - tailor a CV specifically to that posting
   - generate a cover letter, cold email, interview prep pack, salary negotiation brief, application-form answers, or a reference list -- each using its matching skill
   - keep notes and move it through stages as things progress

## Notes on what's intentionally simple (MVP scope)

- **PDF CV upload isn't supported** -- only `.docx`, `.txt`, `.md`. Convert a PDF first (e.g. with Claude's `pdf` skill) if that's your only copy.
- **CV -> .docx export** uses a lightweight markdown-ish renderer (`server/lib/docxOut.js`), not a full template engine. For polished, styled output, route the final CV text through Claude's `docx` skill instead.
- **Storage is a single JSON file**, not a real database. It's fine for one person on one machine; it is not safe for concurrent writers or multiple users.
- **No auth** -- this assumes it's just for you, running locally.
- **Job search results depend on live web search** and can occasionally come up thin for a niche role/location combo -- the skill is instructed to say so rather than pad the list with weak matches.

## Natural next steps (good candidates for a Claude Code session)

- Swap `lowdb` for Postgres/SQLite if you want this running somewhere persistent/shared
- Deploy it (Render, Fly.io, Railway, etc.) so it's reachable outside localhost
- Route final CV exports through the real `docx` skill for better formatting
- Add PDF CV intake
- Add auth if more than one person will use it
