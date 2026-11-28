import type { CloseCallView } from "./closecall";

// Client for the app server's session API. Replaces direct Firestore access,
// so the host/join/play loop runs without any Firebase security rules.

const INSTRUCTOR_TOKEN_KEY = "rfc_instructor_token";

export const getInstructorToken = () => sessionStorage.getItem(INSTRUCTOR_TOKEN_KEY);
export const setInstructorToken = (t: string) => sessionStorage.setItem(INSTRUCTOR_TOKEN_KEY, t);
export const clearInstructorToken = () => sessionStorage.removeItem(INSTRUCTOR_TOKEN_KEY);

export interface RoomPlayer {
  id: string;
  name: string;
  score: number;
}
/** A question as sent to clients — deliberately without the answer key. */
export interface PublicQuestion {
  id: string;
  question: string;
  options?: string[];
  concept?: string;
  difficulty?: string;
  type?: string;
  imageUrl?: string;
}

/** What the server reveals once an answer has been graded. */
export interface AnswerReveal {
  correct: boolean;
  correctAnswer: string;
  explanation: string;
}

/** The server's reply when a live-quiz player asks for their question. */
export type QuizNext =
  | { done: true; total: number; score: number }
  | {
      done: false;
      index: number;
      total: number;
      question: PublicQuestion;
      /** How long this question has already been on the player's clock. */
      elapsedMs: number;
      score: number;
    };

export interface GameShowView {
  teams: { id: string; name: string; color: string; score: number }[];
  turnIndex: number;
  phase: "idle" | "question" | "resolved" | "final";
  spin: { id: string; kind: string; value: number; label: string } | null;
  questionId: string | null;
  question: PublicQuestion | null;
  doubleNext: boolean;
  lastOutcome: string | null;
  turnsTaken: number;
  turnLimit: number;
}

export interface RoomState {
  code: string;
  status: "waiting" | "started" | "finished";
  mode?: "quiz" | "gameshow" | "closecall";
  difficulty: string;
  questionCount: number;
  timePerQuestion: number;
  endTime: number;
  hostName: string;
  players: RoomPlayer[];
  gameshow?: GameShowView;
  /** Close Call: the round in play, without its answer until revealed. */
  closecall?: CloseCallView;
}

async function req(path: string, options: RequestInit = {}, auth = false) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (auth) {
    const token = getInstructorToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(path, { ...options, headers });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return body;
}

export const api = {
  login: (password: string): Promise<{ token: string }> =>
    req("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),

  // Sends the instructor token when there is one: students get the bank
  // without answers, a signed-in instructor gets the full records to edit.
  getQuestions: (): Promise<{ questions: any[] }> => req("/api/questions", {}, true),

  /** Grade one solo-practice answer on the server. Nothing is recorded. */
  checkAnswer: (questionId: string, answer: string): Promise<AnswerReveal> =>
    req("/api/questions/check", { method: "POST", body: JSON.stringify({ questionId, answer }) }),

  /** Restore the built-in question bank (instructor only). */
  resetQuestions: (): Promise<{ questions: any[] }> =>
    req("/api/questions/reset", { method: "POST", body: "{}" }, true),

  /** Replace the whole bank (instructor only). The server checks every question first. */
  replaceQuestions: (questions: unknown[]): Promise<{ questions: any[] }> =>
    req("/api/questions", { method: "PUT", body: JSON.stringify({ questions }) }, true),

  /** Add one question (instructor only). Returns it with its new id, and the bank. */
  addQuestion: (question: unknown): Promise<{ question: any; questions: any[] }> =>
    req("/api/questions", { method: "POST", body: JSON.stringify({ question }) }, true),

  /** Replace one question (instructor only). */
  updateQuestion: (id: string, question: unknown): Promise<{ question: any; questions: any[] }> =>
    req(`/api/questions/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ question }) }, true),

  /** Remove one question (instructor only). */
  deleteQuestion: (id: string): Promise<{ question: any; questions: any[] }> =>
    req(`/api/questions/${encodeURIComponent(id)}`, { method: "DELETE" }, true),

  createSession: (settings: {
    difficulty: string;
    questionCount: number;
    timePerQuestion: number;
    hostName?: string;
    mode?: "quiz" | "gameshow" | "closecall";
    teamCount?: number;
    rounds?: number;
  }): Promise<{ code: string }> =>
    req("/api/session", { method: "POST", body: JSON.stringify(settings) }, true),

  // ---- Game show -------------------------------------------------------
  /** Host spins the wheel for the active team. */
  spin: (code: string): Promise<RoomState> =>
    req(`/api/session/${code}/spin`, { method: "POST", body: "{}" }, true),

  /** Host hands play to the next team. */
  nextTurn: (code: string): Promise<RoomState> =>
    req(`/api/session/${code}/next-turn`, { method: "POST", body: "{}" }, true),

  /** A player on the active team answers the question in play. */
  answerGameShow: (
    code: string,
    playerId: string,
    playerToken: string,
    answer: string,
  ): Promise<{ correct: boolean; correctAnswer: string; room: RoomState }> =>
    req(`/api/session/${code}/answer`, {
      method: "POST",
      body: JSON.stringify({ playerId, playerToken, answer }),
    }),

  // ---- Close Call -------------------------------------------------------
  /** A player locks in (or changes) their guess for the round in play. */
  closeCallGuess: (
    code: string,
    playerId: string,
    playerToken: string,
    guess: number,
  ): Promise<{ guess: number; room: RoomState }> =>
    req(`/api/session/${code}/closecall/guess`, {
      method: "POST",
      body: JSON.stringify({ playerId, playerToken, guess }),
    }),

  /** Host closes guessing and reveals the answer. */
  closeCallReveal: (code: string): Promise<RoomState> =>
    req(`/api/session/${code}/closecall/reveal`, { method: "POST", body: "{}" }, true),

  /** Host moves to the next item (or ends the game after the last). */
  closeCallNext: (code: string): Promise<RoomState> =>
    req(`/api/session/${code}/closecall/next`, { method: "POST", body: "{}" }, true),

  /** A student leaves before the session starts (e.g. they joined the wrong class). */
  leaveSession: (code: string, playerId: string, playerToken: string): Promise<{ ok: true }> =>
    req(`/api/session/${code}/leave`, { method: "POST", body: JSON.stringify({ playerId, playerToken }) }),

  listSessions: (): Promise<{ sessions: any[] }> => req("/api/sessions", {}, true),

  getRoom: (code: string): Promise<RoomState> => req(`/api/session/${code}`),

  joinSession: (
    code: string,
    name: string,
  ): Promise<{ playerId: string; playerToken: string; room: RoomState }> =>
    req(`/api/session/${code}/join`, { method: "POST", body: JSON.stringify({ name }) }),

  updateSettings: (
    code: string,
    settings: { difficulty?: string; questionCount?: number; timePerQuestion?: number },
  ): Promise<RoomState> =>
    req(`/api/session/${code}/settings`, { method: "POST", body: JSON.stringify(settings) }, true),

  startSession: (code: string, durationMinutes: number): Promise<{ endTime: number }> =>
    req(`/api/session/${code}/start`, { method: "POST", body: JSON.stringify({ durationMinutes }) }, true),

  endSession: (code: string): Promise<{ ok: true }> =>
    req(`/api/session/${code}/end`, { method: "POST", body: "{}" }, true),

  deleteSession: (code: string): Promise<{ ok: true }> =>
    req(`/api/session/${code}`, { method: "DELETE" }, true),

  // ---- Live quiz --------------------------------------------------------
  /** Ask the server for this player's current question; starts its clock. */
  quizNext: (code: string, playerId: string, playerToken: string): Promise<QuizNext> =>
    req(`/api/session/${code}/quiz/next`, {
      method: "POST",
      body: JSON.stringify({ playerId, playerToken }),
    }),

  /** Send this player's answer to be graded and scored by the server. */
  quizAnswer: (
    code: string,
    playerId: string,
    playerToken: string,
    answer: string,
  ): Promise<AnswerReveal & { timedOut: boolean; awarded: number; score: number; done: boolean }> =>
    req(`/api/session/${code}/quiz/answer`, {
      method: "POST",
      body: JSON.stringify({ playerId, playerToken, answer }),
    }),

  getMetrics: (): Promise<any> => req("/api/metrics", {}, true),

  analyzeMetrics: (metrics: any): Promise<{ suggestions: { title: string; description: string }[] }> =>
    req("/api/metrics/analyze", { method: "POST", body: JSON.stringify({ metrics }) }, true),
};
