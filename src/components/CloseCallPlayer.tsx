import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { Home, Lock, Pencil } from "lucide-react";
import { cn } from "../lib/utils";
import { audio } from "../lib/audio";
import { describeEntry, formatNumber, MAX_GUESS, type CloseCallView } from "../lib/closecall";
import type { RoomPlayer } from "../lib/api";
import { CloseCallMark, conceptLabel } from "./CloseCallHost";
import { WinnersPodium } from "./WinnersPodium";

export interface CloseCallPlayerProps {
  view: CloseCallView;
  myId?: string;
  players: RoomPlayer[];
  /** The whole game is over. */
  finished: boolean;
  /** Sends the guess; rejects with a message to show if it fails. */
  onGuess: (guess: number) => Promise<void>;
  onExit: () => void;
  reducedMotion?: boolean;
}

/** A student's device during a Close Call game. */
export function CloseCallPlayer({ view, myId, players, finished, onGuess, onExit, reducedMotion = false }: CloseCallPlayerProps) {
  const me = players.find((p) => p.id === myId);
  const itemId = view.item?.id ?? "";
  const unit = view.item?.unit;
  const fmt = (n: number) => formatNumber(n, unit);

  // The guess box holds digits only; it shows them with thousands separators.
  const [digits, setDigits] = useState("");
  const [sent, setSent] = useState<number | null>(null);
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // A new item: clear the box.
  useEffect(() => {
    setDigits("");
    setSent(null);
    setEditing(true);
    setError("");
  }, [itemId]);

  const lockedIn = !!myId && view.lockedIn.includes(myId) && sent !== null;
  const mine = view.result?.entries.find((e) => e.playerId === myId) ?? null;

  // A sound for your own result, once per round.
  const heard = useRef("");
  useEffect(() => {
    if (view.phase !== "revealed" || heard.current === itemId) return;
    heard.current = itemId;
    if (mine && mine.points > 0) audio.playCorrect();
    else audio.playIncorrect();
  }, [view.phase, itemId, mine]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (digits === "") {
      setError("Type a number first.");
      input.current?.focus();
      return;
    }
    const guess = Number(digits);
    setBusy(true);
    setError("");
    try {
      await onGuess(guess);
      setSent(guess);
      setEditing(false);
    } catch (err: any) {
      setError(err?.message || "That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (finished) {
    return (
      <div className="flex-1 flex flex-col gap-6 max-w-2xl mx-auto w-full py-6 px-4">
        <div className="text-center space-y-1">
          <CloseCallMark className="text-3xl" />
          <p className="text-slate-300">
            That's the game! You scored <span className="font-black text-white">{(me?.score ?? 0).toLocaleString()}</span>.
          </p>
        </div>
        <WinnersPodium players={players.map((p) => ({ uid: p.id, name: p.name, score: p.score }))} youUid={myId} reducedMotion={reducedMotion} />
        <button
          onClick={onExit}
          className="mx-auto inline-flex items-center gap-2 px-6 py-4 rounded-2xl bg-white text-black font-bold hover:bg-slate-200 transition-colors"
        >
          <Home className="w-5 h-5" aria-hidden="true" /> Back to home
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-5 max-w-xl mx-auto w-full py-6 px-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <CloseCallMark className="text-2xl" />
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mt-1">
            Round {Math.min(view.index + 1, view.total)} of {view.total}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Your score</p>
          <p className="text-2xl font-black font-mono text-white tabular-nums">{(me?.score ?? 0).toLocaleString()}</p>
        </div>
      </div>

      {view.item && (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-300">{conceptLabel(view.item.concept)}</p>
          <p className="text-xl font-bold leading-snug text-white">{view.item.prompt}</p>
        </div>
      )}

      {view.phase === "guessing" &&
        (lockedIn && !editing ? (
          <div className="rounded-3xl border border-amber-400/40 bg-amber-400/10 p-6 text-center space-y-3" role="status">
            <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-amber-200">
              <Lock className="w-4 h-4" aria-hidden="true" /> Locked in
            </p>
            <p className="text-5xl font-black font-mono text-white tabular-nums">{fmt(sent!)}</p>
            <p className="text-slate-300 text-sm">Watch the screen for the reveal. You can change it until then.</p>
            <button
              onClick={() => {
                setEditing(true);
                setDigits(String(sent));
                setTimeout(() => input.current?.focus(), 0);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 text-white font-bold hover:bg-white/15"
            >
              <Pencil className="w-4 h-4" aria-hidden="true" /> Change my guess
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
            <label htmlFor="cc-guess" className="block font-bold text-white">
              Your guess{view.item ? ` (${view.item.unit})` : ""}
            </label>
            {/* The button sits beside the box, not below it: a phone keeps the
                focused box in view above the keyboard, so the button stays
                visible too (an iPhone number pad has no Enter key). */}
            <div className="flex gap-2">
              <input
                ref={input}
                id="cc-guess"
                type="text"
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                placeholder="Your number"
                value={digits === "" ? "" : fmt(Number(digits))}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
                  if (next === "" || Number(next) <= MAX_GUESS) setDigits(next);
                  if (error) setError("");
                }}
                onFocus={(e) => {
                  const box = e.currentTarget;
                  window.setTimeout(
                    () => box.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" }),
                    300,
                  );
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby="cc-guess-help"
                className={cn(
                  "flex-1 min-w-0 rounded-2xl bg-black/40 border border-white/15 px-4 py-3.5 font-black font-mono text-white tabular-nums",
                  "placeholder:text-slate-500 placeholder:text-lg placeholder:font-semibold",
                  "focus:outline-none focus:ring-4 focus:ring-amber-400/40 focus:border-amber-400",
                  // Long numbers (1,000,000) shrink to stay visible beside the button.
                  digits.length > 6 ? "text-lg sm:text-2xl" : "text-2xl sm:text-3xl",
                )}
              />
              <button
                type="submit"
                disabled={busy}
                className="shrink-0 px-5 rounded-2xl bg-amber-400 text-black text-base sm:text-lg font-black hover:bg-amber-300 disabled:opacity-50 transition-colors"
              >
                {busy ? "…" : lockedIn ? "UPDATE" : "LOCK IN"}
              </button>
            </div>
            <p id="cc-guess-help" role={error ? "alert" : undefined} className={cn("text-sm", error ? "text-rose-300 font-semibold" : "text-slate-400")}>
              {error || "Closest without going over wins. Go over and you get nothing!"}
            </p>
          </form>
        ))}

      {view.phase === "revealed" && view.result && (
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
          role="status"
        >
          <div
            className={cn(
              "rounded-3xl p-6 text-center border",
              mine?.points ? "bg-emerald-500/10 border-emerald-400/40" : mine?.over ? "bg-rose-500/10 border-rose-400/30" : "bg-white/5 border-white/10",
            )}
          >
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-300">The answer is</p>
            <p className="text-5xl font-black font-mono text-white tabular-nums">{fmt(view.result.answer)}</p>
            {mine ? (
              <>
                <p className="mt-3 text-slate-300">
                  You guessed <span className="font-bold text-white">{fmt(mine.guess)}</span>
                </p>
                <p className={cn("text-xl font-black", mine.points ? "text-emerald-300" : mine.over ? "text-rose-300" : "text-slate-200")}>
                  {describeEntry(mine, view.result.answer)}
                </p>
                <p className="text-lg font-bold text-white">{mine.points ? `+${mine.points.toLocaleString()} points` : "No points this round"}</p>
              </>
            ) : (
              <p className="mt-3 text-slate-300">You didn't lock in a guess this round.</p>
            )}
          </div>
          <p className="rounded-2xl bg-black/30 border border-white/10 p-4 text-slate-200 leading-relaxed">{view.result.explanation}</p>
          <p className="text-center text-sm text-slate-400">Next round coming up — watch the screen.</p>
        </motion.div>
      )}
    </div>
  );
}
