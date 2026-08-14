// Skill loading, from the build-time bundle rather than disk.
//
// The Express version did fs.readFileSync(SKILL.md) per request. Workers have
// no filesystem, so scripts/build-skills.mjs inlines the 24 skills into
// src/skills.generated.js and this module reads from there.

import { SKILLS, SKILL_NAMES } from "../skills.generated.js";

export function loadSkill(name) {
  const skill = SKILLS[name];
  if (!skill) console.warn(`[skills] missing skill: ${name}`);
  return skill || null;
}

export function listSkills() {
  return SKILL_NAMES;
}

/**
 * Concatenate the named skills' full instructions.
 *
 * The output goes in the *cached* half of the system prompt (see
 * lib/anthropic.js), so it must stay byte-identical across turns -- never
 * interpolate a CV, a timestamp, or anything else per-request in here.
 */
export function buildSkillPrompt(names) {
  return names
    .map(loadSkill)
    .filter(Boolean)
    .map((s) => `## Skill: ${s.name}\n${s.description}\n\n${s.body}`)
    .join("\n\n---\n\n");
}

/** Name + one-line description for every skill. Cheap enough to always send. */
export function skillIndex() {
  return SKILL_NAMES.map((n) => `- ${n}: ${SKILLS[n].description}`).join("\n");
}

// Which skills apply to each task. One place to look when adding a skill or
// changing what fires for what.
export const SKILL_ROUTES = {
  optimizeNoJobPost: [
    "resume-formatter",
    "resume-bullet-writer",
    "resume-quantifier",
    "resume-section-builder",
    "resume-ats-optimizer",
  ],
  tailorToJobPost: [
    "job-description-analyzer",
    "resume-tailor",
    "resume-ats-optimizer",
    "resume-bullet-writer",
  ],
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

export const FLAVOR_SKILLS = {
  tech: SKILL_ROUTES.tailorTech,
  executive: SKILL_ROUTES.tailorExecutive,
  academic: SKILL_ROUTES.tailorAcademic,
  creative: SKILL_ROUTES.tailorCreative,
  careerChange: SKILL_ROUTES.tailorCareerChange,
};
