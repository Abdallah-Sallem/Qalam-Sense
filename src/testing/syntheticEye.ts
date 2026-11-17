/**
 * TEST INSTRUMENT — not used in normal operation.
 *
 * A simple forward model of an eye looking at a screen: given where the
 * "reader" looks, it produces the FaceObservation a camera pipeline would
 * have produced. It exists so that calibration, gaze estimation, fixation
 * detection, reading analysis, difficulty and adaptation can be exercised
 * end to end, deterministically, without a webcam.
 *
 * It says nothing about real-world accuracy: its noise level is a parameter.
 */
import type { Rng } from '@/lib/random';
import type { Viewport } from '@/vision/calibration';
import type { FaceObservation, Point } from '@/vision/types';

export interface SyntheticEyeOptions {
  /** Standard deviation of the iris-position noise, in eye widths. */
  noise: number;
  /** Head pose offset from the calibration pose. */
  head?: { yaw?: number; pitch?: number; dx?: number; dy?: number; scale?: number };
  eyesClosed?: boolean;
}

export const DEFAULT_EYE: SyntheticEyeOptions = { noise: 0.004 };

/** Iris travel across the full screen width/height, in eye widths. */
const H_RANGE = 0.24;
const V_RANGE = 0.13;

export function observeGaze(
  gaze: Point,
  viewport: Viewport,
  t: number,
  rng: Rng,
  options: SyntheticEyeOptions = DEFAULT_EYE,
): FaceObservation {
  const gx = gaze.x / viewport.width - 0.5;
  const gy = gaze.y / viewport.height - 0.5;
  const head = options.head ?? {};
  const n = () => rng.gauss() * options.noise;
  // Mildly non-linear, like a real eye seen from a camera above the screen.
  const h = -H_RANGE * gx - 0.03 * gx * gx - 0.5 * (head.yaw ?? 0);
  const v = V_RANGE * gy + 0.02 * gy * gy - 0.4 * (head.pitch ?? 0);
  const openness = 0.3 - 0.07 * gy;
  const closed = options.eyesClosed === true;
  const eye = () => ({ h: h + n(), v: v + n(), openness: closed ? 0.04 : openness + n() });
  return {
    t,
    right: eye(),
    left: eye(),
    yaw: (head.yaw ?? 0) + rng.gauss() * 0.004,
    pitch: (head.pitch ?? 0) + rng.gauss() * 0.004,
    roll: rng.gauss() * 0.003,
    faceX: 0.5 + (head.dx ?? 0) + rng.gauss() * 0.002,
    faceY: 0.45 + (head.dy ?? 0) + rng.gauss() * 0.002,
    faceScale: 0.13 * (head.scale ?? 1),
    blinkScore: closed ? 0.95 : 0.05,
    eyesClosed: closed,
  };
}
