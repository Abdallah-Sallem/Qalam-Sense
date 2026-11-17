import { describe, expect, it } from 'vitest';
import { ridgeFit, solveLinearSystem } from '@/lib/math';
import { createRng } from '@/lib/random';
import { runSyntheticCalibration } from '@/testing/harness';
import { observeGaze } from '@/testing/syntheticEye';
import { buildTargets, gradeFor, validatePointSamples } from '@/vision/calibration';
import { OneEuroFilter } from '@/vision/filters';
import { fitGazeModel, headDeviation, predictGaze, rawFeatures } from '@/vision/gazeModel';

const VIEWPORT = { width: 1366, height: 768 };

describe('linear algebra', () => {
  it('solves a small system', () => {
    expect(solveLinearSystem([[2, 1], [1, 3]], [5, 10])!.map((v) => +v.toFixed(6))).toEqual([1, 3]);
  });
  it('reports singular systems instead of returning garbage', () => {
    expect(solveLinearSystem([[1, 2], [2, 4]], [1, 2])).toBeNull();
  });
  it('recovers a linear relation with ridge regression', () => {
    const X = Array.from({ length: 50 }, (_, i) => [1, i / 10]);
    const w = ridgeFit(X, X.map((r) => 3 + 2 * r[1]!), 1e-6)!;
    expect(w[0]).toBeCloseTo(3, 3);
    expect(w[1]).toBeCloseTo(2, 3);
  });
});

describe('calibration targets', () => {
  it('uses 9 fit points and 4 hold-out points, all inside the screen', () => {
    const targets = buildTargets(9);
    expect(targets.filter((t) => t.role === 'fit')).toHaveLength(9);
    expect(targets.filter((t) => t.role === 'validate')).toHaveLength(4);
    for (const t of targets) {
      expect(t.nx).toBeGreaterThan(0);
      expect(t.nx).toBeLessThan(1);
      expect(t.ny).toBeGreaterThan(0);
      expect(t.ny).toBeLessThan(1);
    }
    // Hold-out points must not coincide with fit points.
    const fit = new Set(targets.filter((t) => t.role === 'fit').map((t) => `${t.nx},${t.ny}`));
    expect(targets.filter((t) => t.role === 'validate').every((t) => !fit.has(`${t.nx},${t.ny}`))).toBe(true);
  });
});

describe('sample validation', () => {
  it('drops outliers and accepts a steady fixation', () => {
    const rng = createRng(3);
    const steady = Array.from({ length: 20 }, () => [0.05 + rng.gauss() * 0.003, 0.02 + rng.gauss() * 0.003, 0.3, 0, 0, 0.5, 0.5, 0.13]);
    const withBlinkRemnant = [...steady, [0.3, 0.2, 0.3, 0, 0, 0.5, 0.5, 0.13]];
    const { kept, stable } = validatePointSamples(withBlinkRemnant, 12);
    expect(kept).toHaveLength(20);
    expect(stable).toBe(true);
  });
  it('rejects a wandering eye and too few samples', () => {
    const rng = createRng(4);
    const wandering = Array.from({ length: 30 }, () => [rng.gauss() * 0.08, rng.gauss() * 0.08, 0.3, 0, 0, 0.5, 0.5, 0.13]);
    expect(validatePointSamples(wandering, 12).stable).toBe(false);
    expect(validatePointSamples([[0, 0, 0.3, 0, 0, 0.5, 0.5, 0.13]], 12).stable).toBe(false);
    expect(validatePointSamples([], 12).stable).toBe(false);
  });
});

describe('CalibrationSession with the synthetic eye', () => {
  it('fits an accurate quadratic model from 9 points and validates it on hold-out points', () => {
    const { result, durationMs } = runSyntheticCalibration(VIEWPORT, createRng(11));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quality.model).toBe('quadratic');
    expect(result.quality.method).toBe('holdout');
    expect(result.quality.fitPoints).toBe(9);
    expect(result.quality.validationPoints).toBe(4);
    expect(result.quality.grade).toBe('good');
    expect(result.quality.meanErrorPx).toBeLessThan(60);
    // 13 targets at about 2.2 s each: short enough for a child.
    expect(durationMs).toBeLessThan(35_000);
    // The model must generalise to a point that is neither a fit nor a hold-out target.
    const rng = createRng(99);
    const truth = { x: 400, y: 500 };
    const predicted = predictGaze(result.model, rawFeatures(observeGaze(truth, VIEWPORT, 0, rng, { noise: 0 })));
    expect(Math.hypot(predicted.x - truth.x, predicted.y - truth.y)).toBeLessThan(60);
  });

  it('reports lower quality when the eye signal is noisy, never a false "good"', () => {
    const { result } = runSyntheticCalibration(VIEWPORT, createRng(12), { noise: 0.022 });
    if (result.ok) {
      expect(result.quality.grade).not.toBe('good');
      expect(result.quality.jitterPx).toBeGreaterThan(40);
    } else {
      expect(['too-inaccurate', 'not-enough-points']).toContain(result.reason);
    }
  });

  it('fails cleanly when the signal is unusable', () => {
    const { result } = runSyntheticCalibration(VIEWPORT, createRng(13), { noise: 0.09 });
    expect(result.ok).toBe(false);
  });

  it('aborts with "no-face" when nobody is in front of the camera', () => {
    const { result, durationMs } = runSyntheticCalibration(VIEWPORT, createRng(14), undefined, undefined, () => null);
    expect(result).toMatchObject({ ok: false, reason: 'no-face' });
    expect(durationMs).toBeLessThan(10_000);
  });

  it('ignores blinks during collection and still calibrates', () => {
    const { result } = runSyntheticCalibration(VIEWPORT, createRng(15), undefined, undefined, (t) => ({
      noise: 0.004,
      eyesClosed: t % 1500 < 200,
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quality.grade).toBe('good');
  });

  it('re-asks an unstable point once instead of fitting bad data', () => {
    const seen = new Map<number, number>();
    const { result } = runSyntheticCalibration(VIEWPORT, createRng(16), undefined, undefined, (_t, target) => {
      const frames = (seen.get(target.id) ?? 0) + 1;
      seen.set(target.id, frames);
      // Target 3 is fidgety the first time it is shown (≈ first 75 frames), calm on the retry.
      return { noise: target.id === 3 && frames < 75 ? 0.07 : 0.004 };
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quality.fitPoints).toBe(9);
    expect(result.points.find((p) => p.target.id === 3)!.stable).toBe(true);
  });

  it('falls back to the linear model and leave-one-out error with 5 points', () => {
    const targets = buildTargets(5).filter((t) => t.role === 'fit');
    const { result } = runSyntheticCalibration(VIEWPORT, createRng(17), undefined, targets);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quality.model).toBe('linear');
    expect(result.quality.method).toBe('leave-one-out');
  });

  it('grades by error relative to the screen diagonal', () => {
    expect(gradeFor(0.03)).toBe('good');
    expect(gradeFor(0.09)).toBe('fair');
    expect(gradeFor(0.15)).toBe('poor');
  });
});

describe('gaze model', () => {
  it('refuses to fit from too few samples', () => {
    expect(fitGazeModel([], 'quadratic')).toBeNull();
  });

  it('measures how far the head moved from the calibration pose', () => {
    const { result } = runSyntheticCalibration(VIEWPORT, createRng(21));
    if (!result.ok) throw new Error('calibration failed');
    const rng = createRng(5);
    const centre = { x: 683, y: 384 };
    const same = observeGaze(centre, VIEWPORT, 0, rng, { noise: 0 });
    const moved = observeGaze(centre, VIEWPORT, 0, rng, { noise: 0, head: { yaw: 0.3 } });
    const closer = observeGaze(centre, VIEWPORT, 0, rng, { noise: 0, head: { scale: 1.4 } });
    expect(headDeviation(result.model, same)).toBeLessThan(0.5);
    expect(headDeviation(result.model, moved)).toBeGreaterThan(1);
    expect(headDeviation(result.model, closer)).toBeGreaterThan(1);
  });
});

describe('OneEuroFilter', () => {
  it('removes jitter from a still signal', () => {
    const rng = createRng(8);
    const f = new OneEuroFilter();
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 120; i++) {
      const x = 500 + rng.gauss() * 20;
      raw.push(x);
      out.push(f.filter(x, i * 33));
    }
    const spread = (xs: number[]) => Math.max(...xs.slice(30)) - Math.min(...xs.slice(30));
    expect(spread(out)).toBeLessThan(spread(raw) * 0.5);
  });
  it('follows a jump within a few frames', () => {
    const f = new OneEuroFilter();
    for (let i = 0; i < 30; i++) f.filter(100, i * 33);
    let v = 0;
    for (let i = 30; i < 45; i++) v = f.filter(900, i * 33);
    expect(v).toBeGreaterThan(780);
  });
  it('starts fresh after reset', () => {
    const f = new OneEuroFilter();
    f.filter(100, 0);
    f.reset();
    expect(f.filter(700, 33)).toBe(700);
  });
});
