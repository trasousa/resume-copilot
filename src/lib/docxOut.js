// Markdown-ish CV text -> .docx buffer.
//
// Intentionally a small renderer, not a layout engine. Unchanged from the
// Express version except that italics now actually work: the old split only
// produced bold-or-plain parts, and the italic test (/^\*[^*]+\*$/) could
// never match any of them, so the flag was always false.

import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

// Bold before italic -- alternation order decides which wins on `**x**`.
const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;

function lineToRuns(line) {
  const parts = line.split(INLINE).filter(Boolean);
  if (parts.length === 0) return [new TextRun("")];

  return parts.map((part) => {
    const bold = part.startsWith("**") && part.endsWith("**") && part.length > 4;
    const italics = !bold && part.startsWith("*") && part.endsWith("*") && part.length > 2;
    let text = part;
    if (bold) text = part.slice(2, -2);
    else if (italics) text = part.slice(1, -1);
    return new TextRun({ text, bold, italics });
  });
}

function isLikelyHeading(line) {
  const stripped = line.replace(/\*\*/g, "").trim();
  if (!stripped) return false;
  // Short ALL-CAPS lines ("SUMMARY", "EXPERIENCE") read as section headers.
  return (
    stripped.length < 40 &&
    stripped === stripped.toUpperCase() &&
    /[A-Z]/.test(stripped)
  );
}

export async function cvTextToDocxBuffer(text) {
  const children = [];

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\t/g, "").trimEnd();

    if (!line.trim()) {
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    if (isLikelyHeading(line)) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
          children: lineToRuns(line),
        })
      );
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: lineToRuns(line.trim().replace(/^[-*]\s+/, "")),
        })
      );
      continue;
    }

    children.push(
      new Paragraph({ spacing: { after: 80 }, children: lineToRuns(line) })
    );
  }

  const doc = new Document({ sections: [{ properties: {}, children }] });
  return Packer.toBuffer(doc);
}

/** Safe Content-Disposition filename; never collapses to a bare ".docx". */
export function docxFilename(label, fallbackId) {
  const clean = String(label || "").replace(/[^a-z0-9\-_ ]/gi, "").trim();
  return `${clean || `cv-${fallbackId}`}.docx`;
}
