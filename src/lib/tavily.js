// Calls the Tavily Search API -- a general web-search API, not a job
// board, so it's steered toward job postings via `include_domains` on
// the major boards/ATSes and by phrasing the query as a role+location job
// search. Results are generic web hits (title/url/content snippet), not
// structured postings, so parsing here is best-effort: titles are trimmed
// of the "at Company" / "- Company" suffixes job boards commonly append,
// and anything that doesn't look like an individual listing (search/browse
// pages, category indexes) is dropped rather than guessed at.

const BASE_URL = "https://api.tavily.com/search";
// Bare domains only -- Tavily's include_domains matches hostnames, not
// paths, so "linkedin.com/jobs" would silently exclude LinkedIn entirely.
// Non-posting LinkedIn pages are handled by NON_POSTING_PATH instead.
const JOB_BOARD_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "lever.co",
  "greenhouse.io",
  "workable.com",
];

// Matches "Title at Company", "Title - Company", "Title | Company" --
// the common separators job-board <title> tags use between role and employer.
const TITLE_COMPANY_SPLIT = /\s+(?:at|-|\|)\s+/;

// Listing/search/category pages rather than a single posting -- these
// don't have a specific job to extract and would otherwise show up as
// junk "jobs" with no real title or company.
const NON_POSTING_PATH = /\/(jobs|search|browse|companies|careers)\/?(\?|$)/i;

function splitTitleCompany(rawTitle) {
  const title = String(rawTitle || "").trim();
  const parts = title.split(TITLE_COMPANY_SPLIT);
  if (parts.length >= 2) {
    return { title: parts[0].trim(), company: parts[parts.length - 1].trim() };
  }
  return { title, company: "" };
}

export async function fetchTavilyJobs({ apiKey, query, city, region, country, remote }) {
  if (!apiKey) return { jobs: [], error: null }; // Not configured -- silently skip, not an error state.

  const locationLine = remote
    ? "remote"
    : [city, region, country].filter(Boolean).join(", ");
  const searchQuery = `${query || "jobs"} job posting ${locationLine}`.trim();

  let res;
  try {
    res = await fetch(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: searchQuery,
        search_depth: "basic",
        max_results: 20,
        include_domains: JOB_BOARD_DOMAINS,
      }),
      // eslint-disable-next-line no-undef
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    return { jobs: [], error: `Tavily request failed: ${err.message}` };
  }

  if (!res.ok) {
    return { jobs: [], error: `Tavily returned ${res.status}` };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { jobs: [], error: "Tavily returned an unreadable response." };
  }

  const items = Array.isArray(body?.results) ? body.results : [];
  const jobs = items
    .filter((item) => item?.url && item?.title && !NON_POSTING_PATH.test(item.url))
    .slice(0, 30)
    .map((item) => {
      const { title, company } = splitTitleCompany(item.title);
      return {
        title,
        company,
        location: locationLine || "",
        url: String(item.url),
        compEstimate: "",
        source: "tavily",
      };
    })
    .filter((job) => job.title && job.company);

  return { jobs, error: null };
}
