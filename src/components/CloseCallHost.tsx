import { useEffect, useRef, useState } from "react";
import { animate, AnimatePresence, motion } from "motion/react";
import { Crown, Lock } from "lucide-react";
import { cn } from "../lib/utils";
import { audio } from "../lib/audio";
import { CLOSE_CALL_POINTS, describeEntry, formatNumber, type CloseCallView } from "../lib/closecall";
import type { RoomPlayer } from "../lib/api";

/** How long the answer takes to count up on the projector. */
const COUNT_SECONDS = 2.4;

export const conceptLabel = (c: string) => c.replace(/_/g, " ");

/** The Close Call wordmark, shared by the projector and the phones. */
export function CloseCallMark({ className }: { className?: string }) {
  return (
    <p className={cn("font-black tracking-tight leading-none", className)}>
      <span className="text-white">CLOSE</span>{" "}
      <span className="bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">CALL</span>
    </p>
  );
}

/**
 * The answer, counting up from zero with a drumroll and landing with a ding.
 * Calls `onDone` when it settles. Reduced motion shows it straight away.
 */
function CountUp({
  to,
  unit,
  reducedMotion,
  onDone,
}: {
  to: number;
  unit?: string;
  reducedMotion: boolean;
  onDone: () => void;
}) {
  const [shown, setShown] = useState(reducedMotion ? to : 0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (reducedMotion) {
      audio.playWheelLand();
      done.current();
      return;
    }
    audio.playDrumroll(COUNT_SECONDS);
    const controls = animate(0, to, {
      duration: COUNT_SECONDS,
      ease: [0.2, 0.7, 0.3, 1],
      onUpdate: (v) => setShown(Math.round(v)),
      onComplete: () => {
        setShown(to);
        audio.playWheelLand();
        done.current();
      },
    });
    return () => controls.stop();
  }, [to, reducedMotion]);

  return <>{formatNumber(shown, unit)}</>;
}

export interface CloseCallHostProps {
  code: string;
  view: CloseCallView;
  players: RoomPlayer[];
  onReveal: () => void;
  onNext: () => void;
  onEnd: () => void;
  busy?: boolean;
  reducedMotion?: boolean;
}

/**
 * The projector view of a Close Call game. Everyone guesses a number on their
 * device; the host reveals it, and the closest guess without going over wins
 * the round.
 */
export function CloseCallHost({
  code,
  view,
  players,
  onReveal,
  onNext,
  onEnd,
  busy = false,
  reducedMotion = false,
}: CloseCallHostProps) {
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  // The winner banner and the list wait for the count-up to land.
  const [settled, setSettled] = useState(false);
  const roundKey = `${view.index}-${view.phase}`;
  useEffect(() => setSettled(false), [roundKey]);

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "A player";
  const locked = new Set(view.lockedIn);
  const result = view.result;
  const isLast = view.index + 1 >= view.total;
  const ranked = [...players].sort((a, b) => b.score - a.score).slice(0, 6);

  // Exact guesses get the big fanfare.
  useEffect(() => {
    if (settled && result?.entries.some((e) => e.exact)) audio.playFanfare();
  }, [settled, result]);

  const winnerLine = !result
    ? ""
    : result.entries.length === 0
      ? "No guesses this round"
      : result.everyoneOver
        ? "Everyone went over — no winner this round"
        : result.entries.some((e) => e.exact)
          ? `Right on the number: ${result.winners.map(nameOf).join(" & ")}!`
          : `Closest without going over: ${result.winners.map(nameOf).join(" & ")}`;

  return (
    <div className="flex-1 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <CloseCallMark className="text-4xl" />
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
            Round {Math.min(view.index + 1, view.total)} of {view.total} · Closest without going over wins
          </p>
        </div>
        <div className="flex gap-8 text-right">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Join code</p>
            <p className="text-3xl font-black font-mono tracking-tight text-white">{code}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Players</p>
            <p className="text-3xl font-bold text-white">{players.length}</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_280px] gap-6 items-start">
        <div className="flex flex-col gap-5">
          {/* The item */}
          {view.item && (
            <div className={cn("rounded-3xl border border-white/10 bg-white/5 space-y-4", result ? "p-5" : "p-6 md:p-8")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-3 py-1 rounded-full bg-amber-400 text-black text-xs font-black uppercase tracking-wider">
                  Guess the {view.item.unit === "year" ? "year" : view.item.unit === "port" ? "port" : "number"}
                </span>
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  {conceptLabel(view.item.concept)}
                </span>
              </div>
              <p
                className={cn(
                  "font-bold leading-snug text-white",
                  result ? "text-xl md:text-2xl" : "text-3xl md:text-4xl",
                )}
              >
                {view.item.prompt}
              </p>
            </div>
          )}

          {/* Guessing: who has locked in */}
          {view.phase === "guessing" && (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-xl font-bold text-white">Lock in your guess on your device</p>
                <p className="text-lg font-mono font-bold text-amber-300" aria-live="polite">
                  {locked.size} of {players.length} locked in
                </p>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-amber-300 to-orange-400"
                  animate={{ width: `${players.length ? (locked.size / players.length) * 100 : 0}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              <ul className="flex flex-wrap gap-2">
                {players.map((p) => {
                  const on = locked.has(p.id);
                  return (
                    <li
                      key={p.id}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold border transition-colors",
                        on
                          ? "bg-amber-400/20 border-amber-400/60 text-amber-100"
                          : "bg-white/5 border-white/10 text-slate-400",
                      )}
                    >
                      {on && <Lock className="w-3.5 h-3.5" aria-hidden="true" />}
                      {p.name}
                      <span className="sr-only">{on ? " (locked in)" : " (still guessing)"}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Revealed: the answer, the winner, everyone's guess */}
          {result && (
            <div className="rounded-3xl border border-amber-400/30 bg-gradient-to-b from-amber-400/10 to-transparent p-6 md:p-8 space-y-5">
              <div className="text-center">
                <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-amber-200">The answer is</p>
                <p className="mt-1 text-6xl md:text-7xl font-black font-mono tracking-tight text-white tabular-nums">
                  <CountUp
                    key={roundKey}
                    to={result.answer}
                    unit={view.item?.unit}
                    reducedMotion={reducedMotion}
                    onDone={() => setSettled(true)}
                  />
                </p>
                {view.item && <p className="text-slate-300 font-semibold">{view.item.unit}</p>}
              </div>

              <AnimatePresence>
                {settled && (
                  <motion.div
                    initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-5"
                  >
                    <p
                      role="status"
                      className={cn(
                        "flex items-center justify-center gap-2 text-center text-2xl font-black",
                        result.winners.length ? "text-amber-300" : "text-slate-300",
                      )}
                    >
                      {result.winners.length > 0 && <Crown className="w-7 h-7 shrink-0" aria-hidden="true" />}
                      {winnerLine}
                    </p>

                    {result.entries.length > 0 && (
                      <ol className="space-y-2 max-h-[34vh] overflow-y-auto pr-1 custom-scrollbar">
                        {result.entries.map((e, i) => (
                          <motion.li
                            key={e.playerId}
                            initial={reducedMotion ? false : { opacity: 0, x: -12 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: Math.min(i, 12) * 0.06 }}
                            className={cn(
                              "flex items-center gap-4 rounded-2xl px-4 py-3 border",
                              e.winner
                                ? "bg-amber-400/15 border-amber-400/50"
                                : e.over
                                  ? "bg-rose-500/5 border-rose-500/20"
                                  : "bg-white/5 border-white/10",
                            )}
                          >
                            <span className="flex-1 min-w-0">
                              <span className="block font-bold text-white truncate">{nameOf(e.playerId)}</span>
                              <span className={cn("block text-sm", e.over ? "text-rose-300" : e.winner ? "text-amber-200" : "text-slate-400")}>
                                {describeEntry(e, result.answer)}
                              </span>
                            </span>
                            <span
                              className={cn(
                                "font-mono font-bold text-xl tabular-nums",
                                e.over ? "text-rose-300 line-through decoration-2" : "text-white",
                              )}
                            >
                              {formatNumber(e.guess, view.item?.unit)}
                            </span>
                            <span
                              className={cn(
                                "w-20 text-right font-black",
                                e.points > 0 ? "text-emerald-300" : "text-slate-500",
                              )}
                            >
                              {e.points > 0 ? `+${e.points.toLocaleString()}` : "0"}
                            </span>
                          </motion.li>
                        ))}
                      </ol>
                    )}

                    <p className="rounded-2xl bg-black/30 border border-white/10 p-4 text-slate-200 leading-relaxed">
                      {result.explanation}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

        </div>

        {/* Right column: the host's buttons (always in view on a projector), then the scores */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-6">
          <div className="flex flex-col gap-3">
            {view.phase === "guessing" && (
              <button
                onClick={onReveal}
                disabled={busy}
                className="w-full py-5 rounded-2xl bg-amber-400 text-black text-xl font-black hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {busy ? "Revealing…" : locked.size === 0 ? "REVEAL (NO GUESSES YET)" : "REVEAL THE ANSWER"}
              </button>
            )}
            {view.phase === "revealed" && (
              <button
                onClick={onNext}
                disabled={busy || !settled}
                className="w-full py-5 rounded-2xl bg-white text-black text-xl font-black hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isLast ? "SEE THE WINNERS" : "NEXT ROUND"}
              </button>
            )}

            {confirmingEnd ? (
              <div
                role="alertdialog"
                aria-label="Confirm ending the session"
                className="flex flex-col gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3"
              >
                <p className="text-sm font-bold text-rose-100">
                  End the game for everyone now? This cannot be undone.
                </p>
                <button
                  onClick={() => setConfirmingEnd(false)}
                  autoFocus
                  className="px-5 py-3 rounded-xl bg-white text-black font-bold hover:bg-slate-200 transition-colors"
                >
                  Keep playing
                </button>
                <button
                  onClick={onEnd}
                  className="px-5 py-3 rounded-xl bg-rose-500 text-white font-bold hover:bg-rose-400 transition-colors"
                >
                  Yes, end it
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingEnd(true)}
                className="w-full px-6 py-3 rounded-2xl font-bold transition-colors border bg-rose-500/15 text-rose-300 border-rose-500/30 hover:bg-rose-500/25"
              >
                End Game
              </button>
            )}
          </div>

          <aside aria-labelledby="cc-scores" className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
            <h3 id="cc-scores" className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
              Scoreboard
            </h3>
            {ranked.length === 0 ? (
              <p className="text-slate-400 text-sm">No players yet.</p>
            ) : (
              <ol className="space-y-2">
                {ranked.map((p, i) => (
                  <motion.li
                    layout={!reducedMotion}
                    key={p.id}
                    className="flex items-center gap-3 rounded-xl bg-black/20 px-3 py-2"
                  >
                    <span
                      className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center text-sm font-black shrink-0",
                        i === 0 && p.score > 0 ? "bg-amber-400 text-black" : "bg-white/10 text-slate-300",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate font-bold text-white">{p.name}</span>
                    <span className="font-mono font-bold text-white tabular-nums">{p.score.toLocaleString()}</span>
                  </motion.li>
                ))}
              </ol>
            )}
            <p className="text-xs text-slate-500 pt-1">
              Closest without going over: +{CLOSE_CALL_POINTS.closest.toLocaleString()} · exact: +
              {CLOSE_CALL_POINTS.exact.toLocaleString()} · within 10% under: +{CLOSE_CALL_POINTS.near}
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
