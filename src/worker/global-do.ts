/// <reference types="@cloudflare/workers-types" />

// A single Durable Object instance (named "global") that holds cross-room state:
// the editable question bank, the login rate-limit counters, and a registry of
// active room codes (so the dashboard and metrics can enumerate sessions).
import { CYBER_QUESTIONS } from "../server-data/question-bank";
import { reconcileBank } from "../lib/questions";
import { addQuestion, updateQuestion, removeQuestion, validateBank } from "../lib/bank-edits";
import type { Question } from "../constants";

interface RateEntry {
  count: number;
  resetAt: number;
}

export class GlobalDO {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^\//, "");
    const body: any = request.method !== "GET" ? await request.json().catch(() => ({})) : {};
    const json = (data: unknown, status = 200) => Response.json(data, { status });
    const storage = this.state.storage;

    /** The bank as it stands: the stored copy, or the built-in set if none. */
    const loadBank = async (): Promise<Question[]> => {
      const stored = await storage.get<any[]>("questions");
      if (!stored) return CYBER_QUESTIONS;
      // A bank saved before a schema field existed would otherwise be served
      // forever, silently disabling anything that depends on that field.
      // Patch in the missing metadata and persist the repair once.
      const { questions, repaired } = reconcileBank(stored, CYBER_QUESTIONS);
      if (repaired) await storage.put("questions", questions);
      return questions;
    };

    switch (action) {
      case "questions:get": {
        return json({ questions: await loadBank() });
      }

      case "questions:set": {
        const checked = validateBank(body.questions);
        if (!checked.ok) return json({ error: checked.error }, checked.status);
        await storage.put("questions", checked.value);
        return json({ questions: checked.value });
      }

      // One question at a time. A Durable Object handles one request at a
      // time, so read-change-write here can't lose another instructor's edit.
      case "questions:add":
      case "questions:update":
      case "questions:delete": {
        const bank = await loadBank();
        const result =
          action === "questions:add"
            ? addQuestion(bank, body.question)
            : action === "questions:update"
              ? updateQuestion(bank, String(body.id ?? ""), body.question)
              : removeQuestion(bank, String(body.id ?? ""));
        if (!result.ok) return json({ error: result.error }, result.status);
        await storage.put("questions", result.value.bank);
        return json(
          { question: result.value.question, questions: result.value.bank },
          action === "questions:add" ? 201 : 200,
        );
      }

      // Restore the built-in bank. Dropping the stored copy is enough:
      // questions:get serves the built-in set whenever nothing is stored.
      case "questions:reset": {
        await storage.delete("questions");
        return json({ questions: CYBER_QUESTIONS });
      }

      case "rate": {
        const { key, limit, windowMs } = body;
        const now = Date.now();
        const map = (await storage.get<Record<string, RateEntry>>("rate")) ?? {};
        // Prune expired entries so the map can't grow without bound.
        for (const k of Object.keys(map)) if (now > map[k].resetAt) delete map[k];
        const e = map[key];
        let limited = false;
        if (!e || now > e.resetAt) {
          map[key] = { count: 1, resetAt: now + windowMs };
        } else if (e.count >= limit) {
          limited = true;
        } else {
          e.count++;
        }
        await storage.put("rate", map);
        return json({ limited });
      }

      case "rooms:add": {
        const rooms = (await storage.get<Record<string, number>>("rooms")) ?? {};
        rooms[body.code] = Date.now();
        await storage.put("rooms", rooms);
        return json({ ok: true });
      }

      case "rooms:remove": {
        const rooms = (await storage.get<Record<string, number>>("rooms")) ?? {};
        delete rooms[body.code];
        await storage.put("rooms", rooms);
        return json({ ok: true });
      }

      case "rooms:list": {
        const rooms = (await storage.get<Record<string, number>>("rooms")) ?? {};
        return json({
          rooms: Object.entries(rooms).map(([code, createdAt]) => ({ code, createdAt })),
        });
      }

      default:
        return json({ error: "Unknown action." }, 404);
    }
  }
}
