import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import path from "node:path";

// The Node server used to fall back to a built-in instructor password when
// APP_PASSWORD was unset. The repository is public, so that password was
// public too. This boots the real server with no password and checks that
// instructor access is refused rather than opened.

const require = createRequire(import.meta.url);
const TSX_CLI = path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
const REPO_ROOT = path.resolve(__dirname, "..");
const PORT = 3798;
const BASE = `http://localhost:${PORT}`;

let child: ChildProcess;

beforeAll(async () => {
  child = spawn(process.execPath, [TSX_CLI, "server.ts"], {
    cwd: REPO_ROOT,
    // An empty value is still "set", so a developer's local .env cannot fill it in.
    env: { ...process.env, PORT: String(PORT), APP_PASSWORD: "", DISABLE_HMR: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    try {
      if ((await fetch(`${BASE}/api/questions`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Server did not become ready");
}, 30_000);

afterAll(() => {
  child?.kill();
});

const login = (password: string) =>
  fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

/** A token signed the way the server signs them, for a guessed password. */
function forgeToken(password: string): string {
  const secret = crypto.createHash("sha256").update(`rfc-token-secret:${password}`).digest();
  const exp = String(Date.now() + 60 * 60 * 1000);
  return `${exp}.${crypto.createHmac("sha256", secret).update(exp).digest("hex")}`;
}

describe("Node server with no APP_PASSWORD", () => {
  it("refuses instructor sign-in, including with the old default password", async () => {
    expect((await login("readyforce")).status).toBe(503);
    expect((await login("")).status).toBe(503);
  });

  it("rejects tokens forged from the old default or an empty password", async () => {
    for (const guess of ["readyforce", ""]) {
      const res = await fetch(`${BASE}/api/sessions`, {
        headers: { Authorization: `Bearer ${forgeToken(guess)}` },
      });
      expect(res.status).toBe(401);
    }
  });

  it("still serves students, without the answer key", async () => {
    const res = await fetch(`${BASE}/api/questions`, {
      headers: { Authorization: `Bearer ${forgeToken("")}` },
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain("correctAnswer");
  });
});
