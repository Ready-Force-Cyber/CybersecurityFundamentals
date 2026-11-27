// Close Call: a class game show where everyone guesses a number about
// cybersecurity (how many 4-digit PINs exist, which port HTTPS uses, the year
// WannaCry hit) and the closest guess *without going over* wins the round.
//
// This module holds the rules only, as pure functions shared by the Node
// server and the Cloudflare Durable Object. The items themselves, with their
// answers, live in server-data/ and never reach the browser: a guess's value
// and the answer stay on the server until the host reveals the round.

/** One thing to guess. Server-only: it carries the answer. */
export interface CloseCallItem {
  id: string;
  prompt: string;
  /** What the number counts, e.g. "PINs", "port", "year". */
  unit: string;
  answer: number;
  explanation: string;
  concept: string;
}

/** How many items a game can have. */
export const CLOSE_CALL_ROUND_CHOICES = [5, 8, 10] as const;
export const DEFAULT_CLOSE_CALL_ROUNDS = 8;

/** Largest guess accepted; nothing in the game is anywhere near this. */
export const MAX_GUESS = 1_000_000_000_000;

/** Points for a round. */
export const CLOSE_CALL_POINTS = {
  /** Exactly right. */
  exact: 2000,
  /** Closest without going over (shared by everyone tied on that guess). */
  closest: 1000,
  /** Not the winner, but under and within NEAR_FRACTION of the answer. */
  near: 250,
} as const;
export const NEAR_FRACTION = 0.1;

export type CloseCallPhase = "guessing" | "revealed" | "final";

export interface CloseCallEntry {
  playerId: string;
  guess: number;
  over: boolean;
  exact: boolean;
  winner: boolean;
  near: boolean;
  points: number;
}

export interface CloseCallResult {
  answer: number;
  explanation: string;
  /** Closest under first, then the overs from least to most. */
  entries: CloseCallEntry[];
  winners: string[];
  everyoneOver: boolean;
}

export interface CloseCallState {
  itemIds: string[];
  index: number;
  phase: CloseCallPhase;
  /** This round's guesses by player id. Never sent to a browser before the reveal. */
  guesses: Record<string, number>;
  result: CloseCallResult | null;
}

/** What browsers see: the item without its answer, and who has locked in. */
export interface CloseCallView {
  index: number;
  total: number;
  phase: CloseCallPhase;
  item: { id: string; prompt: string; unit: string; concept: string } | null;
  lockedIn: string[];
  result: CloseCallResult | null;
}

type Fail = { ok: false; status: number; error: string };

/** Choose this game's items in a random order. */
export function createCloseCallState(
  items: { id: string }[],
  rounds: number,
  random: () => number = Math.random,
): CloseCallState {
  const count = Math.max(1, Math.min(items.length, Math.floor(rounds) || DEFAULT_CLOSE_CALL_ROUNDS));
  const ids = items.map((i) => i.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return { itemIds: ids.slice(0, count), index: 0, phase: "guessing", guesses: {}, result: null };
}

/** Read a guess: a whole number from 0 up to MAX_GUESS. Commas and spaces are fine. */
export function parseGuess(raw: unknown): number | null {
  let n = raw;
  if (typeof raw === "string") {
    const digits = raw.replace(/[\s,]/g, "");
    // Number("") is 0, so an empty box must not count as a guess of zero.
    n = digits === "" ? NaN : Number(digits);
  }
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0 || n > MAX_GUESS) return null;
  return n;
}

/** A player locks in (or changes) their guess for the current round. */
export function submitGuess(
  state: CloseCallState,
  playerId: string,
  raw: unknown,
): { ok: true; state: CloseCallState; guess: number } | Fail {
  if (state.phase !== "guessing") {
    return { ok: false, status: 409, error: "Guessing is closed for this round." };
  }
  const guess = parseGuess(raw);
  if (guess === null) {
    return { ok: false, status: 400, error: "Enter a whole number, 0 or more." };
  }
  return { ok: true, state: { ...state, guesses: { ...state.guesses, [playerId]: guess } }, guess };
}

/** Score one round's guesses against the answer. */
export function scoreGuesses(answer: number, guesses: Record<string, number>): Omit<CloseCallResult, "explanation"> {
  const all = Object.entries(guesses).map(([playerId, guess]) => ({ playerId, guess }));
  const under = all.filter((g) => g.guess <= answer);
  const best = under.length ? Math.max(...under.map((g) => g.guess)) : null;

  const entries: CloseCallEntry[] = all.map(({ playerId, guess }) => {
    const over = guess > answer;
    const exact = guess === answer;
    const winner = !over && guess === best;
    const near = !over && !winner && answer - guess <= answer * NEAR_FRACTION;
    const points = exact
      ? CLOSE_CALL_POINTS.exact
      : winner
        ? CLOSE_CALL_POINTS.closest
        : near
          ? CLOSE_CALL_POINTS.near
          : 0;
    return { playerId, guess, over, exact, winner, near, points };
  });

  entries.sort((a, b) => {
    if (a.over !== b.over) return a.over ? 1 : -1;
    return a.over ? a.guess - b.guess : b.guess - a.guess;
  });

  return {
    answer,
    entries,
    winners: entries.filter((e) => e.winner).map((e) => e.playerId),
    everyoneOver: all.length > 0 && under.length === 0,
  };
}

/** Host reveals the answer: guessing closes and the round is scored. */
export function revealRound(
  state: CloseCallState,
  item: CloseCallItem,
): { ok: true; state: CloseCallState; result: CloseCallResult } | Fail {
  if (state.phase !== "guessing") {
    return { ok: false, status: 409, error: "This round has already been revealed." };
  }
  const result: CloseCallResult = { ...scoreGuesses(item.answer, state.guesses), explanation: item.explanation };
  return { ok: true, state: { ...state, phase: "revealed", result }, result };
}

/** Host moves on: the next item, or the end of the game after the last one. */
export function nextRound(state: CloseCallState): { ok: true; state: CloseCallState; finished: boolean } | Fail {
  if (state.phase !== "revealed") {
    return { ok: false, status: 409, error: "Reveal this round before moving on." };
  }
  if (state.index + 1 >= state.itemIds.length) {
    return { ok: true, state: { ...state, phase: "final" }, finished: true };
  }
  return {
    ok: true,
    state: { ...state, index: state.index + 1, phase: "guessing", guesses: {}, result: null },
    finished: false,
  };
}

/** The browser-safe view: no answer and no guess values until the reveal. */
export function closeCallView(state: CloseCallState, items: CloseCallItem[]): CloseCallView {
  const item = items.find((i) => i.id === state.itemIds[state.index]) ?? null;
  return {
    index: state.index,
    total: state.itemIds.length,
    phase: state.phase,
    item: item ? { id: item.id, prompt: item.prompt, unit: item.unit, concept: item.concept } : null,
    lockedIn: Object.keys(state.guesses),
    result: state.phase === "guessing" ? null : state.result,
  };
}

/**
 * Write a number the way people read that kind of number: years and port
 * numbers without a thousands separator (2017, port 3389), counts with one
 * (1,000,000 codes).
 */
export function formatNumber(n: number, unit?: string): string {
  return unit === "year" || unit === "port" ? String(n) : n.toLocaleString();
}

/** How a single entry reads to the player, e.g. "Over by 12". */
export function describeEntry(entry: CloseCallEntry, answer: number): string {
  if (entry.exact) return "Right on the number!";
  if (entry.over) return `Over by ${(entry.guess - answer).toLocaleString()}`;
  const under = `Under by ${(answer - entry.guess).toLocaleString()}`;
  if (entry.winner) return `Closest without going over · ${under.toLowerCase()}`;
  if (entry.near) return `Close call · ${under.toLowerCase()}`;
  return under;
}
