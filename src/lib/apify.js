// Calls Apify's fantastic-jobs/jobs-scraper actor -- a deterministic
// scraper that reads each ATS's own public JSON/XML endpoint directly
// (Greenhouse, Lever, Workday, Ashby, and others), rather than an LLM
// guessing at web search results. Runs on Apify's own infrastructure, so
// this is a plain outbound fetch() -- no new hosting for this project.
// $1 per 1,000 job results; Apify's $5/month free platform credits cover
// roughly 5,000 results/month, which is generous for personal-use search
// volume.
//
// The actor takes `startUrls` -- explicit company career-page URLs -- not
// a free-text search query, and its output has no `company`/`salary`
// field. Company name comes from matching each returned job's url against
// the watchlist entry it was scraped from.

const ACTOR = "fantastic-jobs~jobs-scraper";
const RUN_SYNC_URL = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`;

export async function runApifyAtsSearch({ apiToken, watchlist }) {
  if (!apiToken || !watchlist?.length) return { jobs: [], error: null }; // Not configured -- silently skip, not an error state.

  let res;
  try {
    res = await fetch(`${RUN_SYNC_URL}?token=${encodeURIComponent(apiToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startUrls: watchlist.map((w) => ({ url: w.url })) }),
      // Apify's own run can take a while; bound it so a slow/stuck scrape
      // never holds up the whole job-search request past a sane wait.
      // AbortSignal is a Workers runtime global not listed in eslint.config.js's
      // global allowlist (nothing else in this codebase uses it yet).
      // eslint-disable-next-line no-undef
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    return { jobs: [], error: `ATS search request failed: ${err.message}` };
  }

  if (!res.ok) {
    return { jobs: [], error: `ATS search returned ${res.status}` };
  }

  let items;
  try {
    items = await res.json();
  } catch {
    return { jobs: [], error: "ATS search returned an unreadable response." };
  }

  if (!Array.isArray(items)) return { jobs: [], error: null };

  // Resolve each job's company by which watchlist URL prefixes its own
  // url -- e.g. a job at "https://boards.greenhouse.io/stripe/jobs/123"
  // matches the watchlist entry "https://boards.greenhouse.io/stripe". If
  // there's exactly one watchlist entry there's no ambiguity to resolve, so
  // fall back to it directly -- otherwise an unresolved company must never
  // reach the frontend as "", since that 400s the "Tailor Resume" action
  // downstream (POST /api/applications requires a non-empty company).
  const companyFor = (jobUrl) =>
    watchlist.find((w) => jobUrl?.startsWith(w.url))?.company ||
    (watchlist.length === 1 ? watchlist[0].company : "");

  const jobs = items
    .filter((item) => item?.url && item?.title)
    .slice(0, 40) // Cap per-search cost/volume -- this is a supplementary source, not the primary one.
    .map((item) => ({
      title: String(item.title),
      company: companyFor(item.url),
      location: String(item.locations?.[0] || ""),
      url: String(item.url),
      compEstimate: "",
      source: "ats",
    }))
    // Drop jobs whose company couldn't be resolved rather than shipping an
    // empty company field that breaks Tailor Resume downstream.
    .filter((job) => job.company);

  return { jobs, error: null };
}
