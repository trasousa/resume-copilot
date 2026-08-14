import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(__dirname, "..", "..", "skills");

const cache = new Map();

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: match[2].trim() };
}

export function loadSkill(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.join(skillsDir, name, "SKILL.md");
  if (!fs.existsSync(file)) {
    console.warn(`[skills] missing skill: ${name}`);
    return null;
  }
  const raw = fs.readFileSync(file, "utf-8");
  const { meta, body } = parseFrontmatter(raw);
  const skill = { name, description: meta.description || "", body };
  cache.set(name, skill);
  return skill;
}

export function listSkills() {
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(skillsDir, name, "SKILL.md")));
}

/**
 * Build a system prompt fragment by concatenating one or more skills'
 * instructions. Each task in this app declares which skills apply so the
 * model gets the exact playbook for that job rather than every skill at once.
 */
export function buildSkillPrompt(names) {
  const parts = names
    .map((n) => loadSkill(n))
    .filter(Boolean)
    .map((s) => `## Skill: ${s.name}\n${s.description}\n\n${s.body}`);
  return parts.join("\n\n---\n\n");
}

// Which skills apply to each task this app performs. Kept in one place so
// it's obvious what to edit if a new skill is added or a mapping changes.
export const SKILL_ROUTES = {
  optimizeNoJobPost: ["resume-formatter", "resume-bullet-writer", "resume-quantifier", "resume-section-builder", "resume-ats-optimizer"],
  tailorToJobPost: ["job-description-analyzer", "resume-tailor", "resume-ats-optimizer", "resume-bullet-writer"],
  tailorTech: ["tech-resume-optimizer"],
  tailorExecutive: ["executive-resume-writer"],
  tailorAcademic: ["academic-cv-builder"],
  tailorCreative: ["creative-portfolio-resume"],
  tailorCareerChange: ["career-changer-translator"],
  jobSearch: ["job-search-matcher"],
  coverLetter: ["cover-letter-generator"],
  coldEmail: ["cold-email-writer"],
  interviewPrep: ["interview-prep-generator"],
  salaryNegotiation: ["salary-negotiation-prep"],
  offerComparison: ["offer-comparison-analyzer"],
  applicationForm: ["application-form-filler"],
  linkedin: ["linkedin-profile-optimizer"],
  referenceList: ["reference-list-builder"],
  portfolioCaseStudy: ["portfolio-case-study-writer"],
  versionManagement: ["resume-version-manager"],
  tracker: ["application-tracker"],
};
