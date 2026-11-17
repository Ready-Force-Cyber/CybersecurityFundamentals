// The backdrop for every game-show screen — solo play, the class projector
// and a student's team view: a dark studio stage with sweeping spotlights,
// marquee lights along the top, and a glowing grid floor that keeps the cyber
// theme. Purely decorative and behind everything (aria-hidden, no pointer
// events). All movement is CSS and stops for reduced motion; the stage itself
// stays, since a still background costs nothing.

/** Fixed sparkle positions, so the stage looks the same on every render. */
const SPARKLES = [
  { left: "8%", top: "22%", delay: "0s", size: 3 },
  { left: "17%", top: "58%", delay: "1.4s", size: 2 },
  { left: "26%", top: "12%", delay: "0.6s", size: 2 },
  { left: "35%", top: "40%", delay: "2.1s", size: 3 },
  { left: "44%", top: "18%", delay: "0.9s", size: 2 },
  { left: "53%", top: "64%", delay: "2.8s", size: 2 },
  { left: "61%", top: "28%", delay: "0.3s", size: 3 },
  { left: "70%", top: "52%", delay: "1.9s", size: 2 },
  { left: "78%", top: "16%", delay: "1.1s", size: 2 },
  { left: "86%", top: "44%", delay: "2.4s", size: 3 },
  { left: "93%", top: "26%", delay: "0.4s", size: 2 },
  { left: "12%", top: "80%", delay: "1.7s", size: 2 },
  { left: "88%", top: "74%", delay: "0.8s", size: 2 },
];

export function GameShowStage() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden="true">
      {/* Base: a deep studio blue falling away to black at the edges */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,#1e1b4b_0%,#0b1023_45%,#030409_100%)]" />

      {/* Warm glow at centre stage, where the wheel stands */}
      <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 w-[70vw] h-[55vh] rounded-full bg-amber-500/10 blur-[110px]" />

      {/* Spotlights: beams from the rig at the top, sweeping slowly */}
      <div className="stage-beam stage-beam-left" />
      <div className="stage-beam stage-beam-right" />
      <div className="stage-beam stage-beam-centre" />

      {/* Marquee lights along the top edge */}
      <div className="stage-marquee absolute inset-x-0 top-0 h-3" />
      <div className="absolute inset-x-0 top-3 h-8 bg-gradient-to-b from-amber-300/10 to-transparent" />

      {/* Glowing grid floor, receding to a horizon */}
      <div className="absolute inset-x-0 bottom-0 h-[42vh] [perspective:600px] [mask-image:linear-gradient(to_top,black_10%,transparent_95%)]">
        <div className="stage-floor absolute inset-x-[-50%] bottom-[-20%] h-[160%] origin-bottom" />
      </div>
      {/* Horizon line where the floor meets the stage */}
      <div className="absolute inset-x-0 bottom-[42vh] h-px bg-gradient-to-r from-transparent via-sky-400/40 to-transparent" />

      {/* Dust caught in the lights */}
      {SPARKLES.map((s, i) => (
        <span
          key={i}
          className="stage-sparkle absolute rounded-full bg-amber-100"
          style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: s.delay }}
        />
      ))}

      {/* Vignette, to keep the edges quiet and the eye on the middle */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.65)_100%)]" />
    </div>
  );
}
