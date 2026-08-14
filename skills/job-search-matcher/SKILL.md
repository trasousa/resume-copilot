---
name: job-search-matcher
description: Search the live web for open job postings that match a candidate's resume and target location, then rank them by estimated compensation and fit. Use this whenever the user wants to find jobs, discover high-paying openings, or asks "what roles should I apply to" based on their resume and where they want to work.
---

# Job Search Matcher

## When to Use This Skill

Use this skill when the user wants to:
- Find open job postings that fit their resume
- Discover high-income / high-paying roles matching their background
- Search a specific location (city, country, or "remote") for openings
- Get a ranked shortlist of jobs worth applying to

This skill assumes a `web_search` tool is available. If it isn't, say so explicitly rather than inventing postings — never fabricate a job listing, company name, salary figure, or URL.

## Inputs

- The candidate's resume (master CV or a specific tailored version)
- Target location(s): a city/region, a country, "remote", or a combination
- Optional: minimum compensation target, seniority level, industry preference, or roles to exclude

## Process

1. **Extract a search profile from the resume**: current/target job titles, core technical or domain skills, years of experience, seniority level, and industries worked in. Don't just search the exact current title — also search adjacent titles the candidate is qualified for (e.g. a "Data Engineer" with ML experience is also a fit for "Machine Learning Engineer" or "MLOps Engineer" roles).

2. **Run multiple targeted searches**, varying title + location + "remote" combinations, and where useful add "salary" or a compensation range to surface roles that disclose pay. Prefer sources likely to have current, real postings: company career pages, LinkedIn Jobs, Levels.fyi, Otta, Wellfound, and general search.

3. **Filter for genuinely open, current postings.** Discard anything that looks stale, a listicle, a scraped aggregator with no live link, or a posting your search didn't actually confirm exists. Every job in the output must have a real URL from the search results — do not construct or guess a URL.

4. **Estimate compensation** where the posting doesn't state it, using comparable roles/level/location found in the same search pass; always label an estimate as an estimate and say what it's based on. Never present an estimate as a confirmed number.

5. **Score fit** for each posting against the resume: what matches directly, what's a stretch, and what's missing. Be honest about stretch roles rather than only returning safe matches.

6. **Rank the shortlist** by a blend of estimated compensation and fit (don't rank purely on salary — a poor-fit high-salary role is not a good recommendation), and present the top 8-15 results.

## Output Format

For each job, report:
- Title, company, location (or "Remote")
- Link (must come directly from search results)
- Estimated or stated compensation range, with a note on which it is
- 1-2 sentence fit rationale (what makes this a match)
- Any notable gap the candidate should be ready to address

Group results loosely by strongest-fit-first, and call out if the search came up thin (fewer than ~5 solid matches) rather than padding the list with weak fits.

## After the Search

Offer to hand any selected posting to `resume-tailor` and `job-description-analyzer` to prepare a tailored application, and to `application-tracker` to log it as a new application.
