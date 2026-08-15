// Auth via Cloudflare Access (Zero Trust).
//
// This file runs no login flow of its own -- Access sits in front of the
// Worker's custom domain and only forwards a request once the visitor has
// authenticated against whatever identity provider you configured there
// (Google, GitHub, a one-time email code, ...) and passed your Access
// policy. What lands here is a signed JWT proving who Access let through;
// this module's only job is verifying that JWT actually came from your
// Access team and hasn't expired, rather than just trusting that traffic
// reaching the Worker must already be legitimate.
//
// That distinction matters because *.workers.dev can't be put behind an
// Access application -- it's a Cloudflare-shared domain, not a zone you
// control. Validating the JWT here (instead of only relying on the edge
// perimeter) is what keeps the workers.dev URL locked out too: Access never
// fronts it, so no request to it can ever carry a validly-signed JWT for
// this app, and everything below fails closed on a missing or bad one.
//
// Set up in the Zero Trust dashboard (not here) -- requires the custom
// domain from README.md "Custom domain" to already be attached:
//   1. Zero Trust -> Access -> Applications -> Add an application ->
//      Self-hosted. Application domain: your Worker's custom domain
//      (e.g. resume.yourdomain.com) -- NOT the *.workers.dev URL.
//   2. Settings -> Authentication -> add an Identity Provider if you don't
//      have one yet. Google is one option; Cloudflare's own "One-time PIN"
//      (an emailed code, no external IdP needed) is the simplest if you'd
//      rather not touch Google Cloud Console at all.
//   3. Policy: Allow, Include -> Emails -> your email(s). This is the
//      allow-list -- there's no ALLOWED_EMAILS in this app anymore because
//      Access's own policy is already the authorization check: you cannot
//      end up holding a validly-signed JWT for this app unless that policy
//      let you through in the first place.
//   4. On the application's Overview page, copy the Application Audience
//      (AUD) tag. Your team domain is the `<team-name>` you chose when
//      Zero Trust was first enabled for the account.
//   5. Put both in wrangler.jsonc `vars` (not secrets -- neither is a
//      bearer credential, just identifiers used to check the JWT):
//        CF_ACCESS_TEAM_DOMAIN   e.g. "yourteam.cloudflareaccess.com"
//        CF_ACCESS_AUD           the AUD tag from step 4
//
// Until both are set correctly, every request fails closed with a 401 --
// there is no unauthenticated fallback mode short of SKIP_AUTH=1, which is
// for `wrangler dev` only (Access never runs in front of localhost).

import { createRemoteJWKSet, jwtVerify } from "jose";

const HEADER = "Cf-Access-Jwt-Assertion";

// createRemoteJWKSet caches the fetched keys (and handles rotation) across
// calls on its own -- caching the JWKSet itself per warm isolate just avoids
// re-registering it on every request.
let jwks = null;
let jwksTeamDomain = null;

function jwksFor(env) {
  if (!jwks || jwksTeamDomain !== env.CF_ACCESS_TEAM_DOMAIN) {
    jwks = createRemoteJWKSet(
      new URL(`https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)
    );
    jwksTeamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  }
  return jwks;
}

async function verifyAccessJwt(c) {
  const { CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD } = c.env;
  if (!CF_ACCESS_TEAM_DOMAIN || !CF_ACCESS_AUD) return null;

  const token = c.req.header(HEADER);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, jwksFor(c.env), {
      issuer: `https://${CF_ACCESS_TEAM_DOMAIN}`,
      audience: CF_ACCESS_AUD,
    });
    return { email: String(payload.email || "").toLowerCase() };
  } catch {
    // Expired, wrong audience, bad signature, wrong issuer -- all the same
    // outcome from the caller's side: not authenticated.
    return null;
  }
}

export function requireAuth() {
  return async (c, next) => {
    if (c.env.SKIP_AUTH === "1") return next(); // wrangler dev only

    const user = await verifyAccessJwt(c);
    if (!user) return c.json({ error: "Not authenticated." }, 401);

    c.set("user", user);
    return next();
  };
}

/** Best-effort: who's signed in, or null. Used by /api/auth/me. */
export async function currentUser(c) {
  if (c.env.SKIP_AUTH === "1") return null;
  return c.get("user") || (await verifyAccessJwt(c));
}
