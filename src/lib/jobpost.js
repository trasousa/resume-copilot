// Fetches a job posting page and reduces it to readable text, so the user
// can paste a link instead of copy-pasting the posting by hand. Deliberately
// not a job for the LLM providers -- a plain fetch() is more reliable than
// asking a model to "browse", and keeps this out of lib/anthropic.js /
// lib/gemini.js entirely.

import { isAllowedByRobots, parseRobotsRules } from "./robots.js";

const MAX_CHARS = 20000;

// A robots.txt big enough to exceed this is not a policy we can act on, and we
// are not obliged to buffer an arbitrary response to find out.
const MAX_ROBOTS_CHARS = 128_000;
const ROBOTS_TIMEOUT_MS = 5000;

const HONEST_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; ResumeCopilot/1.0)" };

// Used only to get past a WAF that filters on client shape, and only after
// robots.txt has affirmatively permitted the path. See the ladder in
// fetchJobPostText().
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

// Blocks the obvious SSRF targets (loopback, link-local, private ranges,
// cloud metadata endpoints). Not exhaustive DNS-rebinding protection --
// Workers' fetch() already restricts a lot -- just a sane first filter on
// the literal host the user pasted.
const BLOCKED_HOSTS = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|::1$|\[::1\]$)/i;
function isPrivateHost(hostname) {
  if (BLOCKED_HOSTS.test(hostname)) return true;
  const m = hostname.match(/^172\.(\d+)\./);
  return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}

function assertFetchable(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const err = new Error("That doesn't look like a valid URL.");
    err.status = 400;
    throw err;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    const err = new Error("Only http(s) job posting URLs are supported.");
    err.status = 400;
    throw err;
  }
  if (isPrivateHost(parsed.hostname)) {
    const err = new Error("That URL isn't a fetchable public job posting.");
    err.status = 400;
    throw err;
  }
  return parsed;
}

/** Strip a job posting page down to plain, readable text. */
function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/**
 * Fetch `start`, following redirects by hand so every hop passes
 * assertFetchable -- with redirect: "follow", a public URL that 302s to a
 * loopback/private address would sail past the host check entirely.
 *
 * @param {URL} start
 * @param {Record<string, string>} headers
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ res: Response, url: URL }>}
 */
async function guardedFetch(start, headers, options = {}) {
  let current = start;
  for (let hop = 0; ; hop++) {
    let res;
    try {
      res = await fetch(current.href, { headers, redirect: "manual", signal: options.signal });
    } catch {
      const err = new Error("Couldn't reach that URL.");
      err.status = 502;
      throw err;
    }

    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return { res, url: current };
    if (hop >= 5) {
      const err = new Error("That URL redirects too many times -- paste the job post text instead.");
      err.status = 502;
      throw err;
    }
    current = assertFetchable(new URL(location, current.href).href);
  }
}

/**
 * Whether the origin's published policy permits fetching `target`.
 *
 * Fails closed: only a policy we actually read and that allows the path, or a
 * 404 (no policy published, which is permission), returns "allowed". A timeout,
 * a 5xx or anything else unreadable returns "unknown", because a policy we are
 * prevented from reading cannot be honoured and we must not assume consent.
 *
 * @param {URL} target
 * @returns {Promise<"allowed" | "disallowed" | "unknown">}
 */
async function robotsVerdict(target) {
  const robotsUrl = assertFetchable(new URL("/robots.txt", target.origin).href);
  // One budget across both robots reads -- an origin that stalls the policy
  // file must not stall the user's request behind it.
  const signal = globalThis.AbortSignal.timeout(ROBOTS_TIMEOUT_MS);

  let res;
  try {
    ({ res } = await guardedFetch(robotsUrl, HONEST_HEADERS, { signal }));
    // The same WAF that refused the page routinely refuses the policy file.
    // robots.txt is not the protected resource, so re-reading it as a browser
    // is fair -- and whatever it then says is obeyed strictly.
    if (res.status === 403) ({ res } = await guardedFetch(robotsUrl, BROWSER_HEADERS, { signal }));
  } catch {
    return "unknown";
  }

  if (res.status === 404) return "allowed";
  if (!res.ok) return "unknown";

  let body;
  try {
    body = await res.text();
  } catch {
    return "unknown";
  }

  const rules = parseRobotsRules(body.slice(0, MAX_ROBOTS_CHARS));
  return isAllowedByRobots(rules, target.pathname + target.search) ? "allowed" : "disallowed";
}

export async function fetchJobPostText(url) {
  const parsed = assertFetchable(url);

  let { res, url: finalUrl } = await guardedFetch(parsed, HONEST_HEADERS);

  // A 403 usually means the page refused the *client*, not that it is missing:
  // corporate, bank and recruiter WAFs answer 403 to anything that doesn't look
  // like a browser while serving the identical page fine to one. Retrying with
  // browser headers overrides a firewall default -- but only where the site's
  // published policy allows the path. Where robots.txt says no, the site used
  // exactly the mechanism it was told to use, and the retry would circumvent
  // it, so we stop.
  if (res.status === 403) {
    const verdict = await robotsVerdict(finalUrl);
    if (verdict === "disallowed") {
      const err = new Error("That site's robots.txt declines automated access to this page -- paste the job post text instead.");
      err.status = 403;
      throw err;
    }
    if (verdict === "unknown") {
      const err = new Error("That URL returned 403 and its robots.txt couldn't be checked -- paste the job post text instead.");
      err.status = 502;
      throw err;
    }
    ({ res } = await guardedFetch(finalUrl, BROWSER_HEADERS));
  }

  if (!res.ok) {
    const err = new Error(`That URL returned ${res.status} -- paste the job post text instead.`);
    err.status = 502;
    throw err;
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    const err = new Error("That URL isn't a readable web page -- paste the job post text instead.");
    err.status = 422;
    throw err;
  }

  const raw = await res.text();
  const text = (contentType.includes("text/html") ? htmlToText(raw) : raw.trim()).slice(0, MAX_CHARS);

  if (!text) {
    const err = new Error("Couldn't extract any readable text from that page.");
    err.status = 422;
    throw err;
  }

  return text;
}
