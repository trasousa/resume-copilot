import mammoth from "mammoth";
import path from "node:path";
import fs from "node:fs/promises";

/**
 * Extract plain text from an uploaded CV file. Supports .docx and plain
 * text/markdown out of the box. PDF isn't handled here to keep the
 * dependency footprint small -- if you need PDF intake, convert it first
 * (e.g. with Claude's `pdf` skill, or `pdftotext`) and upload the .txt/.docx
 * result instead.
 */
export async function extractText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ path: filePath });
    return value.trim();
  }
  if (ext === ".txt" || ext === ".md") {
    return (await fs.readFile(filePath, "utf-8")).trim();
  }
  const err = new Error(
    `Unsupported file type "${ext}". Upload a .docx, .txt, or .md file (convert PDFs first).`
  );
  err.status = 400;
  throw err;
}
