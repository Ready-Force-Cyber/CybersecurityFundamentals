import { describe, it, expect } from "vitest";
import {
  addQuestion,
  updateQuestion,
  removeQuestion,
  validateBank,
  validateQuestion,
  newQuestionId,
  MAX_BANK_SIZE,
} from "../src/lib/bank-edits";
import { CYBER_QUESTIONS } from "../src/server-data/question-bank";
import { toPublicQuestion } from "../src/lib/quiz";
import type { Question } from "../src/constants";

const good = {
  concept: "authentication",
  difficulty: "easy",
  question: "  Which of these is the strongest way to sign in? ",
  options: ["A password", "  A password  plus a code from an app ", "A security question", "A PIN"],
  correctAnswer: "A password plus a code from an app",
  explanation: "Two different factors are much harder to steal together.",
};

const bank = (): Question[] => CYBER_QUESTIONS.map((q) => ({ ...q }));

describe("validateQuestion", () => {
  it("accepts every built-in question, so any of them can be edited and saved", () => {
    for (const q of CYBER_QUESTIONS) {
      const r = validateQuestion(q);
      expect(r.ok, `${q.id}: ${!r.ok ? r.error : ""}`).toBe(true);
    }
  });

  it("returns a tidied copy", () => {
    const r = validateQuestion(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.question).toBe("Which of these is the strongest way to sign in?");
    expect(r.value.options).toContain("A password plus a code from an app");
    expect(r.value.correctAnswer).toBe("A password plus a code from an app");
    expect(r.value.type).toBe("mcq");
  });

  // The bug this guards against: the admin screen once held the student copy
  // of the bank (no answers) and saved it over the real one.
  it("refuses the student copy of a question, which has no answer", () => {
    const r = validateQuestion(toPublicQuestion(CYBER_QUESTIONS[0]));
    expect(r.ok).toBe(false);
  });

  it.each([
    [{ ...good, question: " " }, /question text/],
    [{ ...good, concept: "phishing" }, /five concepts/],
    [{ ...good, difficulty: "extreme" }, /difficulty/],
    [{ ...good, options: ["Only one", ""] }, /at least two/],
    [{ ...good, options: ["1", "2", "3", "4", "5", "6", "7"], correctAnswer: "1" }, /at most 6/],
    [{ ...good, options: ["Yes", "yes"], correctAnswer: "Yes" }, /must be different/],
    [{ ...good, correctAnswer: "None of these" }, /correct answer/],
    [{ ...good, correctAnswer: "" }, /correct answer/],
    [{ ...good, explanation: "" }, /explanation/],
    [{ ...good, imageUrl: "javascript:alert(1)" }, /https/],
    [{ ...good, imageUrl: "http://example.com/a.png" }, /https/],
  ])("explains what to fix: %#", (raw, message) => {
    const r = validateQuestion(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("keeps an https image link", () => {
    const r = validateQuestion({ ...good, imageUrl: "https://example.com/a.png" });
    expect(r.ok && r.value.imageUrl).toBe("https://example.com/a.png");
  });
});

describe("addQuestion", () => {
  it("adds the question with a fresh id that no other question uses", () => {
    const before = bank();
    const r = addQuestion(before, { ...good, id: before[0].id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.bank).toHaveLength(before.length + 1);
    expect(r.value.question.id).not.toBe(before[0].id);
    expect(new Set(r.value.bank.map((q) => q.id)).size).toBe(r.value.bank.length);
    expect(before).toHaveLength(CYBER_QUESTIONS.length); // the input is not changed
  });

  it("refuses an invalid question and leaves the bank alone", () => {
    const r = addQuestion(bank(), { ...good, correctAnswer: "nope" });
    expect(r.ok).toBe(false);
  });

  it("refuses when the bank is full", () => {
    const full = Array.from({ length: MAX_BANK_SIZE }, (_, i) => ({ ...CYBER_QUESTIONS[0], id: `x${i}` }));
    const r = addQuestion(full, good);
    expect(r.ok).toBe(false);
  });
});

describe("updateQuestion", () => {
  it("replaces the question in place and keeps its id", () => {
    const before = bank();
    const target = before[2];
    const r = updateQuestion(before, target.id, { ...good, id: "something-else" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.bank[2].id).toBe(target.id);
    expect(r.value.bank[2].question).toBe("Which of these is the strongest way to sign in?");
    expect(r.value.bank).toHaveLength(before.length);
  });

  it("says when the question no longer exists", () => {
    const r = updateQuestion(bank(), "missing", good);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});

describe("removeQuestion", () => {
  it("removes just that question", () => {
    const before = bank();
    const r = removeQuestion(before, before[0].id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.bank).toHaveLength(before.length - 1);
    expect(r.value.bank.some((q) => q.id === before[0].id)).toBe(false);
  });

  it("says when the question is already gone", () => {
    const r = removeQuestion(bank(), "missing");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});

describe("validateBank", () => {
  it("accepts the built-in bank unchanged", () => {
    const r = validateBank(bank());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((q) => q.id)).toEqual(CYBER_QUESTIONS.map((q) => q.id));
  });

  it("refuses the student copy of the bank", () => {
    const r = validateBank(CYBER_QUESTIONS.map((q) => toPublicQuestion(q)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Question 1:/);
  });

  it("gives missing or repeated ids fresh ones", () => {
    const r = validateBank([{ ...good, id: "same" }, { ...good, id: "same" }, { ...good }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.value.map((q) => q.id);
    expect(ids[0]).toBe("same");
    expect(new Set(ids).size).toBe(3);
  });

  it("accepts an empty bank", () => {
    expect(validateBank([]).ok).toBe(true);
  });

  it("refuses something that isn't a list", () => {
    expect(validateBank({}).ok).toBe(false);
  });
});

describe("newQuestionId", () => {
  it("skips ids already taken", () => {
    const values = [0, 0, 0.5];
    const random = () => values.shift() ?? 0.9;
    const id = newQuestionId([{ id: "q-00000000" }], random);
    expect(id).not.toBe("q-00000000");
  });
});
