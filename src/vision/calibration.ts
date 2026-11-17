/**
 * Calibration: collects eye geometry while the child follows a moving target,
 * validates what was collected, fits the gaze model and measures how good it
 * is on points that were NOT used for fitting.
 *
 * This file is a pure, clock-driven state machine: the UI calls update() once
 * per video frame and draws whatever the returned progress describes.
 */
import { hypot2, mad, mean, median, std } from '@/lib/math';
import { assessFrame } from './frameQuality';
import { fitGazeModel, predictGaze, rawFeatures, type CalibrationSample, type GazeModel, type ModelKind } from './gazeModel';
import type { FaceObservation, FrameIssue, Point } from './types';

export interface Viewport {
  width: number;
  height: number;
}

export interface CalibrationTarget {
  id: number;
  /** Position as a fraction of the viewport. */
  nx: number;
  ny: number;
  role: 'fit' | 'validate';
}

export const CALIBRATION_TIMING = {
  /** The target glides to its next position; the eye follows. */
  travelMs: 600,
  /** Samples right after arrival are discarded: the eye is still landing. */
  settleMs: 450,
  /** Nominal collection time per point. */
  collectMs: 1100,
  /** Collection is extended up to this long when frames keep being rejected. */
  maxCollectMs: 3200,
  minSamples: 12,
  /** Calibration is abandoned when no face is visible for this long. */
  noFaceAbortMs: 7000,
  maxRetries: 3,
};

/** Largest tolerated spread of the iris signal while fixating one target. */
const MAX_POINT_DISPERSION = 0.03;

export const QUALITY_LIMITS = {
  /** Mean error as a fraction of the viewport diagonal. */
  good: 0.06,
  fair: 0.11,
  /** Beyond this the estimate is noise and calibration is reported as failed. */
  unusable: 0.2,
};

/**
 * Nine fit points on a 3×3 grid plus four hold-out points.
 *
 * Why nine: the quadratic model has 12 coefficients per axis; nine distinct
 * screen positions spanning the corners constrain the curvature terms, which
 * five points cannot. Five points are accepted only as a degraded fallback
 * that fits the linear model.
 */
export function buildTargets(points: 5 | 9 = 9, margin = 0.1): CalibrationTarget[] {
  const lo = margin;
  const hi = 1 - margin;
  const grid9: [number, number][] = [
    [0.5, 0.5],
    [lo, lo],
    [0.5, lo],
    [hi, lo],
    [hi, 0.5],
    [hi, hi],
    [0.5, hi],
    [lo, hi],
    [lo, 0.5],
  ];
  const grid5: [number, number][] = [
    [0.5, 0.5],
    [lo, lo],
    [hi, lo],
    [hi, hi],
    [lo, hi],
  ];
  const holdout: [number, number][] = [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.7, 0.7],
    [0.3, 0.7],
  ];
  const fit = points === 9 ? grid9 : grid5;
  return [
    ...fit.map(([nx, ny], id) => ({ id, nx, ny, role: 'fit' as const })),
    ...holdout.map(([nx, ny], i) => ({ id: fit.length + i, nx, ny, role: 'validate' as const })),
  ];
}

export type CalibrationPhase = 'travel' | 'settle' | 'collect';

export interface CalibrationProgress {
  done: boolean;
  /** Number of targets completed so far and total number, for the progress display. */
  completed: number;
  total: number;
  target: CalibrationTarget | null;
  /** Where the target was before it started travelling (for the glide animation). */
  previous: CalibrationTarget | null;
  phase: CalibrationPhase;
  /** 0..1 within the current phase. */
  phaseProgress: number;
  /** Problem with the current frame, if any, so the UI can coach the child. */
  issue: FrameIssue | null;
}

export type CalibrationGrade = 'good' | 'fair' | 'poor';

export interface CalibrationQuality {
  grade: CalibrationGrade;
  /** Mean distance between estimated and true target position, CSS pixels. */
  meanErrorPx: number;
  errorXPx: number;
  errorYPx: number;
  maxErrorPx: number;
  /** Sample-to-sample scatter of the estimate while fixating, CSS pixels. */
  jitterPx: number;
  /** Expected per-sample error (accuracy and jitter combined) divided by the viewport diagonal. */
  relativeError: number;
  /** How the error was measured. */
  method: 'holdout' | 'leave-one-out';
  model: ModelKind;
  fitPoints: number;
  validationPoints: number;
}

export interface PointReport {
  target: CalibrationTarget;
  samples: number;
  stable: boolean;
  /** Estimated position for this target, when it could be evaluated. */
  predicted?: Point;
  errorPx?: number;
}

export type CalibrationFailure = 'no-face' | 'not-enough-points' | 'too-inaccurate';

export type CalibrationResult =
  | { ok: true; model: GazeModel; quality: CalibrationQuality; points: PointReport[]; viewport: Viewport }
  | { ok: false; reason: CalibrationFailure; points: PointReport[] };

interface PointData {
  target: CalibrationTarget;
  features: number[][];
  stable: boolean;
}

export function gradeFor(relativeError: number): CalibrationGrade {
  if (relativeError <= QUALITY_LIMITS.good) return 'good';
  if (relativeError <= QUALITY_LIMITS.fair) return 'fair';
  return 'poor';
}

/** Drops blink remnants and stray frames, then judges whether the eye was actually still. */
export function validatePointSamples(features: number[][], minSamples: number): { kept: number[][]; stable: boolean } {
  if (features.length === 0) return { kept: [], stable: false };
  const hs = features.map((f) => f[0]!);
  const vs = features.map((f) => f[1]!);
  const mh = median(hs);
  const mv = median(vs);
  const th = 3 * Math.max(mad(hs), 0.004);
  const tv = 3 * Math.max(mad(vs), 0.004);
  const kept = features.filter((f) => Math.abs(f[0]! - mh) <= th && Math.abs(f[1]! - mv) <= tv);
  const dispersion = hypot2(std(kept.map((f) => f[0]!)), std(kept.map((f) => f[1]!)));
  return { kept, stable: kept.length >= Math.ceil(minSamples * 0.75) && dispersion <= MAX_POINT_DISPERSION };
}

const medianFeatures = (features: number[][]): number[] =>
  features[0]!.map((_, i) => median(features.map((f) => f[i]!)));

export class CalibrationSession {
  private queue: { target: CalibrationTarget; retried: boolean }[];
  private readonly total: number;
  private done: PointData[] = [];
  private current: { target: CalibrationTarget; retried: boolean } | null = null;
  private previous: CalibrationTarget | null = null;
  private targetStart = 0;
  private features: number[][] = [];
  private lastFaceAt = 0;
  private retries = 0;
  private abortedNoFace = false;

  constructor(
    private readonly viewport: Viewport,
    targets: CalibrationTarget[] = buildTargets(9),
    private readonly timing = CALIBRATION_TIMING,
  ) {
    this.queue = targets.map((target) => ({ target, retried: false }));
    this.total = targets.length;
  }

  start(now: number): void {
    this.lastFaceAt = now;
    this.advance(now);
  }

  private advance(now: number): void {
    this.previous = this.current?.target ?? null;
    this.current = this.queue.shift() ?? null;
    this.targetStart = now;
    this.features = [];
  }

  get finished(): boolean {
    return this.current === null || this.abortedNoFace;
  }

  /** Feed one frame. Call once per processed video frame. */
  update(now: number, observation: FaceObservation | null): CalibrationProgress {
    if (!this.current) return this.progress('collect', 1, null);

    const { usable, issues } = assessFrame(observation);
    if (observation) this.lastFaceAt = now;
    else if (now - this.lastFaceAt > this.timing.noFaceAbortMs) {
      this.abortedNoFace = true;
      return this.progress('collect', 1, 'no-face');
    }
    const issue = issues[0] ?? null;

    const elapsed = now - this.targetStart;
    const { travelMs, settleMs, collectMs, maxCollectMs, minSamples } = this.timing;
    if (elapsed < travelMs) return this.progress('travel', elapsed / travelMs, issue);
    if (elapsed < travelMs + settleMs) return this.progress('settle', (elapsed - travelMs) / settleMs, issue);

    const collectElapsed = elapsed - travelMs - settleMs;
    if (usable && observation) this.features.push(rawFeatures(observation));

    const enough = this.features.length >= minSamples;
    if ((collectElapsed >= collectMs && enough) || collectElapsed >= maxCollectMs) {
      this.completeCurrent(now);
      return this.update(now, observation);
    }
    const byTime = collectElapsed / collectMs;
    const bySamples = this.features.length / minSamples;
    return this.progress('collect', Math.min(1, Math.min(byTime, bySamples)), issue);
  }

  private completeCurrent(now: number): void {
    const cur = this.current!;
    const { kept, stable } = validatePointSamples(this.features, this.timing.minSamples);
    if (!stable && !cur.retried && this.retries < this.timing.maxRetries) {
      // Ask for this point once more at the end instead of keeping bad data.
      this.retries++;
      this.queue.push({ target: cur.target, retried: true });
    } else {
      this.done.push({ target: cur.target, features: kept, stable });
    }
    this.advance(now);
  }

  private progress(phase: CalibrationPhase, phaseProgress: number, issue: FrameIssue | null): CalibrationProgress {
    return {
      done: this.finished,
      completed: this.done.length,
      total: this.total,
      target: this.current?.target ?? null,
      previous: this.previous,
      phase,
      phaseProgress: Math.max(0, Math.min(1, phaseProgress)),
      issue,
    };
  }

  private toPx(t: CalibrationTarget): Point {
    return { x: t.nx * this.viewport.width, y: t.ny * this.viewport.height };
  }

  private samplesFor(points: PointData[]): CalibrationSample[] {
    return points.flatMap((p) => {
      const { x, y } = this.toPx(p.target);
      return p.features.map((features) => ({ features, x, y }));
    });
  }

  /** Fits the model and measures it. Call once `finished` is true. */
  finish(): CalibrationResult {
    const reports = new Map<number, PointReport>(
      this.done.map((p) => [p.target.id, { target: p.target, samples: p.features.length, stable: p.stable }]),
    );
    const points = () => [...reports.values()].sort((a, b) => a.target.id - b.target.id);

    if (this.abortedNoFace) return { ok: false, reason: 'no-face', points: points() };

    const fit = this.done.filter((p) => p.target.role === 'fit' && p.stable);
    const holdout = this.done.filter((p) => p.target.role === 'validate' && p.stable);
    if (fit.length < 5) return { ok: false, reason: 'not-enough-points', points: points() };

    const kind: ModelKind = fit.length >= 7 ? 'quadratic' : 'linear';
    const model = fitGazeModel(this.samplesFor(fit), kind);
    if (!model) return { ok: false, reason: 'not-enough-points', points: points() };

    // Accuracy: prefer points the model has never seen; otherwise leave-one-point-out.
    const errors: { dx: number; dy: number }[] = [];
    let method: CalibrationQuality['method'] = 'holdout';
    const record = (p: PointData, m: GazeModel) => {
      const truth = this.toPx(p.target);
      const predicted = predictGaze(m, medianFeatures(p.features));
      const dx = predicted.x - truth.x;
      const dy = predicted.y - truth.y;
      errors.push({ dx, dy });
      Object.assign(reports.get(p.target.id)!, { predicted, errorPx: hypot2(dx, dy) });
    };
    if (holdout.length >= 3) {
      for (const p of holdout) record(p, model);
    } else {
      method = 'leave-one-out';
      for (const p of fit) {
        const rest = fit.filter((q) => q !== p);
        const m = fitGazeModel(this.samplesFor(rest), rest.length >= 7 ? 'quadratic' : 'linear');
        if (m) record(p, m);
      }
    }
    if (errors.length === 0) return { ok: false, reason: 'not-enough-points', points: points() };

    const jitter = mean(
      [...fit, ...holdout].map((p) => {
        const preds = p.features.map((f) => predictGaze(model, f));
        return hypot2(std(preds.map((q) => q.x)), std(preds.map((q) => q.y)));
      }),
    );
    const dists = errors.map((e) => hypot2(e.dx, e.dy));
    const meanErrorPx = mean(dists);
    // Grade on what a single sample is expected to be off by: the systematic
    // error (accuracy) and the frame-to-frame scatter (precision) combined.
    // Accuracy alone would call a wildly jittering estimate "good".
    const expectedErrorPx = hypot2(meanErrorPx, jitter);
    const relativeError = expectedErrorPx / hypot2(this.viewport.width, this.viewport.height);
    if (relativeError > QUALITY_LIMITS.unusable) return { ok: false, reason: 'too-inaccurate', points: points() };

    return {
      ok: true,
      model,
      viewport: this.viewport,
      points: points(),
      quality: {
        grade: gradeFor(relativeError),
        meanErrorPx,
        errorXPx: mean(errors.map((e) => Math.abs(e.dx))),
        errorYPx: mean(errors.map((e) => Math.abs(e.dy))),
        maxErrorPx: Math.max(...dists),
        jitterPx: jitter,
        relativeError,
        method,
        model: kind,
        fitPoints: fit.length,
        validationPoints: errors.length,
      },
    };
  }
}
