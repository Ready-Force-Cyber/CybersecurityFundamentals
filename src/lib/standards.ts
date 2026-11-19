import type { Question, QuestionStandards, ConceptId } from "../constants";

// Framework alignment for the five core concepts.
//
// Scope note: these are DOMAIN / CATEGORY level mappings, deliberately. They
// answer "which Security+ domains and NICE categories does this module touch?",
// which is the question districts and funders usually ask of an introductory
// course. They are a defensible starting point, not an authoritative
// objective-level crosswalk — a curriculum SME should review them, and add
// objective-level ids (e.g. a specific Security+ sub-objective) if a partner
// requires that granularity.

/** CompTIA Security+ SY0-701 exam domains. */
export const SECURITY_PLUS_DOMAINS = {
  GENERAL: "1.0 General Security Concepts",
  THREATS: "2.0 Threats, Vulnerabilities & Mitigations",
  ARCHITECTURE: "3.0 Security Architecture",
  OPERATIONS: "4.0 Security Operations",
  GOVERNANCE: "5.0 Security Program Management & Oversight",
} as const;

// ---- Student-learning standards ----------------------------------------------
// From Project AIDE's K-12 Student-Standards Crosswalk (Crosswalk A, "Five Core
// Cybersecurity Concepts to Student Standards"). That document gives the
// identifiers as REPRESENTATIVE, from widely used published versions (CSTA
// 2017, ISTE Students, CYBER.ORG 2021): confirm them against the current
// published standards before quoting them to a district, and add the
// participant's state CS / digital-literacy standards where they apply.

/** CYBER.ORG / CISA K-12 Cybersecurity Learning Standards strands. */
export const CYBER_ORG_STRANDS = {
  COMPUTING_SYSTEMS: "Computing Systems",
  DIGITAL_CITIZENSHIP: "Digital Citizenship",
  SECURITY: "Security",
} as const;

/**
 * CSTA K-12 CS Standards used by the crosswalk, with the crosswalk's own short
 * summary of each. These summaries paraphrase; they are not the official text.
 * "2-" identifiers are grades 6-8; "3A-" are grades 9-10.
 */
export const CSTA_STANDARDS: Record<string, { grades: string; summary: string }> = {
  "2-NI-05": { grades: "6-8", summary: "Explain how security measures protect information" },
  "2-NI-06": { grades: "6-8", summary: "Model secure transmission using encryption" },
  "3A-NI-05": { grades: "9-10", summary: "Explain how attacks and malware affect data" },
  "3A-NI-06": { grades: "9-10", summary: "Recommend security measures for scenarios" },
  "3A-NI-07": { grades: "9-10", summary: "Compare security measures" },
};

/** ISTE Standards for Students used by the crosswalk. */
export const ISTE_STANDARDS = {
  DIGITAL_CITIZEN: "1.2 Digital Citizen",
  COMPUTATIONAL_THINKER: "1.5 Computational Thinker",
} as const;

// ---- Workforce standards --------------------------------------------------------

/** NICE Framework (NIST SP 800-181) workforce categories. */
export const NICE_CATEGORIES = {
  PROTECTION: "Protection and Defense",
  IMPLEMENTATION: "Implementation and Operation",
  OVERSIGHT: "Oversight and Governance",
  DESIGN: "Design and Development",
} as const;

// The student-learning rows follow AIDE's Crosswalk A exactly: the CIA triad
// shares one row, Authentication and the Art of Defending each have their own.
const CIA_STUDENT_STANDARDS: QuestionStandards = {
  cyberOrg: [CYBER_ORG_STRANDS.SECURITY],
  csta: ["2-NI-05"],
  iste: [ISTE_STANDARDS.DIGITAL_CITIZEN],
};

/** Default alignment applied to every question in a concept. */
export const CONCEPT_STANDARDS: Record<ConceptId, QuestionStandards> = {
  art_of_defending: {
    securityPlus: [SECURITY_PLUS_DOMAINS.GENERAL, SECURITY_PLUS_DOMAINS.ARCHITECTURE],
    nice: [NICE_CATEGORIES.PROTECTION],
    cyberOrg: [CYBER_ORG_STRANDS.SECURITY],
    csta: ["3A-NI-05", "3A-NI-07"],
    iste: [ISTE_STANDARDS.DIGITAL_CITIZEN, ISTE_STANDARDS.COMPUTATIONAL_THINKER],
  },
  confidentiality: {
    securityPlus: [SECURITY_PLUS_DOMAINS.GENERAL, SECURITY_PLUS_DOMAINS.ARCHITECTURE],
    nice: [NICE_CATEGORIES.PROTECTION],
    ...CIA_STUDENT_STANDARDS,
  },
  integrity: {
    securityPlus: [SECURITY_PLUS_DOMAINS.GENERAL, SECURITY_PLUS_DOMAINS.OPERATIONS],
    nice: [NICE_CATEGORIES.PROTECTION],
    ...CIA_STUDENT_STANDARDS,
  },
  availability: {
    securityPlus: [SECURITY_PLUS_DOMAINS.ARCHITECTURE, SECURITY_PLUS_DOMAINS.OPERATIONS],
    nice: [NICE_CATEGORIES.IMPLEMENTATION],
    ...CIA_STUDENT_STANDARDS,
  },
  authentication: {
    securityPlus: [SECURITY_PLUS_DOMAINS.OPERATIONS, SECURITY_PLUS_DOMAINS.GENERAL],
    nice: [NICE_CATEGORIES.IMPLEMENTATION],
    cyberOrg: [CYBER_ORG_STRANDS.SECURITY],
    csta: ["2-NI-05", "3A-NI-06"],
    iste: [ISTE_STANDARDS.DIGITAL_CITIZEN],
  },
};

/** The alignment for a question: its own tags, else its concept's defaults. */
export function standardsFor(question: Question): QuestionStandards {
  if (question.standards) return question.standards;
  return CONCEPT_STANDARDS[question.concept] ?? {};
}

export interface StandardTag {
  /** Short text for the chip, e.g. "CSTA 2-NI-05". */
  label: string;
  /** Longer description for a tooltip / screen reader. */
  title: string;
  /** Which anchor the tag belongs to. */
  anchor: "student" | "workforce";
}

/**
 * The tags shown to a learner after a question: the student-learning anchor
 * (CSTA, ISTE) first, then the workforce anchor (NICE) — the two anchors
 * Project AIDE asks every lesson to carry.
 *
 * Left out on purpose: the CYBER.ORG strand, which is "Security" for all five
 * concepts and so tells a learner nothing; and Security+, a professional
 * certification that means little in a middle-school class. Both stay in the
 * data and in the instructor's coverage report.
 */
export function learnerStandardTags(question: Question): StandardTag[] {
  const s = standardsFor(question);
  return [
    ...(s.csta ?? []).map((id) => {
      const known = CSTA_STANDARDS[id];
      return {
        label: `CSTA ${id}`,
        title: known
          ? `CSTA ${id} (grades ${known.grades}): ${known.summary}`
          : `CSTA K-12 Computer Science Standard ${id}`,
        anchor: "student" as const,
      };
    }),
    ...(s.iste ?? []).map((name) => ({
      label: `ISTE ${name}`,
      title: `ISTE Standards for Students ${name}`,
      anchor: "student" as const,
    })),
    ...(s.nice ?? []).map((name) => ({
      label: `NICE: ${name}`,
      title: `NICE Workforce Framework category: ${name}`,
      anchor: "workforce" as const,
    })),
  ];
}

export interface CoverageRow {
  standard: string;
  questionCount: number;
  /** Concepts that contribute questions to this standard, sorted. */
  concepts: string[];
}

export interface StandardsCoverage {
  securityPlus: CoverageRow[];
  nice: CoverageRow[];
  cyberOrg: CoverageRow[];
  csta: CoverageRow[];
  iste: CoverageRow[];
}

function rollUp(
  questions: Question[],
  pick: (s: QuestionStandards) => string[] | undefined,
): CoverageRow[] {
  const byStandard = new Map<string, { count: number; concepts: Set<string> }>();

  for (const q of questions) {
    for (const standard of pick(standardsFor(q)) ?? []) {
      let row = byStandard.get(standard);
      if (!row) {
        row = { count: 0, concepts: new Set() };
        byStandard.set(standard, row);
      }
      row.count++;
      row.concepts.add(q.concept);
    }
  }

  return [...byStandard.entries()]
    .map(([standard, { count, concepts }]) => ({
      standard,
      questionCount: count,
      concepts: [...concepts].sort(),
    }))
    // Alphabetical by standard keeps the report stable and readable.
    .sort((a, b) => a.standard.localeCompare(b.standard));
}

/** Coverage report over a question bank, for district / funder reporting. */
export function standardsCoverage(questions: Question[]): StandardsCoverage {
  return {
    securityPlus: rollUp(questions, (s) => s.securityPlus),
    nice: rollUp(questions, (s) => s.nice),
    cyberOrg: rollUp(questions, (s) => s.cyberOrg),
    csta: rollUp(questions, (s) => s.csta),
    iste: rollUp(questions, (s) => s.iste),
  };
}
