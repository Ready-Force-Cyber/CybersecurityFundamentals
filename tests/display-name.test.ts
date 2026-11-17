import { describe, it, expect } from "vitest";
import { normalizeDisplayName, looksLikeFullName, MAX_DISPLAY_NAME } from "../src/lib/display-name";

describe("normalizeDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeDisplayName("  Ana  ")).toBe("Ana");
    expect(normalizeDisplayName("Red    Fox")).toBe("Red Fox");
    expect(normalizeDisplayName("Red\t\nFox")).toBe("Red Fox");
  });

  it("caps the length at the shared limit", () => {
    expect(normalizeDisplayName("x".repeat(60))).toHaveLength(MAX_DISPLAY_NAME);
  });

  it("does not leave a trailing space where the cap lands", () => {
    const name = normalizeDisplayName(`${"a".repeat(MAX_DISPLAY_NAME - 1)} b`);
    expect(name.endsWith(" ")).toBe(false);
  });

  it("returns empty for blank or non-string input", () => {
    for (const bad of ["", "   ", null, undefined, 42, {}, []]) {
      expect(normalizeDisplayName(bad)).toBe("");
    }
  });
});

describe("looksLikeFullName", () => {
  it("flags capitalised first-and-last names", () => {
    expect(looksLikeFullName("Ana Lopez")).toBe(true);
    expect(looksLikeFullName("Mary Jane Watson")).toBe(true);
    expect(looksLikeFullName("Sean O'Neil")).toBe(true);
    expect(looksLikeFullName("Anne-Marie Smith")).toBe(true);
  });

  it("leaves single names and nicknames alone", () => {
    for (const ok of ["Ana", "ana", "RedFox", "red fox", "Agent 7", "CyberCat99", "J. R."]) {
      expect(looksLikeFullName(ok), ok).toBe(false);
    }
  });
});
