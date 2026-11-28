import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Map as MapIcon,
  MailWarning,
  Pause,
  Play,
  Plus,
  Shield,
  ShieldCheck,
  Siren,
  Trophy,
  Users,
} from "lucide-react";
import { cn } from "../lib/utils";
import { CONCEPTS, CONCEPT_BLURBS, CONCEPT_ICON_COMPONENTS } from "./SoloMap";

/** How long each slide shows before the next, while playing. */
const SLIDE_MS = 8000;
const EASE = [0.22, 1, 0.36, 1] as const;

// ---------------------------------------------------------------------------
// Motion variants. Each slide animates to "shown" when it becomes the active
// slide and back to "hidden" when it leaves, so its entrance plays again every
// time it comes round. Children inherit the state and stagger in.
// ---------------------------------------------------------------------------

function variantsFor(still: boolean) {
  const t = (d: number) => (still ? { duration: 0 } : { duration: d, ease: EASE });
  const slide: Variants = {
    hidden: { opacity: 0, x: still ? 0 : -30, transition: t(0.35), transitionEnd: { visibility: "hidden" } },
    shown: {
      opacity: 1,
      x: 0,
      visibility: "visible",
      transition: { ...t(0.5), staggerChildren: still ? 0 : 0.08, delayChildren: still ? 0 : 0.1 },
    },
  };
  const group: Variants = {
    hidden: {},
    shown: { transition: { staggerChildren: still ? 0 : 0.09 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: still ? 0 : 18 },
    shown: { opacity: 1, y: 0, transition: t(0.5) },
  };
  const fromLeft: Variants = {
    hidden: { opacity: 0, x: still ? 0 : -28 },
    shown: { opacity: 1, x: 0, transition: t(0.45) },
  };
  const pop: Variants = {
    hidden: { opacity: 0, scale: still ? 1 : 0.85 },
    shown: { opacity: 1, scale: 1, transition: t(0.5) },
  };
  const word: Variants = {
    hidden: { y: still ? "0%" : "110%" },
    shown: { y: "0%", transition: t(0.55) },
  };
  const draw: Variants = {
    hidden: { pathLength: still ? 1 : 0 },
    shown: { pathLength: 1, transition: { ...t(0.7), delay: still ? 0 : 0.6 } },
  };
  // The template's descriptions type themselves in a word at a time.
  const typeGroup: Variants = {
    hidden: {},
    shown: { transition: { staggerChildren: still ? 0 : 0.035, delayChildren: still ? 0 : 0.55 } },
  };
  const typeWord: Variants = {
    hidden: { opacity: still ? 1 : 0 },
    shown: { opacity: 1, transition: { duration: still ? 0 : 0.12 } },
  };
  return { slide, group, item, fromLeft, pop, word, draw, typeGroup, typeWord };
}
type V = ReturnType<typeof variantsFor>;

/** Words that rise into place one after another, like the template's titles. */
function Words({ text, v, className }: { text: string; v: V; className?: string }) {
  return (
    <motion.span variants={v.group} className={className}>
      {/* Real spaces between the words, so screen readers and copy-paste
          get "The five core concepts", not "Thefivecoreconcepts". */}
      {text.split(" ").map((w, i, all) => (
        <Fragment key={`${w}-${i}`}>
          <span className="inline-block overflow-hidden align-bottom pb-[0.08em]">
            <motion.span variants={v.word} className="inline-block">
              {w}
            </motion.span>
          </span>
          {i < all.length - 1 ? " " : null}
        </Fragment>
      ))}
    </motion.span>
  );
}

/** A paragraph that types itself in, a word at a time. The full text is always in the page for screen readers. */
function TypeIn({ text, v, className }: { text: string; v: V; className?: string }) {
  return (
    <motion.p variants={v.typeGroup} className={className}>
      {text.split(" ").map((w, i) => (
        <motion.span key={`${w}-${i}`} variants={v.typeWord}>
          {w}{" "}
        </motion.span>
      ))}
    </motion.p>
  );
}

// ---------------------------------------------------------------------------
// The emblem: circuit traces draw in toward the centre and the rings turn.
// In the middle is either a shield and keyhole (with a scan line sweeping
// it) or the Ready Force Cyber logo on a white disc with a glowing ring.
// Decorative: the logo is also in the frame's top bar, with its alt text.
// ---------------------------------------------------------------------------

const LOGO_SRC = "/rfc-logo.svg";

function ShieldEmblem({ still, logo = false }: { still: boolean; logo?: boolean }) {
  const id = useId().replace(/:/g, "");
  const shield = "M100 38 L148 57 V98 C148 129 126 151 100 162 C74 151 52 129 52 98 V57 Z";
  // The traces end on the edge of whatever sits in the middle.
  const traces = logo
    ? [
        "M8 46 H40 L58 58",
        "M8 154 H40 L58 142",
        "M192 46 H160 L142 58",
        "M192 154 H160 L142 142",
        "M100 4 V40",
        "M100 196 V160",
        "M4 100 H40",
        "M196 100 H160",
      ]
    : [
        "M8 46 H38 L52 60",
        "M8 150 H34 L58 126",
        "M192 40 H164 L148 56",
        "M192 156 H168 L142 130",
        "M100 4 V38",
        "M100 196 V162",
        "M4 100 H52",
        "M196 100 H148",
      ];
  const nodes = logo
    ? [
        [8, 46],
        [8, 154],
        [192, 46],
        [192, 154],
        [100, 4],
        [100, 196],
        [4, 100],
        [196, 100],
      ]
    : [
        [8, 46],
        [8, 150],
        [192, 40],
        [192, 156],
        [100, 4],
        [100, 196],
        [4, 100],
        [196, 100],
      ];
  const draw = (delay: number) =>
    still
      ? { initial: false as const }
      : {
          initial: { pathLength: 0, opacity: 0 },
          animate: { pathLength: 1, opacity: 1 },
          transition: { duration: 1.1, delay, ease: "easeInOut" as const },
        };

  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#38bdf8" stopOpacity="0.35" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-shield`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2563eb" stopOpacity="0.55" />
          <stop offset="1" stopColor="#0b1430" stopOpacity="0.2" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d={shield} />
        </clipPath>
      </defs>

      <circle cx="100" cy="100" r="96" fill={`url(#${id}-glow)`} />

      <motion.g
        style={{ transformOrigin: "100px 100px" }}
        animate={still ? undefined : { rotate: 360 }}
        transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
      >
        <circle cx="100" cy="100" r="86" fill="none" stroke="#38bdf8" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 6" />
      </motion.g>
      <motion.g
        style={{ transformOrigin: "100px 100px" }}
        animate={still ? undefined : { rotate: -360 }}
        transition={{ duration: 90, repeat: Infinity, ease: "linear" }}
      >
        <circle cx="100" cy="100" r="74" fill="none" stroke="#60a5fa" strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="30 10 4 10" />
      </motion.g>

      {traces.map((d, i) => (
        <motion.path key={d} d={d} fill="none" stroke="#22d3ee" strokeOpacity="0.75" strokeWidth="1.5" strokeLinecap="round" {...draw(0.3 + i * 0.08)} />
      ))}
      {nodes.map(([cx, cy], i) => (
        <motion.circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="3"
          fill="#22d3ee"
          initial={still ? false : { scale: 0 }}
          animate={still ? undefined : { scale: [0, 1.4, 1] }}
          transition={{ delay: 1.2 + i * 0.06, duration: 0.4 }}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        />
      ))}

      {logo ? (
        <>
          {/* A soft pulse spreading out from the logo */}
          {!still && (
            <motion.circle
              cx="100"
              cy="100"
              r="62"
              fill="none"
              stroke="#22d3ee"
              strokeWidth="2"
              style={{ transformOrigin: "100px 100px" }}
              initial={{ scale: 1, opacity: 0 }}
              animate={{ scale: [1, 1.28], opacity: [0.6, 0] }}
              transition={{ delay: 1.4, duration: 2.4, repeat: Infinity, ease: "easeOut" }}
            />
          )}
          {/* The logo on a white disc, popping in */}
          <motion.g
            initial={still ? false : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.6, ease: "backOut" }}
            style={{ transformOrigin: "100px 100px" }}
          >
            <circle cx="100" cy="100" r="60" fill="#ffffff" />
            <image href={LOGO_SRC} x="44" y="44" width="112" height="112" preserveAspectRatio="xMidYMid meet" />
          </motion.g>
          {/* A glowing ring drawn around it */}
          <motion.circle
            cx="100"
            cy="100"
            r="62"
            fill="none"
            stroke="#7dd3fc"
            strokeWidth="2.5"
            style={{ filter: "drop-shadow(0 0 4px rgba(56,189,248,0.8))" }}
            {...draw(0.5)}
          />
        </>
      ) : (
        <>
          <motion.path d={shield} fill={`url(#${id}-shield)`} stroke="#7dd3fc" strokeWidth="2.5" strokeLinejoin="round" {...draw(0)} />
          <motion.g
            initial={still ? false : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.9, duration: 0.5, ease: "backOut" }}
            style={{ transformOrigin: "100px 100px" }}
          >
            <circle cx="100" cy="92" r="13" fill="#e0f2fe" />
            <path d="M94 100 L91 128 H109 L106 100 Z" fill="#e0f2fe" />
          </motion.g>
        </>
      )}

      {!still && !logo && (
        <g clipPath={`url(#${id}-clip)`}>
          <motion.rect
            x="40"
            width="120"
            height="10"
            fill="#22d3ee"
            fillOpacity="0.28"
            initial={{ y: 30 }}
            animate={{ y: [30, 160, 30] }}
            transition={{ delay: 1.6, duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />
        </g>
      )}
    </svg>
  );
}

/** The dark panel holding the emblem. `play` changes each time the slide shows, replaying the drawing. */
function EmblemPanel({
  still,
  play,
  caption,
  className,
  logo = false,
}: {
  still: boolean;
  play: number;
  caption: string;
  className?: string;
  logo?: boolean;
}) {
  return (
    <div className={cn("relative rounded-3xl bg-[#0b1430] overflow-hidden flex items-center justify-center p-4 pb-10 md:p-6", className)}>
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-40 bg-[linear-gradient(to_right,rgba(56,189,248,0.15)_1px,transparent_1px),linear-gradient(to_bottom,rgba(56,189,248,0.15)_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
      />
      <div className="relative w-full max-w-[150px] md:max-w-[280px] aspect-square">
        <ShieldEmblem key={play} still={still} logo={logo} />
      </div>
      <p className="absolute bottom-4 left-0 right-0 text-center text-[11px] font-bold uppercase tracking-[0.25em] text-cyan-200/80">
        {caption}
      </p>
    </div>
  );
}

function CtaButtons({ onJoinClass, onPracticeSolo, dark = false }: { onJoinClass: () => void; onPracticeSolo: () => void; dark?: boolean }) {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        onClick={onJoinClass}
        className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition-colors shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
      >
        <Users className="w-5 h-5" aria-hidden="true" /> Join my class
      </button>
      <button
        onClick={onPracticeSolo}
        className={cn(
          "inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-bold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-400",
          dark ? "bg-white text-slate-900 hover:bg-blue-50" : "bg-slate-900 text-white hover:bg-slate-800",
        )}
      >
        Practice solo <ArrowRight className="w-5 h-5" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The slides
// ---------------------------------------------------------------------------

interface SlideProps {
  v: V;
  still: boolean;
  play: number;
  onJoinClass: () => void;
  onPracticeSolo: () => void;
}

function IntroSlide({ v, still, play, onJoinClass, onPracticeSolo }: SlideProps) {
  return (
    <div className="grid md:grid-cols-[1.08fr_1fr] gap-3 md:gap-0 h-full">
      {/* The dark panel sits over the edge of the shield panel */}
      <motion.div
        variants={v.item}
        className="relative z-10 rounded-3xl md:rounded-[2rem] bg-slate-950 p-6 sm:p-8 md:pr-10 md:-mr-8 flex flex-col justify-center gap-4 sm:gap-5 shadow-2xl shadow-black/40"
      >
        <h1 id="home-title" className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.05]">
          <Words text="Learn Cybersecurity" v={v} />{" "}
          <br />
          <span className="relative inline-block">
            <Words text="by Playing" v={v} className="text-sky-300" />
            <svg viewBox="0 0 300 20" preserveAspectRatio="none" className="absolute left-0 -bottom-2 w-[92%] h-3" aria-hidden="true">
              <motion.path d="M4 14 C 80 4, 200 2, 296 10" fill="none" stroke="#38bdf8" strokeWidth="6" strokeLinecap="round" variants={v.draw} />
            </svg>
          </span>
        </h1>
        <TypeIn
          v={v}
          className="text-sky-100 text-base md:text-lg leading-relaxed max-w-xl"
          text="Cybersecurity isn't optional any more. Short, game-style missions teach the five core concepts every digital citizen should know, with instant feedback on every answer. No experience needed."
        />
        <motion.div variants={v.item}>
          <CtaButtons onJoinClass={onJoinClass} onPracticeSolo={onPracticeSolo} dark />
        </motion.div>
      </motion.div>
      <motion.div variants={v.pop} className="min-h-[200px] md:min-h-[240px]">
        <EmblemPanel logo still={still} play={play} caption="Learn · Practice · Prove" className="h-full md:pl-10" />
      </motion.div>
    </div>
  );
}

function ConceptsSlide({ v, still, play }: SlideProps) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="grid md:grid-cols-[1.15fr_1fr] md:grid-rows-[auto_1fr] gap-3 sm:gap-4 md:gap-x-0 h-full">
      <motion.div
        variants={v.item}
        className="md:col-span-2 rounded-3xl bg-white px-6 py-5 sm:px-8 sm:py-6 flex items-center justify-between gap-4"
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">What you'll learn</p>
          <h2 className="mt-1 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
            <Words text="The five core concepts" v={v} />
          </h2>
        </div>
      </motion.div>
      {/* The list sits over the edge of the shield panel */}
      <div className="relative z-10 md:-mr-10">
        <motion.ul variants={v.group} className="h-full rounded-3xl bg-slate-950 p-3 sm:p-4 space-y-2 shadow-2xl shadow-black/40">
          {CONCEPTS.map((c, i) => {
            const Icon = CONCEPT_ICON_COMPONENTS[c.id] ?? Shield;
            const isOpen = open === c.id;
            const panelId = `hero-concept-${c.id}`;
            return (
              <motion.li key={c.id} variants={v.fromLeft}>
                <button
                  onClick={() => setOpen(isOpen ? null : c.id)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className={cn(
                    "w-full text-left rounded-2xl border px-4 py-2.5 transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/50",
                    isOpen ? "border-blue-400/70 bg-blue-500/15" : "border-white/15 bg-white/5 hover:bg-white/10",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-200 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 tracking-[0.2em]">{String(i + 1).padStart(2, "0")}</span>
                    <span className="flex-1 text-sm font-semibold text-white">{c.name}</span>
                    <motion.span
                      animate={{ rotate: isOpen ? 45 : 0 }}
                      transition={still ? { duration: 0 } : undefined}
                      className="w-7 h-7 rounded-full border-2 border-blue-300/70 text-blue-200 flex items-center justify-center shrink-0"
                      aria-hidden="true"
                    >
                      <Plus className="w-4 h-4" />
                    </motion.span>
                  </span>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.span
                        id={panelId}
                        initial={still ? false : { height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={still ? undefined : { height: 0, opacity: 0 }}
                        className="block overflow-hidden"
                      >
                        <span className="block pt-2 pl-11 text-sm text-slate-300 leading-snug">{CONCEPT_BLURBS[c.id]}</span>
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </motion.li>
            );
          })}
        </motion.ul>
      </div>
      <motion.div variants={v.pop} className="hidden md:block">
        <EmblemPanel logo still={still} play={play} caption="Tap + to learn more" className="h-full md:pl-10" />
      </motion.div>
    </div>
  );
}

function OutcomesSlide({ v, onJoinClass, onPracticeSolo }: SlideProps) {
  const outcomes = [
    { icon: MailWarning, text: "Spot common threats like phishing and impersonation" },
    { icon: KeyRound, text: "Protect accounts with strong passwords and multi-factor sign-in" },
    { icon: ShieldCheck, text: "Keep information private, accurate and available" },
    { icon: Siren, text: "Know the first steps to take when something goes wrong" },
  ];
  return (
    <div className="flex flex-col gap-3 sm:gap-4 h-full">
      <h2 className="text-center text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight py-1 sm:py-2">
        <Words text="By the end," v={v} />{" "}
        <br />
        <Words text="you'll be able to:" v={v} />
      </h2>
      <motion.ul variants={v.group} className="flex-1 grid sm:grid-cols-2 gap-3 sm:gap-4">
        {outcomes.map(({ icon: Icon, text }) => (
          <motion.li key={text} variants={v.pop} className="rounded-3xl bg-slate-950 p-4 sm:p-6 flex items-center gap-3 sm:gap-4">
            <span className="w-11 h-11 rounded-xl bg-blue-500/20 text-blue-200 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5" aria-hidden="true" />
            </span>
            <span className="text-white text-sm sm:text-base font-semibold leading-snug">{text}</span>
          </motion.li>
        ))}
      </motion.ul>
      <motion.div
        variants={v.item}
        className="rounded-full bg-white px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-3"
      >
        <p className="font-extrabold text-slate-900 text-lg">Free for every classroom</p>
        <CtaButtons onJoinClass={onJoinClass} onPracticeSolo={onPracticeSolo} />
      </motion.div>
    </div>
  );
}

function WaysToPlaySlide({ v, onJoinClass, onPracticeSolo }: SlideProps) {
  const ways = [
    { icon: Users, title: "Live Quiz", text: "Your class answers together against the clock, with a live leaderboard." },
    { icon: Trophy, title: "Game Show", text: "Teams spin the wheel on the projector and race to answer." },
    { icon: MapIcon, title: "Solo Practice", text: "Work through the skills map at your own pace, any time." },
  ];
  return (
    <div className="flex flex-col gap-3 sm:gap-4 h-full">
      <motion.div variants={v.item} className="rounded-3xl bg-white px-6 py-5 sm:px-8 sm:py-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Three ways to play</p>
        <h2 className="mt-1 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
          <Words text="Pick how you want to learn" v={v} />
        </h2>
      </motion.div>
      <motion.ul variants={v.group} className="flex-1 grid md:grid-cols-3 gap-3 sm:gap-4">
        {ways.map(({ icon: Icon, title, text }) => (
          <motion.li key={title} variants={v.item} className="rounded-3xl bg-slate-950 p-4 md:p-6 grid grid-cols-[auto_1fr] md:flex md:flex-col gap-x-3 gap-y-1 md:gap-3 items-center md:items-start">
            <span className="row-span-2 w-11 h-11 md:w-12 md:h-12 rounded-2xl bg-amber-400/15 text-amber-300 flex items-center justify-center">
              <Icon className="w-6 h-6" aria-hidden="true" />
            </span>
            <span className="text-white text-lg md:text-xl font-bold">{title}</span>
            <span className="text-slate-300 text-sm leading-relaxed">{text}</span>
          </motion.li>
        ))}
      </motion.ul>
      <motion.div variants={v.item} className="flex justify-center">
        <CtaButtons onJoinClass={onJoinClass} onPracticeSolo={onPracticeSolo} dark />
      </motion.div>
    </div>
  );
}

const SLIDES: { label: string; render: (p: SlideProps) => ReactNode }[] = [
  { label: "Learn cybersecurity by playing", render: (p) => <IntroSlide {...p} /> },
  { label: "The five core concepts", render: (p) => <ConceptsSlide {...p} /> },
  { label: "What you'll be able to do", render: (p) => <OutcomesSlide {...p} /> },
  { label: "Three ways to play", render: (p) => <WaysToPlaySlide {...p} /> },
];

// ---------------------------------------------------------------------------
// The slideshow
// ---------------------------------------------------------------------------

interface HomeHeroProps {
  onJoinClass: () => void;
  onPracticeSolo: () => void;
}

/**
 * The top of the home page as a slideshow, after the Canva template's
 * scenes: each slide's titles rise in word by word and its cards slide or
 * pop into place. It moves on every few seconds and pauses while someone
 * hovers over it or uses it with the keyboard. Visitors who prefer reduced
 * motion get no autoplay and no movement; the controls still work.
 */
export function HomeHero({ onJoinClass, onPracticeSolo }: HomeHeroProps) {
  const still = !!useReducedMotion();
  const v = variantsFor(still);

  const [index, setIndex] = useState(0);
  const [plays, setPlays] = useState(0); // counts slide changes, to replay drawings
  const [playing, setPlaying] = useState(!still);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const regionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (still) setPlaying(false);
  }, [still]);

  useEffect(() => {
    const onVis = () => setPageHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const go = (next: number) => {
    setIndex((next + SLIDES.length) % SLIDES.length);
    setPlays((n) => n + 1);
  };

  const running = playing && !hovered && !focused && !pageHidden;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    go(index + (e.key === "ArrowRight" ? 1 : -1));
  };

  return (
    <motion.section
      ref={regionRef}
      aria-roledescription="carousel"
      aria-label="About Ready Force Labs"
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!regionRef.current?.contains(e.relatedTarget as Node)) setFocused(false);
      }}
      initial={still ? false : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="relative rounded-[2rem] bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-3 sm:p-5 shadow-2xl shadow-blue-900/25 overflow-clip"
    >
      {/* A soft light passing across the frame */}
      {!still && (
        <motion.div
          aria-hidden="true"
          className="absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none"
          initial={{ left: "-40%" }}
          animate={{ left: "120%" }}
          transition={{ delay: 1.4, duration: 2.2, repeat: Infinity, repeatDelay: 5, ease: "easeInOut" }}
        />
      )}

      {/* Slides, stacked in one grid cell so the frame keeps the height of the tallest */}
      <div className="relative grid" aria-live={running ? "off" : "polite"}>
        {SLIDES.map((s, i) => {
          const active = i === index;
          return (
            <motion.div
              key={s.label}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${SLIDES.length}: ${s.label}`}
              aria-hidden={!active}
              inert={!active}
              variants={v.slide}
              initial="hidden"
              animate={active ? "shown" : "hidden"}
              className="[grid-area:1/1] min-w-0"
            >
              {s.render({ v, still, play: active ? plays : -1, onJoinClass, onPracticeSolo })}
            </motion.div>
          );
        })}
      </div>

      {/* Controls */}
      <div className="relative mt-3 sm:mt-4 flex items-center justify-center gap-2 sm:gap-3">
        <button
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause slideshow" : "Play slideshow"}
          className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center focus:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
        >
          {playing ? <Pause className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
        </button>
        <button
          onClick={() => go(index - 1)}
          aria-label="Previous slide"
          className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center focus:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
        >
          <ChevronLeft className="w-5 h-5" aria-hidden="true" />
        </button>
        <div className="flex items-center" role="group" aria-label="Choose a slide">
          {SLIDES.map((s, i) => {
            const active = i === index;
            return (
              <button
                key={s.label}
                onClick={() => go(i)}
                aria-label={`Slide ${i + 1}: ${s.label}`}
                aria-current={active ? "true" : undefined}
                // The dot is small, but the button around it is a 24px tap target.
                className="group h-6 min-w-6 px-[3px] flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
              >
                <span
                  className={cn(
                    "relative block h-2.5 rounded-full overflow-hidden transition-all",
                    active ? "w-12 bg-white/30" : "w-2.5 bg-white/40 group-hover:bg-white/70",
                  )}
                >
                {/* Progress toward the next slide; finishing it moves on */}
                {active && (
                  <span
                    key={plays}
                    className={cn("hero-progress absolute inset-y-0 left-0 bg-white rounded-full", !playing && "w-full")}
                    style={{
                      animationDuration: `${SLIDE_MS}ms`,
                      animationPlayState: running ? "running" : "paused",
                      animationName: playing ? undefined : "none",
                    }}
                    onAnimationEnd={() => go(index + 1)}
                  />
                )}
                </span>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => go(index + 1)}
          aria-label="Next slide"
          className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center focus:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
        >
          <ChevronRight className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
    </motion.section>
  );
}
