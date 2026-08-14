import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

// Splits a line like "**Data Scientist** at **Acme**" into runs, honoring
// simple **bold** markdown -- the format the resume skills consistently
// produce in their output.
function lineToRuns(line) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  if (parts.length === 0) return [new TextRun("")];
  return parts.map((part) => {
    const bold = part.startsWith("**") && part.endsWith("**");
    const text = bold ? part.slice(2, -2) : part;
    return new TextRun({ text, bold, italics: /^\*[^*]+\*$/.test(part) });
  });
}

function isLikelyHeading(line) {
  const stripped = line.replace(/\*\*/g, "").trim();
  if (!stripped) return false;
  // ALL CAPS short lines ("SUMMARY", "EXPERIENCE", "SKILLS") read as section headers.
  return stripped.length < 40 && stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped);
}

/**
 * Turn plain/markdown-ish CV text into a downloadable .docx buffer.
 * This is intentionally simple (MVP formatting, not a full layout engine) --
 * for polished, template-driven output, route the final text through
 * Claude's `docx` skill instead.
 */
export async function cvTextToDocxBuffer(text) {
  const lines = text.split("\n");
  const children = [];

  for (const raw of lines) {
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
    children.push(new Paragraph({ spacing: { after: 80 }, children: lineToRuns(line) }));
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}
