// src/lib/jobdedup.js
//
// Merges job postings from multiple sources, collapsing duplicates that
// the same underlying opening produces across Arbeitnow/Himalayas/JSearch
// (each source assigns its own URL to the same real job, so URL matching
// alone isn't enough -- dedup instead on normalized company+title+location).
//
// Source-trust order when two jobs collide, best first. freehire leads
// because it is the only source carrying the posting's body text, which is
// what ranking reads to judge fit -- losing that copy of a job would throw
// the description away. Then the structured APIs; Arbeitnow's freeform
// location strings are unreliable to match on, and Tavily is last because
// its company names are parsed out of URL slugs ("Remotecom") rather than
// reported. An unlisted source sorts last rather than crashing.
//
// The kept record is backfilled from the loser with any field it lacks, so
// a lower-trust duplicate's salary or description still survives the merge.
const SOURCE_RANK = { freehire: 0, jsearch: 1, himalayas: 2, linkedin: 3, arbeitnow: 4, tavily: 5 };
const LEGAL_SUFFIXES = /\b(inc|llc|ltd|gmbh|corp|co)\b\.?/gi;

function normalizeCompany(company) {
  return String(company || "")
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function locationBucket(job) {
  const loc = String(job.location || "").toLowerCase();
  if (loc.includes("remote")) return "remote";
  return loc.split(",")[0].trim();
}

function dedupeKey(job) {
  return `${normalizeCompany(job.company)}|${normalizeTitle(job.title)}|${locationBucket(job)}`;
}

export function dedupeJobs(jobs) {
  const byKey = new Map();

  for (const job of jobs) {
    const key = dedupeKey(job);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, job);
      continue;
    }

    const existingRank = SOURCE_RANK[existing.source] ?? 99;
    const candidateRank = SOURCE_RANK[job.source] ?? 99;
    const winner = candidateRank < existingRank ? job : existing;
    const loser = winner === job ? existing : job;

    byKey.set(key, {
      ...winner,
      compEstimate: winner.compEstimate || loser.compEstimate || "",
      description: winner.description || loser.description || undefined,
      skills: winner.skills?.length ? winner.skills : loser.skills,
    });
  }

  return [...byKey.values()];
}
