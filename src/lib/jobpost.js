// Fetches a job posting page and reduces it to readable text, so the user
// can paste a link instead of copy-pasting the posting by hand. Deliberately
// not a job for the LLM providers -- a plain fetch() is more reliable than
// asking a model to "browse", and keeps this out of lib/anthropic.js /
// lib/gemini.js entirely.

const MAX_CHARS = 20000;

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

export async function fetchJobPostText(url) {
  const parsed = assertFetchable(url);

  let res;
  try {
    res = await fetch(parsed.href, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ResumeCopilot/1.0)" },
      redirect: "follow",
    });
  } catch {
    const err = new Error("Couldn't reach that URL.");
    err.status = 502;
    throw err;
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
