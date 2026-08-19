// Geocodes location strings via Nominatim (OpenStreetMap's free geocoder),
// with a mandatory D1 cache -- see the usage policy at
// https://operations.osmfoundation.org/policies/nominatim/: max 1
// request/second, a real User-Agent identifying the app is required
// (library defaults are explicitly insufficient), and results must be
// cached. This module enforces both: every call checks the cache first,
// and calls to the live API are made sequentially with a 1-second gap
// after each cache miss, never in parallel and never after a cache hit.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "resume-copilot/1.0 (personal job-tracking tool)";

export function normalizeQuery(location) {
  return String(location || "").trim().toLowerCase();
}

async function geocodeOne(db, query) {
  const cached = await db.prepare("SELECT lat, lng FROM geocode_cache WHERE query = ?").bind(query).first();
  if (cached) return cached.lat != null ? { lat: cached.lat, lng: cached.lng } : null;

  let result = null;
  try {
    const res = await fetch(`${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`, {
      headers: { "User-Agent": USER_AGENT },
      // eslint-disable-next-line no-undef
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body) && body.length) {
        result = { lat: Number(body[0].lat), lng: Number(body[0].lon) };
      }
    }
  } catch {
    // Geocoding failure for one location must never break the whole
    // search -- cache the miss (null coordinates) and move on, same
    // graceful-degradation contract as every other source client in
    // this app.
  }

  await db
    .prepare("INSERT OR REPLACE INTO geocode_cache (query, lat, lng, cached_at) VALUES (?, ?, ?, ?)")
    .bind(query, result?.lat ?? null, result?.lng ?? null, new Date().toISOString())
    .run();

  return result;
}

/** Geocodes a list of location strings, deduplicated, cache-first,
 * respecting Nominatim's 1 req/sec cap for cache misses only (cache hits
 * are unlimited -- they never touch the live API). Returns a Map keyed
 * by normalizeQuery(location) -> {lat, lng} or null. */
export async function geocodeLocations(db, locations) {
  const unique = [...new Set(locations.map(normalizeQuery).filter(Boolean))];
  const results = new Map();

  for (const query of unique) {
    const wasCached = await db.prepare("SELECT 1 FROM geocode_cache WHERE query = ?").bind(query).first();
    results.set(query, await geocodeOne(db, query));
    if (!wasCached) {
      // Only pause after a real API call -- cache hits should stay fast,
      // otherwise a search whose locations are all already cached would
      // pay a needless multi-second penalty for no reason.
      // eslint-disable-next-line no-undef
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
}
