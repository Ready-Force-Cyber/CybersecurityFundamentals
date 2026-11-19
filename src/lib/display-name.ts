// The name a student shows in a live session.
//
// Project AIDE teaches data minimisation alongside FERPA and COPPA, so the game
// asks for the least it needs: a first name or nickname, shown only to the
// class. Nothing here can stop someone typing a full name, but the limit keeps
// it short, and the join form says plainly what to enter.

/** Longest display name accepted. Both runtimes and the join form use it. */
export const MAX_DISPLAY_NAME = 20;

/**
 * Clean a typed name: trim it, collapse runs of whitespace, and cap its
 * length. Returns "" for anything that is not a usable name.
 */
export function normalizeDisplayName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_DISPLAY_NAME).trim();
}

/**
 * True when a name looks like a first and last name: two or more words, each
 * a capitalised run of letters (apostrophes and hyphens allowed, so "O'Neil"
 * and "Anne-Marie" count).
 *
 * Only ever drives a gentle hint on the join form. It is never used to reject
 * a name — a capitalised nickname like "Red Fox" will see the hint, and that
 * is fine.
 */
export function looksLikeFullName(name: string): boolean {
  const words = name.trim().split(/\s+/);
  return words.length >= 2 && words.every((w) => /^[A-Z](?=.*[a-z])[A-Za-z'\-]+$/.test(w));
}
