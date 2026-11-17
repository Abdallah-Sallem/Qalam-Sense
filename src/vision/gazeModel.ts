/**
 * Stage 3 of the vision pipeline: head/eye geometry → screen coordinates.
 *
 * A per-user polynomial regression fitted during calibration. It is a
 * feature-based estimator: transparent, fast, and trainable from a few
 * seconds of data, at the cost of being valid only near the head pose that
 * was present during calibration (see headDeviation()).
 */
import { dot, ridgeFit } from '@/lib/math';
import { binocular } from './faceGeometry';
import type { FaceObservation, Point } from './types';

export type ModelKind = 'quadratic' | 'linear';

/** Raw feature order. */
export const FEATURE_NAMES = ['h', 'v', 'open', 'yaw', 'pitch', 'faceX', 'faceY', 'scale'] as const;
type FeatureTuple = [number, number, number, number, number, number, number, number];

/**
 * Minimum spread used when standardising each feature. Head features barely
 * vary while a child sits still for calibration; without a floor their
 * z-scores would explode the moment the head moves afterwards.
 */
const SCALE_FLOOR = [0.02, 0.02, 0.03, 0.06, 0.06, 0.03, 0.03, 0.012];

export interface GazeModel {
  kind: ModelKind;
  mean: number[];
  scale: number[];
  wx: number[];
  wy: number[];
}

export interface CalibrationSample {
  features: number[];
  /** Target position in CSS pixels. */
  x: number;
  y: number;
}

export function rawFeatures(o: FaceObservation): number[] {
  const b = binocular(o);
  return [b.h, b.v, b.openness, o.yaw, o.pitch, o.faceX, o.faceY, o.faceScale];
}

function standardise(features: readonly number[], mean: readonly number[], scale: readonly number[]): number[] {
  return features.map((f, i) => (f - mean[i]!) / scale[i]!);
}

function expand(z: readonly number[], kind: ModelKind): number[] {
  const [h, v, o, yaw, pitch, fx, fy, s] = z as FeatureTuple;
  if (kind === 'linear') return [1, h, v, o];
  return [1, h, v, o, h * h, v * v, h * v, yaw, pitch, fx, fy, s];
}

export function fitGazeModel(samples: readonly CalibrationSample[], kind: ModelKind, lambda = 1.0): GazeModel | null {
  if (samples.length < 8) return null;
  const p = FEATURE_NAMES.length;
  const n = samples.length;
  const mean = new Array<number>(p).fill(0);
  for (const s of samples) for (let i = 0; i < p; i++) mean[i] = mean[i]! + s.features[i]! / n;
  const scale = new Array<number>(p).fill(0);
  for (const s of samples) for (let i = 0; i < p; i++) scale[i] = scale[i]! + (s.features[i]! - mean[i]!) ** 2 / n;
  for (let i = 0; i < p; i++) scale[i] = Math.max(Math.sqrt(scale[i]!), SCALE_FLOOR[i]!);

  const X = samples.map((s) => expand(standardise(s.features, mean, scale), kind));
  const wx = ridgeFit(X, samples.map((s) => s.x), lambda);
  const wy = ridgeFit(X, samples.map((s) => s.y), lambda);
  if (!wx || !wy) return null;
  return { kind, mean, scale, wx, wy };
}

export function predictGaze(model: GazeModel, features: readonly number[]): Point {
  const row = expand(standardise(features, model.mean, model.scale), model.kind);
  return { x: dot(model.wx, row), y: dot(model.wy, row) };
}

/** Tolerated head movement away from the calibration pose (1.0 = edge of the envelope). */
const ENVELOPE = { yaw: 0.16, pitch: 0.16, faceX: 0.09, faceY: 0.09, scaleRatio: 0.22 };

/**
 * How far the head has moved from where it was during calibration.
 * 0 = same pose, 1 = edge of the envelope in which the model is trusted.
 */
export function headDeviation(model: GazeModel, o: FaceObservation): number {
  const [, , , yaw0, pitch0, fx0, fy0, s0] = model.mean as FeatureTuple;
  return Math.max(
    Math.abs(o.yaw - yaw0) / ENVELOPE.yaw,
    Math.abs(o.pitch - pitch0) / ENVELOPE.pitch,
    Math.abs(o.faceX - fx0) / ENVELOPE.faceX,
    Math.abs(o.faceY - fy0) / ENVELOPE.faceY,
    Math.abs(o.faceScale / s0 - 1) / ENVELOPE.scaleRatio,
  );
}
