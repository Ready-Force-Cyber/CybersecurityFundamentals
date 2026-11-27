import type { Question } from "../constants";

// Server-side question serving and grading, shared by both runtimes (the Node
// server and the Cloudflare Worker / RoomDO).
//
// The rule this module exists to enforce: the answer key never reaches a
// student's browser before they have answered. Questions go out stripped of
// `correctAnswer` and `explanation`, answers come back to be graded here, and
// scores are computed here rather than reported by the client.

/** A question as a student sees it: no answer key. */
export type PublicQuestion = Omit<Question, "correctAnswer" | "explanation">;

/** What a student is told once they have answered. */
export interface AnswerReveal {
  correct: boolean;
  correctAnswer: string;
  explanation: string;
}

// ---- Deterministic shuffling ------------------------------------------------

/** Small seeded PRNG (mulberry32 over a string hash); returns values in [0,1). */
export function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates on a copy; the input is left untouched. */
export function shuffled<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Strip the answer key and shuffle the options.
 *
 * The shuffle matters as much as the strip: the bank is authored with the
 * correct answer first, so serving options in stored order gives the answer
 * away by position. Pass a `seed` where the same question must come back in
 * the same order every time (a question on screen that is re-fetched by
 * polling); omit it for a fresh order per call.
 */
export function toPublicQuestion(q: Question, seed?: string): PublicQuestion {
  const { correctAnswer: _answer, explanation: _explanation, ...rest } = q;
  const rng = seed === undefined ? Math.random : seededRng(seed);
  return {
    ...rest,
    options: Array.isArray(q.options) ? shuffled(q.options, rng) : q.options,
  };
}

// ---- Grading ----------------------------------------------------------------

/** Compare an answer to the key. Tolerates a malformed question or answer. */
export function gradeAnswer(q: Question, answer: unknown): boolean {
  if (typeof answer !== "string" || typeof q.correctAnswer !== "string") return false;
  const given = answer.trim().toLowerCase();
  return given !== "" && given === q.correctAnswer.trim().toLowerCase();
}

/** Grade and build the reveal a student is shown afterwards. */
export function revealAnswer(q: Question, answer: unknown): AnswerReveal {
  return {
    correct: gradeAnswer(q, answer),
    correctAnswer: typeof q.correctAnswer === "string" ? q.correctAnswer : "",
    explanation: typeof q.explanation === "string" ? q.explanation : "",
  };
}

// ---- Live quiz --------------------------------------------------------------

export const QUIZ_BASE_POINTS = 100;
export const QUIZ_SPEED_BONUS_PER_SECOND = 5;
/**
 * Slack allowed past the clock before an answer counts as timed out. It
 * absorbs network latency, so a student who answers at the buzzer on a slow
 * connection is not marked wrong for the round trip.
 */
export const QUIZ_ANSWER_GRACE_MS = 3000;

/**
 * Choose and order the questions for a live quiz. Done once, on the server,
 * when the session starts — so every student gets the same set and no client
 * decides what it is asked.
 */
export function selectQuizQuestions(
  bank: readonly Question[],
  difficulty: string,
  count: number,
  rng: () => number = Math.random,
): Question[] {
  const pool = difficulty === "all" ? bank : bank.filter((q) => q.difficulty === difficulty);
  const n = Math.max(1, Math.floor(count) || 10);
  return shuffled(pool, rng).slice(0, n);
}

/**
 * Points for one answer, from the server's own clock.
 *
 * `timePerQuestion` of 0 is the untimed accommodation: base points only and
 * no timeout, so a speed bonus cannot penalise extended time.
 */
export function scoreQuizAnswer(
  correct: boolean,
  timePerQuestion: number,
  elapsedMs: number,
): { points: number; timedOut: boolean; timeTaken: number } {
  if (timePerQuestion <= 0) {
    return { points: correct ? QUIZ_BASE_POINTS : 0, timedOut: false, timeTaken: 0 };
  }
  const elapsed = Math.max(0, elapsedMs);
  const limitMs = timePerQuestion * 1000;
  const timedOut = elapsed > limitMs + QUIZ_ANSWER_GRACE_MS;
  // Whole seconds left on the student's countdown when they answered.
  const secondsLeft = Math.max(0, Math.min(timePerQuestion, Math.ceil((limitMs - elapsed) / 1000)));
  const points =
    correct && !timedOut ? QUIZ_BASE_POINTS + secondsLeft * QUIZ_SPEED_BONUS_PER_SECOND : 0;
  return { points, timedOut, timeTaken: Math.min(timePerQuestion, Math.round(elapsed / 1000)) };
}

/** Where one player is in the quiz. */
export interface QuizProgress {
  /** Index into the room's quiz questions of the question in play. */
  index: number;
  /** When that question was first served to this player; null until it is. */
  shownAt: number | null;
}

/** The slice of a player record the quiz reads and updates. */
export interface QuizPlayer {
  id: string;
  score: number;
  history: unknown[];
  quiz?: QuizProgress;
}

/** The slice of a room record the quiz reads. */
export interface QuizRoom {
  status: "waiting" | "started" | "finished";
  mode: "quiz" | "gameshow" | "closecall";
  endTime: number;
  timePerQuestion: number;
  quizQuestions?: Question[];
}

export interface QuizResult {
  status: number;
  body: Record<string, unknown>;
}

const fail = (status: number, error: string): QuizResult => ({ status, body: { error } });

function quizGate(room: QuizRoom, now: number): QuizResult | null {
  if (room.mode !== "quiz") return fail(409, "This session is not a quiz.");
  if (room.status === "waiting") return fail(409, "This session has not started yet.");
  if (room.status === "finished" || (room.endTime > 0 && now > room.endTime + QUIZ_ANSWER_GRACE_MS)) {
    return fail(409, "This session has ended.");
  }
  return null;
}

/**
 * Serve the player's current question and start its clock.
 *
 * Idempotent: asking again for a question already served returns the same
 * question without restarting the clock, so a page reload neither loses the
 * student's place nor buys extra time. The player record is updated in place.
 */
export function serveQuizQuestion(room: QuizRoom, player: QuizPlayer, now: number): QuizResult {
  const blocked = quizGate(room, now);
  if (blocked) return blocked;

  const questions = room.quizQuestions ?? [];
  const progress = (player.quiz ??= { index: 0, shownAt: null });
  if (progress.index >= questions.length) {
    return { status: 200, body: { done: true, total: questions.length, score: player.score } };
  }

  if (progress.shownAt === null) progress.shownAt = now;
  const q = questions[progress.index];
  return {
    status: 200,
    body: {
      done: false,
      index: progress.index,
      total: questions.length,
      // Seeded per player and question: stable across reloads, different
      // between neighbours.
      question: toPublicQuestion(q, `${player.id}:${q.id}`),
      elapsedMs: now - progress.shownAt,
      score: player.score,
    },
  };
}

/**
 * Grade the player's answer to the question they were last served, score it
 * from the server's clock, and move them on. Each question can be answered
 * once. The player record is updated in place.
 */
export function answerQuizQuestion(
  room: QuizRoom,
  player: QuizPlayer,
  answer: unknown,
  now: number,
): QuizResult {
  const blocked = quizGate(room, now);
  if (blocked) return blocked;

  const questions = room.quizQuestions ?? [];
  const progress = player.quiz;
  if (!progress || progress.shownAt === null || progress.index >= questions.length) {
    return fail(409, "There is no question waiting for an answer.");
  }

  const q = questions[progress.index];
  const reveal = revealAnswer(q, answer);
  const { points, timedOut, timeTaken } = scoreQuizAnswer(
    reveal.correct,
    room.timePerQuestion,
    now - progress.shownAt,
  );
  const correct = reveal.correct && !timedOut;

  player.score += points;
  player.history.push({
    question: { id: q.id, question: q.question, concept: q.concept, difficulty: q.difficulty },
    correct,
    timeTaken,
  });
  progress.index += 1;
  progress.shownAt = null;

  return {
    status: 200,
    body: {
      ...reveal,
      correct,
      timedOut,
      awarded: points,
      score: player.score,
      done: progress.index >= questions.length,
    },
  };
}
