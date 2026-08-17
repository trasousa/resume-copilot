// public/js/markdown.js
//
// Small, dependency-free markdown-to-HTML renderer for LLM-generated text
// (chat replies, match analysis). Escapes first, transforms second -- see
// this module's own tests-by-inspection below for why that order matters:
// escaping after transforming would let a markdown-inserted <tag> survive
// as real markup; escaping first means every transform regex only ever
// sees literal &lt;/&gt;, so there's no way for model output to inject
// markup through this function no matter what it contains.
//
// Deliberately supports only the handful of constructs LLM output actually
// uses in this app's prompts (headings, bold/italic, inline code, lists,
// paragraphs, links) -- not a full CommonMark implementation.

import { escapeHtml, safeUrl } from "./app.js";

export function renderMarkdown(text) {
  if (!text) return "";

  let html = escapeHtml(text);

  // Headings (### / ## / #) -- must run before bold/italic so a heading
  // like "### **Foo**" doesn't confuse the line-start anchor.
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

  // Bold, then italic (order matters: **x** before *x*, else the two
  // leading asterisks of "**x**" would each get consumed as italic first).
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Inline code.
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links: [text](url) -- safeUrl() rejects non-http(s) schemes the same
  // way every other link-rendering path in this app already does.
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    const safe = safeUrl(url);
    return safe ? `<a href="${safe}" target="_blank" rel="noopener">${linkText}</a>` : linkText;
  });

  // Lists: group consecutive "- " or "1. " lines into <ul>/<ol>.
  const lines = html.split("\n");
  const out = [];
  let listType = null; // "ul" | "ol" | null
  for (const line of lines) {
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (bulletMatch) {
      if (listType !== "ul") { if (listType) out.push(`</${listType}>`); out.push("<ul>"); listType = "ul"; }
      out.push(`<li>${bulletMatch[1]}</li>`);
    } else if (numberedMatch) {
      if (listType !== "ol") { if (listType) out.push(`</${listType}>`); out.push("<ol>"); listType = "ol"; }
      out.push(`<li>${numberedMatch[1]}</li>`);
    } else {
      if (listType) { out.push(`</${listType}>`); listType = null; }
      out.push(line);
    }
  }
  if (listType) out.push(`</${listType}>`);
  html = out.join("\n");

  // Remaining blank-line-separated chunks become paragraphs, skipping
  // anything that's already a block element (heading/list) from above.
  html = html
    .split(/\n{2,}/)
    .map((chunk) => {
      const trimmed = chunk.trim();
      if (!trimmed) return "";
      if (/^<(h2|h3|ul|ol)/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return html;
}
