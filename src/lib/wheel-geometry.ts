import { WHEEL } from "./gameshow";

// Where each wheel segment sits in the 3D scene.
//
// The game describes the wheel the way the 2D one draws it: segment 0 starts
// at the pointer (the top) and segments run clockwise, and a rotation is in
// degrees, clockwise positive (as in CSS). Three.js measures angles in
// radians, anticlockwise from the +x axis. These helpers convert, so the 3D
// wheel stops on exactly the segment the game chose.

/** Degrees per segment. */
export const SEGMENT_DEG = 360 / WHEEL.length;

const DEG = Math.PI / 180;

/** A clockwise-from-the-top angle in degrees, as a Three.js angle in radians. */
export const fromTopClockwise = (degrees: number): number => (90 - degrees) * DEG;

/** The sector a segment occupies, for THREE.CircleGeometry (radians). */
export function segmentSector(index: number): { thetaStart: number; thetaLength: number } {
  return { thetaStart: fromTopClockwise((index + 1) * SEGMENT_DEG), thetaLength: SEGMENT_DEG * DEG };
}

/** The boundary at the start of a segment (where its peg goes), in radians. */
export const boundaryAngle = (index: number): number => fromTopClockwise(index * SEGMENT_DEG);

/** The wheel group's rotation.z for a wheel rotation in degrees. */
export const wheelRotationZ = (degrees: number): number => -degrees * DEG;
