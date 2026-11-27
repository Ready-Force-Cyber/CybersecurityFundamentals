/// <reference types="@cloudflare/workers-types" />

import { normalizeTimePerQuestion } from "../lib/session-settings";
import { normalizeDisplayName } from "../lib/display-name";
import type { Question } from "../constants";
import {
  type QuizProgress,
  toPublicQuestion,
  gradeAnswer,
  selectQuizQuestions,
  serveQuizQuestion,
  answerQuizQuestion,
} from "../lib/quiz";
import {
  type GameShowState,
  createGameShowState,
  assignTeam,
  spinWheel,
  applySpin,
  applyAnswer,
  nextTurn,
  activeTeam,
} from "../lib/gameshow";
import {
  type CloseCallState,
  createCloseCallState,
  submitGuess,
  revealRound,
  nextRound,
  closeCallView,
} from "../lib/closecall";
import { CLOSE_CALL_ITEMS } from "../server-data/closecall-items";

// One Durable Object instance per room code. Holds the live session state that
// the in-memory Map held in the Node server — but durably and consistently,
// which is what makes this work on Cloudflare's serverless runtime.

export interface PlayerRec {
  id: string;
  token: string;
  name: string;
  score: number;
  history: any[];
  /** Game-show mode only: which team this player plays for. */
  teamId?: string;
  /** Quiz mode only: which question this player is on. */
  quiz?: QuizProgress;
}

export interface RoomRec {
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
  players: Record<string, PlayerRec>;
  /** Present only in game-show mode. */
  gameshow?: GameShowState;
  /** Present only in Close Call mode. */
  closecall?: CloseCallState;
  /**
   * Snapshot of the question bank taken when the room is created. The bank
   * itself lives in GlobalDO, but copying it here keeps serving and grading
   * inside this object (no cross-DO call per answer) and means editing the
   * bank mid-session cannot change a session already in progress.
   */
  questions?: Question[];
  /** Question ids already used this game, so spins don't repeat them. */
  usedQuestionIds?: string[];
  /** Quiz mode: this session's questions, chosen and ordered when it starts. */
  quizQuestions?: Question[];
}

function publicRoom(r: RoomRec) {
  return {
    code: r.code,
    status: r.status,
    mode: r.mode,
    difficulty: r.difficulty,
    questionCount: r.questionCount,
    timePerQuestion: r.timePerQuestion,
    endTime: r.endTime,
    hostName: r.hostName,
    players: Object.values(r.players)
      .map((p) => ({ id: p.id, name: p.name, score: p.score, teamId: p.teamId }))
      .sort((a, b) => b.score - a.score),
    // The in-play question is sent without its answer key — answers are
    // graded in here, so the correct answer never reaches a browser.
    gameshow: r.gameshow
      ? { ...r.gameshow, question: publicQuestion(r, r.gameshow.questionId) }
      : undefined,
    // Close Call: no answer and no guess values until the host reveals.
    closecall: r.closecall ? closeCallView(r.closecall, CLOSE_CALL_ITEMS) : undefined,
  };
}

function publicQuestion(r: RoomRec, questionId: string | null) {
  if (!questionId) return null;
  const q = (r.questions ?? []).find((x) => x.id === questionId);
  if (!q) return null;
  // Seeded so the option order is stable across polls of the same question.
  return toPublicQuestion(q, `${r.code}:${q.id}`);
}

/** Pick a question for a spin, avoiding ones already used this game. */
function pickGameShowQuestion(r: RoomRec): Question | null {
  const bank = r.questions ?? [];
  const used = new Set(r.usedQuestionIds ?? []);
  let pool = bank.filter((q) => !used.has(q.id));
  if (r.difficulty !== "all") {
    const byDifficulty = pool.filter((q) => q.difficulty === r.difficulty);
    if (byDifficulty.length > 0) pool = byDifficulty;
  }
  // Every question used — recycle rather than stall the game.
  if (pool.length === 0) {
    r.usedQuestionIds = [];
    pool = bank;
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export class RoomDO {
  constructor(private state: DurableObjectState) {}

  private async room(): Promise<RoomRec | null> {
    return (await this.state.storage.get<RoomRec>("room")) ?? null;
  }
  private async save(r: RoomRec): Promise<void> {
    await this.state.storage.put("room", r);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^\//, "");
    const body: any = request.method !== "GET" ? await request.json().catch(() => ({})) : {};
    const json = (data: unknown, status = 200) => Response.json(data, { status });

    if (action === "create") {
      const gameshowMode = body.mode === "gameshow";
      const closeCallMode = body.mode === "closecall";
      const r: RoomRec = {
        code: body.code,
        status: "waiting",
        mode: gameshowMode ? "gameshow" : closeCallMode ? "closecall" : "quiz",
        difficulty: ["all", "easy", "medium", "hard"].includes(body.difficulty) ? body.difficulty : "all",
        questionCount: Number(body.questionCount) || 10,
        timePerQuestion: normalizeTimePerQuestion(body.timePerQuestion),
        endTime: 0,
        hostName: typeof body.hostName === "string" && body.hostName ? body.hostName.slice(0, 50) : "Instructor",
        createdAt: Date.now(),
        players: {},
        gameshow: gameshowMode ? createGameShowState(Number(body.teamCount) || 2, Number(body.rounds) || undefined) : undefined,
        closecall: closeCallMode ? createCloseCallState(CLOSE_CALL_ITEMS, Number(body.questionCount)) : undefined,
        // The worker passes the bank in, since it lives in GlobalDO.
        questions: Array.isArray(body.questions) ? body.questions : undefined,
        usedQuestionIds: [],
      };
      await this.save(r);
      return json({ code: r.code });
    }

    const r = await this.room();
    if (!r) return json({ error: "Session not found." }, 404);

    switch (action) {
      case "state":
        return json(publicRoom(r));

      case "join": {
        if (r.status === "finished") return json({ error: "This session has already ended." }, 409);
        const name = normalizeDisplayName(body.name);
        if (!name) return json({ error: "A name is required." }, 400);
        if (Object.keys(r.players).length >= 200) return json({ error: "This session is full." }, 409);
        const id = crypto.randomUUID();
        const token = crypto.randomUUID().replace(/-/g, "");

        // In game-show mode put the player on the smallest team.
        let teamId: string | undefined;
        if (r.mode === "gameshow" && r.gameshow) {
          const sizes: Record<string, number> = {};
          for (const p of Object.values(r.players)) {
            if (p.teamId) sizes[p.teamId] = (sizes[p.teamId] ?? 0) + 1;
          }
          teamId = assignTeam(r.gameshow.teams, sizes);
        }

        r.players[id] = { id, token, name, score: 0, history: [], teamId };
        await this.save(r);
        return json({ playerId: id, playerToken: token, teamId, room: publicRoom(r) });
      }

      case "settings": {
        if (r.status !== "waiting") {
          return json({ error: "Settings can only change before the session starts." }, 409);
        }
        if (["all", "easy", "medium", "hard"].includes(body.difficulty)) r.difficulty = body.difficulty;
        if (Number(body.questionCount) > 0) r.questionCount = Number(body.questionCount);
        // 0 is valid here — it selects the untimed accommodation.
        if (body.timePerQuestion !== undefined) {
          r.timePerQuestion = normalizeTimePerQuestion(body.timePerQuestion, r.timePerQuestion);
        }
        await this.save(r);
        return json(publicRoom(r));
      }

      case "start": {
        if (r.status !== "waiting") {
          return json({ error: "This session has already started." }, 409);
        }
        const minutes = Math.min(120, Math.max(1, Number(body.durationMinutes) || 5));
        r.status = "started";
        r.endTime = Date.now() + minutes * 60 * 1000;
        if (r.mode === "quiz") {
          r.quizQuestions = selectQuizQuestions(r.questions ?? [], r.difficulty, r.questionCount);
        }
        await this.save(r);
        return json({ endTime: r.endTime });
      }

      case "end": {
        r.status = "finished";
        r.endTime = Date.now();
        await this.save(r);
        return json({ ok: true });
      }

      // ---- Live quiz ----------------------------------------------------
      // The room serves each question, times it, grades the answer and keeps
      // the score. Clients used to report their own score and history; they
      // no longer can.
      case "quiz-next":
      case "quiz-answer": {
        const p = r.players[body.playerId];
        if (!p || p.token !== body.playerToken) return json({ error: "Invalid player." }, 403);
        const result =
          action === "quiz-next"
            ? serveQuizQuestion(r, p, Date.now())
            : answerQuizQuestion(r, p, body.answer, Date.now());
        // Both calls can change the player (clock started, answer recorded).
        if (result.status === 200) await this.save(r);
        return json(result.body, result.status);
      }

      // ---- Game show ----------------------------------------------------
      case "spin": {
        if (r.mode !== "gameshow" || !r.gameshow) {
          return json({ error: "This session is not in game-show mode." }, 409);
        }
        if (r.gameshow.phase === "final") {
          return json({ error: "The game is over — every round has been played." }, 409);
        }
        if (r.gameshow.phase !== "idle") {
          return json({ error: "Finish the current turn before spinning again." }, 409);
        }
        const segment = spinWheel();
        const question = segment.kind === "points" ? pickGameShowQuestion(r) : null;
        if (question) r.usedQuestionIds = [...(r.usedQuestionIds ?? []), question.id];
        r.gameshow = applySpin(r.gameshow, segment, question?.id ?? null);
        await this.save(r);
        return json(publicRoom(r));
      }

      case "answer": {
        if (r.mode !== "gameshow" || !r.gameshow) {
          return json({ error: "This session is not in game-show mode." }, 409);
        }
        const p = r.players[body.playerId];
        if (!p || p.token !== body.playerToken) return json({ error: "Invalid player." }, 403);
        if (r.gameshow.phase !== "question") {
          return json({ error: "There is no question to answer right now." }, 409);
        }
        const team = activeTeam(r.gameshow);
        if (!team || p.teamId !== team.id) {
          return json({ error: "It is not your team's turn." }, 403);
        }
        const question = (r.questions ?? []).find((q) => q.id === r.gameshow!.questionId);
        if (!question) return json({ error: "Question is no longer available." }, 409);

        // Graded here so the answer key never leaves the Durable Object.
        const correct = gradeAnswer(question, body.answer);

        p.history.push({
          question: { id: question.id, question: question.question, concept: question.concept, difficulty: question.difficulty },
          correct,
          timeTaken: 0,
        });
        r.gameshow = applyAnswer(r.gameshow, correct);
        await this.save(r);
        return json({ correct, correctAnswer: question.correctAnswer, room: publicRoom(r) });
      }

      // ---- Close Call --------------------------------------------------
      case "closecall-guess": {
        if (r.mode !== "closecall" || !r.closecall) {
          return json({ error: "This session is not a Close Call game." }, 409);
        }
        if (r.status !== "started") return json({ error: "The game isn't running right now." }, 409);
        const p = r.players[body.playerId];
        if (!p || p.token !== body.playerToken) return json({ error: "Invalid player." }, 403);
        const result = submitGuess(r.closecall, p.id, body.guess);
        if (!result.ok) return json({ error: result.error }, result.status);
        r.closecall = result.state;
        await this.save(r);
        return json({ guess: result.guess, room: publicRoom(r) });
      }

      case "closecall-reveal": {
        if (r.mode !== "closecall" || !r.closecall) {
          return json({ error: "This session is not a Close Call game." }, 409);
        }
        const item = CLOSE_CALL_ITEMS.find((i) => i.id === r.closecall!.itemIds[r.closecall!.index]);
        if (!item) return json({ error: "This round's item is no longer available." }, 409);
        const result = revealRound(r.closecall, item);
        if (!result.ok) return json({ error: result.error }, result.status);
        r.closecall = result.state;
        for (const entry of result.result.entries) {
          const p = r.players[entry.playerId];
          if (!p) continue;
          p.score += entry.points;
          p.history.push({
            question: { id: item.id, question: item.prompt, concept: item.concept, difficulty: "medium" },
            correct: entry.points > 0,
            timeTaken: 0,
          });
        }
        await this.save(r);
        return json(publicRoom(r));
      }

      case "closecall-next": {
        if (r.mode !== "closecall" || !r.closecall) {
          return json({ error: "This session is not a Close Call game." }, 409);
        }
        const result = nextRound(r.closecall);
        if (!result.ok) return json({ error: result.error }, result.status);
        r.closecall = result.state;
        if (result.finished) {
          r.status = "finished";
          r.endTime = Date.now();
        }
        await this.save(r);
        return json(publicRoom(r));
      }

      case "next-turn": {
        if (r.mode !== "gameshow" || !r.gameshow) {
          return json({ error: "This session is not in game-show mode." }, 409);
        }
        r.gameshow = nextTurn(r.gameshow);
        await this.save(r);
        return json(publicRoom(r));
      }

      case "metrics":
        return json({ players: Object.values(r.players) });

      case "destroy":
        await this.state.storage.deleteAll();
        return json({ ok: true });

      default:
        return json({ error: "Unknown action." }, 404);
    }
  }
}
