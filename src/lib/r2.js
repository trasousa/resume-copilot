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

export async function putOriginal(bucket, cvId, filename, contentType, arrayBuffer) {
  const key = `${cvId}/${filename}`;
  await bucket.put(key, arrayBuffer, {
    httpMetadata: { contentType: contentType || "application/octet-stream" },
  });
  return key;
}

export async function getOriginal(bucket, key) {
  return bucket.get(key);
}

export async function deleteOriginal(bucket, key) {
  if (key) await bucket.delete(key);
}
