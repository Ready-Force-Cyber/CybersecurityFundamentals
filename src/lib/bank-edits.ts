import type { ConceptId, Question, QuestionStandards } from "../constants";

// Adding, editing and removing questions in the bank. Both runtimes (the
// Express server and the Cloudflare Worker) use these, so the rules are the
// same everywhere, and the server checks every question before saving it.
//
// The checks matter: the bank is the answer key. A question saved without a
// correct answer can never be graded right, and before these existed the admin
// screen could save the student copy of the bank (answers stripped) over the
// real one.

export const MAX_BANK_SIZE = 500;

export const CONCEPT_IDS: ConceptId[] = [
  "art_of_defending",
  "confidentiality",
  "integrity",
  "availability",
  "authentication",
];

export const QUESTION_DIFFICULTIES = ["easy", "medium", "hard"] as const;

export const QUESTION_LIMITS = {
  question: 500,
  option: 200,
  explanation: 1000,
  minOptions: 2,
  maxOptions: 6,
} as const;

export type BankResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: 400 | 404 };

const fail = (error: string, status: 400 | 404 = 400): { ok: false; error: string; status: 400 | 404 } => ({
  ok: false,
  error,
  status,
});

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
/** An answer option: trimmed, with runs of spaces collapsed. */
const optionText = (v: unknown): string => text(v).replace(/\s+/g, " ");

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function cleanStandards(raw: unknown): QuestionStandards | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: QuestionStandards = {};
  for (const key of ["securityPlus", "nice", "cyberOrg", "csta", "iste"] as const) {
    const list = (raw as Record<string, unknown>)[key];
    if (Array.isArray(list)) {
      const items = list.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
      if (items.length) out[key] = items;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Check one question and return a clean copy, or say what to fix in words an
 * instructor can act on. The id is kept only if it is well formed; callers
 * that add a question assign a fresh one.
 */
export function validateQuestion(raw: unknown): BankResult<Question> {
  if (!raw || typeof raw !== "object") return fail("Expected a question.");
  const r = raw as Record<string, unknown>;

  const question = text(r.question);
  if (!question) return fail("Write the question text.");
  if (question.length > QUESTION_LIMITS.question) {
    return fail(`Keep the question under ${QUESTION_LIMITS.question} characters.`);
  }

  if (!CONCEPT_IDS.includes(r.concept as ConceptId)) return fail("Pick one of the five concepts.");
  if (!QUESTION_DIFFICULTIES.includes(r.difficulty as (typeof QUESTION_DIFFICULTIES)[number])) {
    return fail("Pick a difficulty: easy, medium or hard.");
  }

  const options = (Array.isArray(r.options) ? r.options : []).map(optionText).filter(Boolean);
  if (options.length < QUESTION_LIMITS.minOptions) return fail("Give at least two answer options.");
  if (options.length > QUESTION_LIMITS.maxOptions) {
    return fail(`Use at most ${QUESTION_LIMITS.maxOptions} answer options.`);
  }
  if (options.some((o) => o.length > QUESTION_LIMITS.option)) {
    return fail(`Keep each option under ${QUESTION_LIMITS.option} characters.`);
  }
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    return fail("Each answer option must be different.");
  }

  const correctAnswer = optionText(r.correctAnswer);
  if (!options.includes(correctAnswer)) return fail("Mark which option is the correct answer.");

  const explanation = text(r.explanation);
  if (!explanation) return fail("Add an explanation. Students see it after they answer.");
  if (explanation.length > QUESTION_LIMITS.explanation) {
    return fail(`Keep the explanation under ${QUESTION_LIMITS.explanation} characters.`);
  }

  const imageUrl = text(r.imageUrl);
  if (imageUrl) {
    let ok = false;
    try {
      ok = new URL(imageUrl).protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) return fail("The image link must be a full https:// address, or left blank.");
  }

  const id = typeof r.id === "string" && ID_PATTERN.test(r.id) ? r.id : "";
  const standards = cleanStandards(r.standards);

  return {
    ok: true,
    value: {
      id,
      concept: r.concept as ConceptId,
      type: "mcq",
      question,
      options,
      correctAnswer,
      explanation,
      difficulty: r.difficulty as Question["difficulty"],
      ...(imageUrl ? { imageUrl } : {}),
      ...(standards ? { standards } : {}),
    },
  };
}

/** A short id no question in the bank already uses. */
export function newQuestionId(bank: { id: string }[], random: () => number = Math.random): string {
  const taken = new Set(bank.map((q) => q.id));
  for (;;) {
    const id = `q-${Math.floor(random() * 36 ** 8).toString(36).padStart(8, "0")}`;
    if (!taken.has(id)) return id;
  }
}

/** Add one question with a fresh id, at the end of the bank. */
export function addQuestion(
  bank: Question[],
  raw: unknown,
  random?: () => number,
): BankResult<{ bank: Question[]; question: Question }> {
  if (bank.length >= MAX_BANK_SIZE) {
    return fail(`The bank is full (${MAX_BANK_SIZE} questions). Remove one before adding another.`);
  }
  const checked = validateQuestion(raw);
  if (!checked.ok) return checked;
  const question = { ...checked.value, id: newQuestionId(bank, random) };
  return { ok: true, value: { bank: [...bank, question], question } };
}

/** Replace one question, keeping its id and its place in the bank. */
export function updateQuestion(
  bank: Question[],
  id: string,
  raw: unknown,
): BankResult<{ bank: Question[]; question: Question }> {
  const index = bank.findIndex((q) => q.id === id);
  if (index < 0) return fail("That question no longer exists. It may have been removed.", 404);
  const checked = validateQuestion(raw);
  if (!checked.ok) return checked;
  const question = { ...checked.value, id };
  const next = [...bank];
  next[index] = question;
  return { ok: true, value: { bank: next, question } };
}

/** Remove one question by id. */
export function removeQuestion(
  bank: Question[],
  id: string,
): BankResult<{ bank: Question[]; question: Question }> {
  const question = bank.find((q) => q.id === id);
  if (!question) return fail("That question no longer exists. It may have been removed already.", 404);
  return { ok: true, value: { bank: bank.filter((q) => q.id !== id), question } };
}

/**
 * Check a whole bank before replacing the stored one. Every question must
 * pass; ids that are missing or repeated are replaced with fresh ones.
 */
export function validateBank(raw: unknown, random?: () => number): BankResult<Question[]> {
  if (!Array.isArray(raw)) return fail("Expected an array of questions.");
  if (raw.length > MAX_BANK_SIZE) return fail(`A bank can hold at most ${MAX_BANK_SIZE} questions.`);
  const out: Question[] = [];
  const seen = new Set<string>();
  // Every id anywhere in the input, so a fresh id can't collide with a later one.
  const rawIds = raw.map((x) => ({
    id: x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string" ? (x as { id: string }).id : "",
  }));
  for (let i = 0; i < raw.length; i++) {
    const checked = validateQuestion(raw[i]);
    if (!checked.ok) return fail(`Question ${i + 1}: ${checked.error}`);
    let id = checked.value.id;
    if (!id || seen.has(id)) id = newQuestionId([...out, ...rawIds], random);
    seen.add(id);
    out.push({ ...checked.value, id });
  }
  return { ok: true, value: out };
}
