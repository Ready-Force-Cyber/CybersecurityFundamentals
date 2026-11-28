import dotenv from "dotenv";
import express from "express";
import path from "path";
import crypto from "crypto";
import helmet from "helmet";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import type { Question } from "./src/constants";
import { CYBER_QUESTIONS } from "./src/server-data/question-bank";
import { computeMetrics } from "./src/lib/metrics";
import { normalizeTimePerQuestion } from "./src/lib/session-settings";
import { normalizeDisplayName } from "./src/lib/display-name";
import { addQuestion, updateQuestion, removeQuestion, validateBank } from "./src/lib/bank-edits";
import {
  type QuizProgress,
  toPublicQuestion,
  gradeAnswer,
  revealAnswer,
  selectQuizQuestions,
  serveQuizQuestion,
  answerQuizQuestion,
} from "./src/lib/quiz";
import {
  type GameShowState,
  createGameShowState,
  assignTeam,
  spinWheel,
  applySpin,
  applyAnswer,
  nextTurn,
  activeTeam,
} from "./src/lib/gameshow";
import {
  type CloseCallState,
  createCloseCallState,
  submitGuess,
  revealRound,
  nextRound,
  closeCallView,
} from "./src/lib/closecall";
import { CLOSE_CALL_ITEMS } from "./src/server-data/closecall-items";

// Local development reads settings (APP_PASSWORD, GEMINI_API_KEY) from .env.
// Variables already set in the environment win, so hosting is unaffected.
dotenv.config({ quiet: true });

// ---------------------------------------------------------------------------
// Auth: a single shared instructor password, exchanged for a signed token.
// ---------------------------------------------------------------------------
// There is deliberately no built-in password. This repository is public, so
// any default written here is known to everyone; with APP_PASSWORD unset,
// instructor sign-in is refused rather than falling back to one.
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const TOKEN_SECRET = crypto
  .createHash("sha256")
  .update(`rfc-token-secret:${APP_PASSWORD}`)
  .digest();
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function createToken(): string {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(exp).digest("hex");
  return `${exp}.${sig}`;
}

function verifyToken(token: string): boolean {
  if (!APP_PASSWORD) return false;
  const [exp, sig] = (token || "").split(".");
  if (!exp || !sig) return false;
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(exp).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
      return false;
    }
  } catch {
    return false;
  }
  return Number(exp) > Date.now();
}

function safeCompare(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function bearer(req: express.Request): string {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function requireInstructor(req: express.Request, res: express.Response): boolean {
  if (!verifyToken(bearer(req))) {
    res.status(401).json({ error: "Instructor sign-in required." });
    return false;
  }
  return true;
}

// Simple in-memory rate limiter per key.
const requestLog = new Map<string, number[]>();
function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (requestLog.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    requestLog.set(key, recent);
    return true;
  }
  recent.push(now);
  requestLog.set(key, recent);
  return false;
}

// ---------------------------------------------------------------------------
// In-memory session store. Replaces Firestore for the host/join/play loop, so
// no Firebase security rules are involved.
// NOTE: state lives in this single process — rooms reset on restart and are not
// shared across multiple server instances. Fine for a classroom run on one
// server; use a shared store (Redis/DB) if you scale horizontally.
// ---------------------------------------------------------------------------
interface HistoryEntry {
  // `id` and `concept` are what the metrics item-analysis groups by, so keep
  // this in step with MetricsHistoryEntry in src/lib/metrics.ts.
  question?: { id?: string; question?: string; concept?: string; difficulty?: string };
  correct?: boolean;
  timeTaken?: number;
}
interface Player {
  id: string;
  token: string;
  name: string;
  score: number;
  history: HistoryEntry[];
  /** Game-show mode only: which team this player plays for. */
  teamId?: string;
  /** Quiz mode only: which question this player is on. */
  quiz?: QuizProgress;
}
interface Room {
  code: string;
  status: "waiting" | "started" | "finished";
  /**
   * "quiz" is the original everyone-answers mode; "gameshow" is team play on
   * the wheel; "closecall" is closest-guess-without-going-over.
   */
  mode: "quiz" | "gameshow" | "closecall";
  difficulty: string;
  questionCount: number;
  timePerQuestion: number;
  endTime: number;
  hostName: string;
  createdAt: number;
  players: Map<string, Player>;
  /** Present only in game-show mode. */
  gameshow?: GameShowState;
  /** Present only in Close Call mode. */
  closecall?: CloseCallState;
  /** Question ids already used this game, so spins don't repeat them. */
  usedQuestionIds?: string[];
  /**
   * Quiz mode: the questions for this session, chosen and ordered when it
   * starts. Kept on the room, with answers, so grading is unaffected by edits
   * to the bank mid-session.
   */
  quizQuestions?: Question[];
}

const rooms = new Map<string, Room>();
let questionBank: Question[] = CYBER_QUESTIONS.map((q) => ({ ...q }));

const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
function sweepRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) rooms.delete(code);
  }
}

function newCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 6; i++) {
      code += alphabet[crypto.randomInt(alphabet.length)];
    }
  } while (rooms.has(code));
  return code;
}

function publicRoom(room: Room) {
  return {
    code: room.code,
    status: room.status,
    mode: room.mode,
    difficulty: room.difficulty,
    questionCount: room.questionCount,
    timePerQuestion: room.timePerQuestion,
    endTime: room.endTime,
    hostName: room.hostName,
    players: [...room.players.values()]
      .map((p) => ({ id: p.id, name: p.name, score: p.score, teamId: p.teamId }))
      .sort((a, b) => b.score - a.score),
    // Game-show state, including the question currently in play. The correct
    // answer is never sent — answers are graded server-side.
    gameshow: room.gameshow
      ? { ...room.gameshow, question: publicQuestion(room.code, room.gameshow.questionId) }
      : undefined,
    // Close Call: no answer and no guess values until the host reveals.
    closecall: room.closecall ? closeCallView(room.closecall, CLOSE_CALL_ITEMS) : undefined,
  };
}

/** The in-play question, stripped of its answer key. */
function publicQuestion(code: string, questionId: string | null) {
  if (!questionId) return null;
  const q = questionBank.find((x) => x.id === questionId);
  if (!q) return null;
  // Seeded so the option order is stable across polls of the same question.
  return toPublicQuestion(q, `${code}:${q.id}`);
}

/** Pick a question for a spin, avoiding ones already used this game. */
function pickGameShowQuestion(room: Room): Question | null {
  const used = new Set(room.usedQuestionIds ?? []);
  let pool = questionBank.filter((q) => !used.has(q.id));
  if (room.difficulty !== "all") {
    const byDifficulty = pool.filter((q) => q.difficulty === room.difficulty);
    if (byDifficulty.length > 0) pool = byDifficulty;
  }
  // Every question used — recycle rather than stall the game.
  if (pool.length === 0) {
    room.usedQuestionIds = [];
    pool = questionBank;
  }
  if (pool.length === 0) return null;
  return pool[crypto.randomInt(pool.length)];
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { headers: { "User-Agent": "aistudio-build" } },
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Trust one proxy hop (e.g. Cloud Run / a load balancer) so req.ip and the
  // login rate limiter see the real client IP rather than the proxy's address.
  app.set("trust proxy", 1);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "500kb" }));

  // ---- Auth -------------------------------------------------------------
  app.post("/api/auth/login", (req, res) => {
    const ip = req.ip ?? "unknown";
    // 5 attempts per IP per minute.
    if (isRateLimited(`login:${ip}`, 5, 60 * 1000)) {
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }
    if (!APP_PASSWORD) {
      return res.status(503).json({
        error: "Instructor sign-in is not configured. Set APP_PASSWORD on the server.",
      });
    }
    const { password } = req.body ?? {};
    if (typeof password !== "string" || !safeCompare(password, APP_PASSWORD)) {
      return res.status(401).json({ error: "Incorrect password." });
    }
    res.json({ token: createToken() });
  });

  // ---- Question bank ----------------------------------------------------
  // Students get the bank without its answer key and with options shuffled.
  // Only a signed-in instructor (who edits the bank) gets the full records.
  app.get("/api/questions", (req, res) => {
    if (verifyToken(bearer(req))) return res.json({ questions: questionBank });
    res.json({ questions: questionBank.map((q) => toPublicQuestion(q)) });
  });

  // Grade one answer for solo practice. Nothing is recorded — solo play has
  // no score on the server — but it keeps the key out of the browser.
  app.post("/api/questions/check", (req, res) => {
    const { questionId, answer } = req.body ?? {};
    const question = questionBank.find((q) => q.id === questionId);
    if (!question) return res.status(404).json({ error: "Question not found." });
    res.json(revealAnswer(question, answer));
  });

  // Restore the built-in bank. The built-in questions live on the server
  // only, so the client can no longer send them back itself.
  app.post("/api/questions/reset", (req, res) => {
    if (!requireInstructor(req, res)) return;
    questionBank = CYBER_QUESTIONS.map((q) => ({ ...q }));
    res.json({ questions: questionBank });
  });

  // Replace the whole bank. Every question is checked first, so a bank with
  // its answers stripped (the copy students get) can't be saved over the key.
  app.put("/api/questions", (req, res) => {
    if (!requireInstructor(req, res)) return;
    const checked = validateBank(req.body?.questions);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    questionBank = checked.value;
    res.json({ questions: questionBank });
  });

  // Add, edit and remove one question at a time. Each returns the bank as it
  // now stands, so the admin screen shows exactly what the server holds.
  app.post("/api/questions", (req, res) => {
    if (!requireInstructor(req, res)) return;
    const result = addQuestion(questionBank, req.body?.question);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    questionBank = result.value.bank;
    res.status(201).json({ question: result.value.question, questions: questionBank });
  });

  app.put("/api/questions/:id", (req, res) => {
    if (!requireInstructor(req, res)) return;
    const result = updateQuestion(questionBank, req.params.id, req.body?.question);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    questionBank = result.value.bank;
    res.json({ question: result.value.question, questions: questionBank });
  });

  app.delete("/api/questions/:id", (req, res) => {
    if (!requireInstructor(req, res)) return;
    const result = removeQuestion(questionBank, req.params.id);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    questionBank = result.value.bank;
    res.json({ question: result.value.question, questions: questionBank });
  });

  // ---- Sessions ---------------------------------------------------------
  app.post("/api/session", (req, res) => {
    if (!requireInstructor(req, res)) return;
    sweepRooms();
    const { difficulty, questionCount, timePerQuestion, hostName, mode, teamCount, rounds } = req.body ?? {};
    const code = newCode();
    const gameshowMode = mode === "gameshow";
    const closeCallMode = mode === "closecall";
    rooms.set(code, {
      code,
      status: "waiting",
      mode: gameshowMode ? "gameshow" : closeCallMode ? "closecall" : "quiz",
      difficulty: ["all", "easy", "medium", "hard"].includes(difficulty) ? difficulty : "all",
      questionCount: Number(questionCount) || 10,
      timePerQuestion: normalizeTimePerQuestion(timePerQuestion),
      endTime: 0,
      hostName: typeof hostName === "string" && hostName ? hostName.slice(0, 50) : "Instructor",
      createdAt: Date.now(),
      players: new Map(),
      gameshow: gameshowMode ? createGameShowState(Number(teamCount) || 2, Number(rounds) || undefined) : undefined,
      closecall: closeCallMode ? createCloseCallState(CLOSE_CALL_ITEMS, Number(questionCount)) : undefined,
      usedQuestionIds: [],
    });
    res.json({ code });
  });

  app.get("/api/sessions", (req, res) => {
    if (!requireInstructor(req, res)) return;
    sweepRooms();
    const list = [...rooms.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        code: r.code,
        status: r.status,
        difficulty: r.difficulty,
        playerCount: r.players.size,
        createdAt: r.createdAt,
      }));
    res.json({ sessions: list });
  });

  app.get("/api/session/:code", (req, res) => {
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: "Session not found." });
    res.json(publicRoom(room));
  });

  app.post("/api/session/:code/join", (req, res) => {
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: "Session not found. Check the code." });
    if (room.status === "finished") {
      return res.status(409).json({ error: "This session has already ended." });
    }
    const name = normalizeDisplayName(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: "A name is required." });
    }
    if (room.players.size >= 200) {
      return res.status(409).json({ error: "This session is full." });
    }
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(16).toString("hex");

    // In game-show mode put the player on the smallest team so sides stay even.
    let teamId: string | undefined;
    if (room.mode === "gameshow" && room.gameshow) {
      const sizes: Record<string, number> = {};
      for (const p of room.players.values()) {
        if (p.teamId) sizes[p.teamId] = (sizes[p.teamId] ?? 0) + 1;
      }
      teamId = assignTeam(room.gameshow.teams, sizes);
    }

    room.players.set(id, { id, token, name, score: 0, history: [], teamId });
    res.json({ playerId: id, playerToken: token, teamId, room: publicRoom(room) });
  });

  /**
   * A student leaves before the session starts (they joined the wrong class),
   * so they drop off the host's roster. Once it has started, their score and
   * answers stay part of the session's record.
   */
  app.post("/api/session/:code/leave", (req, res) => {
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: "Session not found." });
    const { playerId, playerToken } = req.body ?? {};
    const player = room.players.get(playerId);
    if (!player || player.token !== playerToken) return res.status(403).json({ error: "Invalid player." });
    if (room.status !== "waiting") return res.status(409).json({ error: "The session has already started." });
    room.players.delete(player.id);
    res.json({ ok: true });
  });

  // ---- Game show --------------------------------------------------------
  /** Host spins the wheel; hazards resolve at once, points put a question up. */
  app.post("/api/session/:code/spin", (req, res) => {
    if (!requireInstructor(req, res)) return;
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: "Session not found." });
    if (room.mode !== "gameshow" || !room.gameshow) {
      return res.status(409).json({ error: "This session is not in game-show mode." });
    }
    if (room.gameshow.phase === "final") {
      return res.status(409).json({ error: "The game is over — every round has been played." });
    }
    if (room.gameshow.phase !== "idle") {
      return res.status(409).json({ error: "Finish the current turn before spinning again." });
    }

    const segment = spinWheel();
    const question = segment.kind === "points" ? pickGameShowQuestion(room) : null;
    if (question) room.usedQuestionIds = [...(room.usedQuestionIds ?? []), question.id];
    room.gameshow = applySpin(room.gameshow, segment, question?.id ?? null);
    res.json(publicRoom(room));
  });

  /** A player on the active team answers the question in play. */
  app.post("/api/session/:code/answer", (req, res) => {
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: "Session not found." });
    if (room.mode !== "gameshow" || !room.gameshow) {
      return res.status(409).json({ error: "This session is not in game-show mode." });
    }
    const { playerId, playerToken, answer } = req.body ?? {};
    const player = room.players.get(playerId);
    if (!player || player.token !== playerToken) {
      return res.status(403).json({ error: "Invalid player." });
    }
    if (room.gameshow.phase !== "question") {
      return res.status(409).json({ error: "There is no question to answer right now." });
    }
    const team = activeTeam(room.gameshow);
    if (!team || player.teamId !== team.id) {
      return res.status(403).json({ error: "It is not your team's turn." });
    }

    const question = questionBank.find((q) => q.id === room.gameshow!.questionId);
    if (!question) return res.status(409).json({ error: "Question is no longer available." });

    // Graded server-side so the answer key never reaches the client.
    const correct = gradeAnswer(question, answer);

    player.history.push({ question: { id: question.id, question: question.question, concept: question.concept, difficulty: question.difficulty }, correct, timeTaken: 0 });
    room.gameshow = applyAnswer(room.gameshow, correct);
    res.json({ correct, correctAnswer: question.correctAnswer, room: publicRoom(room) });
  });

  // ---- Close Call -------------------------------------------------------
  /** A player locks in (or changes) their guess for the current round. */
  app.post("/api/session/:code/closecall/guess", (req, res) => {
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: "Session not found." });
    if (room.mode !== "closecall" || !room.closecall) {
      return res.status(409).json({ error: "This session is not a Close Call game." });
    }
    if (room.status !== "started") {
      return res.status(409).json({ error: "The game isn't running right now." });
    }
    const { playerId, playerToken, guess } = req.body ?? {};
    const player = room.players.get(playerId);
    if (!player || player.token !== playerToken) {
      return res.status(403).json({ error: "Invalid player." });
    }
    const result = submitGuess(room.closecall, player.id, guess);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    room.closecall = result.state;
    res.json({ guess: result.guess, room: publicRoom(room) });
  });

  /** Host closes guessing and reveals the answer; points go to the players. */
  app.post("/api/session/:code/closecall/reveal", (req, res) => {
    if (!requireInstructor(req, res)) return;
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: "Session not found." });
    if (room.mode !== "closecall" || !room.closecall) {
      return res.status(409).json({ error: "This session is not a Close Call game." });
    }
    const item = CLOSE_CALL_ITEMS.find((i) => i.id === room.closecall!.itemIds[room.closecall!.index]);
    if (!item) return res.status(409).json({ error: "This round's item is no longer available." });
    const result = revealRound(room.closecall, item);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    room.closecall = result.state;
    for (const entry of result.result.entries) {
      const player = room.players.get(entry.playerId);
      if (!player) continue;
      player.score += entry.points;
      player.history.push({
        question: { id: item.id, question: item.prompt, concept: item.concept, difficulty: "medium" },
        correct: entry.points > 0,
        timeTaken: 0,
      });
    }
    res.json(publicRoom(room));
  });

  /** Host moves to the next item; after the last one the game ends. */
  app.post("/api/session/:code/closecall/next", (req, res) => {
    if (!requireInstructor(req, res)) return;
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: "Session not found." });
    if (room.mode !== "closecall" || !room.closecall) {
      return res.status(409).json({ error: "This session is not a Close Call game." });
    }
    const result = nextRound(room.closecall);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    room.closecall = result.state;
    if (result.finished) {
      room.status = "finished";
      room.endTime = Date.now();
    }
    res.json(publicRoom(room));
  });

  /** Host hands play to the next team. */
  app.post("/api/session/:code/next-turn", (req, res) => {
    if (!requireInstructor(req, res)) return;
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: "Session not found." });
    if (room.mode !== "gameshow" || !room.gameshow) {
      return res.status(409).json({ error: "This session is not in game-show mode." });
    }
    room.gameshow = nextTurn(room.gameshow);
    res.json(publicRoom(room));
  });

  app.post("/api/session/:code/settings", (req, res) => {
    if (!requireInstructor(req, res)) return;
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: "Session not found." });
    if (room.status !== "waiting") {
      return res.status(409).json({ error: "Settings can only change before the session starts." });
    }
    const { difficulty, questionCount, timePerQuestion } = req.body ?? {};
    if (["all", "easy", "medium", "hard"].includes(difficulty)) room.difficulty = difficulty;
    if (Number(questionCount) > 0) room.questionCount = Number(questionCount);
    // 0 is valid here — it selects the untimed accommodation.
    if (timePerQuestion !== undefined) {
      room.timePerQuestion = normalizeTimePerQuestion(timePerQuestion, room.timePerQuestion);
    }
    res.json(publicRoom(room));
  });

  app.post("/api/session/:code/start", (req, res) => {
    if (!requireInstructor(req, res)) return;
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: "Session not found." });
    if (room.status !== "waiting") {
      return res.status(409).json({ error: "This session has already started." });
    }
    const minutes = Math.min(120, Math.max(1, Number(req.body?.durationMinutes) || 5));
    room.status = "started";
    room.endTime = Date.now() + minutes * 60 * 1000;
    if (room.mode === "quiz") {
      room.quizQuestions = selectQuizQuestions(questionBank, room.difficulty, room.questionCount);
    }
    res.json({ endTime: room.endTime });
  });

  app.post("/api/session/:code/end", (req, res) => {
    if (!requireInstructor(req, res)) return;
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: "Session not found." });
    room.status = "finished";
    room.endTime = Date.now();
    res.json({ ok: true });
  });

  app.delete("/api/session/:code", (req, res) => {
    if (!requireInstructor(req, res)) return;
    rooms.delete(req.params.code.toUpperCase());
    res.json({ ok: true });
  });

  // ---- Live quiz ---------------------------------------------------------
  // The server serves each question, times it, grades the answer and keeps
  // the score. Clients used to report their own score and history; they no
  // longer can.
  const quizPlayer = (req: express.Request, res: express.Response) => {
    const room = rooms.get(req.params.code.toUpperCase());
    if (!room) {
      res.status(404).json({ error: "Session not found." });
      return null;
    }
    const { playerId, playerToken } = req.body ?? {};
    const player = room.players.get(playerId);
    if (!player || player.token !== playerToken) {
      res.status(403).json({ error: "Invalid player." });
      return null;
    }
    return { room, player };
  };

  /** Serve the player's current question and start its clock. */
  app.post("/api/session/:code/quiz/next", (req, res) => {
    const found = quizPlayer(req, res);
    if (!found) return;
    const result = serveQuizQuestion(found.room, found.player, Date.now());
    res.status(result.status).json(result.body);
  });

  /** Grade the player's answer to the question they were served. */
  app.post("/api/session/:code/quiz/answer", (req, res) => {
    const found = quizPlayer(req, res);
    if (!found) return;
    const result = answerQuizQuestion(found.room, found.player, req.body?.answer, Date.now());
    res.status(result.status).json(result.body);
  });

  // ---- Metrics + AI -----------------------------------------------------
  app.get("/api/metrics", (req, res) => {
    if (!requireInstructor(req, res)) return;
    const allPlayers = [...rooms.values()].flatMap((r) => [...r.players.values()]);
    res.json(computeMetrics(allPlayers));
  });

  app.post("/api/metrics/analyze", async (req, res) => {
    try {
      if (!requireInstructor(req, res)) return;
      if (isRateLimited("metrics", 10, 10 * 60 * 1000)) {
        return res.status(429).json({ error: "Too many requests. Try again later." });
      }
      const { metrics } = req.body;
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `You are an expert instructional designer and game metric analyst. Based on the following metrics, suggest 3 practical improvements for the assessment or teaching plan.

Metrics:
${JSON.stringify(metrics, null, 2)}

Provide your analysis in JSON format with an array of "suggestions", each containing a "title" and "description".`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: ["title", "description"],
                },
              },
            },
            required: ["suggestions"],
          },
        },
      });
      const suggestionsStr = response.text;
      if (!suggestionsStr) throw new Error("No response from AI");
      res.json(JSON.parse(suggestionsStr));
    } catch (e) {
      console.error("Gemini Error:", e);
      res.status(500).json({ error: "Failed to fetch AI suggestions." });
    }
  });

  // ---- Static / Vite ----------------------------------------------------
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!APP_PASSWORD) {
      console.warn(
        "APP_PASSWORD is not set: instructor sign-in is disabled. Set it in the environment or in .env.",
      );
    }
  });
}

startServer();
