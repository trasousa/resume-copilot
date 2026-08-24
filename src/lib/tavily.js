// Calls the Tavily Search API -- a general web-search API, not a job
// board, so it's steered toward job postings via `include_domains` on
// the major boards/ATSes and by phrasing the query as a role+location job
// search. Results are generic web hits (title/url/content snippet), not
// structured postings, so parsing here is best-effort: titles are trimmed
// of the "at Company" / "- Company" suffixes job boards commonly append,
// and anything that doesn't look like an individual listing (search/browse
// pages, category indexes) is dropped rather than guessed at.

const BASE_URL = "https://api.tavily.com/search";

// Applicant tracking systems, not job aggregators -- measured, not assumed.
// LinkedIn/Indeed/Glassdoor were in this list originally and turned out to
// be worse than useless: for a typical query they return only category and
// search pages ("4,289 backend developer Jobs | Glassdoor"), every one of
// which postingInfo() discards, while still consuming the 20 result slots
// Tavily gives us. Removing them and spending those slots on ATS domains
// took a sample of three queries from 0-3 usable postings to 12-20.
//
// Bare hostnames only: Tavily's include_domains matches on host, so a
// "greenhouse.io/jobs" entry would exclude the site entirely.
const JOB_BOARD_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "smartrecruiters.com",
  "recruitee.com",
  "breezy.hr",
  "myworkdayjobs.com",
];

// Matches "Title at Company", "Title - Company", "Title | Company" --
// the common separators job-board <title> tags use between role and employer.
const TITLE_COMPANY_SPLIT = /\s+(?:at|-|\|)\s+/;

/**
 * Only individual postings, recognized by the URL shapes these sites use
 * for a single job. Checked against live Tavily output, which is dominated
 * by category and search pages: an "5,000 Backend Engineer Jobs | Indeed"
 * result is a directory, not something you can apply to, and letting one
 * through produces a card whose "company" is the job board itself.
 *
 * Allow-list rather than deny-list on purpose. Ruling pages out by pattern
 * kept failing open -- `/q-backend-engineer-jobs.html` has no `/jobs`
 * segment to match on -- and a missed listing page is worse than a missed
 * posting here, because the other three sources already supply volume.
 *
 * `company` pulls the employer out of the URL where the site puts it there
 * (both ATSes namespace by employer), which is more reliable than parsing
 * it out of a <title>.
 */
const POSTING_PATTERNS = [
  // job-boards.greenhouse.io/acme/jobs/12345
  { host: /greenhouse\.io$/i, path: /^\/([^/]+)\/jobs\/\d+/i, company: 1 },
  // jobs.lever.co/acme/<uuid>
  { host: /lever\.co$/i, path: /^\/([^/]+)\/[0-9a-f-]{8,}/i, company: 1 },
  // jobs.ashbyhq.com/acme/<uuid>
  { host: /ashbyhq\.com$/i, path: /^\/([^/]+)\/[0-9a-f-]{8,}/i, company: 1 },
  // apply.workable.com/acme/j/ABC123, or acme.workable.com/j/ABC123
  { host: /workable\.com$/i, path: /^\/([^/]+)\/j\/[^/]+/i, company: 1 },
  { host: /workable\.com$/i, path: /^\/j\/[^/]+/i, hostCompany: true },
  // jobs.smartrecruiters.com/Acme/743999688868256-data-scientist
  { host: /smartrecruiters\.com$/i, path: /^\/([^/]+)\/\d+/i, company: 1 },
  // acme.recruitee.com/o/<slug>
  { host: /recruitee\.com$/i, path: /^\/o\//i, hostCompany: true },
  // acme.breezy.hr/p/<id>
  { host: /breezy\.hr$/i, path: /^\/p\//i, hostCompany: true },
  // acme.wd1.myworkdayjobs.com/en-US/Careers/job/Location/Title
  { host: /myworkdayjobs\.com$/i, path: /\/job\//i, hostCompany: true },
  // Kept for completeness: the aggregators are no longer searched (see
  // JOB_BOARD_DOMAINS), but a single-posting URL from one is still valid if
  // it ever turns up.
  { host: /linkedin\.com$/i, path: /^\/jobs\/view\/\d+/i },
  { host: /indeed\.com$/i, path: /^\/viewjob$/i, query: /(^|&)jk=/i },
  { host: /glassdoor\.com$/i, path: /^\/job-listing\//i },
];

/** Returns { company } for a single-posting URL, or null for anything else
 * (listing pages, company indexes, search results). */
function postingInfo(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  for (const rule of POSTING_PATTERNS) {
    if (!rule.host.test(url.hostname)) continue;
    const match = rule.path.exec(url.pathname);
    if (!match) continue;
    if (rule.query && !rule.query.test(url.search.slice(1))) continue;

    // Some ATSes namespace the employer in the path, others give them a
    // subdomain (acme.recruitee.com, acme.wd1.myworkdayjobs.com).
    let company = "";
    if (rule.company) company = decodeURIComponent(match[rule.company]);
    else if (rule.hostCompany) {
      const label = url.hostname.split(".")[0];
      // Generic service subdomains name the ATS, not the employer.
      if (!/^(jobs|apply|boards|job-boards|www|careers)$/i.test(label)) company = label;
    }
    return { company };
  }
  return null;
}

/** Turns an ATS URL slug into something presentable ("acme-corp" -> "Acme
 * Corp"). These are lowercase path segments, not display names. */
function humanizeSlug(slug) {
  return String(slug)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

// Boilerplate the ATSes wrap around the actual role in their <title>.
const TITLE_PREFIX_NOISE = /^(job application for|apply for|application for|careers?\s*[:-]\s*)/i;

// What's left when a result points at a real posting but the page title
// says nothing about the role ("Jobs at Reddit"). Better to drop it than to
// render a card whose headline is the word "Jobs" -- the other sources
// already supply volume, so precision is the useful thing here.
const GENERIC_TITLE = /^(jobs?|careers?|open positions?|openings?|job application|vacancies)$/i;

function splitTitleCompany(rawTitle) {
  const title = String(rawTitle || "").trim().replace(TITLE_PREFIX_NOISE, "").trim();
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
  const jobs = [];

  for (const item of items) {
    if (!item?.url || !item?.title) continue;
    const posting = postingInfo(item.url);
    if (!posting) continue; // Listing/search/category page, not a job.

    const fromTitle = splitTitleCompany(item.title);
    // The URL's employer segment wins: it's what the site itself uses to
    // namespace the posting, whereas a <title> tail is as likely to be the
    // job board's own name ("... | Indeed") as the employer's.
    const company = posting.company ? humanizeSlug(posting.company) : fromTitle.company;
    if (!fromTitle.title || !company || GENERIC_TITLE.test(fromTitle.title)) continue;

    jobs.push({
      title: fromTitle.title,
      company,
      location: locationLine || "",
      url: String(item.url),
      compEstimate: "",
      source: "tavily",
    });
    if (jobs.length >= 30) break;
  }

  return { jobs, error: null };
}
