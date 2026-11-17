import { motion } from "motion/react";
import { cn } from "../lib/utils";
import { WHEEL } from "../lib/gameshow";

// The game-show wheel, shared by the class projector view and solo play.

export const SEGMENT_ANGLE = 360 / WHEEL.length;

/** Wheel segment colours, alternating so slices are distinguishable. */
function segmentFill(index: number, kind: string) {
  if (kind === "bankrupt") return "#0f172a";
  if (kind === "lose_turn") return "#7f1d1d";
  if (kind === "double") return "#a16207";
  return index % 2 === 0 ? "#1d4ed8" : "#1e40af";
}

/** SVG wedge path for one segment of the wheel. */
function wedgePath(index: number, radius: number) {
  const start = (index * SEGMENT_ANGLE - 90) * (Math.PI / 180);
  const end = ((index + 1) * SEGMENT_ANGLE - 90) * (Math.PI / 180);
  const x1 = radius + radius * Math.cos(start);
  const y1 = radius + radius * Math.sin(start);
  const x2 = radius + radius * Math.cos(end);
  const y2 = radius + radius * Math.sin(end);
  return `M ${radius} ${radius} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`;
}

/**
 * The rotation that brings a segment's centre under the pointer, continuing
 * clockwise from wherever the wheel is now.
 *
 * It always travels at least `turns` full turns, so every spin looks like a
 * spin — including one that lands on the segment the wheel is already on.
 */
export function nextWheelRotation(current: number, landedIndex: number, turns = 3): number {
  const target = -(landedIndex * SEGMENT_ANGLE + SEGMENT_ANGLE / 2);
  const base = current + 360 * turns;
  const delta = (((target - base) % 360) + 360) % 360;
  return base + delta;
}

export interface WheelFaceProps {
  /** Rotation in degrees; the pointer is at the top. */
  rotation: number;
  /** Seconds the wheel takes to reach `rotation`; 0 jumps straight there. */
  duration: number;
  /** Sizing classes for the square wrapper; the wheel fills it. */
  className?: string;
}

/** The wheel itself: a pointer and the rotating face. Purely presentational. */
export function WheelFace({ rotation, duration, className }: WheelFaceProps) {
  const R = 150;
  return (
    <div className={cn("relative aspect-square shrink-0", className ?? "w-[300px]")} aria-hidden="true">
      {/* Pointer */}
      <div className="absolute left-1/2 -translate-x-1/2 -top-2 z-10 w-0 h-0 border-l-[14px] border-r-[14px] border-t-[26px] border-l-transparent border-r-transparent border-t-amber-400 drop-shadow-lg" />
      <motion.svg
        viewBox={`0 0 ${R * 2} ${R * 2}`}
        animate={{ rotate: rotation }}
        transition={{ duration, ease: [0.17, 0.67, 0.2, 1] }}
        className="w-full h-full drop-shadow-2xl"
      >
        {WHEEL.map((seg, i) => {
          const mid = i * SEGMENT_ANGLE + SEGMENT_ANGLE / 2 - 90;
          const tx = R + R * 0.65 * Math.cos((mid * Math.PI) / 180);
          const ty = R + R * 0.65 * Math.sin((mid * Math.PI) / 180);
          return (
            <g key={seg.id}>
              <path d={wedgePath(i, R)} fill={segmentFill(i, seg.kind)} stroke="#0b1220" strokeWidth="2" />
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
        <circle cx={R} cy={R} r="26" fill="#0b1220" stroke="#f59e0b" strokeWidth="3" />
      </motion.svg>
    </div>
  );
}
