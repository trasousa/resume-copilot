// Session auth.
//
// The Express version had none, plus a wildcard CORS header -- fine-ish behind
// localhost, fatal on a public URL: anyone who found the hostname could read
// the CV store and spend the API key. A single-user app doesn't need accounts,
// so this is one shared password exchanged for an HMAC-signed cookie.
//
// Set the secrets before deploying:
//   npx wrangler secret put APP_PASSWORD
//   npx wrangler secret put SESSION_SECRET   # any long random string
//
// If you'd rather not manage this at all, put Cloudflare Access in front of
// the Worker and set SKIP_AUTH=1 -- Access then handles identity at the edge.

const COOKIE = "rc_session";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Constant-time compare, so a wrong password can't be found by timing. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionCookie(env) {
  const expires = Date.now() + TTL_SECONDS * 1000;
  const payload = String(expires);
  const sig = await hmac(env.SESSION_SECRET, payload);
  return (
    `${COOKIE}=${payload}.${sig}; HttpOnly; Secure; SameSite=Strict; ` +
    `Path=/; Max-Age=${TTL_SECONDS}`
  );
}

export function clearSessionCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

async function hasValidSession(request, env) {
  const raw = request.headers.get("Cookie") || "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;

  const [payload, sig] = match[1].split(".");
  if (!payload || !sig) return false;
  if (!safeEqual(sig, await hmac(env.SESSION_SECRET, payload))) return false;

  return Number(payload) > Date.now();
}

export async function verifyPassword(env, password) {
  if (!env.APP_PASSWORD || !env.SESSION_SECRET) {
    const err = new Error(
      "APP_PASSWORD and SESSION_SECRET must be set. See src/lib/auth.js."
    );
    err.status = 500;
    throw err;
  }
  // Compare digests so the check doesn't leak length via timing.
  const [a, b] = await Promise.all([
    hmac(env.SESSION_SECRET, `pw:${password}`),
    hmac(env.SESSION_SECRET, `pw:${env.APP_PASSWORD}`),
  ]);
  return safeEqual(a, b);
}

/**
 * Hono middleware. Everything except /api/health and /api/auth/* requires a
 * session. Static assets are served by the assets binding and never reach it.
 */
export function requireAuth() {
  return async (c, next) => {
    if (c.env.SKIP_AUTH === "1") return next();

    const path = new URL(c.req.url).pathname;
    if (path === "/api/health" || path.startsWith("/api/auth/")) return next();

    if (!(await hasValidSession(c.req.raw, c.env))) {
      return c.json({ error: "Not authenticated." }, 401);
    }
    return next();
  };
}
