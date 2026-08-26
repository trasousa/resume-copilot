// Calls LinkedIn's public "jobs-guest" endpoint -- the same one that backs
// the job list a logged-out visitor sees. No account, no API key.
//
// USE POLICY, read before enabling: automated access to LinkedIn is against
// its Terms of Service. This is included as a personal, low-volume source
// for a single job seeker searching for themselves -- one request per
// user-initiated search, no crawling, no bulk collection, no commercial
// use. It is therefore OFF unless LINKEDIN_SEARCH="1" is set, so running
// it is a deliberate choice rather than a default someone inherits. See
// README.md "Job search".
//
// Worth having despite that, because a general web-search API cannot
// substitute for it: searching linkedin.com through one returns category
// pages ("1,000+ Backend Engineer jobs") rather than postings. This
// endpoint returns the actual listings, with company and city attached.
//
// The response is an HTML fragment of job cards. Parsed with regex
// deliberately: the markup is shallow and stable, and a DOM parser would
// be a new runtime dependency in a Worker bundle for no gain.

const SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";

// Identifies the app honestly rather than impersonating a browser, while
// still being a UA the endpoint accepts.
const USER_AGENT = "Mozilla/5.0 (compatible; resume-copilot/1.0; +personal job search)";

const CARD_TITLE = /base-search-card__title"[^>]*>\s*([^<]+)/g;
const CARD_COMPANY = /hidden-nested-link"[^>]*>\s*([^<]+)/g;
const CARD_LOCATION = /job-search-card__location"[^>]*>\s*([^<]+)/g;
const CARD_URL = /href="(https:\/\/[a-z]{0,3}\.?linkedin\.com\/jobs\/view\/[^"?]+)/g;

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

function decode(text) {
  return String(text)
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function matchAll(pattern, html) {
  // Fresh lastIndex per call -- these are module-level /g regexes.
  pattern.lastIndex = 0;
  const out = [];
  let m;
  while ((m = pattern.exec(html)) !== null) out.push(decode(m[1]));
  return out;
}

export async function fetchLinkedInJobs({ enabled, query, city, region, country, remote }) {
  if (enabled !== "1") return { jobs: [], error: "not configured" };

  const location = remote
    ? [city, region, country].filter(Boolean).join(", ") || "Worldwide"
    : [city, region, country].filter(Boolean).join(", ");
  if (!location) return { jobs: [], error: "LinkedIn search needs a location." };

  // No workplace-type filter is sent. The logged-in site takes `f_WT` (2 =
  // remote), but this guest endpoint ignores it: the same query with and
  // without it returns a byte-identical set of 10 postings, checked against
  // the live endpoint. Passing it anyway would imply a filter that isn't
  // happening -- a remote search here is a location search whose results
  // still need reading.
  const params = new URLSearchParams({ keywords: query || "", location, start: "0" });

  let res;
  try {
    res = await fetch(`${SEARCH_URL}?${params}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        // The endpoint serves the card fragment only to XHR-style callers.
        "X-Requested-With": "XMLHttpRequest",
      },
      // eslint-disable-next-line no-undef
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    return { jobs: [], error: `LinkedIn search request failed: ${err.message}` };
  }

  // 429 is the one worth naming: it means this deployment is querying too
  // often, and the honest fix is to search less, not to retry harder.
  if (res.status === 429) {
    return { jobs: [], error: "LinkedIn is rate-limiting this deployment -- try again later." };
  }
  if (!res.ok) return { jobs: [], error: `LinkedIn search returned ${res.status}` };

  const html = await res.text();

  const titles = matchAll(CARD_TITLE, html);
  const companies = matchAll(CARD_COMPANY, html);
  const locations = matchAll(CARD_LOCATION, html);
  const urls = matchAll(CARD_URL, html);

  // The four lists are positional: card N's title, company, location and
  // link are the Nth match of each pattern. A card missing any one of them
  // would shift every later row onto the wrong job, so anything past the
  // shortest list is dropped rather than zipped on a guess.
  const count = Math.min(titles.length, companies.length, locations.length, urls.length);

  const jobs = [];
  for (let i = 0; i < count; i++) {
    if (!titles[i] || !companies[i] || !urls[i]) continue;
    jobs.push({
      title: titles[i],
      company: companies[i],
      location: locations[i] || location,
      url: urls[i],
      compEstimate: "",
      source: "linkedin",
    });
  }

  return { jobs, error: null };
}
