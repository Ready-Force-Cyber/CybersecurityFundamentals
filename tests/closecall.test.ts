import { describe, it, expect } from "vitest";
import {
  CLOSE_CALL_POINTS,
  CLOSE_CALL_ROUND_CHOICES,
  closeCallView,
  createCloseCallState,
  describeEntry,
  nextRound,
  parseGuess,
  revealRound,
  scoreGuesses,
  submitGuess,
  type CloseCallItem,
} from "../src/lib/closecall";
import { CLOSE_CALL_ITEMS } from "../src/server-data/closecall-items";
import { CONCEPT_IDS } from "../src/lib/bank-edits";

const item = (answer: number, id = "x"): CloseCallItem => ({
  id,
  prompt: "How many?",
  unit: "things",
  answer,
  explanation: "Because.",
  concept: "authentication",
});

describe("Close Call items", () => {
  it("has enough items for the largest game", () => {
    expect(CLOSE_CALL_ITEMS.length).toBeGreaterThanOrEqual(Math.max(...CLOSE_CALL_ROUND_CHOICES));
  });

  it("gives every item a unique id, a whole-number answer, an explanation and one of the five concepts", () => {
    const ids = new Set(CLOSE_CALL_ITEMS.map((i) => i.id));
    expect(ids.size).toBe(CLOSE_CALL_ITEMS.length);
    for (const i of CLOSE_CALL_ITEMS) {
      expect(Number.isSafeInteger(i.answer), i.id).toBe(true);
      expect(i.answer, i.id).toBeGreaterThan(0);
      expect(i.explanation.length, i.id).toBeGreaterThan(20);
      expect(i.prompt.endsWith("?"), i.id).toBe(true);
      expect(CONCEPT_IDS, i.id).toContain(i.concept);
    }
  });

  it("covers all five concepts", () => {
    expect(new Set(CLOSE_CALL_ITEMS.map((i) => i.concept))).toEqual(new Set(CONCEPT_IDS));
  });
});

describe("parseGuess", () => {
  it("accepts whole numbers, with or without commas", () => {
    expect(parseGuess(443)).toBe(443);
    expect(parseGuess("10,000")).toBe(10_000);
    expect(parseGuess(" 1 000 000 ")).toBe(1_000_000);
    expect(parseGuess(0)).toBe(0);
  });

  it("rejects anything else", () => {
    for (const bad of [-1, 1.5, "abc", "", null, undefined, NaN, Infinity, 1e15, {}]) {
      expect(parseGuess(bad), String(bad)).toBeNull();
    }
  });
});

describe("scoreGuesses: closest without going over", () => {
  it("gives the round to the closest guess that isn't over", () => {
    const r = scoreGuesses(443, { a: 400, b: 440, c: 450, d: 80 });
    expect(r.winners).toEqual(["b"]);
    const byId = Object.fromEntries(r.entries.map((e) => [e.playerId, e]));
    expect(byId.b.points).toBe(CLOSE_CALL_POINTS.closest);
    expect(byId.c.over).toBe(true);
    expect(byId.c.points).toBe(0);
    // 400 is within 10% under 443, so it earns the "close call" points
    expect(byId.a.near).toBe(true);
    expect(byId.a.points).toBe(CLOSE_CALL_POINTS.near);
    expect(byId.d.points).toBe(0);
  });

  it("pays double for an exact guess", () => {
    const r = scoreGuesses(2017, { a: 2017, b: 2010 });
    expect(r.winners).toEqual(["a"]);
    expect(r.entries[0]).toMatchObject({ playerId: "a", exact: true, points: CLOSE_CALL_POINTS.exact });
  });

  it("shares the win between tied guesses", () => {
    const r = scoreGuesses(100, { a: 90, b: 90, c: 50 });
    expect(r.winners.sort()).toEqual(["a", "b"]);
  });

  it("has no winner when everyone goes over", () => {
    const r = scoreGuesses(22, { a: 80, b: 443 });
    expect(r.everyoneOver).toBe(true);
    expect(r.winners).toEqual([]);
    expect(r.entries.every((e) => e.points === 0)).toBe(true);
  });

  it("lists the closest under first, then the overs from least to most", () => {
    const r = scoreGuesses(100, { a: 120, b: 95, c: 101, d: 50 });
    expect(r.entries.map((e) => e.playerId)).toEqual(["b", "d", "c", "a"]);
  });

  it("copes with a round nobody guessed", () => {
    const r = scoreGuesses(7, {});
    expect(r).toMatchObject({ entries: [], winners: [], everyoneOver: false });
  });
});

describe("a game of Close Call", () => {
  const items = [item(10, "one"), item(20, "two"), item(30, "three")];

  it("picks the requested number of items, no more than exist", () => {
    expect(createCloseCallState(items, 2).itemIds).toHaveLength(2);
    expect(createCloseCallState(items, 10).itemIds).toHaveLength(3);
  });

  it("runs guess → reveal → next, and ends after the last item", () => {
    let state = createCloseCallState(items, 2, () => 0);
    const g = submitGuess(state, "p1", 9);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    state = g.state;

    // Before the reveal, the view shows who locked in but no values or answer.
    const before = closeCallView(state, items);
    expect(before.lockedIn).toEqual(["p1"]);
    expect(before.result).toBeNull();
    expect(JSON.stringify(before)).not.toContain('"answer"');
    expect(before.item).not.toHaveProperty("answer");

    const current = items.find((i) => i.id === state.itemIds[0])!;
    const revealed = revealRound(state, current);
    expect(revealed.ok).toBe(true);
    if (!revealed.ok) return;
    state = revealed.state;
    expect(closeCallView(state, items).result?.answer).toBe(current.answer);

    // No guessing or second reveal once it's out.
    expect(submitGuess(state, "p2", 5).ok).toBe(false);
    expect(revealRound(state, current).ok).toBe(false);

    const next = nextRound(state);
    expect(next.ok && !next.finished).toBe(true);
    if (!next.ok) return;
    state = next.state;
    expect(state).toMatchObject({ index: 1, phase: "guessing", guesses: {}, result: null });

    // Can't skip a round without revealing it.
    expect(nextRound(state).ok).toBe(false);
    const r2 = revealRound(state, items.find((i) => i.id === state.itemIds[1])!);
    if (!r2.ok) throw new Error("reveal failed");
    const end = nextRound(r2.state);
    expect(end.ok && end.finished).toBe(true);
    if (end.ok) expect(end.state.phase).toBe("final");
  });

  it("lets a player change their guess until the reveal", () => {
    let state = createCloseCallState(items, 1);
    const a = submitGuess(state, "p1", 5);
    if (!a.ok) throw new Error();
    const b = submitGuess(a.state, "p1", 7);
    if (!b.ok) throw new Error();
    expect(b.state.guesses).toEqual({ p1: 7 });
  });

  it("rejects a guess that isn't a whole number", () => {
    const res = submitGuess(createCloseCallState(items, 1), "p1", "lots");
    expect(res).toMatchObject({ ok: false, status: 400 });
  });
});

describe("describeEntry", () => {
  it("reads naturally", () => {
    const r = scoreGuesses(1000, { exact: 1000, over: 1012 });
    const r2 = scoreGuesses(1000, { win: 950, near: 920, far: 10 });
    const find = (res: typeof r, id: string) => res.entries.find((e) => e.playerId === id)!;
    expect(describeEntry(find(r, "exact"), 1000)).toBe("Right on the number!");
    expect(describeEntry(find(r, "over"), 1000)).toBe("Over by 12");
    expect(describeEntry(find(r2, "win"), 1000)).toBe("Closest without going over · under by 50");
    expect(describeEntry(find(r2, "near"), 1000)).toBe("Close call · under by 80");
    expect(describeEntry(find(r2, "far"), 1000)).toBe("Under by 990");
  });
});
