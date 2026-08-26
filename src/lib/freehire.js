// Calls freehire.me -- an open-source aggregator that normalizes postings
// from ~50 ATS platforms into one schema. Free, no signup, no API key.
//
// This source is the only one that returns the posting's own body text at
// search time, which is what makes it worth having: every other source
// gives titles and companies, so the ranking model has been scoring fit
// from a job title alone. `/api/v1/agent/jobs/search` exists specifically
// to hydrate descriptions inline rather than making a caller fetch each
// hit -- see jobsearch.js, which feeds the snippet into the ranking prompt.
//
// Corpus is tech-heavy (its skill/category facets are tuned that way), so
// it complements rather than replaces the general boards.
//
// The backend is MIT-licensed and self-hostable (strelov1/freehire); the
// base URL is swappable via FREEHIRE_API_URL for anyone who would rather
// not depend on someone else's best-effort hosting.

const DEFAULT_BASE_URL = "https://freehire.me";
const SEARCH_PATH = "/api/v1/agent/jobs/search";

// Long enough to be useful context for ranking, short enough that 20 of
// them don't blow the ranking prompt's token budget.
const DESCRIPTION_CHARS = 600;

// The `countries` facet is a controlled vocabulary of ISO-3166 alpha-2
// codes: verified against the live API, `PT` returns results where
// `portugal` returns zero. Sending a country name silently filters
// everything out, so a name that can't be mapped is dropped instead --
// a broader search beats an empty one.
const COUNTRY_NAME_TO_ISO2 = {
  "united states": "US", "usa": "US", "us": "US", "united states of america": "US",
  "united kingdom": "GB", "uk": "GB", "great britain": "GB", "england": "GB",
  "germany": "DE", "deutschland": "DE",
  "portugal": "PT",
  "spain": "ES", "españa": "ES",
  "france": "FR",
  "italy": "IT",
  "netherlands": "NL", "holland": "NL",
  "ireland": "IE",
  "poland": "PL",
  "sweden": "SE",
  "norway": "NO",
  "denmark": "DK",
  "finland": "FI",
  "switzerland": "CH",
  "austria": "AT",
  "belgium": "BE",
  "czechia": "CZ", "czech republic": "CZ",
  "romania": "RO",
  "canada": "CA",
  "brazil": "BR",
  "mexico": "MX",
  "australia": "AU",
  "new zealand": "NZ",
  "india": "IN",
  "singapore": "SG",
  "japan": "JP",
  "israel": "IL",
  "south africa": "ZA",
};

function toIso2(country) {
  const key = String(country || "").trim().toLowerCase();
  if (!key) return "";
  if (COUNTRY_NAME_TO_ISO2[key]) return COUNTRY_NAME_TO_ISO2[key];
  // Already a code (the API wants it uppercased).
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  return "";
}

function firstText(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return String(value.name || value.title || "");
  return "";
}

/** Collapses the description to a single-line snippet: it goes into a JSON
 * blob inside the ranking prompt, where raw newlines and markdown add
 * tokens without adding signal. */
function snippet(text) {
  return String(text || "")
    .replace(/[#*_`>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DESCRIPTION_CHARS);
}

export async function fetchFreehireJobs({ baseUrl, query, city, country, remote }) {
  const params = new URLSearchParams({
    q: query || "",
    limit: "20",
    offset: "0",
    // Keyword search; freehire's semantic index is opt-in and behaves
    // unpredictably against short role queries.
    semantic_ratio: "0",
    include_description: "true",
    description_format: "text",
  });

  if (remote) params.set("work_mode", "remote");
  const iso2 = toIso2(country);
  // Location facets are ANDed server-side, so sending both a country and a
  // city needlessly narrows an already-small corpus -- city is the more
  // specific of the two, and remote searches want neither.
  if (!remote) {
    if (city) params.set("cities", String(city).trim());
    else if (iso2) params.set("countries", iso2);
  }

  const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}${SEARCH_PATH}?${params}`;

  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      // eslint-disable-next-line no-undef
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    // Best-effort hosting with no SLA -- an outage degrades this source
    // rather than failing the whole search, same contract as every other
    // client here.
    return { jobs: [], error: `freehire search request failed: ${err.message}` };
  }

  if (!res.ok) return { jobs: [], error: `freehire search returned ${res.status}` };

  let body;
  try {
    body = await res.json();
  } catch {
    return { jobs: [], error: "freehire search returned an unreadable response." };
  }

  const items = Array.isArray(body?.data) ? body.data : [];
  const jobs = items
    .filter((item) => item?.title && item?.url)
    .map((item) => ({
      title: String(item.title),
      company: firstText(item.company),
      location: String(item.location || (item.work_mode === "remote" ? "Remote" : "")),
      url: String(item.url),
      compEstimate: "",
      description: snippet(item.description),
      skills: Array.isArray(item.skills) ? item.skills.slice(0, 8) : [],
      source: "freehire",
    }))
    .filter((job) => job.company);

  return { jobs, error: null };
}
