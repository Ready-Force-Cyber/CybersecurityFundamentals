import { describe, it, expect } from "vitest";
import { DEFAULT_PREFS, sanitizePrefs } from "../src/lib/instructor-prefs";
import { timeAgo } from "../src/components/admin/SessionsPanel";

describe("sanitizePrefs", () => {
  it("falls back to the defaults for nothing stored", () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs("garbage")).toEqual(DEFAULT_PREFS);
  });

  it("keeps choices the console offers", () => {
    const prefs = {
      mode: "gameshow",
      difficulty: "hard",
      questionCount: 15,
      timePerQuestion: 0,
      teamCount: 4,
      rounds: 5,
      sound: false,
    };
    expect(sanitizePrefs(prefs)).toEqual(prefs);
  });

  it("replaces anything it doesn't offer, field by field", () => {
    const out = sanitizePrefs({ mode: "battle", difficulty: "easy", questionCount: 999, teamCount: 9, sound: "yes" });
    expect(out.mode).toBe(DEFAULT_PREFS.mode);
    expect(out.difficulty).toBe("easy");
    expect(out.questionCount).toBe(DEFAULT_PREFS.questionCount);
    expect(out.teamCount).toBe(DEFAULT_PREFS.teamCount);
    expect(out.sound).toBe(DEFAULT_PREFS.sound);
  });

  // 0 means "untimed", an accessibility accommodation; it must survive.
  it("keeps untimed (0) rather than treating it as missing", () => {
    expect(sanitizePrefs({ timePerQuestion: 0 }).timePerQuestion).toBe(0);
  });
});

describe("timeAgo", () => {
  const now = 1_700_000_000_000;
  it.each([
    [now - 10_000, "Just now"],
    [now - 5 * 60_000, "5 min ago"],
    [now - 3 * 3_600_000, "3 h ago"],
  ])("formats %s", (ms, expected) => {
    expect(timeAgo(ms, now)).toBe(expected);
  });

  it("says Unknown for a missing time", () => {
    expect(timeAgo(undefined, now)).toBe("Unknown");
  });
});
