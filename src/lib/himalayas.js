// Calls Himalayas's public job board search API -- free, no signup, no
// API key. GET https://himalayas.app/jobs/api/search?q=<keyword>&country=<name>
// returns real, structured remote-job postings with salary data when
// disclosed. Himalayas lists remote roles only (no on-site postings), which
// pairs with Arbeitnow's on-site-heavy coverage rather than overlapping it.

const BASE_URL = "https://himalayas.app/jobs/api/search";

function formatSalary(job) {
  if (!job.minSalary && !job.maxSalary) return "";
  const period = job.salaryPeriod ? `/${job.salaryPeriod}` : "";
  const currency = job.currency || "";
  if (job.minSalary && job.maxSalary) {
    return `${currency} ${job.minSalary}-${job.maxSalary}${period}`.trim();
  }
  return `${currency} ${job.minSalary || job.maxSalary}${period}`.trim();
}

export async function fetchHimalayasJobs({ query, country }) {
  const params = new URLSearchParams({ q: query || "", page: "1" });
  if (country) params.set("country", country);

  let res;
  try {
    res = await fetch(`${BASE_URL}?${params}`, {
      // eslint-disable-next-line no-undef
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { jobs: [], error: `Himalayas search request failed: ${err.message}` };
  }

  if (!res.ok) {
    return { jobs: [], error: `Himalayas search returned ${res.status}` };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { jobs: [], error: "Himalayas search returned an unreadable response." };
  }

  const items = Array.isArray(body?.jobs) ? body.jobs : [];
  const jobs = items
    .filter((item) => item?.applicationLink && item?.title)
    .slice(0, 40)
    .map((item) => ({
      title: String(item.title),
      company: String(item.companyName || ""),
      location: Array.isArray(item.locationRestrictions) && item.locationRestrictions.length
        ? item.locationRestrictions.join(", ")
        : "Remote",
      url: String(item.applicationLink),
      compEstimate: formatSalary(item),
      source: "himalayas",
    }))
    .filter((job) => job.company);

  return { jobs, error: null };
}
