// Original CV file storage.
//
// extractText() (lib/parse.js) keeps only the plain text -- everything the
// extractor doesn't model (layout, tables, fonts) was gone for good the
// moment a file was uploaded, with no way back. This keeps the original
// bytes too, so a CV can be downloaded exactly as uploaded, or re-parsed
// later with a better extractor.
//
// Callers check for the ORIGINALS binding before using these, so the app
// still works -- just without originals -- if the bucket isn't configured.

/** R2 keys are flat strings, so the per-user prefix is spelled out here.
 * `sub` can be an email (Access) or anything the IdP issues, and locally
 * it's a dev string -- sanitized so it can't introduce path segments or
 * odd characters into the key. */
export const userPrefix = (sub) => String(sub).replace(/[^a-zA-Z0-9._-]/g, "_");

/**
 * Keys are prefixed by user so a deletion sweep can enumerate exactly one
 * person's objects. Not a security boundary on its own -- reads always go
 * through the caller's own CV row, which is already per-user (see
 * src/lib/store.js) -- but it means orphaned uploads are findable and a
 * deleted account leaves nothing behind.
 *
 * Objects written before this prefix existed keep their old `{cvId}/...`
 * keys and are still served: the key is always read back from the row, never
 * recomputed. Deletion handles both shapes.
 */
export async function putOriginal(bucket, sub, cvId, filename, contentType, arrayBuffer) {
  const key = `u/${userPrefix(sub)}/${cvId}/${filename}`;
  await bucket.put(key, arrayBuffer, {
    httpMetadata: { contentType: contentType || "application/octet-stream" },
  });
  return key;
}

/** Deletes every object under one user's prefix, paginating because R2 caps
 * a list page at 1000 keys. Used by account deletion to catch orphans that
 * no CV row points at any more. */
export async function deleteAllOriginalsFor(bucket, sub) {
  let cursor;
  do {
    const listed = await bucket.list({ prefix: `u/${userPrefix(sub)}/`, cursor });
    for (const object of listed.objects) await bucket.delete(object.key);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export async function getOriginal(bucket, key) {
  return bucket.get(key);
}

export async function deleteOriginal(bucket, key) {
  if (key) await bucket.delete(key);
}
