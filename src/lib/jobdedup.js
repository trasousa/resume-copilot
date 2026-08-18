// src/lib/jobdedup.js
//
// Merges job postings from multiple sources, collapsing duplicates that
// the same underlying opening produces across Arbeitnow/Himalayas/JSearch
// (each source assigns its own URL to the same real job, so URL matching
// alone isn't enough -- dedup instead on normalized company+title+location).
//
// Source-trust order when two jobs collide: jsearch > himalayas >
// arbeitnow. JSearch and Himalayas return more structured/complete data;
// Arbeitnow's freeform location strings are the least reliable to match
// on, so it loses ties. The kept record is backfilled with any field
// (currently just compEstimate) that a lower-trust duplicate has and it
// doesn't, rather than discarding that data.

const SOURCE_RANK = { jsearch: 0, himalayas: 1, arbeitnow: 2 };
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
    });
  }

  return [...byKey.values()];
}
