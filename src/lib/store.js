// Resolves the per-user data store for a request and hands it to the route
// as `c.var.store`.
//
// This is the seam that makes multi-tenancy real. Before it, every route
// read `c.env.DB` -- one shared D1 database with no owner column on any
// table, so two people behind the same Access policy saw each other's CVs
// and applications. Now each request is routed to the Durable Object named
// by the caller's verified Access `sub`, and that object's own SQLite is
// the only data it can reach. Isolation stops being a query convention
// nobody can forget to apply, because there are no other users' rows in
// there to leak.
//
// What did NOT move: src/lib/geocode.js still takes `c.env.DB`. Its
// geocode_cache holds public OpenStreetMap coordinates, not user data, and
// one shared cache serves Nominatim's usage policy far better than N
// per-user copies of the same lookups.
//
// Cost note: `store` methods are Durable Object RPC, so each one is a
// network hop rather than a local call. They mirror db.js's functions
// (not its individual statements), so a request makes the same number of
// round trips it used to make D1 queries -- single-digit milliseconds
// intra-colo, against LLM calls measured in tens of seconds. Do not push
// generation into the object to save a hop: a Durable Object handles one
// request at a time, so a 30-90s model call in there would block every
// other request from that same user.

import { getAgentByName } from "agents";

// setIdentity() is a no-op after an instance's first call, but calling it
// is still a round trip -- remember which subs this isolate has already
// stamped so warm requests skip it. Per-isolate and lossy by design: a
// cold isolate just pays the no-op once more.
const stamped = new Set();

export function withStore() {
  return async (c, next) => {
    // requireAuth() runs first on /api/*, so this is always set.
    const user = c.get("user");
    const store = await getAgentByName(c.env.RESUME_AGENT, user.sub);

    if (!stamped.has(user.sub)) {
      await store.setIdentity(user.email, user.sub);
      stamped.add(user.sub);
    }

    c.set("store", store);
    return next();
  };
}
