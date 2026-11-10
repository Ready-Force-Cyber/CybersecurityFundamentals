import { describe, it, expect, vi, afterEach } from "vitest";
import { RoomDO } from "../src/worker/room-do";
import { GlobalDO } from "../src/worker/global-do";
import { CYBER_QUESTIONS } from "../src/server-data/question-bank";

// Minimal in-memory fake of the one DurableObjectState surface both DOs
// actually use: state.storage.get/put/deleteAll. Good enough to exercise the
// real fetch() handlers without needing the Workers runtime.
function fakeState() {
  const map = new Map<string, any>();
  return {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return map.get(key);
      },
      async put(key: string, value: any): Promise<void> {
        map.set(key, value);
      },
      async delete(key: string): Promise<boolean> {
        return map.delete(key);
      },
      async deleteAll(): Promise<void> {
        map.clear();
      },
    },
  } as any;
}

function req(action: string, body?: unknown) {
  return new Request(`https://do/${action}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("RoomDO", () => {
  it("returns 404 for any action before the room is created", async () => {
    const room = new RoomDO(fakeState());
    const res = await room.fetch(req("state"));
    expect(res.status).toBe(404);
  });

  it("creates a room and reports its public state", async () => {
    const room = new RoomDO(fakeState());
    const created = await (await room.fetch(req("create", { code: "ABC123", difficulty: "hard", questionCount: 7, timePerQuestion: 15 }))).json();
    expect(created).toEqual({ code: "ABC123" });

    const state: any = await (await room.fetch(req("state"))).json();
    expect(state).toMatchObject({
      code: "ABC123",
      status: "waiting",
      difficulty: "hard",
      questionCount: 7,
      timePerQuestion: 15,
      players: [],
    });
  });

  it("falls back to defaults for an invalid difficulty and missing settings", async () => {
    const room = new RoomDO(fakeState());
    await room.fetch(req("create", { code: "X", difficulty: "impossible" }));
    const state: any = await (await room.fetch(req("state"))).json();
    expect(state.difficulty).toBe("all");
    expect(state.questionCount).toBe(10);
    expect(state.timePerQuestion).toBe(20);
    expect(state.hostName).toBe("Instructor");
  });

  it("lets players join and rejects an empty name", async () => {
    const room = new RoomDO(fakeState());
    await room.fetch(req("create", { code: "X" }));

    const bad = await room.fetch(req("join", { name: "   " }));
    expect(bad.status).toBe(400);

    const joined: any = await (await room.fetch(req("join", { name: "Alice" }))).json();
    expect(joined.playerId).toBeTruthy();
    expect(joined.playerToken).toBeTruthy();
    expect(joined.room.players).toEqual([{ id: joined.playerId, name: "Alice", score: 0 }]);
  });

  it("rejects joining a finished session", async () => {
    const room = new RoomDO(fakeState());
    await room.fetch(req("create", { code: "X" }));
    await room.fetch(req("end", {}));

    const res = await room.fetch(req("join", { name: "Alice" }));
    expect(res.status).toBe(409);
  });

  it("locks settings once the session has started", async () => {
    const room = new RoomDO(fakeState());
    await room.fetch(req("create", { code: "X" }));

    const okBefore = await room.fetch(req("settings", { timePerQuestion: 45 }));
    expect(okBefore.status).toBe(200);

    await room.fetch(req("start", { durationMinutes: 5 }));

    const blocked = await room.fetch(req("settings", { timePerQuestion: 60 }));
    expect(blocked.status).toBe(409);
  });

  it("supports the untimed accommodation at create and via settings", async () => {
    const room = new RoomDO(fakeState());

    // Created untimed — must not be coerced back to the 20s default.
    await room.fetch(req("create", { code: "X", timePerQuestion: 0 }));
    let state: any = await (await room.fetch(req("state"))).json();
    expect(state.timePerQuestion).toBe(0);

    // Switching to a timed value works...
    await room.fetch(req("settings", { timePerQuestion: 30 }));
    state = await (await room.fetch(req("state"))).json();
    expect(state.timePerQuestion).toBe(30);

    // ...and switching back to untimed also works.
    await room.fetch(req("settings", { timePerQuestion: 0 }));
    state = await (await room.fetch(req("state"))).json();
    expect(state.timePerQuestion).toBe(0);
  });

  it("leaves an untimed setting alone when other settings change", async () => {
    const room = new RoomDO(fakeState());
    await room.fetch(req("create", { code: "X", timePerQuestion: 0 }));
    await room.fetch(req("settings", { difficulty: "hard" }));
    const state: any = await (await room.fetch(req("state"))).json();
    expect(state.difficulty).toBe("hard");
    expect(state.timePerQuestion).toBe(0);
  });

  it("clamps the session duration to 1-120 minutes", async () => {
    const room = new RoomDO(fakeState());
    await room.fetch(req("create", { code: "X" }));

    const before = Date.now();
    const { endTime: tooLong }: any = await (await room.fetch(req("start", { durationMinutes: 999 }))).json();
    expect(tooLong - before).toBeLessThanOrEqual(120 * 60 * 1000 + 1000);

    await room.fetch(req("create", { code: "X" })); // reset back to waiting
    const before2 = Date.now();
    const { endTime: tooShort }: any = await (await room.fetch(req("start", { durationMinutes: 0 }))).json();
    expect(tooShort - before2).toBeGreaterThanOrEqual(1 * 60 * 1000 - 1000);
  });

  it("ends a session and marks it finished", async () => {
    const room = new RoomDO(fakeState());
    await room.fetch(req("create", { code: "X" }));
    await room.fetch(req("end", {}));
    const state: any = await (await room.fetch(req("state"))).json();
    expect(state.status).toBe("finished");
  });

  it("destroys a room so it no longer exists", async () => {
    const room = new RoomDO(fakeState());
    await room.fetch(req("create", { code: "X" }));
    await room.fetch(req("destroy", {}));
    const res = await room.fetch(req("state"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown action", async () => {
    const room = new RoomDO(fakeState());
    await room.fetch(req("create", { code: "X" }));
    const res = await room.fetch(req("nonsense"));
    expect(res.status).toBe(404);
  });
});

describe("GlobalDO", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the built-in question bank before any questions are set", async () => {
    const g = new GlobalDO(fakeState());
    const { questions }: any = await (await g.fetch(req("questions:get"))).json();
    expect(questions).toEqual(CYBER_QUESTIONS);
  });

  it("stores and returns a custom question bank", async () => {
    const g = new GlobalDO(fakeState());
    // A non-colliding id, so this asserts round-tripping rather than the
    // reconcile-by-id repair (covered in tests/questions.test.ts).
    const custom = [{ id: "custom-1", question: "Q?", correctAnswer: "A" }];
    await g.fetch(req("questions:set", { questions: custom }));
    const { questions }: any = await (await g.fetch(req("questions:get"))).json();
    expect(questions).toEqual(custom);
  });

  it("repairs a stored bank that predates the concept field", async () => {
    const g = new GlobalDO(fakeState());
    const stale = CYBER_QUESTIONS.map(({ concept, ...rest }) => rest as any);
    await g.fetch(req("questions:set", { questions: stale }));

    const { questions }: any = await (await g.fetch(req("questions:get"))).json();
    expect(questions.every((q: any) => !!q.concept)).toBe(true);

    // The repair is persisted, so it happens once rather than on every read.
    const again: any = await (await g.fetch(req("questions:get"))).json();
    expect(again.questions.every((q: any) => !!q.concept)).toBe(true);
  });

  it("stores an empty array (not the fallback) when questions is not an array", async () => {
    const g = new GlobalDO(fakeState());
    await g.fetch(req("questions:set", { questions: "not-an-array" }));
    const { questions }: any = await (await g.fetch(req("questions:get"))).json();
    expect(questions).toEqual([]);
  });

  it("rate-limits after the Nth attempt within the window", async () => {
    const g = new GlobalDO(fakeState());
    const body = { key: "login:1.2.3.4", limit: 3, windowMs: 60_000 };

    const r1: any = await (await g.fetch(req("rate", body))).json();
    const r2: any = await (await g.fetch(req("rate", body))).json();
    const r3: any = await (await g.fetch(req("rate", body))).json();
    const r4: any = await (await g.fetch(req("rate", body))).json();

    expect([r1.limited, r2.limited, r3.limited]).toEqual([false, false, false]);
    expect(r4.limited).toBe(true);
  });

  it("resets the rate limit once the window passes", async () => {
    vi.useFakeTimers();
    const start = new Date(2030, 0, 1);
    vi.setSystemTime(start);

    const g = new GlobalDO(fakeState());
    const body = { key: "login:5.6.7.8", limit: 1, windowMs: 1000 };

    const first: any = await (await g.fetch(req("rate", body))).json();
    const second: any = await (await g.fetch(req("rate", body))).json();
    expect(first.limited).toBe(false);
    expect(second.limited).toBe(true);

    vi.setSystemTime(new Date(start.getTime() + 2000));
    const third: any = await (await g.fetch(req("rate", body))).json();
    expect(third.limited).toBe(false);
  });

  it("adds, lists, and removes rooms from the registry", async () => {
    const g = new GlobalDO(fakeState());
    await g.fetch(req("rooms:add", { code: "AAA" }));
    await g.fetch(req("rooms:add", { code: "BBB" }));

    let list: any = await (await g.fetch(req("rooms:list"))).json();
    expect(list.rooms.map((r: any) => r.code).sort()).toEqual(["AAA", "BBB"]);

    await g.fetch(req("rooms:remove", { code: "AAA" }));
    list = await (await g.fetch(req("rooms:list"))).json();
    expect(list.rooms.map((r: any) => r.code)).toEqual(["BBB"]);
  });

  it("returns 404 for an unknown action", async () => {
    const g = new GlobalDO(fakeState());
    const res = await g.fetch(req("nonsense"));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Game-show mode inside the Durable Object. This is the only way to verify the
// Cloudflare path on a machine where wrangler/workerd cannot run, so it mirrors
// the flow that was exercised over HTTP against the Node server.
// ---------------------------------------------------------------------------
describe("RoomDO — game-show mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Force the wheel (and question pick) to be deterministic. */
  const fixRandom = (value: number) => vi.spyOn(Math, "random").mockReturnValue(value);

  async function newGame(teamCount = 2) {
    const room = new RoomDO(fakeState());
    await room.fetch(
      req("create", {
        code: "GS1",
        mode: "gameshow",
        teamCount,
        difficulty: "all",
        questions: CYBER_QUESTIONS,
      }),
    );
    return room;
  }

  async function join(room: RoomDO, name: string) {
    return (await (await room.fetch(req("join", { name }))).json()) as any;
  }

  it("creates a game-show room with teams", async () => {
    const room = await newGame(3);
    const state: any = await (await room.fetch(req("state"))).json();
    expect(state.mode).toBe("gameshow");
    expect(state.gameshow.teams).toHaveLength(3);
    expect(state.gameshow.phase).toBe("idle");
  });

  it("balances joining players across teams", async () => {
    const room = await newGame(2);
    const ids = [];
    for (const n of ["A", "B", "C", "D"]) ids.push((await join(room, n)).teamId);
    expect(ids.filter((t) => t === "blue")).toHaveLength(2);
    expect(ids.filter((t) => t === "red")).toHaveLength(2);
  });

  it("puts a question in play on a points spin, without its answer key", async () => {
    const room = await newGame();
    await join(room, "A");
    fixRandom(0); // segment 0 is a points segment
    const state: any = await (await room.fetch(req("spin", {}))).json();
    expect(state.gameshow.phase).toBe("question");
    expect(state.gameshow.question).toBeTruthy();
    expect(state.gameshow.question).not.toHaveProperty("correctAnswer");
    expect(state.gameshow.question.options.length).toBeGreaterThan(1);
  });

  it("rejects a second spin while a turn is unresolved", async () => {
    const room = await newGame();
    await join(room, "A");
    fixRandom(0);
    await room.fetch(req("spin", {}));
    const res = await room.fetch(req("spin", {}));
    expect(res.status).toBe(409);
  });

  it("scores a correct answer from the active team", async () => {
    const room = await newGame();
    const a = await join(room, "A"); // blue, goes first
    fixRandom(0);
    const spun: any = await (await room.fetch(req("spin", {}))).json();
    const value = spun.gameshow.spin.value;
    const answer = spun.gameshow.question.options.find(
      (o: string) => o === CYBER_QUESTIONS.find((q) => q.id === spun.gameshow.question.id)!.correctAnswer,
    );

    const res = await room.fetch(
      req("answer", { playerId: a.playerId, playerToken: a.playerToken, answer }),
    );
    const body: any = await res.json();
    expect(body.correct).toBe(true);
    expect(body.room.gameshow.teams[0].score).toBe(value);
  });

  it("awards nothing for a wrong answer but still reveals the key to that player", async () => {
    const room = await newGame();
    const a = await join(room, "A");
    fixRandom(0);
    await room.fetch(req("spin", {}));
    const body: any = await (
      await room.fetch(req("answer", { playerId: a.playerId, playerToken: a.playerToken, answer: "definitely wrong" }))
    ).json();
    expect(body.correct).toBe(false);
    expect(body.correctAnswer).toBeTruthy();
    expect(body.room.gameshow.teams[0].score).toBe(0);
  });

  it("rejects a player from a team whose turn it is not", async () => {
    const room = await newGame();
    await join(room, "A"); // blue
    const b = await join(room, "B"); // red
    fixRandom(0);
    await room.fetch(req("spin", {}));
    const res = await room.fetch(
      req("answer", { playerId: b.playerId, playerToken: b.playerToken, answer: "x" }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects an answer with a bad player token", async () => {
    const room = await newGame();
    const a = await join(room, "A");
    fixRandom(0);
    await room.fetch(req("spin", {}));
    const res = await room.fetch(req("answer", { playerId: a.playerId, playerToken: "nope", answer: "x" }));
    expect(res.status).toBe(403);
  });

  it("rejects an answer when no question is in play", async () => {
    const room = await newGame();
    const a = await join(room, "A");
    const res = await room.fetch(req("answer", { playerId: a.playerId, playerToken: a.playerToken, answer: "x" }));
    expect(res.status).toBe(409);
  });

  it("resolves a hazard spin with no question", async () => {
    const room = await newGame();
    await join(room, "A");
    fixRandom(2 / 12); // segment 2 is Lose a Turn
    const state: any = await (await room.fetch(req("spin", {}))).json();
    expect(state.gameshow.phase).toBe("resolved");
    expect(state.gameshow.question).toBeNull();
    expect(state.gameshow.lastOutcome).toMatch(/lost a turn/i);
  });

  it("hands play to the next team and clears the turn", async () => {
    const room = await newGame();
    await join(room, "A");
    fixRandom(0);
    await room.fetch(req("spin", {}));
    const state: any = await (await room.fetch(req("next-turn", {}))).json();
    expect(state.gameshow.turnIndex).toBe(1);
    expect(state.gameshow.phase).toBe("idle");
    expect(state.gameshow.question).toBeNull();
  });

  it("does not reuse a question within a game", async () => {
    const room = await newGame();
    await join(room, "A");
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      fixRandom(0);
      const s: any = await (await room.fetch(req("spin", {}))).json();
      if (s.gameshow.question) {
        expect(seen.has(s.gameshow.question.id)).toBe(false);
        seen.add(s.gameshow.question.id);
      }
      await room.fetch(req("next-turn", {}));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("refuses game-show actions on an ordinary quiz room", async () => {
    const room = new RoomDO(fakeState());
    await room.fetch(req("create", { code: "Q1" })); // defaults to quiz mode
    for (const action of ["spin", "next-turn", "answer"]) {
      const res = await room.fetch(req(action, {}));
      expect(res.status, `${action} on a quiz room`).toBe(409);
    }
  });
});

// The live quiz used to trust the browser: it graded its own answers and
// posted its own score. These pin the replacement — the room serves, times,
// grades and scores every question itself.
describe("RoomDO live quiz", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const T0 = new Date("2026-01-01T00:00:00Z").getTime();

  /** A started quiz with one player, with the clock under test control. */
  async function startedQuiz(opts: { timePerQuestion?: number; questionCount?: number } = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const room = new RoomDO(fakeState());
    await room.fetch(
      req("create", {
        code: "QUIZ01",
        questions: CYBER_QUESTIONS,
        questionCount: opts.questionCount ?? 3,
        timePerQuestion: opts.timePerQuestion ?? 20,
      }),
    );
    const me: any = await (await room.fetch(req("join", { name: "Alice" }))).json();
    await room.fetch(req("start", { durationMinutes: 30 }));
    const auth = { playerId: me.playerId, playerToken: me.playerToken };
    const next = async () => (await room.fetch(req("quiz-next", auth))).json() as Promise<any>;
    const answer = async (text: string) => room.fetch(req("quiz-answer", { ...auth, answer: text }));
    const keyFor = (id: string) => CYBER_QUESTIONS.find((q) => q.id === id)!.correctAnswer;
    const score = async () => ((await (await room.fetch(req("state"))).json()) as any).players[0].score;
    return { room, auth, next, answer, keyFor, score };
  }

  it("serves questions without the answer key", async () => {
    const { next } = await startedQuiz();
    const res = await next();
    expect(res.done).toBe(false);
    expect(res.total).toBe(3);
    expect(res.question).not.toHaveProperty("correctAnswer");
    expect(res.question).not.toHaveProperty("explanation");
    expect(JSON.stringify(res)).not.toContain("correctAnswer");
  });

  it("never puts the answer key in the room state students poll", async () => {
    const { room, next, answer, keyFor } = await startedQuiz();
    const q = (await next()).question;
    await answer(keyFor(q.id));
    const state = JSON.stringify(await (await room.fetch(req("state"))).json());
    expect(state).not.toContain("correctAnswer");
    expect(state).not.toContain("explanation");
  });

  it("rejects a wrong token and an unknown player", async () => {
    const { room, auth } = await startedQuiz();
    expect((await room.fetch(req("quiz-next", { ...auth, playerToken: "nope" }))).status).toBe(403);
    expect((await room.fetch(req("quiz-answer", { playerId: "ghost", playerToken: auth.playerToken, answer: "x" }))).status).toBe(403);
  });

  it("scores a correct answer from its own clock, with the speed bonus", async () => {
    const { next, answer, keyFor, score } = await startedQuiz({ timePerQuestion: 20 });
    const q = (await next()).question;
    vi.setSystemTime(T0 + 5_000); // 15 seconds left on a 20-second clock
    const res: any = await (await answer(keyFor(q.id))).json();
    expect(res.correct).toBe(true);
    expect(res.awarded).toBe(100 + 15 * 5);
    expect(res.correctAnswer).toBe(keyFor(q.id));
    expect(res.explanation).toBeTruthy();
    expect(await score()).toBe(175);
  });

  it("gives nothing for a wrong answer but still reveals the right one", async () => {
    const { next, answer, keyFor, score } = await startedQuiz();
    const q = (await next()).question;
    const res: any = await (await answer("definitely not the answer")).json();
    expect(res.correct).toBe(false);
    expect(res.awarded).toBe(0);
    expect(res.correctAnswer).toBe(keyFor(q.id));
    expect(await score()).toBe(0);
  });

  it("awards base points only when the session is untimed", async () => {
    const { next, answer, keyFor } = await startedQuiz({ timePerQuestion: 0 });
    const q = (await next()).question;
    vi.setSystemTime(T0 + 10 * 60_000); // ten minutes is fine when untimed
    const res: any = await (await answer(keyFor(q.id))).json();
    expect(res.correct).toBe(true);
    expect(res.awarded).toBe(100);
  });

  it("counts a right answer sent after the clock ran out as timed out", async () => {
    const { next, answer, keyFor, score } = await startedQuiz({ timePerQuestion: 20 });
    const q = (await next()).question;
    vi.setSystemTime(T0 + 20_000 + 4_000); // past the limit and the grace
    const res: any = await (await answer(keyFor(q.id))).json();
    expect(res.timedOut).toBe(true);
    expect(res.correct).toBe(false);
    expect(await score()).toBe(0);
  });

  it("lets each question be answered only once", async () => {
    const { next, answer, keyFor, score } = await startedQuiz();
    const q = (await next()).question;
    expect((await answer(keyFor(q.id))).status).toBe(200);
    const first = await score();
    // Re-sending the answer cannot score the same question twice.
    expect((await answer(keyFor(q.id))).status).toBe(409);
    expect(await score()).toBe(first);
  });

  it("will not grade a question that was never served", async () => {
    const { answer } = await startedQuiz();
    expect((await answer("anything")).status).toBe(409);
  });

  it("does not restart the clock when the same question is requested again", async () => {
    const { next } = await startedQuiz();
    const first = await next();
    vi.setSystemTime(T0 + 8_000);
    const again = await next();
    expect(again.question.id).toBe(first.question.id);
    expect(again.question.options).toEqual(first.question.options);
    expect(again.elapsedMs).toBe(8_000);
  });

  it("walks through the whole quiz and then reports done", async () => {
    const { next, answer, keyFor, score } = await startedQuiz({ questionCount: 3, timePerQuestion: 0 });
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const res = await next();
      expect(res.index).toBe(i);
      seen.add(res.question.id);
      await answer(keyFor(res.question.id));
    }
    expect(seen.size).toBe(3);
    expect((await next()).done).toBe(true);
    expect(await score()).toBe(300);
  });

  it("cannot be given a score: the old endpoint is gone", async () => {
    const { room, auth, score } = await startedQuiz();
    const res = await room.fetch(req("score", { ...auth, score: 100000, history: [] }));
    expect(res.status).toBe(404);
    expect(await score()).toBe(0);
  });

  it("builds the answer history itself, for the instructor reports", async () => {
    const { room, next, answer, keyFor } = await startedQuiz();
    const q = (await next()).question;
    await answer(keyFor(q.id));
    const metrics: any = await (await room.fetch(req("metrics"))).json();
    expect(metrics.players[0].history).toEqual([
      expect.objectContaining({ correct: true, question: expect.objectContaining({ id: q.id }) }),
    ]);
  });

  it("refuses answers before the session starts and after it ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const room = new RoomDO(fakeState());
    await room.fetch(req("create", { code: "QUIZ02", questions: CYBER_QUESTIONS }));
    const me: any = await (await room.fetch(req("join", { name: "Alice" }))).json();
    const auth = { playerId: me.playerId, playerToken: me.playerToken };
    expect((await room.fetch(req("quiz-next", auth))).status).toBe(409);

    await room.fetch(req("start", { durationMinutes: 1 }));
    expect((await room.fetch(req("quiz-next", auth))).status).toBe(200);
    await room.fetch(req("end", {}));
    expect((await room.fetch(req("quiz-answer", { ...auth, answer: "x" }))).status).toBe(409);
  });

  it("cannot be restarted once it has started", async () => {
    const { room } = await startedQuiz();
    expect((await room.fetch(req("start", { durationMinutes: 5 }))).status).toBe(409);
  });

  it("sorts players by score descending in public state", async () => {
    const { room, next, answer, keyFor } = await startedQuiz();
    const bob: any = await (await room.fetch(req("join", { name: "Bob" }))).json();
    // Alice answers correctly; Bob has not answered.
    const q = (await next()).question;
    await answer(keyFor(q.id));
    const state: any = await (await room.fetch(req("state"))).json();
    expect(state.players.map((p: any) => p.name)).toEqual(["Alice", "Bob"]);
    expect(bob.playerId).toBeTruthy();
  });
});
