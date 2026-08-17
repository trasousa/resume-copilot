// Calls Arbeitnow's public job board API -- free, no signup, no API key.
// GET https://www.arbeitnow.com/api/job-board-api?page=N returns ~175 real
// postings per page (aggregated from Greenhouse, SmartRecruiters, and other
// ATS platforms directly), updated hourly. There's no server-side keyword
// or location search, so matching against the candidate's requested
// city/region/country/remote preference happens here, page by page, until
// enough matches are found or pages run out.

const BASE_URL = "https://www.arbeitnow.com/api/job-board-api";
const MAX_PAGES = 3;
const MAX_JOBS = 40;

export async function fetchArbeitnowJobs({ remote, city, region, country }) {
  const locationTerms = [city, region, country].filter(Boolean).map((s) => s.toLowerCase());
  const jobs = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    let res;
    try {
      res = await fetch(`${BASE_URL}?page=${page}`, {
        // eslint-disable-next-line no-undef
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      return { jobs, error: jobs.length ? null : `Job search request failed: ${err.message}` };
    }

    if (!res.ok) {
      return { jobs, error: jobs.length ? null : `Job search returned ${res.status}` };
    }

    let body;
    try {
      body = await res.json();
    } catch {
      return { jobs, error: jobs.length ? null : "Job search returned an unreadable response." };
    }

    const items = Array.isArray(body?.data) ? body.data : [];
    if (!items.length) break;

    for (const item of items) {
      if (!item?.url || !item?.title) continue;
      if (remote) {
        if (!item.remote) continue;
      } else if (locationTerms.length) {
        const loc = String(item.location || "").toLowerCase();
        if (!locationTerms.some((term) => loc.includes(term))) continue;
      }
      jobs.push({
        title: String(item.title),
        company: String(item.company_name || ""),
        location: String(item.location || (item.remote ? "Remote" : "")),
        url: String(item.url),
        compEstimate: "",
        source: "arbeitnow",
      });
      if (jobs.length >= MAX_JOBS) break;
    }

    if (jobs.length >= MAX_JOBS || !body?.links?.next) break;
  }

  return { jobs, error: null };
}
