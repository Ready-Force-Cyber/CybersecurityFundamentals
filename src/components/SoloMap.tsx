import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronRight,
  FileCheck,
  Flag,
  KeyRound,
  Lock,
  Map as MapIcon,
  RotateCcw,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  SOLO_DIFFICULTIES,
  type SoloDifficulty,
} from "../lib/questions";

export const CONCEPTS = [
  { id: "art_of_defending", name: "Art of Defending", icon: "🛡️" },
  { id: "confidentiality", name: "Confidentiality", icon: "🤫" },
  { id: "integrity", name: "Integrity", icon: "✓" },
  { id: "availability", name: "Availability", icon: "⚡" },
  { id: "authentication", name: "Authentication", icon: "🔑" }
];

/** The same line icons the home page uses for each concept. */
export const CONCEPT_ICON_COMPONENTS: Record<string, LucideIcon> = {
  art_of_defending: ShieldCheck,
  confidentiality: Lock,
  integrity: FileCheck,
  availability: Activity,
  authentication: KeyRound,
};

/** One plain-language line per skill, shown when a student picks it on the map. */
const CONCEPT_BLURBS: Record<string, string> = {
  art_of_defending:
    "Think like a defender: spot threats, stack up protections, and know what to do when something goes wrong.",
  confidentiality: "Keep private information private, so only the right people can see it.",
  integrity: "Make sure information stays accurate and isn't changed by someone who shouldn't change it.",
  availability: "Keep systems and data working and ready for the people who need them.",
  authentication: "Prove who you are online with strong passwords, passkeys and multi-factor sign-in.",
};

const DIFFICULTY_LABELS: Record<SoloDifficulty, string> = {
  all: "Mixed",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

/**
 * Each difficulty has its own colour, so the whole map changes with the level:
 * Mixed blue, Easy teal, Medium amber, Hard rose. Class names are written out
 * in full so Tailwind can find them. Text on a coloured fill uses a shade dark
 * enough for 4.5:1 contrast with white.
 */
interface LevelTheme {
  tagline: string;
  button: string;
  hover: string;
  dot: string;
  title: string;
  card: string;
  mapBorder: string;
  node: string;
  ping: string;
  panel: string;
  panelIcon: string;
  accent: string;
  cta: string;
  flash: string;
  /** SVG colours (hex): the lane toward the next skill, open districts, the ground and its grid. */
  lane: string;
  blob: string;
  sky: string;
  grid: string;
}

const THEMES: Record<SoloDifficulty, LevelTheme> = {
  all: {
    tagline: "Every level, all mixed up",
    button: "bg-blue-600 text-white",
    hover: "hover:bg-blue-50 hover:text-blue-700",
    dot: "bg-blue-600",
    title: "text-blue-600",
    card: "border-blue-200 shadow-blue-100/60",
    mapBorder: "border-blue-100",
    node: "bg-blue-600",
    ping: "bg-blue-400/50",
    panel: "bg-blue-50/60 border-blue-100",
    panelIcon: "border-blue-100 text-blue-600",
    accent: "text-blue-700",
    cta: "bg-blue-600 hover:bg-blue-700 text-white",
    flash: "bg-blue-600 text-white",
    lane: "#2563eb",
    blob: "#dbeafe",
    sky: "#eff6ff",
    grid: "#dbeafe",
  },
  easy: {
    tagline: "Warm up with the basics",
    button: "bg-teal-700 text-white",
    hover: "hover:bg-teal-50 hover:text-teal-800",
    dot: "bg-teal-500",
    title: "text-teal-600",
    card: "border-teal-200 shadow-teal-100/60",
    mapBorder: "border-teal-100",
    node: "bg-teal-600",
    ping: "bg-teal-400/50",
    panel: "bg-teal-50/60 border-teal-100",
    panelIcon: "border-teal-100 text-teal-600",
    accent: "text-teal-700",
    cta: "bg-teal-700 hover:bg-teal-800 text-white",
    flash: "bg-teal-700 text-white",
    lane: "#0d9488",
    blob: "#ccfbf1",
    sky: "#f0fdfa",
    grid: "#ccfbf1",
  },
  medium: {
    tagline: "Time to level up",
    button: "bg-amber-700 text-white",
    hover: "hover:bg-amber-50 hover:text-amber-800",
    dot: "bg-amber-500",
    title: "text-amber-600",
    card: "border-amber-200 shadow-amber-100/60",
    mapBorder: "border-amber-100",
    node: "bg-amber-600",
    ping: "bg-amber-400/50",
    panel: "bg-amber-50/60 border-amber-100",
    panelIcon: "border-amber-200 text-amber-700",
    accent: "text-amber-700",
    cta: "bg-amber-700 hover:bg-amber-800 text-white",
    flash: "bg-amber-700 text-white",
    lane: "#d97706",
    blob: "#fef3c7",
    sky: "#fffbeb",
    grid: "#fef3c7",
  },
  hard: {
    tagline: "Expert territory",
    button: "bg-rose-600 text-white",
    hover: "hover:bg-rose-50 hover:text-rose-700",
    dot: "bg-rose-500",
    title: "text-rose-600",
    card: "border-rose-200 shadow-rose-100/60",
    mapBorder: "border-rose-100",
    node: "bg-rose-600",
    ping: "bg-rose-400/50",
    panel: "bg-rose-50/60 border-rose-100",
    panelIcon: "border-rose-100 text-rose-600",
    accent: "text-rose-700",
    cta: "bg-rose-600 hover:bg-rose-700 text-white",
    flash: "bg-rose-600 text-white",
    lane: "#e11d48",
    blob: "#ffe4e6",
    sky: "#fff1f2",
    grid: "#ffe4e6",
  },
};

/** Colour changes on the map's SVG ease in with the rest of the page. */
const SVG_FADE = { transition: "fill 0.45s ease, stroke 0.45s ease, stop-color 0.45s ease" };

const CHALLENGE_ID = "all_topics";

// ---------------------------------------------------------------------------
// Map layout. Spots are placed in the map's own units (its viewBox); the
// buttons on top use the same numbers as percentages, so they line up with
// the drawn path at any size. A wide map for tablets and computers, a tall
// one for phones.
// ---------------------------------------------------------------------------

type Point = { x: number; y: number };
interface MapLayout {
  width: number;
  height: number;
  start: Point;
  /** One spot per concept, in order, then the challenge trophy. */
  spots: Point[];
}

const WIDE: MapLayout = {
  width: 1000,
  height: 600,
  start: { x: 55, y: 520 },
  spots: [
    { x: 150, y: 420 },
    { x: 320, y: 190 },
    { x: 490, y: 410 },
    { x: 660, y: 180 },
    { x: 815, y: 400 },
    { x: 900, y: 180 },
  ],
};

const TALL: MapLayout = {
  width: 400,
  height: 1060,
  start: { x: 45, y: 55 },
  spots: [
    { x: 120, y: 160 },
    { x: 280, y: 320 },
    { x: 120, y: 490 },
    { x: 280, y: 660 },
    { x: 120, y: 830 },
    { x: 280, y: 960 },
  ],
};

/** A smooth curve from b to c, shaped by the points either side (Catmull-Rom). */
function curve(a: Point, b: Point, c: Point, d: Point): string {
  const c1 = { x: b.x + (c.x - a.x) / 6, y: b.y + (c.y - a.y) / 6 };
  const c2 = { x: c.x - (d.x - b.x) / 6, y: c.y - (d.y - b.y) / 6 };
  return `M ${b.x} ${b.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${c.x} ${c.y}`;
}

/** True when the screen is at least `px` wide. */
function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" || !window.matchMedia ? true : window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

type SpotStatus = "complete" | "next" | "open" | "empty" | "locked";

interface SoloMapProps {
  unlockedConcepts: string[];
  completedConcepts: string[];
  onSelectConcept: (conceptId: string) => void;
  onSelectAllTopics: () => void;
  onBack: () => void;
  difficulty: SoloDifficulty;
  onDifficultyChange: (difficulty: SoloDifficulty) => void;
  /** Questions available per difficulty for the whole bank (all topics). */
  availability: Record<SoloDifficulty, number>;
  /** Questions available for each concept at the current difficulty. */
  conceptCounts: Record<string, number>;
}

export function SoloMap({
  unlockedConcepts,
  completedConcepts,
  onSelectConcept,
  onSelectAllTopics,
  onBack,
  difficulty,
  onDifficultyChange,
  availability,
  conceptCounts,
}: SoloMapProps) {
  const allTopicsCount = availability[difficulty] ?? 0;
  const levelLabel = DIFFICULTY_LABELS[difficulty];
  const theme = THEMES[difficulty];

  // Changing the difficulty zooms the map out and back in, and flashes the
  // new level's name, so the change is hard to miss.
  const reduceMotion = useReducedMotion();
  const [mapScope, animateMap] = useAnimate<HTMLDivElement>();
  const [flash, setFlash] = useState<SoloDifficulty | null>(null);
  const shownDifficulty = useRef(difficulty);
  useEffect(() => {
    if (shownDifficulty.current === difficulty) return;
    shownDifficulty.current = difficulty;
    setFlash(difficulty);
    if (!reduceMotion && mapScope.current) {
      animateMap(
        mapScope.current,
        { scale: [1, 0.84, 1.12, 1] },
        { duration: 0.9, times: [0, 0.3, 0.68, 1], ease: "easeInOut" },
      );
    }
    const id = window.setTimeout(() => setFlash(null), 1200);
    return () => window.clearTimeout(id);
  }, [difficulty, reduceMotion, animateMap, mapScope]);
  const doneCount = CONCEPTS.filter((c) => completedConcepts.includes(c.id)).length;

  const layout = useMinWidth(768) ? WIDE : TALL;
  const pct = (p: Point) => ({
    left: `${(p.x / layout.width) * 100}%`,
    top: `${(p.y / layout.height) * 100}%`,
  });

  // Where the student is now: the first open skill they haven't finished.
  const nextIndex = CONCEPTS.findIndex(
    (c) => unlockedConcepts.includes(c.id) && !completedConcepts.includes(c.id),
  );

  const statusOf = (index: number): SpotStatus => {
    const id = CONCEPTS[index].id;
    if (!unlockedConcepts.includes(id)) return "locked";
    if (completedConcepts.includes(id)) return "complete";
    if ((conceptCounts[id] ?? 0) === 0) return "empty";
    return index === nextIndex ? "next" : "open";
  };

  const spotIds = [...CONCEPTS.map((c) => c.id), CHALLENGE_ID];
  const [selected, setSelected] = useState<string>(
    () => (nextIndex >= 0 ? CONCEPTS[nextIndex].id : CHALLENGE_ID),
  );
  const spotRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const detailsRef = useRef<HTMLDivElement>(null);

  // Tapping a spot shows its details. On a phone the details sit below a tall
  // map, so bring them into view if they are off screen.
  const pick = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() => {
      const el = detailsRef.current;
      if (!el) return;
      const { bottom } = el.getBoundingClientRect();
      if (bottom > window.innerHeight) {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
      }
    });
  };

  // Arrow keys walk along the path, like moving a piece on a board.
  const onMapKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const current = spotIds.indexOf(selected);
    const target = Math.min(spotIds.length - 1, Math.max(0, current + step));
    setSelected(spotIds[target]);
    spotRefs.current[target]?.focus();
  };

  // The road between each pair of spots, styled by how far the student got.
  const points = [layout.start, ...layout.spots];
  const roads = points.slice(0, -1).map((from, i) => {
    const d = curve(points[i - 1] ?? from, from, points[i + 1], points[i + 2] ?? points[i + 1]);
    // Road i runs from spot i-1 (or the start flag, for road 0) to spot i.
    const fromIndex = i - 1;
    const leftDone = fromIndex < 0 || completedConcepts.includes(CONCEPTS[fromIndex].id);
    const intoIndex = i;
    const intoDone = intoIndex < CONCEPTS.length && completedConcepts.includes(CONCEPTS[intoIndex].id);
    const kind: "walked" | "ahead" | "later" = leftDone ? (intoDone ? "walked" : "ahead") : "later";
    return { d, kind };
  });

  const blobFill: Record<SpotStatus | "challenge", string> = {
    complete: "#d1fae5",
    next: theme.blob,
    open: theme.blob,
    empty: "#e2e8f0",
    locked: "#e2e8f0",
    challenge: "#fef3c7",
  };

  const selectedIndex = CONCEPTS.findIndex((c) => c.id === selected);

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto flex flex-col gap-8 py-4 md:py-6">
      <button
        onClick={onBack}
        className="self-start inline-flex items-center gap-2 px-3 py-2 -ml-3 rounded-xl text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to home
      </button>

      {/* Hero, matching the home page */}
      <div className="text-center space-y-5 px-2">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-100 text-blue-700 font-semibold text-xs tracking-widest uppercase">
          <MapIcon className="w-3.5 h-3.5" aria-hidden="true" />
          Solo Practice
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900">
          Your Cyber <span className={cn("transition-colors duration-500", theme.title)}>Skills Map</span>
        </h1>
        <p className="text-slate-600 text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
          Follow the path through the five core skills. Each one you finish opens the road to the next.
        </p>

        <div className="max-w-xs mx-auto space-y-2 pt-1">
          <div
            className="h-2 rounded-full bg-slate-200 overflow-hidden"
            role="progressbar"
            aria-label="Skills complete"
            aria-valuemin={0}
            aria-valuemax={CONCEPTS.length}
            aria-valuenow={doneCount}
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: `${(doneCount / CONCEPTS.length) * 100}%` }}
            />
          </div>
          <p className="text-xs font-semibold text-slate-500">
            {doneCount} of {CONCEPTS.length} skills complete
          </p>
        </div>
      </div>

      {/* Difficulty selector */}
      <div className="flex flex-col items-center gap-3">
        <p id="difficulty-label" className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">
          Choose a difficulty
        </p>
        <div
          role="group"
          aria-labelledby="difficulty-label"
          className="inline-flex flex-wrap justify-center gap-1 p-1.5 bg-white border border-slate-200 rounded-2xl shadow-sm"
        >
          {SOLO_DIFFICULTIES.map((level) => {
            const count = availability[level] ?? 0;
            const disabled = count === 0;
            const isSelected = difficulty === level;
            return (
              <button
                key={level}
                onClick={() => !disabled && onDifficultyChange(level)}
                disabled={disabled}
                aria-pressed={isSelected}
                title={disabled ? "No questions at this level yet" : `${count} questions available`}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
                  isSelected
                    ? cn(THEMES[level].button, "shadow-sm")
                    : disabled
                      ? "text-slate-300 cursor-not-allowed"
                      : cn("text-slate-600", THEMES[level].hover),
                )}
              >
                <span
                  className={cn(
                    "inline-block w-2 h-2 rounded-full mr-1.5 align-middle -mt-0.5",
                    isSelected ? "bg-white/85" : disabled ? "bg-slate-200" : THEMES[level].dot,
                  )}
                  aria-hidden="true"
                />
                {DIFFICULTY_LABELS[level]}
                <span className={cn("ml-1.5 font-mono text-[11px]", isSelected ? "text-white/75" : "text-slate-400")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* The map */}
      <section
        aria-labelledby="map-heading"
        className={cn("relative bg-white border-2 rounded-3xl shadow-xl p-4 sm:p-6 space-y-5 transition-colors duration-500", theme.card)}
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 px-1">
          <div>
            <h2 id="map-heading" className="text-xl font-bold text-slate-900 tracking-tight">
              Skills map
            </h2>
            <p className="text-sm text-slate-500">
              Pick a spot on the map to see what's there. Arrow keys move along the path.
            </p>
          </div>
          <ul className="flex flex-wrap gap-3 text-xs font-semibold text-slate-600" aria-label="Map key">
            <li className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500" />Complete</li>
            <li className="flex items-center gap-1.5"><span className={cn("w-3 h-3 rounded-full transition-colors duration-500", theme.node)} />Open</li>
            <li className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-slate-300" />Locked</li>
          </ul>
        </div>

        <div
          className={cn("relative w-full rounded-2xl overflow-hidden border transition-colors duration-500", theme.mapBorder)}
          style={{ aspectRatio: `${layout.width} / ${layout.height}`, backgroundColor: theme.sky, transition: "background-color 0.45s ease" }}
          onKeyDown={onMapKeyDown}
        >
          {/* Everything on the map zooms together when the difficulty changes */}
          <div ref={mapScope} className="absolute inset-0">
          {/* Terrain and roads (decorative; the buttons carry the meaning) */}
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="map-sky" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={theme.sky} style={SVG_FADE} />
                <stop offset="1" stopColor="#f8fafc" />
              </linearGradient>
              <pattern id="map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke={theme.grid} strokeWidth="1" style={SVG_FADE} />
              </pattern>
            </defs>
            <rect width={layout.width} height={layout.height} fill="url(#map-sky)" />
            <rect width={layout.width} height={layout.height} fill="url(#map-grid)" />

            {/* A soft district around each spot, tinted by its status */}
            {layout.spots.map((p, i) => (
              <ellipse
                key={`blob-${i}`}
                cx={p.x}
                cy={p.y}
                rx={layout === WIDE ? 115 : 120}
                ry={layout === WIDE ? 95 : 85}
                fill={i < CONCEPTS.length ? blobFill[statusOf(i)] : blobFill.challenge}
                opacity={0.75}
              />
            ))}

            {/* Road edge, then road surface */}
            {roads.map((r, i) => (
              <path key={`edge-${i}`} d={r.d} fill="none" stroke="#cbd5e1" strokeWidth={22} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            ))}
            {roads.map((r, i) => (
              <path key={`surface-${i}`} d={r.d} fill="none" stroke="#ffffff" strokeWidth={18} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            ))}
            {/* Lane markings: solid where walked, marching toward the next skill */}
            {roads.map((r, i) => (
              <path
                key={`lane-${i}`}
                d={r.d}
                fill="none"
                stroke={r.kind === "walked" ? "#10b981" : r.kind === "ahead" ? theme.lane : "#cbd5e1"}
                strokeWidth={r.kind === "walked" ? 6 : 4}
                strokeLinecap="round"
                strokeDasharray={r.kind === "walked" ? undefined : "2 10"}
                className={r.kind === "ahead" ? "map-march" : undefined}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {/* Start flag */}
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 pointer-events-none"
            style={pct(layout.start)}
            aria-hidden="true"
          >
            <div className="w-9 h-9 rounded-full bg-white border-2 border-slate-200 text-slate-500 flex items-center justify-center shadow-sm">
              <Flag className="w-4 h-4" />
            </div>
            {layout === WIDE && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Start</span>
            )}
          </div>

          {/* Skill spots */}
          {CONCEPTS.map((concept, i) => {
            const status = statusOf(i);
            const Icon = CONCEPT_ICON_COMPONENTS[concept.id] ?? ShieldCheck;
            const isSelected = selected === concept.id;
            const statusText = {
              complete: "complete",
              next: "up next",
              open: "open",
              empty: `no ${levelLabel} questions yet`,
              locked: "locked",
            }[status];
            return (
              <button
                key={concept.id}
                ref={(el) => { spotRefs.current[i] = el; }}
                onClick={() => pick(concept.id)}
                aria-pressed={isSelected}
                aria-label={`Skill ${i + 1}: ${concept.name}, ${statusText}`}
                className="absolute -translate-x-1/2 -translate-y-1/2 group rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60"
                style={pct(layout.spots[i])}
              >
                {status === "next" && (
                  <span className={cn("absolute inset-0 rounded-full motion-safe:animate-ping", theme.ping)} aria-hidden="true" />
                )}
                <motion.span
                  whileHover={{ scale: 1.08, y: -2 }}
                  whileTap={{ scale: 0.95 }}
                  animate={{ scale: isSelected ? 1.12 : 1 }}
                  className={cn(
                    "relative w-14 h-14 sm:w-16 sm:h-16 rounded-full border-4 flex items-center justify-center shadow-lg transition-colors",
                    status === "complete" && "bg-emerald-500 border-white text-white",
                    (status === "next" || status === "open") && cn(theme.node, "border-white text-white"),
                    status === "empty" && "bg-slate-300 border-white text-white",
                    status === "locked" && "bg-slate-100 border-slate-200 text-slate-400",
                    isSelected && "ring-4 ring-amber-300",
                  )}
                >
                  <Icon className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden="true" />
                  {/* Number or status badge */}
                  <span
                    className={cn(
                      "absolute -top-1 -right-1 w-6 h-6 rounded-full border-2 border-white text-[11px] font-extrabold flex items-center justify-center",
                      status === "complete" ? "bg-emerald-700 text-white" : status === "locked" ? "bg-slate-400 text-white" : "bg-slate-900 text-white",
                    )}
                    aria-hidden="true"
                  >
                    {status === "complete" ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : status === "locked" ? <Lock className="w-3 h-3" /> : i + 1}
                  </span>
                </motion.span>

                {/* Name tag */}
                <span
                  className={cn(
                    "absolute top-full left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap px-2.5 py-1 rounded-lg border text-xs font-bold shadow-sm",
                    isSelected ? "bg-slate-900 text-white border-slate-900" : "bg-white/95 border-slate-200",
                    !isSelected && (status === "locked" ? "text-slate-500" : "text-slate-800"),
                  )}
                  aria-hidden="true"
                >
                  {concept.name}
                </span>

                {/* "You are here" marker walks to the next skill */}
                {i === nextIndex && (
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 pointer-events-none" aria-hidden="true">
                    <motion.span
                      layoutId="map-you"
                      animate={{ y: [0, -4, 0] }}
                      transition={{ y: { duration: 1.6, repeat: Infinity, ease: "easeInOut" } }}
                      className="flex flex-col items-center"
                    >
                      <span className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-900 text-[10px] font-extrabold uppercase tracking-wider shadow">
                        You
                      </span>
                      <span className="w-0 h-0 border-x-[5px] border-x-transparent border-t-[6px] border-t-amber-400" />
                    </motion.span>
                  </span>
                )}
              </button>
            );
          })}

          {/* The trophy at the end: the all-topics challenge, open any time */}
          <button
            ref={(el) => { spotRefs.current[CONCEPTS.length] = el; }}
            onClick={() => pick(CHALLENGE_ID)}
            aria-pressed={selected === CHALLENGE_ID}
            aria-label={`All Topics Challenge, ${allTopicsCount > 0 ? "open any time" : `no ${levelLabel} questions yet`}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60"
            style={pct(layout.spots[CONCEPTS.length])}
          >
            <motion.span
              whileHover={{ scale: 1.08, rotate: -3 }}
              whileTap={{ scale: 0.95 }}
              animate={{ scale: selected === CHALLENGE_ID ? 1.12 : 1 }}
              className={cn(
                "relative w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem] rounded-2xl border-4 border-white flex items-center justify-center shadow-xl",
                allTopicsCount > 0 ? "bg-slate-900 text-amber-300" : "bg-slate-300 text-white",
                selected === CHALLENGE_ID && "ring-4 ring-amber-300",
              )}
            >
              <Trophy className="w-8 h-8" aria-hidden="true" />
            </motion.span>
            <span
              className={cn(
                "absolute top-full left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap px-2.5 py-1 rounded-lg border text-xs font-bold shadow-sm",
                selected === CHALLENGE_ID ? "bg-slate-900 text-white border-slate-900" : "bg-amber-50 text-amber-900 border-amber-200",
              )}
              aria-hidden="true"
            >
              All Topics
            </span>
          </button>
          </div>

          {/* The new level's name, flashed over the map */}
          <AnimatePresence>
            {flash && (
              <motion.div
                key={flash}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.25 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                aria-hidden="true"
              >
                <div className={cn("px-6 py-3 rounded-2xl shadow-2xl text-center", THEMES[flash].flash)}>
                  <p className="text-2xl sm:text-3xl font-extrabold uppercase tracking-widest">
                    {DIFFICULTY_LABELS[flash]}
                  </p>
                  <p className="text-xs sm:text-sm font-semibold opacity-90">{THEMES[flash].tagline}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Details for the chosen spot */}
        <div ref={detailsRef} aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {selected === CHALLENGE_ID ? (
              <motion.div
                key={CHALLENGE_ID}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="flex flex-col sm:flex-row sm:items-center gap-5 p-5 sm:p-6 rounded-2xl bg-slate-900 text-white"
              >
                <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/10 text-amber-300 flex items-center justify-center shrink-0">
                  <Trophy className="w-6 h-6" aria-hidden="true" />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-xs font-bold uppercase tracking-widest text-blue-300">Mixed practice · open any time</p>
                  <h3 className="text-xl font-bold tracking-tight">All Topics Challenge</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    {allTopicsCount > 0
                      ? `Test yourself across all five skills: ${allTopicsCount} questions at ${levelLabel}.`
                      : `No ${levelLabel} questions yet. Try another difficulty.`}
                  </p>
                </div>
                <motion.button
                  whileHover={allTopicsCount > 0 ? { scale: 1.02 } : {}}
                  whileTap={allTopicsCount > 0 ? { scale: 0.98 } : {}}
                  onClick={() => allTopicsCount > 0 && onSelectAllTopics()}
                  disabled={allTopicsCount === 0}
                  className={cn(
                    "shrink-0 px-6 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors",
                    "focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/50",
                    allTopicsCount > 0 ? "bg-white text-slate-900 hover:bg-blue-50" : "bg-white/10 text-slate-500 cursor-not-allowed",
                  )}
                >
                  Start Challenge <ChevronRight className="w-5 h-5" aria-hidden="true" />
                </motion.button>
              </motion.div>
            ) : selectedIndex >= 0 ? (
              (() => {
                const concept = CONCEPTS[selectedIndex];
                const status = statusOf(selectedIndex);
                const Icon = CONCEPT_ICON_COMPONENTS[concept.id] ?? ShieldCheck;
                const count = conceptCounts[concept.id] ?? 0;
                const canStart = status !== "locked" && status !== "empty";
                const previous = CONCEPTS[selectedIndex - 1];
                return (
                  <motion.div
                    key={concept.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className={cn(
                      "flex flex-col sm:flex-row sm:items-center gap-5 p-5 sm:p-6 rounded-2xl border",
                      status === "complete" ? "bg-emerald-50 border-emerald-200" : status === "locked" ? "bg-slate-50 border-slate-200" : theme.panel,
                    )}
                  >
                    <div
                      className={cn(
                        "w-12 h-12 rounded-xl border flex items-center justify-center shrink-0",
                        status === "complete"
                          ? "bg-white border-emerald-200 text-emerald-600"
                          : status === "locked"
                            ? "bg-white border-slate-200 text-slate-400"
                            : cn("bg-white", theme.panelIcon),
                      )}
                    >
                      <Icon className="w-6 h-6" aria-hidden="true" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                        Skill {String(selectedIndex + 1).padStart(2, "0")}
                        {" · "}
                        <span
                          className={cn(
                            status === "complete" && "text-emerald-700",
                            (status === "next" || status === "open") && theme.accent,
                          )}
                        >
                          {status === "complete" ? "Complete" : status === "next" ? "Up next" : status === "open" ? "Open" : status === "empty" ? "No questions" : "Locked"}
                        </span>
                      </p>
                      <h3 className="text-xl font-bold text-slate-900 tracking-tight">{concept.name}</h3>
                      <p className="text-sm text-slate-600 leading-relaxed">{CONCEPT_BLURBS[concept.id]}</p>
                      <p className="text-xs font-semibold text-slate-500 pt-1">
                        {status === "locked"
                          ? `Finish ${previous?.name ?? "the skill before"} to open this one.`
                          : status === "empty"
                            ? `No ${levelLabel} questions yet. Try another difficulty.`
                            : `${count} question${count === 1 ? "" : "s"} at ${levelLabel}`}
                      </p>
                    </div>
                    <motion.button
                      whileHover={canStart ? { scale: 1.02 } : {}}
                      whileTap={canStart ? { scale: 0.98 } : {}}
                      onClick={() => canStart && onSelectConcept(concept.id)}
                      disabled={!canStart}
                      className={cn(
                        "shrink-0 px-6 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors",
                        "focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/50",
                        !canStart
                          ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                          : status === "complete"
                            ? "bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                            : cn(theme.cta, "shadow-md"),
                      )}
                    >
                      {status === "locked" ? (
                        <>
                          <Lock className="w-4 h-4" aria-hidden="true" /> Locked
                        </>
                      ) : status === "complete" ? (
                        <>
                          <RotateCcw className="w-4 h-4" aria-hidden="true" /> Play again
                        </>
                      ) : (
                        <>
                          Start mission <ChevronRight className="w-5 h-5" aria-hidden="true" />
                        </>
                      )}
                    </motion.button>
                  </motion.div>
                );
              })()
            ) : null}
          </AnimatePresence>
        </div>
      </section>
    </div>
  );
}
