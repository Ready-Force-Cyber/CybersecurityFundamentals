export type QuestionType = 'mcq';

/** Concept ids, kept in sync with CONCEPTS in components/SoloMap.tsx. */
export type ConceptId =
  | 'art_of_defending'
  | 'confidentiality'
  | 'integrity'
  | 'availability'
  | 'authentication';

/**
 * External framework alignment for a question.
 *
 * These are recorded at DOMAIN / CATEGORY level, not at individual objective
 * level. Domain-level mapping is defensible for an introductory module and is
 * what a district or funder usually asks for ("which Security+ domains does
 * this cover?"). If you need objective-level citations (e.g. Security+ 4.6, or
 * NICE TKS statement ids), have a curriculum SME add them — do not infer them.
 */
export interface QuestionStandards {
  // Workforce anchor — what the content leads to.
  /** CompTIA Security+ SY0-701 domains, e.g. "1.0 General Security Concepts". */
  securityPlus?: string[];
  /** NICE Framework workforce categories, e.g. "Protection and Defense". */
  nice?: string[];

  // Student-learning anchor — what a classroom lesson must meet. Project AIDE
  // requires both anchors on every lesson (K-12 Student-Standards Crosswalk).
  /** CYBER.ORG / CISA K-12 Cybersecurity Learning Standards strands, e.g. "Security". */
  cyberOrg?: string[];
  /** CSTA K-12 Computer Science Standards identifiers, e.g. "2-NI-05". */
  csta?: string[];
  /** ISTE Standards for Students, e.g. "1.2 Digital Citizen". */
  iste?: string[];
}

export interface Question {
  id: string;
  /**
   * Which of the five core concepts this question belongs to. The solo
   * campaign filters on this, so questions can be added to any concept in any
   * order without disturbing the others.
   */
  concept: ConceptId;
  type: QuestionType;
  question: string;
  imageUrl?: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** Optional framework alignment, shown to learners and summarised for staff. */
  standards?: QuestionStandards;
}
