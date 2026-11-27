import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import confetti from "canvas-confetti";
import { Crown } from "lucide-react";
import { audio } from "../lib/audio";
import { cn } from "../lib/utils";

export interface PodiumPlayer {
  uid: string;
  name: string;
  score: number;
}

interface WinnersPodiumProps {
  players: PodiumPlayer[];
  /** Marks this player's spot with "You" (a student's own results). */
  youUid?: string;
  reducedMotion: boolean;
}

/** The three steps, in finishing order. `slot` is where each stands, left to right. */
const PLACES = [
  {
    label: "1st",
    word: "First",
    slot: "order-2",
    step: "h-36 sm:h-44",
    // Blocks rise 3rd, then 2nd, then 1st.
    delay: 1.0,
    medal: "from-amber-200 via-amber-400 to-amber-600 text-amber-950",
    glow: "shadow-[0_0_40px_rgba(251,191,36,0.55)]",
  },
  {
    label: "2nd",
    word: "Second",
    slot: "order-1",
    step: "h-24 sm:h-32",
    delay: 0.6,
    medal: "from-slate-100 via-slate-300 to-slate-500 text-slate-900",
    glow: "shadow-[0_0_28px_rgba(203,213,225,0.45)]",
  },
  {
    label: "3rd",
    word: "Third",
    slot: "order-3",
    step: "h-16 sm:h-24",
    delay: 0.2,
    medal: "from-orange-200 via-orange-400 to-orange-700 text-orange-950",
    glow: "shadow-[0_0_28px_rgba(251,146,60,0.45)]",
  },
] as const;

/**
 * The end of a live quiz: the top three scores on a winners' podium, with a
 * fanfare, applause and confetti. 1st stands in the middle on the tallest
 * step, 2nd on the left and 3rd on the right; screen readers hear them in
 * finishing order. Plays its celebration once, when it first appears.
 */
export function WinnersPodium({ players, youUid, reducedMotion }: WinnersPodiumProps) {
  // Only players who scored stand on the podium. The sort is stable, so ties
  // keep the server's order and match the leaderboard shown with it.
  const top = players
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const celebrated = useRef(false);

  useEffect(() => {
    if (celebrated.current || top.length === 0) return;
    celebrated.current = true;
    const timers = [window.setTimeout(() => audio.playFanfare(), 250)];
    if (!reducedMotion) {
      // Confetti as the winner's step lands, from both sides of the stage.
      timers.push(
        window.setTimeout(() => {
          const shot = { particleCount: 90, spread: 70, startVelocity: 55, ticks: 260 };
          confetti({ ...shot, angle: 60, origin: { x: 0.15, y: 0.7 } });
          confetti({ ...shot, angle: 120, origin: { x: 0.85, y: 0.7 } });
        }, 1500),
        window.setTimeout(() => {
          confetti({ particleCount: 120, spread: 120, startVelocity: 35, origin: { x: 0.5, y: 0.35 } });
        }, 2100),
      );
    }
    return () => timers.forEach(clearTimeout);
    // Celebrate once, on first appearance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (top.length === 0) return null;

  return (
    <section
      aria-labelledby="winners-podium-heading"
      className="relative overflow-clip rounded-3xl bg-gradient-to-b from-slate-950 via-indigo-950 to-blue-900 px-4 pt-8 sm:px-8 shadow-xl"
    >
      {/* Two spotlights crossing over the podium */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60% 70% at 25% 0%, rgba(125,211,252,0.22), transparent 60%), radial-gradient(60% 70% at 75% 0%, rgba(196,181,253,0.22), transparent 60%)",
        }}
      />

      <div className="relative text-center">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-cyan-300">Final results</p>
        <h3 id="winners-podium-heading" className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          Top of the class
        </h3>
      </div>

      <ol className="relative mt-6 flex items-end justify-center gap-2 sm:gap-3 max-w-xl mx-auto">
        {PLACES.map((place, i) => {
          const p = top[i];
          const isYou = !!p && !!youUid && p.uid === youUid;
          return (
            <li key={place.label} className={cn("flex-1 min-w-0 flex flex-col items-center", place.slot)}>
              {/* Who stands on this step */}
              {p ? (
                <motion.div
                  initial={reducedMotion ? false : { opacity: 0, y: 16, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: place.delay + 0.45, duration: 0.45, ease: "backOut" }}
                  className="w-full flex flex-col items-center text-center px-1 pb-2"
                >
                  {i === 0 && (
                    <motion.span
                      aria-hidden="true"
                      animate={reducedMotion ? undefined : { y: [0, -4, 0] }}
                      transition={{ delay: 2, duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Crown className="w-7 h-7 text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                    </motion.span>
                  )}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex items-center justify-center rounded-full bg-gradient-to-br font-black ring-2 ring-white/70",
                      place.medal,
                      place.glow,
                      i === 0 ? "w-16 h-16 text-2xl sm:w-20 sm:h-20 sm:text-3xl" : "w-12 h-12 text-xl sm:w-14 sm:h-14",
                    )}
                  >
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="mt-2 w-full truncate font-bold text-white text-sm sm:text-base" title={p.name}>
                    <span className="sr-only">{place.word} place: </span>
                    {p.name}
                  </span>
                  <span className="font-mono font-bold text-cyan-300 text-sm sm:text-base">
                    {p.score.toLocaleString()}
                    <span className="sr-only"> points</span>
                  </span>
                  {isYou && (
                    <span className="mt-1 rounded-full bg-emerald-400 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-950">
                      You
                    </span>
                  )}
                </motion.div>
              ) : (
                <span className="sr-only">{place.word} place: nobody</span>
              )}

              {/* The step itself, rising from the floor */}
              <motion.div
                aria-hidden="true"
                initial={reducedMotion ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ delay: place.delay, duration: 0.5, ease: [0.2, 0.9, 0.3, 1.15] }}
                style={{ transformOrigin: "bottom" }}
                className={cn("relative w-full", place.step)}
              >
                {/* Top surface */}
                <div className="absolute inset-x-0 top-0 h-3 rounded-t-md bg-gradient-to-b from-slate-100 to-slate-300 border border-slate-400/60" />
                {/* Front face */}
                <div className="absolute inset-x-0 top-3 bottom-0 bg-gradient-to-b from-slate-300 to-slate-500 border-x border-b border-slate-500/70 flex items-start justify-center pt-2 sm:pt-4">
                  <span className="font-black text-slate-800 leading-none">
                    <span className={i === 0 ? "text-5xl sm:text-6xl" : "text-4xl sm:text-5xl"}>{i + 1}</span>
                    <span className="align-top text-base sm:text-xl">{place.label.slice(1)}</span>
                  </span>
                </div>
              </motion.div>
            </li>
          );
        })}
      </ol>

      {/* The floor, with a soft glow under the podium */}
      <div aria-hidden="true" className="relative -mx-4 sm:-mx-8 h-6 bg-gradient-to-b from-blue-950 to-slate-950">
        <div className="absolute left-1/2 top-0 h-4 w-2/3 -translate-x-1/2 rounded-[50%] bg-cyan-400/20 blur-md" />
      </div>
    </section>
  );
}
