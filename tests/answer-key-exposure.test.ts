import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The built-in question bank carries its answer key. If any file that ships
// to the browser imports it, the bundler puts every answer into the
// JavaScript each student downloads — which is exactly how the key used to
// leak. These tests fail if that import ever comes back.

const SRC = join(__dirname, "..", "src");

/** Server-only code: allowed to hold the answer key. */
const SERVER_ONLY = [join(SRC, "worker"), join(SRC, "server-data")];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const clientFiles = sourceFiles(SRC).filter(
  (file) => !SERVER_ONLY.some((dir) => file.startsWith(dir)),
);

describe("answer key exposure", () => {
  it("finds the client source to check", () => {
    const names = clientFiles.map((f) => relative(SRC, f).replace(/\\/g, "/"));
    expect(names).toContain("App.tsx");
    expect(names).toContain("lib/api.ts");
  });

  it("no browser code imports the server-only question bank", () => {
    const offenders = clientFiles.filter((file) =>
      /from\s+["'][^"']*server-data[^"']*["']/.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it("the shared constants file holds types only, not question data", () => {
    const constants = readFileSync(join(SRC, "constants.ts"), "utf8");
    expect(constants).not.toMatch(/correctAnswer\s*:\s*['"`]/);
    expect(constants).not.toContain("CYBER_QUESTIONS");
  });

  it("no browser code names the built-in bank at all", () => {
    const offenders = clientFiles.filter((file) => readFileSync(file, "utf8").includes("CYBER_QUESTIONS"));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });
});
