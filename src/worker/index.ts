/// <reference types="@cloudflare/workers-types" />

// Cloudflare Pages Worker (Advanced mode). Serves the static client via the
// ASSETS binding and implements the same /api the Node server does, backed by
// Durable Objects instead of in-memory Maps.
import { Hono } from "hono";
import { RoomDO } from "./room-do";
import { GlobalDO } from "./global-do";
import { createToken, verifyToken, passwordMatches } from "./auth";
import { computeMetrics } from "../lib/metrics";
import { toPublicQuestion, revealAnswer } from "../lib/quiz";
import type { Question } from "../constants";

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
  GLOBAL: DurableObjectNamespace;
  APP_PASSWORD?: string;
  GEMINI_API_KEY?: string;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

// There is deliberately no built-in password. This repository is public, so
// any default written here is known to everyone; with the APP_PASSWORD secret
// unset, instructor sign-in is refused rather than falling back to one.
const password = (env: Env): string | null => env.APP_PASSWORD || null;
const globalStub = (env: Env) => env.GLOBAL.get(env.GLOBAL.idFromName("global"));
const roomStub = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

function callDO(stub: DurableObjectStub, action: string, body?: unknown): Promise<Response> {
  return stub.fetch(`https://do/${action}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function isInstructor(env: Env, authHeader: string | undefined): Promise<boolean> {
  const secret = password(env);
  if (!secret) return false;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return verifyToken(secret, token);
}

// Proxy a Durable Object's JSON Response straight back to the client.
const proxy = (res: Response) => new Response(res.body, res);

const app = new Hono<{ Bindings: Env }>();
const api = new Hono<{ Bindings: Env }>();

api.post("/auth/login", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "unknown";
  const rl = await (
    await callDO(globalStub(c.env), "rate", { key: `login:${ip}`, limit: 5, windowMs: 60_000 })
  ).json<{ limited: boolean }>();
  if (rl.limited) return c.json({ error: "Too many attempts. Try again later." }, 429);
  const secret = password(c.env);
  if (!secret) {
    return c.json(
      { error: "Instructor sign-in is not configured. Set the APP_PASSWORD secret on the Worker." },
      503,
    );
  }
  const { password: pw } = await c.req.json().catch(() => ({}) as any);
  if (typeof pw !== "string" || !(await passwordMatches(pw, secret))) {
    return c.json({ error: "Incorrect password." }, 401);
  }
  return c.json({ token: await createToken(secret) });
});

/** The full bank, answers included. Never returned to a student as-is. */
async function fullBank(env: Env): Promise<Question[]> {
  const res = await callDO(globalStub(env), "questions:get");
  return ((await res.json()) as { questions: Question[] }).questions ?? [];
}

// Students get the bank without its answer key and with options shuffled.
// Only a signed-in instructor (who edits the bank) gets the full records.
api.get("/questions", async (c) => {
  const questions = await fullBank(c.env);
  if (await isInstructor(c.env, c.req.header("Authorization"))) return c.json({ questions });
  return c.json({ questions: questions.map((q) => toPublicQuestion(q)) });
});

// Grade one answer for solo practice. Nothing is recorded — solo play has no
// score on the server — but it keeps the key out of the browser.
api.post("/questions/check", async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const question = (await fullBank(c.env)).find((q) => q.id === body.questionId);
  if (!question) return c.json({ error: "Question not found." }, 404);
  return c.json(revealAnswer(question, body.answer));
});

// Restore the built-in bank. The built-in questions live on the server only,
// so the client can no longer send them back itself.
api.post("/questions/reset", async (c) => {
  if (!(await isInstructor(c.env, c.req.header("Authorization")))) {
    return c.json({ error: "Instructor sign-in required." }, 401);
  }
  return proxy(await callDO(globalStub(c.env), "questions:reset", {}));
});

api.put("/questions", async (c) => {
  if (!(await isInstructor(c.env, c.req.header("Authorization")))) {
    return c.json({ error: "Instructor sign-in required." }, 401);
  }
  const body = await c.req.json().catch(() => ({}) as any);
  return proxy(await callDO(globalStub(c.env), "questions:set", { questions: body.questions }));
});

api.post("/session", async (c) => {
  if (!(await isInstructor(c.env, c.req.header("Authorization")))) {
    return c.json({ error: "Instructor sign-in required." }, 401);
  }
  const body = await c.req.json().catch(() => ({}) as any);
  const code = newCode();

  // Every room serves and grades its own questions, so hand it a snapshot of
  // the question bank (which otherwise lives in GlobalDO) at creation time.
  const questions = await fullBank(c.env);

  await callDO(roomStub(c.env, code), "create", { code, ...body, questions });
  await callDO(globalStub(c.env), "rooms:add", { code });
  return c.json({ code });
});

api.get("/sessions", async (c) => {
  if (!(await isInstructor(c.env, c.req.header("Authorization")))) {
    return c.json({ error: "Instructor sign-in required." }, 401);
  }
  const { rooms } = await (await callDO(globalStub(c.env), "rooms:list")).json<{
    rooms: { code: string; createdAt: number }[];
  }>();
  const sessions: any[] = [];
  for (const { code, createdAt } of rooms) {
    const res = await callDO(roomStub(c.env, code), "state");
    if (res.ok) {
      const r: any = await res.json();
      sessions.push({ code, status: r.status, difficulty: r.difficulty, playerCount: r.players.length, createdAt });
    }
  }
  sessions.sort((a, b) => b.createdAt - a.createdAt);
  return c.json({ sessions });
});

api.get("/session/:code", async (c) =>
  proxy(await callDO(roomStub(c.env, c.req.param("code").toUpperCase()), "state")),
);

api.post("/session/:code/join", async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  return proxy(await callDO(roomStub(c.env, c.req.param("code").toUpperCase()), "join", body));
});

api.post("/session/:code/settings", async (c) => {
  if (!(await isInstructor(c.env, c.req.header("Authorization")))) {
    return c.json({ error: "Instructor sign-in required." }, 401);
  }
  const body = await c.req.json().catch(() => ({}) as any);
  return proxy(await callDO(roomStub(c.env, c.req.param("code").toUpperCase()), "settings", body));
});

api.post("/session/:code/start", async (c) => {
  if (!(await isInstructor(c.env, c.req.header("Authorization")))) {
    return c.json({ error: "Instructor sign-in required." }, 401);
  }
  const body = await c.req.json().catch(() => ({}) as any);
  return proxy(await callDO(roomStub(c.env, c.req.param("code").toUpperCase()), "start", body));
});

api.post("/session/:code/end", async (c) => {
  if (!(await isInstructor(c.env, c.req.header("Authorization")))) {
    return c.json({ error: "Instructor sign-in required." }, 401);
  }
  return proxy(await callDO(roomStub(c.env, c.req.param("code").toUpperCase()), "end", {}));
});

// ---- Game show ---------------------------------------------------------
api.post("/session/:code/spin", async (c) => {
  if (!(await isInstructor(c.env, c.req.header("Authorization")))) {
    return c.json({ error: "Instructor sign-in required." }, 401);
  }
  return proxy(await callDO(roomStub(c.env, c.req.param("code").toUpperCase()), "spin", {}));
});

api.post("/session/:code/next-turn", async (c) => {
  if (!(await isInstructor(c.env, c.req.header("Authorization")))) {
    return c.json({ error: "Instructor sign-in required." }, 401);
  }
  return proxy(await callDO(roomStub(c.env, c.req.param("code").toUpperCase()), "next-turn", {}));
});

// Players answer directly — the Durable Object checks the player token and
// that it is actually their team's turn.
api.post("/session/:code/answer", async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  return proxy(await callDO(roomStub(c.env, c.req.param("code").toUpperCase()), "answer", body));
});

api.delete("/session/:code", async (c) => {
  if (!(await isInstructor(c.env, c.req.header("Authorization")))) {
    return c.json({ error: "Instructor sign-in required." }, 401);
  }
  const code = c.req.param("code").toUpperCase();
  await callDO(roomStub(c.env, code), "destroy", {});
  await callDO(globalStub(c.env), "rooms:remove", { code });
  return c.json({ ok: true });
});

// ---- Live quiz -----------------------------------------------------------
// Players call these directly — the Durable Object checks the player token,
// serves and times each question, grades the answer and keeps the score.
api.post("/session/:code/quiz/next", async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  return proxy(await callDO(roomStub(c.env, c.req.param("code").toUpperCase()), "quiz-next", body));
});

api.post("/session/:code/quiz/answer", async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  return proxy(await callDO(roomStub(c.env, c.req.param("code").toUpperCase()), "quiz-answer", body));
});

api.get("/metrics", async (c) => {
  if (!(await isInstructor(c.env, c.req.header("Authorization")))) {
    return c.json({ error: "Instructor sign-in required." }, 401);
  }
  const { rooms } = await (await callDO(globalStub(c.env), "rooms:list")).json<{ rooms: { code: string }[] }>();
  const allPlayers: any[] = [];
  for (const { code } of rooms) {
    const res = await callDO(roomStub(c.env, code), "metrics");
    if (res.ok) {
      const d: any = await res.json();
      allPlayers.push(...d.players);
    }
  }

  return c.json(computeMetrics(allPlayers));
});

api.post("/metrics/analyze", async (c) => {
  if (!(await isInstructor(c.env, c.req.header("Authorization")))) {
    return c.json({ error: "Instructor sign-in required." }, 401);
  }
  if (!c.env.GEMINI_API_KEY) return c.json({ error: "AI suggestions are not configured." }, 503);
  const { metrics } = await c.req.json().catch(() => ({}) as any);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${c.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You are an expert instructional designer and game metric analyst. Based on the following metrics, suggest 3 practical improvements for the assessment or teaching plan.\n\nMetrics:\n${JSON.stringify(metrics, null, 2)}\n\nProvide your analysis in JSON format with an array of "suggestions", each containing a "title" and "description".`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                suggestions: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: { title: { type: "STRING" }, description: { type: "STRING" } },
                    required: ["title", "description"],
                  },
                },
              },
              required: ["suggestions"],
            },
          },
        }),
      },
    );
    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("No response from AI");
    return c.json(JSON.parse(text));
  } catch (e) {
    console.error("Gemini error:", e);
    return c.json({ error: "Failed to fetch AI suggestions." }, 500);
  }
});

app.route("/api", api);

// Everything else is a static asset served by Pages.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
export { RoomDO, GlobalDO };
