// Session auth via Google sign-in.
//
// Single-tenant: anyone with a Google account can start the sign-in flow, but
// a session is only granted if the verified email is in ALLOWED_EMAILS.
// There's no per-user data separation -- everyone on the allow-list shares
// one CV store, same as the shared-password version this replaced.
//
// Set up:
//   1. Google Cloud Console -> APIs & Services -> Credentials -> Create
//      OAuth client ID (Web application). Add this Worker's callback URL to
//      "Authorized redirect URIs" -- one entry per host you'll use it from:
//        https://<your-custom-domain>/api/auth/google/callback
//        https://resume-copilot.<your-subdomain>.workers.dev/api/auth/google/callback
//        http://localhost:8787/api/auth/google/callback   (wrangler dev)
//   2. npx wrangler secret put GOOGLE_CLIENT_ID
//      npx wrangler secret put GOOGLE_CLIENT_SECRET
//      npx wrangler secret put ALLOWED_EMAILS      # comma-separated
//      npx wrangler secret put SESSION_SECRET      # any long random string
//
// If you'd rather not manage this at all, put Cloudflare Access in front of
// the Worker and set SKIP_AUTH=1 -- Access then handles identity at the edge.

import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const SESSION_COOKIE = "rc_session";
const STATE_COOKIE = "rc_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const STATE_TTL_SECONDS = 600; // 10 minutes -- just the redirect round trip

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(str) {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
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

/** Constant-time compare, so a mismatch can't be found by timing. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signedValue(secret, obj) {
  const payload = b64url(enc.encode(JSON.stringify(obj)));
  return `${payload}.${await hmac(secret, payload)}`;
}

async function verifySignedValue(secret, value) {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  if (!safeEqual(sig, await hmac(secret, payload))) return null;
  try {
    return JSON.parse(dec.decode(b64urlToBytes(payload)));
  } catch {
    return null;
  }
}

// --- session cookie ----------------------------------------------------

export async function setSessionCookie(c, email) {
  const value = await signedValue(c.env.SESSION_SECRET, {
    email,
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  });
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

async function readSession(c) {
  const claims = await verifySignedValue(c.env.SESSION_SECRET, getCookie(c, SESSION_COOKIE));
  if (!claims?.exp || claims.exp <= Date.now()) return null;
  return claims; // { email, exp }
}

/**
 * Hono middleware. Everything under /api/* requires a session except this
 * explicit list -- deliberately not a path-prefix bypass, so a future
 * /api/auth/* route doesn't silently become public by accident.
 */
const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/status",
  "/api/auth/me",
  "/api/auth/google/start",
  "/api/auth/google/callback",
  "/api/auth/logout",
]);

export function requireAuth() {
  return async (c, next) => {
    if (c.env.SKIP_AUTH === "1") return next();
    if (PUBLIC_PATHS.has(new URL(c.req.url).pathname)) return next();

    const session = await readSession(c);
    if (!session) return c.json({ error: "Not authenticated." }, 401);

    c.set("user", session);
    return next();
  };
}

/** Best-effort: who's signed in, or null. Used by /api/auth/me. */
export async function currentUser(c) {
  if (c.env.SKIP_AUTH === "1") return null;
  return c.get("user") || (await readSession(c));
}

// --- Google OAuth --------------------------------------------------------

function allowedEmails(env) {
  return (env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function assertGoogleConfigured(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET || !env.ALLOWED_EMAILS) {
    const err = new Error(
      "Google sign-in isn't configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, " +
        "ALLOWED_EMAILS, and SESSION_SECRET -- see src/lib/auth.js."
    );
    err.status = 500;
    throw err;
  }
}

// Must exactly match the URI registered in Google Cloud Console, so it's
// derived from the request rather than hard-coded -- the same Worker answers
// on workers.dev, the custom domain, and localhost during dev.
const callbackUrl = (c) => `${new URL(c.req.url).origin}/api/auth/google/callback`;

/** Build the redirect to Google's consent screen and stash CSRF state. */
export async function startGoogleAuth(c) {
  assertGoogleConfigured(c.env);

  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  // SameSite=Lax, not Strict: this cookie has to survive the top-level
  // cross-site redirect Google sends the browser back on. Strict cookies are
  // dropped on exactly that kind of navigation.
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/api/auth/google",
    maxAge: STATE_TTL_SECONDS,
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", c.env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", callbackUrl(c));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/**
 * Handle Google's redirect back: verify state, exchange the code, and check
 * the verified email against ALLOWED_EMAILS.
 *
 * Throws (with `.status`) on any failure -- the caller decides how to present
 * that, since a browser sitting on this URL needs a redirect, not JSON.
 */
export async function completeGoogleAuth(c) {
  assertGoogleConfigured(c.env);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/api/auth/google" });

  if (!code || !state || !cookieState || !safeEqual(state, cookieState)) {
    const err = new Error("Sign-in expired or was tampered with. Try again.");
    err.status = 400;
    throw err;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(c),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    const err = new Error("Google rejected the sign-in request.");
    err.status = 401;
    throw err;
  }
  const { access_token } = await tokenRes.json();

  const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) {
    const err = new Error("Couldn't read the Google account's profile.");
    err.status = 401;
    throw err;
  }
  const profile = await userRes.json(); // { email, email_verified, name, picture, sub }

  const email = String(profile.email || "").toLowerCase();
  if (!profile.email_verified || !allowedEmails(c.env).includes(email)) {
    const err = new Error(`${profile.email || "That Google account"} isn't allowed to sign in here.`);
    err.status = 403;
    throw err;
  }

  return email;
}
