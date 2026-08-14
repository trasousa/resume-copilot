// Text extraction from an uploaded CV.
//
// Takes an ArrayBuffer rather than a path: on Workers the upload arrives in
// memory and there's no disk to stage it on. That also disposes of the temp
// file leak in the Express version, where a rejected upload left its multer
// tempfile behind forever because the unlink ran only on the success path.

import mammoth from "mammoth";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function extractText(arrayBuffer, originalName) {
  if (arrayBuffer.byteLength > MAX_UPLOAD_BYTES) {
    const err = new Error("File is larger than the 10 MB limit.");
    err.status = 413;
    throw err;
  }

  const ext = (originalName.match(/\.[^.]+$/)?.[0] || "").toLowerCase();

  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return value.trim();
  }

  if (ext === ".txt" || ext === ".md") {
    return new TextDecoder().decode(arrayBuffer).trim();
  }

  const err = new Error(
    `Unsupported file type "${ext}". Upload a .docx, .txt, or .md file (convert PDFs first).`
  );
  err.status = 400;
  throw err;
}
