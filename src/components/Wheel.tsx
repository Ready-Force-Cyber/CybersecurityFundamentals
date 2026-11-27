import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import {
  motion,
  animate,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  useVelocity,
  type MotionValue,
} from "motion/react";
import { cn } from "../lib/utils";
import { WHEEL } from "../lib/gameshow";

// The game-show wheel, shared by the class projector view and solo play.
//
// Everything here is decoration on top of one number — the wheel's rotation.
// The rotation is driven to the segment the game has already chosen, so
// however lively the spin looks, it always stops on the real result.

export const SEGMENT_ANGLE = 360 / WHEEL.length;

/** How long a full spin takes, including the settle at the end. */
export const SPIN_SECONDS = 3.6;

/** How far past the target the wheel coasts before settling back. */
const OVERSHOOT_DEGREES = 7;

/** Rim bulbs around the wheel. */
const BULBS = 24;

/** Wheel segment colours, alternating so slices are distinguishable. */
export function segmentFill(index: number, kind: string) {
  if (kind === "bankrupt") return "#0f172a";
  if (kind === "lose_turn") return "#7f1d1d";
  if (kind === "double") return "#a16207";
  return index % 2 === 0 ? "#1d4ed8" : "#1e40af";
}

/** SVG wedge path for one segment of a wheel of the given radius. */
function wedgePath(index: number, radius: number, cx = radius, cy = radius) {
  const start = (index * SEGMENT_ANGLE - 90) * (Math.PI / 180);
  const end = ((index + 1) * SEGMENT_ANGLE - 90) * (Math.PI / 180);
  const x1 = cx + radius * Math.cos(start);
  const y1 = cy + radius * Math.sin(start);
  const x2 = cx + radius * Math.cos(end);
  const y2 = cy + radius * Math.sin(end);
  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`;
}

/** Which segment sits under the pointer (at the top) for a rotation. */
export function segmentAtPointer(rotation: number): number {
  const angle = (((-rotation % 360) + 360) % 360);
  return Math.floor(angle / SEGMENT_ANGLE) % WHEEL.length;
}

/**
 * The rotation that brings a segment's centre under the pointer, continuing
 * clockwise from wherever the wheel is now.
 *
 * It always travels at least `turns` full turns, so every spin looks like a
 * spin — including one that lands on the segment the wheel is already on.
 */
export function nextWheelRotation(current: number, landedIndex: number, turns = 5): number {
  const target = -(landedIndex * SEGMENT_ANGLE + SEGMENT_ANGLE / 2);
  const base = current + 360 * turns;
  const delta = (((target - base) % 360) + 360) % 360;
  return base + delta;
}

/**
 * How far the flapper pointer is knocked sideways, in degrees, for a wheel
 * rotation and spin direction (1 = clockwise). A boundary passing the pointer
 * knocks it against the direction of travel; it springs back across the rest
 * of the segment. Positive is clockwise, as in CSS.
 */
export function flapperTilt(rotation: number, direction: number): number {
  const frac = (((-rotation % SEGMENT_ANGLE) + SEGMENT_ANGLE) % SEGMENT_ANGLE) / SEGMENT_ANGLE;
  const nearBoundary = direction > 0 ? 1 - frac : frac;
  return nearBoundary < 0.22 ? -direction * 26 * (1 - nearBoundary / 0.22) : 0;
}

export interface WheelSpin {
  /** The wheel's rotation in degrees, animated. Read it per frame. */
  rot: MotionValue<number>;
  spinning: boolean;
  /** True once the wheel has stopped on a result. */
  settled: boolean;
  /** 1 while turning clockwise, -1 anticlockwise. A ref: read it per frame. */
  direction: { current: number };
  /** The segment under the pointer once settled, else null. */
  landedIndex: number | null;
}

/**
 * The spin itself, shared by the 2D and 3D wheels so both move by the same
 * rules and stop on the same segment: a fast start, a long coast, a small
 * overshoot past the target, then a settle back onto it.
 */
/** What a spin reports as it happens, e.g. to play sounds in time with it. */
export interface WheelEvents {
  /** Each time a segment boundary passes the pointer while spinning. */
  onTick?: () => void;
  /** An animated spin begins. */
  onSpinStart?: () => void;
  /** An animated spin comes to rest (not called for a jump with no animation). */
  onLand?: () => void;
}

export function useWheelSpin(rotation: number, duration: number, events: WheelEvents = {}): WheelSpin {
  const rot = useMotionValue(rotation);
  const [spinning, setSpinning] = useState(false);
  const [settled, setSettled] = useState(false);
  // Read inside the motion-value listener, which must not depend on render.
  const spinningRef = useRef(false);
  spinningRef.current = spinning;
  const lastSegment = useRef(segmentAtPointer(rotation));
  const direction = useRef(1);
  // Read the latest callbacks without restarting the spin when they change.
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    const from = rot.get();
    if (from === rotation) return;
    if (duration <= 0) {
      rot.set(rotation);
      lastSegment.current = segmentAtPointer(rotation);
      setSettled(true);
      return;
    }
    direction.current = rotation > from ? 1 : -1;
    setSpinning(true);
    setSettled(false);
    eventsRef.current.onSpinStart?.();
    const controls = animate(rot, [from, rotation + direction.current * OVERSHOOT_DEGREES, rotation], {
      duration,
      times: [0, 0.86, 1],
      ease: [
        [0.12, 0.62, 0.18, 1],
        [0.45, 0, 0.55, 1],
      ],
    });
    controls.then(() => {
      setSpinning(false);
      setSettled(true);
      eventsRef.current.onLand?.();
    });
    return () => controls.stop();
  }, [rotation, duration, rot]);

  // A tick each time a segment boundary passes the pointer: it drives the
  // sound and the pointer's flick, so both match what the eye sees.
  useMotionValueEvent(rot, "change", (r) => {
    const segment = segmentAtPointer(r);
    if (segment !== lastSegment.current) {
      lastSegment.current = segment;
      if (spinningRef.current) eventsRef.current.onTick?.();
    }
  });

  return { rot, spinning, settled, direction, landedIndex: settled ? segmentAtPointer(rotation) : null };
}

export interface WheelFaceProps extends WheelEvents {
  /** Rotation in degrees; the pointer is at the top. */
  rotation: number;
  /** Seconds the wheel takes to reach `rotation`; 0 jumps straight there. */
  duration: number;
  /** Sizing classes for the square wrapper; the wheel fills it. */
  className?: string;
}

/** The wheel itself: pointer, rim lights and the rotating face. */
export function WheelFace({ rotation, duration, onTick, onSpinStart, onLand, className }: WheelFaceProps) {
  const R = 150;
  const { rot, spinning, settled, direction, landedIndex } = useWheelSpin(rotation, duration, {
    onTick,
    onSpinStart,
    onLand,
  });

  // The pointer is a flapper: it is knocked sideways as each boundary passes
  // and springs back while the wheel crosses the segment.
  const pointerTilt = useTransform(rot, (r) => flapperTilt(r, direction.current));

  // A little motion blur at full speed, gone well before the wheel stops.
  const velocity = useVelocity(rot);
  const blur = useTransform(velocity, (v) => `blur(${Math.min(1.6, Math.abs(v) / 900).toFixed(2)}px)`);

  const VIEW = R * 2 + 36; // room for the rim and bulbs
  const C = VIEW / 2;

  return (
    <div className={cn("relative aspect-square shrink-0", className ?? "w-[300px]")} aria-hidden="true">
      {/* Glow behind the wheel, brighter while it spins */}
      <div
        className={cn(
          "absolute inset-[6%] rounded-full blur-2xl transition-opacity duration-700",
          "bg-[radial-gradient(circle,rgba(251,191,36,0.35),rgba(59,130,246,0.15)_60%,transparent_70%)]",
          spinning ? "opacity-100" : "opacity-50",
        )}
      />

      {/* Pointer: a flapper that flicks as each segment passes */}
      <motion.div
        style={{ rotate: pointerTilt, transformOrigin: "50% 15%" }}
        className="absolute left-1/2 -translate-x-1/2 -top-[2%] z-20 w-[11%] drop-shadow-[0_3px_6px_rgba(0,0,0,0.6)]"
      >
        <svg viewBox="0 0 40 52" className="w-full">
          <path d="M20 52 L4 14 A17 17 0 1 1 36 14 Z" fill="#fbbf24" stroke="#78350f" strokeWidth="2" />
          <circle cx="20" cy="15" r="6" fill="#78350f" />
        </svg>
      </motion.div>

      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="relative w-full h-full">
        {/* Rim */}
        <circle cx={C} cy={C} r={R + 14} fill="#0b1220" stroke="#f59e0b" strokeWidth="3" />

        {/* Rim bulbs: chase while spinning, flash when it lands */}
        {Array.from({ length: BULBS }, (_, i) => {
          const a = ((i / BULBS) * 360 - 90) * (Math.PI / 180);
          return (
            <circle
              key={i}
              cx={C + (R + 8) * Math.cos(a)}
              cy={C + (R + 8) * Math.sin(a)}
              r="3.4"
              className={cn(
                "fill-amber-200",
                spinning ? "wheel-bulb-chase" : settled ? "wheel-bulb-flash" : "wheel-bulb-idle",
              )}
              style={{ animationDelay: spinning ? `${(i % 4) * 0.09}s` : `${(i % 2) * 0.25}s` }}
            />
          );
        })}

        {/* The rotating face */}
        <motion.g style={{ rotate: rot, filter: blur }}>
          {WHEEL.map((seg, i) => {
            const mid = i * SEGMENT_ANGLE + SEGMENT_ANGLE / 2 - 90;
            const tx = C + R * 0.65 * Math.cos((mid * Math.PI) / 180);
            const ty = C + R * 0.65 * Math.sin((mid * Math.PI) / 180);
            return (
              <g key={seg.id}>
                <path d={wedgePath(i, R, C, C)} fill={segmentFill(i, seg.kind)} stroke="#0b1220" strokeWidth="2" />
                <text
                  x={tx}
                  y={ty}
                  fill="white"
                  fontSize={seg.kind === "points" ? 20 : 11}
                  fontWeight="700"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${mid + 90}, ${tx}, ${ty})`}
                >
                  {seg.label}
                </text>
              </g>
            );
          })}
          {/* The winning segment glows once the wheel has stopped */}
          {landedIndex !== null && (
            <path
              d={wedgePath(landedIndex, R, C, C)}
              fill="rgba(255,255,255,0.18)"
              stroke="#fde68a"
              strokeWidth="4"
              strokeLinejoin="round"
              className="wheel-winner"
            />
          )}
        </motion.g>

        {/* Hub */}
        <circle cx={C} cy={C} r="28" fill="#0b1220" stroke="#f59e0b" strokeWidth="3" />
        <circle cx={C} cy={C} r="9" className={spinning ? "fill-amber-300" : "fill-amber-500"} />
      </svg>
    </div>
  );
}

// ---- 3D ---------------------------------------------------------------------

// The 3D wheel and Three.js load only when a game-show screen first needs
// them, so the rest of the app (and solo practice on a device without WebGL)
// never downloads them.
const Wheel3D = lazy(() => import("./Wheel3D"));

let webglSupport: boolean | null = null;
/** Whether this browser can create a WebGL context. Checked once. */
function canUseWebGL(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement("canvas");
    webglSupport = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

/** Falls back to the 2D wheel if the 3D one fails (e.g. the GPU context is lost). */
class FallbackOnError extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("3D wheel unavailable, using the 2D wheel:", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface GameWheelProps extends WheelFaceProps {
  /** Calm the scene: no light chase or camera movement. */
  reducedMotion?: boolean;
}

/**
 * The wheel to put on screen: the 3D studio wheel where the device supports
 * WebGL, otherwise the 2D wheel. The 2D wheel also shows while the 3D one
 * loads, so there is never an empty space. Both are driven by the same
 * rotation, so they always agree on the result.
 */
export function GameWheel(props: GameWheelProps) {
  const [use3D] = useState(canUseWebGL);
  const flat = <WheelFace {...props} />;
  if (!use3D) return flat;
  return (
    <FallbackOnError fallback={flat}>
      <Suspense fallback={flat}>
        <Wheel3D {...props} />
      </Suspense>
    </FallbackOnError>
  );
}
