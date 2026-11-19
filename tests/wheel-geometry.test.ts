import { describe, it, expect } from "vitest";
import { segmentSector, boundaryAngle, wheelRotationZ, SEGMENT_DEG, fromTopClockwise } from "../src/lib/wheel-geometry";
import { nextWheelRotation, segmentAtPointer, flapperTilt, SEGMENT_ANGLE } from "../src/components/Wheel";
import { WHEEL } from "../src/lib/gameshow";

const TAU = Math.PI * 2;
/** An angle in radians folded into [0, 2π). */
const fold = (a: number) => ((a % TAU) + TAU) % TAU;
/** The pointer sits at the top: +90 degrees in Three.js terms. */
const POINTER = Math.PI / 2;

// The 3D wheel must stop on the segment the game chose, exactly as the 2D
// wheel does. These check the conversion from the game's angles (clockwise
// from the top, degrees) into Three.js's (anticlockwise from +x, radians).
describe("3D wheel geometry", () => {
  it("uses the same segment size as the 2D wheel", () => {
    expect(SEGMENT_DEG).toBe(SEGMENT_ANGLE);
  });

  it("puts the top of the wheel at Three.js's +90 degrees", () => {
    expect(fromTopClockwise(0)).toBeCloseTo(POINTER);
    expect(fromTopClockwise(90)).toBeCloseTo(0); // a quarter turn clockwise is +x
  });

  it("tiles the circle with segment sectors, no gaps or overlaps", () => {
    const total = WHEEL.reduce((sum, _, i) => sum + segmentSector(i).thetaLength, 0);
    expect(total).toBeCloseTo(TAU);
    for (let i = 0; i < WHEEL.length - 1; i++) {
      // Going clockwise, each segment starts where the previous one ended.
      expect(fold(segmentSector(i).thetaStart)).toBeCloseTo(
        fold(segmentSector(i + 1).thetaStart + segmentSector(i + 1).thetaLength),
      );
    }
  });

  it("lands the chosen segment's centre under the pointer, from any start", () => {
    for (const start of [0, 777, -1234]) {
      for (let i = 0; i < WHEEL.length; i++) {
        const rotation = nextWheelRotation(start, i);
        const { thetaStart, thetaLength } = segmentSector(i);
        const centre = thetaStart + thetaLength / 2 + wheelRotationZ(rotation);
        expect(fold(centre)).toBeCloseTo(POINTER, 6);
      }
    }
  });

  it("agrees with the 2D wheel about which segment is under the pointer", () => {
    for (const rotation of [0, 47, -200, 1234.5, 3600]) {
      const index = segmentAtPointer(rotation);
      const { thetaStart, thetaLength } = segmentSector(index);
      // The pointer, in the wheel's own frame, falls inside that sector.
      const pointerInWheel = fold(POINTER - wheelRotationZ(rotation));
      const offset = fold(pointerInWheel - thetaStart);
      expect(offset).toBeLessThan(thetaLength + 1e-9);
    }
  });

  it("puts each peg on the boundary where its segment starts", () => {
    for (let i = 0; i < WHEEL.length; i++) {
      const { thetaStart, thetaLength } = segmentSector(i);
      expect(fold(boundaryAngle(i))).toBeCloseTo(fold(thetaStart + thetaLength));
    }
  });
});

describe("flapperTilt", () => {
  it("rests upright when the pointer is mid-segment", () => {
    const resting = nextWheelRotation(0, 3);
    expect(flapperTilt(resting, 1)).toBe(0);
  });

  it("is knocked against the direction of travel as a boundary passes", () => {
    // Just short of a boundary, travelling clockwise.
    const nearBoundary = -(3 * SEGMENT_ANGLE) + 0.5;
    expect(flapperTilt(nearBoundary, 1)).toBeLessThan(0);
    expect(flapperTilt(nearBoundary - 0.5 + SEGMENT_ANGLE - 0.5, -1)).toBeGreaterThan(0);
  });

  it("never tilts more than 26 degrees", () => {
    for (let r = 0; r < 360; r += 0.25) {
      expect(Math.abs(flapperTilt(r, 1))).toBeLessThanOrEqual(26);
      expect(Math.abs(flapperTilt(r, -1))).toBeLessThanOrEqual(26);
    }
  });
});
