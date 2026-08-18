// Calls OpenWebNinja's JSearch API -- aggregates LinkedIn, Indeed,
// Glassdoor, ZipRecruiter, and other public boards via Google for Jobs.
// Structured JSON, no scraping, no proxy. Free tier: 200 requests/month,
// 1,000 req/hour -- this module must be called at most once per user
// search (no pagination, no retry-on-empty) to respect that budget.
//
// The API's `country` parameter defaults to "us" when omitted (confirmed
// empirically -- an unscoped non-US query returns zero results), so an
// explicit country is always passed here rather than relying on the
// default.

const BASE_URL = "https://api.openwebninja.com/jsearch/search-v2";

function formatSalary(job) {
  if (job.job_salary_string) return String(job.job_salary_string);
  if (!job.job_min_salary && !job.job_max_salary) return "";
  const period = job.job_salary_period ? `/${job.job_salary_period}` : "";
  if (job.job_min_salary && job.job_max_salary) {
    return `${job.job_min_salary}-${job.job_max_salary}${period}`;
  }
  return `${job.job_min_salary || job.job_max_salary}${period}`;
}

export async function fetchJSearchJobs({ apiKey, query, country }) {
  if (!apiKey) return { jobs: [], error: null }; // Not configured -- silently skip, not an error state.

  const params = new URLSearchParams({ query: query || "", country: country || "us" });

  let res;
  try {
    res = await fetch(`${BASE_URL}?${params}`, {
      headers: { "X-API-Key": apiKey },
      // eslint-disable-next-line no-undef
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { jobs: [], error: `JSearch request failed: ${err.message}` };
  }

  if (!res.ok) {
    return { jobs: [], error: `JSearch returned ${res.status}` };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { jobs: [], error: "JSearch returned an unreadable response." };
  }

  const items = Array.isArray(body?.data?.jobs) ? body.data.jobs : [];
  const jobs = items
    .filter((item) => item?.job_apply_link && item?.job_title)
    .slice(0, 40)
    .map((item) => ({
      title: String(item.job_title),
      company: String(item.employer_name || ""),
      location: String(
        item.job_location || (item.job_is_remote ? "Remote" : [item.job_city, item.job_state, item.job_country].filter(Boolean).join(", "))
      ).trim(),
      url: String(item.job_apply_link),
      compEstimate: formatSalary(item),
      source: "jsearch",
    }))
    .filter((job) => job.company);

  return { jobs, error: null };
}
