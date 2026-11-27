import type { ReactNode } from "react";
import { cn } from "../lib/utils";

/** The front of the podium tapers toward the floor, like a TV game-show lectern. */
const FRONT = "polygon(0 0, 100% 0, 93% 100%, 7% 100%)";

interface PodiumProps {
  /** The wheel is spinning: lights chase faster and the glow brightens. */
  spinning: boolean;
  score: number;
  /** What the contestant's name plate says. */
  name?: string;
  /** The podium's screen: the heading and a line of text. */
  children: ReactNode;
  /** The big button on the front of the podium. */
  action: ReactNode;
}

/**
 * A contestant podium for the solo game show. The player stands behind it:
 * a gold-rimmed desk, a tapered front with marquee bulbs, a screen saying
 * what happens next, the spin button, and a name plate with the score.
 * Purely a frame; the content and the button come from the caller, in
 * reading order (screen, then button), so screen readers meet them in the
 * same order they appear.
 */
export function Podium({ spinning, score, name = "You", children, action }: PodiumProps) {
  return (
    <div className="relative mx-auto w-full max-w-lg pt-2">
      {/* Stage light falling on the podium */}
      <div
        aria-hidden="true"
        className={cn(
          "absolute -inset-x-8 -top-6 bottom-8 rounded-[3rem] blur-2xl transition-opacity duration-500",
          "bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.28),transparent_70%)]",
          spinning ? "opacity-100" : "opacity-60",
        )}
      />

      {/* Desk top, gold rim */}
      <div
        aria-hidden="true"
        className="relative z-10 -mx-[3%] h-5 rounded-t-2xl rounded-b-md bg-gradient-to-b from-amber-200 via-amber-400 to-amber-700 shadow-[0_8px_18px_rgba(0,0,0,0.55)]"
      />

      {/* Front panel: a gold edge (outer) around the blue face (inner) */}
      <div className="relative bg-gradient-to-b from-amber-300 to-amber-700 p-[3px]" style={{ clipPath: FRONT }}>
        <div
          className="relative px-9 sm:px-14 pt-4 pb-7 text-center bg-gradient-to-b from-[#1d3b8f] via-[#13265e] to-[#0a1435]"
          style={{ clipPath: FRONT }}
        >
          {/* Vertical light strips down each side */}
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-[10%] top-6 bottom-8 w-1 rounded-full bg-gradient-to-b from-cyan-300 to-blue-500/0 transition-opacity",
              spinning ? "opacity-100 shadow-[0_0_10px_rgba(103,232,249,0.9)]" : "opacity-50",
            )}
          />
          <span
            aria-hidden="true"
            className={cn(
              "absolute right-[10%] top-6 bottom-8 w-1 rounded-full bg-gradient-to-b from-cyan-300 to-blue-500/0 transition-opacity",
              spinning ? "opacity-100 shadow-[0_0_10px_rgba(103,232,249,0.9)]" : "opacity-50",
            )}
          />

          {/* Marquee bulbs */}
          <div aria-hidden="true" className={cn("h-3.5 mx-1 podium-bulbs", spinning && "podium-bulbs-fast")} />

          {/* The podium's screen */}
          <div className="relative mt-4 mx-auto max-w-sm rounded-xl border border-cyan-300/30 bg-black/70 px-4 py-4 shadow-[inset_0_0_28px_rgba(34,211,238,0.18)]">
            {children}
          </div>

          {/* The button, set into the podium */}
          <div className="relative mt-5 flex justify-center">{action}</div>

          {/* Name plate */}
          <div className="relative mt-5 inline-flex items-center gap-3 rounded-lg border border-amber-200/70 bg-gradient-to-b from-amber-100 to-amber-300 px-4 py-1.5 text-slate-900 shadow-[0_2px_0_rgba(0,0,0,0.35)]">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-900">Contestant</span>
            <span className="font-black">{name}</span>
            <span className="font-mono font-black tabular-nums" aria-label={`Score ${score}`}>
              {score}
            </span>
          </div>
        </div>
      </div>

      {/* Plinth and the shadow it casts on the stage floor */}
      <div aria-hidden="true" className="mx-auto h-3 w-[87%] rounded-b-xl bg-slate-950 border-t border-amber-500/40" />
      <div aria-hidden="true" className="mx-auto mt-1 h-4 w-[82%] rounded-[50%] bg-black/60 blur-md" />
    </div>
  );
}
