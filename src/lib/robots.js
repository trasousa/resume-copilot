// A robots.txt parser/matcher used to decide whether the job-post fetcher may
// retry a 403 with browser-like headers. Pure -- no I/O -- so the caller keeps
// its SSRF-guarded fetch in one place and this stays unit-testable.
//
// Deliberately not urllib.robotparser-shaped: that implementation ends a record
// at the first blank line and matches rules in file order, so a real-world file
// with blank lines between `User-agent: *` and its rules, and `Allow: /` listed
// before `Disallow: /cs/`, reads as "everything allowed". That fails open, which
// is the one direction that matters here.

/** @typedef {{ allow: boolean, pattern: string }} RobotsRule */

// Only the groups that can bind us: the wildcard group, and a group naming this
// client explicitly. Honouring our own token as well as `*` can only ever make
// the verdict stricter.
const OWN_TOKEN = "resumecopilot";

/**
 * Collect the rules of every group whose User-agent list names `*` or this
 * client. Blank lines are ignored entirely; a group ends only when a
 * `User-agent:` line follows a rule line, which is what keeps the fail-open
 * bug above from reappearing.
 *
 * @param {string} text raw robots.txt body
 * @returns {RobotsRule[]}
 */
export function parseRobotsRules(text) {
  /** @type {RobotsRule[]} */
  const rules = [];
  let agents = [];
  let sawRuleSinceAgent = false;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group; a User-agent line after
      // a rule opens a new one.
      if (sawRuleSinceAgent) {
        agents = [];
        sawRuleSinceAgent = false;
      }
      agents.push(value.toLowerCase());
      continue;
    }

    if (field !== "allow" && field !== "disallow") continue;
    sawRuleSinceAgent = true;

    // An empty Disallow means "nothing is disallowed" and an empty Allow says
    // nothing at all; neither constrains a path, so neither becomes a rule.
    if (!value) continue;
    if (!agents.some((a) => a === "*" || a === OWN_TOKEN)) continue;

    rules.push({ allow: field === "allow", pattern: value });
  }

  return rules;
}

/**
 * robots.txt path patterns support `*` (any run of characters) and a trailing
 * `$` (end anchor). Everything else is literal.
 */
function patternMatches(pattern, path) {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source =
    "^" + body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : "");
  return new RegExp(source).test(path);
}

/**
 * Longest matching pattern wins; an Allow/Disallow tie of equal length goes to
 * Disallow. With no matching rule the path is allowed, which matches the spec
 * and is safe because the caller treats an *unreadable* policy as a refusal.
 *
 * @param {RobotsRule[]} rules
 * @param {string} path request path, including any query string
 * @returns {boolean}
 */
export function isAllowedByRobots(rules, path) {
  let best = null;
  for (const rule of rules) {
    if (!patternMatches(rule.pattern, path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && !rule.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
