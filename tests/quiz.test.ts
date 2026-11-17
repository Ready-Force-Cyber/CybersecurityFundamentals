import { describe, it, expect } from "vitest";
import {
  toPublicQuestion,
  gradeAnswer,
  revealAnswer,
  selectQuizQuestions,
  scoreQuizAnswer,
  seededRng,
  shuffled,
  QUIZ_BASE_POINTS,
  QUIZ_SPEED_BONUS_PER_SECOND,
  QUIZ_ANSWER_GRACE_MS,
} from "../src/lib/quiz";
import { CYBER_QUESTIONS } from "../src/server-data/question-bank";

describe("toPublicQuestion", () => {
  it("removes the answer key from every question in the bank", () => {
    for (const q of CYBER_QUESTIONS) {
      const pub = toPublicQuestion(q);
      expect(pub).not.toHaveProperty("correctAnswer");
      expect(pub).not.toHaveProperty("explanation");
      expect(JSON.stringify(pub)).not.toContain(q.explanation);
    }
  });

  it("keeps everything a student needs to see the question", () => {
    const q = CYBER_QUESTIONS[0];
    const pub = toPublicQuestion(q);
    expect(pub).toMatchObject({ id: q.id, question: q.question, concept: q.concept, difficulty: q.difficulty });
    expect([...(pub.options ?? [])].sort()).toEqual([...(q.options ?? [])].sort());
  });

  it("does not modify the stored question", () => {
    const q = CYBER_QUESTIONS[0];
    const before = JSON.stringify(q);
    toPublicQuestion(q, "seed");
    expect(JSON.stringify(q)).toBe(before);
  });

  // The bank is authored with the correct answer first. Served in stored
  // order, the answer to every question would be "the first one".
  it("does not leave the correct answer in the first position", () => {
    const stored = CYBER_QUESTIONS.filter((q) => q.options?.[0] === q.correctAnswer).length;
    expect(stored).toBe(CYBER_QUESTIONS.length); // the hazard this guards against

    let first = 0;
    let total = 0;
    for (let round = 0; round < 40; round++) {
      for (const q of CYBER_QUESTIONS) {
        const pub = toPublicQuestion(q, `player-${round}:${q.id}`);
        if (pub.options?.[0] === q.correctAnswer) first++;
        total++;
      }
    }
    // Four options, so about a quarter. Anything near 100% means no shuffle.
    expect(first / total).toBeGreaterThan(0.1);
    expect(first / total).toBeLessThan(0.45);
  });

  it("gives the same order for the same seed, so polling does not reshuffle", () => {
    const q = CYBER_QUESTIONS[3];
    expect(toPublicQuestion(q, "room:q").options).toEqual(toPublicQuestion(q, "room:q").options);
  });

  it("gives different students different orders", () => {
    const q = CYBER_QUESTIONS[3];
    const orders = new Set(
      Array.from({ length: 20 }, (_, i) => toPublicQuestion(q, `student-${i}:${q.id}`).options!.join("|")),
    );
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("gradeAnswer", () => {
  const q = CYBER_QUESTIONS[0];

  it("accepts the correct answer, ignoring case and surrounding space", () => {
    expect(gradeAnswer(q, q.correctAnswer)).toBe(true);
    expect(gradeAnswer(q, `  ${q.correctAnswer.toUpperCase()}  `)).toBe(true);
  });

  it("rejects wrong, empty and non-string answers", () => {
    expect(gradeAnswer(q, "wrong")).toBe(false);
    expect(gradeAnswer(q, "")).toBe(false);
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(gradeAnswer(q, bad)).toBe(false);
    }
  });

  // An instructor can save a malformed question; grading must not crash.
  it("treats a question with no usable answer as never correct", () => {
    const broken = { ...q, correctAnswer: undefined } as any;
    expect(gradeAnswer(broken, "anything")).toBe(false);
    expect(gradeAnswer({ ...q, correctAnswer: "" } as any, "")).toBe(false);
    expect(revealAnswer(broken, "x")).toEqual({ correct: false, correctAnswer: "", explanation: q.explanation });
  });
});

describe("selectQuizQuestions", () => {
  it("returns the requested number of distinct questions", () => {
    const picked = selectQuizQuestions(CYBER_QUESTIONS, "all", 5);
    expect(picked).toHaveLength(5);
    expect(new Set(picked.map((q) => q.id)).size).toBe(5);
  });

  it("filters by difficulty", () => {
    const picked = selectQuizQuestions(CYBER_QUESTIONS, "hard", 50);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.every((q) => q.difficulty === "hard")).toBe(true);
  });

  it("never returns more than the bank holds", () => {
    expect(selectQuizQuestions(CYBER_QUESTIONS, "all", 999)).toHaveLength(CYBER_QUESTIONS.length);
  });

  it("falls back to ten for a nonsense count", () => {
    expect(selectQuizQuestions(CYBER_QUESTIONS, "all", Number.NaN)).toHaveLength(10);
  });

  it("is reproducible with a seeded generator", () => {
    const a = selectQuizQuestions(CYBER_QUESTIONS, "all", 6, seededRng("x")).map((q) => q.id);
    const b = selectQuizQuestions(CYBER_QUESTIONS, "all", 6, seededRng("x")).map((q) => q.id);
    expect(a).toEqual(b);
  });
});

describe("scoreQuizAnswer", () => {
  it("adds a speed bonus for each second left on the clock", () => {
    expect(scoreQuizAnswer(true, 20, 0).points).toBe(QUIZ_BASE_POINTS + 20 * QUIZ_SPEED_BONUS_PER_SECOND);
    expect(scoreQuizAnswer(true, 20, 5_000).points).toBe(QUIZ_BASE_POINTS + 15 * QUIZ_SPEED_BONUS_PER_SECOND);
  });

  // The student's countdown shows whole seconds; a few hundred milliseconds
  // of network delay must not cost them the second they saw on screen.
  it("matches the countdown the student saw despite network delay", () => {
    expect(scoreQuizAnswer(true, 20, 5_300).points).toBe(QUIZ_BASE_POINTS + 15 * QUIZ_SPEED_BONUS_PER_SECOND);
  });

  it("gives base points only at the buzzer and within the grace period", () => {
    expect(scoreQuizAnswer(true, 20, 20_000)).toMatchObject({ points: QUIZ_BASE_POINTS, timedOut: false });
    expect(scoreQuizAnswer(true, 20, 20_000 + QUIZ_ANSWER_GRACE_MS)).toMatchObject({
      points: QUIZ_BASE_POINTS,
      timedOut: false,
    });
  });

  it("times out a correct answer that arrives after the grace period", () => {
    expect(scoreQuizAnswer(true, 20, 20_000 + QUIZ_ANSWER_GRACE_MS + 1)).toMatchObject({
      points: 0,
      timedOut: true,
    });
  });

  it("gives nothing for a wrong answer however fast", () => {
    expect(scoreQuizAnswer(false, 20, 0).points).toBe(0);
  });

  it("gives base points and never times out when untimed", () => {
    expect(scoreQuizAnswer(true, 0, 60 * 60_000)).toEqual({ points: QUIZ_BASE_POINTS, timedOut: false, timeTaken: 0 });
  });

  // No client-supplied number can lift a score above a perfect, instant run.
  it("can never award more than the fastest possible correct answer", () => {
    for (const elapsed of [-5_000, -1, 0]) {
      expect(scoreQuizAnswer(true, 20, elapsed).points).toBe(QUIZ_BASE_POINTS + 20 * QUIZ_SPEED_BONUS_PER_SECOND);
    }
  });
});

describe("shuffled", () => {
  it("keeps every item exactly once and leaves the input alone", () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = shuffled(input, seededRng("s"));
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
