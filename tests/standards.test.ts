import { describe, it, expect } from "vitest";
import {
  standardsFor,
  standardsCoverage,
  learnerStandardTags,
  CONCEPT_STANDARDS,
  SECURITY_PLUS_DOMAINS,
  NICE_CATEGORIES,
  CYBER_ORG_STRANDS,
  CSTA_STANDARDS,
  ISTE_STANDARDS,
} from "../src/lib/standards";
import type { Question, ConceptId } from "../src/constants";
import { CYBER_QUESTIONS } from "../src/server-data/question-bank";
import { CONCEPTS } from "../src/components/SoloMap";

function q(over: Partial<Question> = {}): Question {
  return {
    id: "1",
    concept: "integrity" as ConceptId,
    type: "mcq",
    question: "Q?",
    options: ["a", "b"],
    correctAnswer: "a",
    explanation: "e",
    difficulty: "easy",
    ...over,
  };
}

describe("CONCEPT_STANDARDS", () => {
  it("maps every campaign concept", () => {
    for (const c of CONCEPTS) {
      expect(CONCEPT_STANDARDS[c.id as ConceptId], `missing mapping for ${c.id}`).toBeDefined();
    }
  });

  it("gives every concept at least one Security+ domain and NICE category", () => {
    for (const [concept, std] of Object.entries(CONCEPT_STANDARDS)) {
      expect(std.securityPlus?.length, `${concept} securityPlus`).toBeGreaterThan(0);
      expect(std.nice?.length, `${concept} nice`).toBeGreaterThan(0);
    }
  });

  it("only uses the declared domain and category vocabularies", () => {
    const validDomains = Object.values(SECURITY_PLUS_DOMAINS) as string[];
    const validCategories = Object.values(NICE_CATEGORIES) as string[];
    for (const std of Object.values(CONCEPT_STANDARDS)) {
      for (const d of std.securityPlus ?? []) expect(validDomains).toContain(d);
      for (const n of std.nice ?? []) expect(validCategories).toContain(n);
    }
  });
});

describe("standardsFor", () => {
  it("falls back to the concept default", () => {
    expect(standardsFor(q({ concept: "authentication" as ConceptId }))).toEqual(
      CONCEPT_STANDARDS.authentication,
    );
  });

  it("prefers explicit per-question standards over the concept default", () => {
    const custom = { securityPlus: [SECURITY_PLUS_DOMAINS.GOVERNANCE] };
    expect(standardsFor(q({ standards: custom }))).toEqual(custom);
  });

  it("resolves standards for every question in the shipped bank", () => {
    for (const question of CYBER_QUESTIONS) {
      const s = standardsFor(question);
      expect(s.securityPlus?.length, `question ${question.id}`).toBeGreaterThan(0);
      expect(s.nice?.length, `question ${question.id}`).toBeGreaterThan(0);
    }
  });
});

describe("standardsCoverage", () => {
  it("counts questions per standard", () => {
    const coverage = standardsCoverage([
      q({ id: "1", concept: "authentication" as ConceptId }),
      q({ id: "2", concept: "authentication" as ConceptId }),
    ]);
    const ops = coverage.securityPlus.find(
      (r) => r.standard === SECURITY_PLUS_DOMAINS.OPERATIONS,
    );
    expect(ops?.questionCount).toBe(2);
  });

  it("lists the contributing concepts, de-duplicated and sorted", () => {
    const coverage = standardsCoverage([
      q({ id: "1", concept: "availability" as ConceptId }),
      q({ id: "2", concept: "availability" as ConceptId }),
      q({ id: "3", concept: "authentication" as ConceptId }),
    ]);
    const ops = coverage.securityPlus.find(
      (r) => r.standard === SECURITY_PLUS_DOMAINS.OPERATIONS,
    );
    expect(ops?.concepts).toEqual(["authentication", "availability"]);
  });

  it("returns empty reports for an empty bank", () => {
    expect(standardsCoverage([])).toEqual({ securityPlus: [], nice: [], cyberOrg: [], csta: [], iste: [] });
  });

  it("sorts rows by standard for a stable report", () => {
    const rows = standardsCoverage(CYBER_QUESTIONS).securityPlus.map((r) => r.standard);
    expect(rows).toEqual([...rows].sort((a, b) => a.localeCompare(b)));
  });

  it("covers the shipped bank across multiple Security+ domains", () => {
    const coverage = standardsCoverage(CYBER_QUESTIONS);
    expect(coverage.securityPlus.length).toBeGreaterThan(1);
    expect(coverage.nice.length).toBeGreaterThan(0);
    // Every question contributes to at least one domain.
    const totalTagged = coverage.securityPlus.reduce((n, r) => n + r.questionCount, 0);
    expect(totalTagged).toBeGreaterThanOrEqual(CYBER_QUESTIONS.length);
  });
});

// Project AIDE requires two anchors on every lesson: a workforce standard and
// a student-learning standard (K-12 Student-Standards Crosswalk). These pin
// the student anchor, and its values, to the crosswalk's Crosswalk A.
describe("student-learning standards", () => {
  it("gives every concept both anchors", () => {
    for (const [concept, std] of Object.entries(CONCEPT_STANDARDS)) {
      expect(std.nice?.length, `${concept} workforce (NICE)`).toBeGreaterThan(0);
      expect(std.csta?.length, `${concept} CSTA`).toBeGreaterThan(0);
      expect(std.iste?.length, `${concept} ISTE`).toBeGreaterThan(0);
      expect(std.cyberOrg?.length, `${concept} CYBER.ORG`).toBeGreaterThan(0);
    }
  });

  it("only uses the declared student-standard vocabularies", () => {
    const strands = Object.values(CYBER_ORG_STRANDS) as string[];
    const iste = Object.values(ISTE_STANDARDS) as string[];
    for (const std of Object.values(CONCEPT_STANDARDS)) {
      for (const id of std.csta ?? []) expect(Object.keys(CSTA_STANDARDS)).toContain(id);
      for (const x of std.iste ?? []) expect(iste).toContain(x);
      for (const x of std.cyberOrg ?? []) expect(strands).toContain(x);
    }
  });

  it("matches AIDE's Crosswalk A row for each concept", () => {
    const cia = { cyberOrg: ["Security"], csta: ["2-NI-05"], iste: ["1.2 Digital Citizen"] };
    for (const c of ["confidentiality", "integrity", "availability"] as const) {
      expect(CONCEPT_STANDARDS[c]).toMatchObject(cia);
    }
    expect(CONCEPT_STANDARDS.authentication).toMatchObject({
      cyberOrg: ["Security"],
      csta: ["2-NI-05", "3A-NI-06"],
      iste: ["1.2 Digital Citizen"],
    });
    expect(CONCEPT_STANDARDS.art_of_defending).toMatchObject({
      cyberOrg: ["Security"],
      csta: ["3A-NI-05", "3A-NI-07"],
      iste: ["1.2 Digital Citizen", "1.5 Computational Thinker"],
    });
  });

  it("labels CSTA grade bands from the identifier", () => {
    for (const [id, { grades }] of Object.entries(CSTA_STANDARDS)) {
      expect(grades, id).toBe(id.startsWith("2-") ? "6-8" : "9-10");
    }
  });

  it("reports student-standard coverage for the shipped bank", () => {
    const report = standardsCoverage(CYBER_QUESTIONS);
    expect(report.csta.map((r) => r.standard)).toEqual(
      expect.arrayContaining(["2-NI-05", "3A-NI-05", "3A-NI-06", "3A-NI-07"]),
    );
    expect(report.iste.length).toBeGreaterThan(0);
    expect(report.cyberOrg).toEqual([
      { standard: "Security", questionCount: CYBER_QUESTIONS.length, concepts: expect.any(Array) },
    ]);
  });
});

describe("learnerStandardTags", () => {
  it("shows the student anchor first, then the workforce anchor", () => {
    const tags = learnerStandardTags(q({ concept: "authentication" as ConceptId }));
    const anchors = tags.map((t) => t.anchor);
    expect(anchors[0]).toBe("student");
    expect(anchors.lastIndexOf("student")).toBeLessThan(anchors.indexOf("workforce"));
    expect(tags.map((t) => t.label)).toEqual([
      "CSTA 2-NI-05",
      "CSTA 3A-NI-06",
      "ISTE 1.2 Digital Citizen",
      `NICE: ${NICE_CATEGORIES.IMPLEMENTATION}`,
    ]);
  });

  it("explains each CSTA code with its grade band", () => {
    const tag = learnerStandardTags(q({ concept: "integrity" as ConceptId }))[0];
    expect(tag.title).toBe("CSTA 2-NI-05 (grades 6-8): Explain how security measures protect information");
  });

  // Security+ is a professional certification and the CYBER.ORG strand is the
  // same for every concept; both stay in the data, not on the learner's screen.
  it("leaves Security+ and the CYBER.ORG strand off the learner's screen", () => {
    for (const question of CYBER_QUESTIONS) {
      const labels = learnerStandardTags(question).map((t) => t.label).join(" | ");
      expect(labels).not.toMatch(/Security\+|General Security Concepts|^Security$/);
      expect(labels).not.toContain("CYBER.ORG");
    }
  });

  it("still describes a CSTA code it does not know", () => {
    const tags = learnerStandardTags(q({ standards: { csta: ["9Z-XX-99"] } }));
    expect(tags).toEqual([
      { label: "CSTA 9Z-XX-99", title: "CSTA K-12 Computer Science Standard 9Z-XX-99", anchor: "student" },
    ]);
  });
});
