/**
 * Stage 2 of the vision pipeline: landmarks → head/eye geometry.
 *
 * Pure functions only. Eye measurements are expressed in "eye widths" along
 * and across the eye's own axis, which makes them invariant to image scale,
 * to the distance from the camera, and to in-plane head roll.
 */
import { clamp, ramp } from '@/lib/math';
import type { EyeObservation, FaceObservation, Landmark } from './types';

/** MediaPipe Face Mesh indices (478-point model with iris refinement). */
export const LM = {
  // Subject's right eye: appears on the left of an un-mirrored image.
  rightOuter: 33,
  rightInner: 133,
  rightUpper: 159,
  rightLower: 145,
  rightIris: 468,
  // Subject's left eye.
  leftInner: 362,
  leftOuter: 263,
  leftUpper: 386,
  leftLower: 374,
  leftIris: 473,
  noseTip: 1,
} as const;

export const LANDMARK_COUNT_WITH_IRIS = 478;

interface Vec {
  x: number;
  y: number;
}

/**
 * Measures one eye. `a` and `b` are the two corners ordered along image +x,
 * so `h` has the same sign convention for both eyes.
 */
export function measureEye(a: Vec, b: Vec, upper: Vec, lower: Vec, iris: Vec): EyeObservation {
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const width = Math.hypot(ax, ay);
  if (width < 1e-6) return { h: 0, v: 0, openness: 0 };
  const ux = ax / width;
  const uy = ay / width;
  // Perpendicular pointing towards the chin for an upright face (image +y).
  const nx = -uy;
  const ny = ux;
  const dx = iris.x - (a.x + b.x) / 2;
  const dy = iris.y - (a.y + b.y) / 2;
  return {
    h: (dx * ux + dy * uy) / width,
    v: (dx * nx + dy * ny) / width,
    openness: Math.abs((lower.x - upper.x) * nx + (lower.y - upper.y) * ny) / width,
  };
}

export interface ExtractOptions {
  /** 4×4 facial transformation matrix (column-major), when the detector provides it. */
  matrix?: ArrayLike<number> | null;
  /** Blink blendshape scores (0..1), when available. */
  blink?: { left: number; right: number } | null;
}

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Converts one set of face landmarks into a FaceObservation.
 * @param aspect image width / image height. Landmarks are normalised per axis,
 *               so distances must be computed in a square pixel space.
 * Returns null if the mesh does not include the iris landmarks.
 */
export function extractObservation(
  landmarks: readonly Landmark[],
  aspect: number,
  t: number,
  options: ExtractOptions = {},
): FaceObservation | null {
  if (landmarks.length < LANDMARK_COUNT_WITH_IRIS) return null;
  // Scale x so one unit is the same distance on both axes (unit: image height).
  const p = (i: number): Vec => ({ x: landmarks[i]!.x * aspect, y: landmarks[i]!.y });

  const right = measureEye(p(LM.rightOuter), p(LM.rightInner), p(LM.rightUpper), p(LM.rightLower), p(LM.rightIris));
  const left = measureEye(p(LM.leftInner), p(LM.leftOuter), p(LM.leftUpper), p(LM.leftLower), p(LM.leftIris));

  const rc = mid(p(LM.rightOuter), p(LM.rightInner));
  const lc = mid(p(LM.leftInner), p(LM.leftOuter));
  const eyeMid = mid(rc, lc);
  const interOcular = Math.max(Math.hypot(lc.x - rc.x, lc.y - rc.y), 1e-6);

  let yaw: number;
  let pitch: number;
  let roll: number;
  const m = options.matrix;
  if (m && m.length >= 16) {
    yaw = Math.atan2(m[8]!, m[10]!);
    pitch = Math.asin(clamp(-m[9]!, -1, 1));
    roll = Math.atan2(m[1]!, m[5]!);
  } else {
    // Landmark-only fallback: nose displacement relative to the eye line.
    const nose = p(LM.noseTip);
    roll = Math.atan2(lc.y - rc.y, lc.x - rc.x);
    const cos = Math.cos(-roll);
    const sin = Math.sin(-roll);
    const dx = nose.x - eyeMid.x;
    const dy = nose.y - eyeMid.y;
    yaw = Math.atan((dx * cos - dy * sin) / interOcular);
    // A frontal face has the nose tip about 0.6 inter-ocular distances below the eyes.
    pitch = Math.atan((dx * sin + dy * cos) / interOcular - 0.6);
  }

  const openness = (right.openness + left.openness) / 2;
  const blinkScore = options.blink ? Math.max(options.blink.left, options.blink.right) : ramp(openness, 0.2, 0.08);

  return {
    t,
    right,
    left,
    yaw,
    pitch,
    roll,
    faceX: eyeMid.x / aspect,
    faceY: eyeMid.y,
    faceScale: interOcular / aspect,
    blinkScore,
    eyesClosed: blinkScore > 0.55,
  };
}

/** Averages both eyes; the mean is markedly less noisy than either eye alone. */
export function binocular(o: FaceObservation): { h: number; v: number; openness: number } {
  return {
    h: (o.right.h + o.left.h) / 2,
    v: (o.right.v + o.left.v) / 2,
    openness: (o.right.openness + o.left.openness) / 2,
  };
}
