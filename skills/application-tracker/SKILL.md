---
name: application-tracker
description: Maintain a structured record of job applications and their stage (saved, applied, screening, interview, offer, rejected, withdrawn), surface next actions, and flag stale or stalled applications. Use whenever the user logs a new application, updates a stage, asks what's outstanding, or wants a status overview of their job search.
---

# Application Tracker

## When to Use This Skill

Use this skill when the user wants to:
- Log a new job application
- Move an application to a new stage (e.g. "I got a screening call with Acme")
- Get an overview of everything in flight
- Know what needs follow-up or is going stale

## Stage Model

Use this fixed stage set so tracking stays comparable across applications:

1. **Saved** — a job was found/matched but no application sent yet
2. **Applied** — application submitted
3. **Screening** — recruiter/phone screen scheduled or completed
4. **Interview** — onsite/technical/panel interview stage
5. **Offer** — an offer has been extended
6. **Rejected** — the company passed
7. **Withdrawn** — the candidate pulled out

Don't invent additional stages; if something doesn't fit cleanly, note the nuance in the application's notes field rather than adding a new stage.

## What to Record per Application

- Company, role title, location, source (where it was found)
- Link to the original posting (if any)
- Current stage and the date it entered that stage
- Key dates: applied date, next scheduled event (interview date, deadline)
- Compensation info: posted/estimated range, and later, offer details if reached
- Documents generated for this application (tailored CV version, cover letter, cold email, etc.)
- Free-text notes: interviewer names, questions asked, impressions, follow-up commitments made

## Behaviors

- **On a new application**: confirm the stage starts at "Saved" or "Applied" depending on what the user says, and prompt for the one or two most useful missing fields (e.g. a link, or the role level) rather than demanding a fully filled form.
- **On a stage change**: update the date-entered-stage, and proactively suggest the next artifact that's likely needed — e.g. moving to "Interview" is a good moment to suggest `interview-prep-generator`; moving to "Offer" is a good moment to suggest `salary-negotiation-prep` or `offer-comparison-analyzer` if there's more than one live offer.
- **On a status request**: summarize counts per stage, and separately call out applications that look stalled — no stage change or follow-up in longer than is typical for that stage (roughly: no response 2+ weeks after Applied, no response 1+ week after an Interview). Use judgment on what counts as "stalled" rather than a rigid cutoff, and say so when flagging.
- **Never fabricate history.** Only report what the user or the app's stored data actually contains; if a date or detail is missing, say it's missing rather than guessing.

## Output Format

For a status overview, group by stage (most-advanced first: Offer, Interview, Screening, Applied, Saved) and within each stage list company, role, and days since the stage started. Close with a short "needs attention" list of anything stalled or with an upcoming deadline.
