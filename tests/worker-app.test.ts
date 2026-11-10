import { describe, it, expect } from "vitest";
import app, { type Env } from "../src/worker/index";
import { RoomDO } from "../src/worker/room-do";
import { GlobalDO } from "../src/worker/global-do";
import { createToken } from "../src/worker/auth";
import { CYBER_QUESTIONS } from "../src/server-data/question-bank";

// Route-level tests for the Cloudflare Worker — the code the live site runs.
// The Worker's routes are exercised for real; only the platform is faked: each
// Durable Object namespace hands out the real DO class over in-memory storage.

function fakeState() {
  const map = new Map<string, any>();
  return {
    storage: {
      get: async (key: string) => map.get(key),
      put: async (key: string, value: any) => void map.set(key, value),
      delete: async (key: string) => map.delete(key),
      deleteAll: async () => map.clear(),
    },
  } as any;
}

function fakeNamespace<T extends { fetch(r: Request): Promise<Response> }>(make: () => T) {
  const objects = new Map<string, T>();
  return {
    idFromName: (name: string) => name,
    get: (id: string) => {
      if (!objects.has(id)) objects.set(id, make());
      const object = objects.get(id)!;
      return { fetch: (url: string, init?: RequestInit) => object.fetch(new Request(url, init)) };
    },
  } as any;
}

const PASSWORD = "worker-test-password";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } as any,
    ROOMS: fakeNamespace(() => new RoomDO(fakeState())),
    GLOBAL: fakeNamespace(() => new GlobalDO(fakeState())),
    APP_PASSWORD: PASSWORD,
    ...overrides,
  };
}

function call(env: Env, path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  return app.fetch(
    new Request(`https://example.test${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    env,
  );
}

async function signIn(env: Env, password = PASSWORD) {
  return call(env, "/api/auth/login", { body: { password } });
}

describe("Worker: instructor sign-in", () => {
  it("signs in with the configured password", async () => {
    const res = await signIn(makeEnv());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).token).toBeTruthy();
  });

  it("rejects a wrong password", async () => {
    expect((await signIn(makeEnv(), "wrong")).status).toBe(401);
  });

  // The repository is public. A built-in fallback password is a password
  // everyone knows, so with no secret configured sign-in must be refused.
  describe("with no APP_PASSWORD configured", () => {
    const env = () => makeEnv({ APP_PASSWORD: undefined });

    it("refuses sign-in outright", async () => {
      const res = await signIn(env(), "anything");
      expect(res.status).toBe(503);
    });

    it("does not accept the old default password", async () => {
      expect((await signIn(env(), "readyforce")).status).toBe(503);
    });

    it("does not accept a token forged from the old default password", async () => {
      const forged = await createToken("readyforce");
      expect((await call(env(), "/api/sessions", { token: forged })).status).toBe(401);
      expect((await call(env(), "/api/session", { body: {}, token: forged })).status).toBe(401);
    });

    it("treats an empty secret the same as a missing one", async () => {
      expect((await signIn(makeEnv({ APP_PASSWORD: "" }), "")).status).toBe(503);
    });

    it("still serves students", async () => {
      expect((await call(env(), "/api/questions")).status).toBe(200);
    });
  });
});

describe("Worker: answer key exposure", () => {
  it("serves students the bank without answers or explanations", async () => {
    const res = await call(makeEnv(), "/api/questions");
    const { questions } = (await res.json()) as { questions: any[] };
    expect(questions).toHaveLength(CYBER_QUESTIONS.length);
    const raw = JSON.stringify(questions);
    expect(raw).not.toContain("correctAnswer");
    for (const q of CYBER_QUESTIONS) expect(raw).not.toContain(q.explanation);
  });

  it("treats an invalid token as a student, not an instructor", async () => {
    const res = await call(makeEnv(), "/api/questions", { token: "123.abc" });
    expect(JSON.stringify(await res.json())).not.toContain("correctAnswer");
  });

  it("serves a signed-in instructor the full bank, to edit", async () => {
    const env = makeEnv();
    const { token } = (await (await signIn(env)).json()) as any;
    const { questions } = (await (await call(env, "/api/questions", { token })).json()) as any;
    expect(questions[0]).toHaveProperty("correctAnswer");
  });

  it("grades a solo-practice answer on the server", async () => {
    const env = makeEnv();
    const q = CYBER_QUESTIONS[0];
    const right: any = await (
      await call(env, "/api/questions/check", { body: { questionId: q.id, answer: q.correctAnswer } })
    ).json();
    expect(right).toEqual({ correct: true, correctAnswer: q.correctAnswer, explanation: q.explanation });

    const wrong: any = await (
      await call(env, "/api/questions/check", { body: { questionId: q.id, answer: "nope" } })
    ).json();
    expect(wrong.correct).toBe(false);

    const missing = await call(env, "/api/questions/check", { body: { questionId: "nope", answer: "x" } });
    expect(missing.status).toBe(404);
  });

  it("lets only an instructor reset the bank, and restores the built-in set", async () => {
    const env = makeEnv();
    expect((await call(env, "/api/questions/reset", { body: {} })).status).toBe(401);

    const { token } = (await (await signIn(env)).json()) as any;
    await call(env, "/api/questions", { method: "PUT", body: { questions: [] }, token });
    expect(((await (await call(env, "/api/questions", { token })).json()) as any).questions).toHaveLength(0);

    const reset = await call(env, "/api/questions/reset", { body: {}, token });
    expect(reset.status).toBe(200);
    expect(((await (await call(env, "/api/questions")).json()) as any).questions).toHaveLength(
      CYBER_QUESTIONS.length,
    );
  });
});

describe("Worker: live quiz", () => {
  async function startedQuiz() {
    const env = makeEnv();
    const { token } = (await (await signIn(env)).json()) as any;
    const { code } = (await (
      await call(env, "/api/session", { body: { questionCount: 3, timePerQuestion: 0 }, token })
    ).json()) as any;
    const me: any = await (await call(env, `/api/session/${code}/join`, { body: { name: "Alice" } })).json();
    await call(env, `/api/session/${code}/start`, { body: { durationMinutes: 10 }, token });
    const auth = { playerId: me.playerId, playerToken: me.playerToken };
    return { env, code, auth, token };
  }

  it("serves, grades and scores a quiz without ever sending the key first", async () => {
    const { env, code, auth } = await startedQuiz();

    for (let i = 0; i < 3; i++) {
      const served: any = await (await call(env, `/api/session/${code}/quiz/next`, { body: auth })).json();
      expect(served.done).toBe(false);
      expect(JSON.stringify(served)).not.toContain("correctAnswer");

      const key = CYBER_QUESTIONS.find((q) => q.id === served.question.id)!.correctAnswer;
      const graded: any = await (
        await call(env, `/api/session/${code}/quiz/answer`, { body: { ...auth, answer: key } })
      ).json();
      expect(graded.correct).toBe(true);
      expect(graded.score).toBe((i + 1) * 100);
    }

    const done: any = await (await call(env, `/api/session/${code}/quiz/next`, { body: auth })).json();
    expect(done.done).toBe(true);

    const state: any = await (await call(env, `/api/session/${code}`)).json();
    expect(state.players[0]).toMatchObject({ name: "Alice", score: 300 });
    expect(JSON.stringify(state)).not.toContain("correctAnswer");
  });

  it("gives a client no way to report its own score", async () => {
    const { env, code, auth } = await startedQuiz();
    const res = await call(env, `/api/session/${code}/score`, { body: { ...auth, score: 100000, history: [] } });
    expect(res.status).toBe(404);
    const state: any = await (await call(env, `/api/session/${code}`)).json();
    expect(state.players[0].score).toBe(0);
  });

  it("rejects quiz calls with a wrong player token", async () => {
    const { env, code, auth } = await startedQuiz();
    const res = await call(env, `/api/session/${code}/quiz/next`, { body: { ...auth, playerToken: "nope" } });
    expect(res.status).toBe(403);
  });

  it("feeds the instructor reports from the server's own record", async () => {
    const { env, code, auth, token } = await startedQuiz();
    const served: any = await (await call(env, `/api/session/${code}/quiz/next`, { body: auth })).json();
    await call(env, `/api/session/${code}/quiz/answer`, { body: { ...auth, answer: "wrong on purpose" } });

    const metrics: any = await (await call(env, "/api/metrics", { token })).json();
    const stat = metrics.questionStats.find((s: any) => s.id === served.question.id);
    expect(stat).toMatchObject({ attempted: 1, correct: 0 });
  });
});
