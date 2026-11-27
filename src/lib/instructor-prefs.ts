import type { SoloDifficulty } from "./questions";
import { DEFAULT_ROUNDS, MAX_TEAMS, MIN_TEAMS } from "./gameshow";
import { CLOSE_CALL_ROUND_CHOICES, DEFAULT_CLOSE_CALL_ROUNDS } from "./closecall";

// An instructor's session setup and console preferences, remembered in this
// browser so they don't have to be picked again every class. Nothing here is
// sensitive, and the app works the same if storage is unavailable.

export type HostMode = "quiz" | "gameshow" | "closecall";

export interface InstructorPrefs {
  mode: HostMode;
  difficulty: SoloDifficulty;
  questionCount: number;
  /** Seconds per question; 0 means untimed. */
  timePerQuestion: number;
  teamCount: number;
  rounds: number;
  /** How many items a Close Call game plays. */
  closeCallRounds: number;
  sound: boolean;
  /** Waiting-room music on the host screen while students join. */
  lobbyMusic: boolean;
}

export const QUESTION_COUNTS = [5, 10, 15, 20];
export const TIME_CHOICES = [10, 20, 30, 45, 60, 0];
export const ROUND_CHOICES = [1, 2, 3, 4, 5];

export const DEFAULT_PREFS: InstructorPrefs = {
  mode: "quiz",
  difficulty: "all",
  questionCount: 10,
  timePerQuestion: 20,
  teamCount: 2,
  rounds: DEFAULT_ROUNDS,
  closeCallRounds: DEFAULT_CLOSE_CALL_ROUNDS,
  sound: true,
  lobbyMusic: true,
};

const KEY = "rfl.instructorPrefs.v1";

/** Keep only values the console offers; anything else falls back to the default. */
export function sanitizePrefs(raw: unknown): InstructorPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof InstructorPrefs, unknown>>;
  const pick = <T,>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  return {
    mode: pick(r.mode, ["quiz", "gameshow", "closecall"] as const, DEFAULT_PREFS.mode),
    difficulty: pick(r.difficulty, ["all", "easy", "medium", "hard"] as const, DEFAULT_PREFS.difficulty),
    questionCount: pick(r.questionCount, QUESTION_COUNTS, DEFAULT_PREFS.questionCount),
    timePerQuestion: pick(r.timePerQuestion, TIME_CHOICES, DEFAULT_PREFS.timePerQuestion),
    teamCount: pick(
      r.teamCount,
      Array.from({ length: MAX_TEAMS - MIN_TEAMS + 1 }, (_, i) => MIN_TEAMS + i),
      DEFAULT_PREFS.teamCount,
    ),
    rounds: pick(r.rounds, ROUND_CHOICES, DEFAULT_PREFS.rounds),
    closeCallRounds: pick(r.closeCallRounds, CLOSE_CALL_ROUND_CHOICES as readonly number[], DEFAULT_PREFS.closeCallRounds),
    sound: typeof r.sound === "boolean" ? r.sound : DEFAULT_PREFS.sound,
    lobbyMusic: typeof r.lobbyMusic === "boolean" ? r.lobbyMusic : DEFAULT_PREFS.lobbyMusic,
  };
}

export function loadPrefs(): InstructorPrefs {
  try {
    const stored = window.localStorage.getItem(KEY);
    return sanitizePrefs(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: InstructorPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing or blocked storage: the setup just isn't remembered.
  }
}
