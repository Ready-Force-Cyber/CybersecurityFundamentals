import { describe, it, expect } from "vitest";
import { nextWheelRotation, SEGMENT_ANGLE } from "../src/components/Wheel";
import { WHEEL } from "../src/lib/gameshow";

/** Which segment sits under the pointer (at the top) for a given rotation. */
function segmentUnderPointer(rotation: number): number {
  // The wheel is drawn with segment 0 starting at the top and rotated by
  // `rotation` degrees; the pointer reads the angle that has turned up to it.
  const angle = (((-rotation % 360) + 360) % 360);
  return Math.floor(angle / SEGMENT_ANGLE);
}

describe("nextWheelRotation", () => {
  it("lands every segment under the pointer, from any starting position", () => {
    for (const start of [0, 37, 360, 1234.5, -90]) {
      for (let index = 0; index < WHEEL.length; index++) {
        expect(segmentUnderPointer(nextWheelRotation(start, index))).toBe(index);
      }
    }
  });

  it("lands on the centre of the segment, not its edge", () => {
    const rotation = nextWheelRotation(0, 4);
    const angle = (((-rotation % 360) + 360) % 360);
    expect(angle - 4 * SEGMENT_ANGLE).toBeCloseTo(SEGMENT_ANGLE / 2);
  });

  // The visual promise of a spin: it always turns, and always forwards.
  it("always travels at least three full turns, clockwise", () => {
    let rotation = 0;
    for (const index of [3, 3, 3, 0, 11, 5, 5]) {
      const next = nextWheelRotation(rotation, index);
      expect(next - rotation).toBeGreaterThanOrEqual(360 * 3);
      expect(next - rotation).toBeLessThan(360 * 4);
      rotation = next;
    }
  });

  it("still spins fully when it lands on the segment it is already on", () => {
    const first = nextWheelRotation(0, 7);
    const again = nextWheelRotation(first, 7);
    expect(again - first).toBeCloseTo(360 * 3);
  });
});
