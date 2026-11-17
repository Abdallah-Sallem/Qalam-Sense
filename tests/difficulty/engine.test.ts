import { describe, expect, it } from 'vitest';
import { DifficultyEngine, ENGINE_CONFIG, toBaseline } from '@/difficulty/engine';
import { DIMENSION_WEIGHTS, combineDimensions, computeIndicators } from '@/difficulty/indicators';
import type { Assessment, Baseline, EngineContext } from '@/difficulty/types';
import type { WindowFeatures } from '@/reading/readingAnalyzer';

const calm: WindowFeatures = {
  windowMs: 30_000,
  validRatio: 0.92,
  fixationCount: 60,
  medianFixationMs: 420,
  meanFixationMs: 440,
  fixationCv: 0.4,
  regressionRate: 0.08,
  wordsAdvanced: 55,
  wordsPerMinute: 110,
  stagnationMs: 600,
  lineTransitions: 6,
  lineInstability: 0,
  longPauses: 0,
  offTextRatio: 0.02,
  meanConfidence: 0.85,
};
const effortful: WindowFeatures = {
  ...calm,
  fixationCount: 30,
  medianFixationMs: 820,
  meanFixationMs: 900,
  fixationCv: 0.75,
  regressionRate: 0.36,
  wordsAdvanced: 18,
  wordsPerMinute: 36,
  stagnationMs: 5000,
  lineTransitions: 4,
  lineInstability: 0.5,
  longPauses: 3,
};
const baseline: Baseline = { fixationMs: 420, wordsPerMinute: 110, fixationCv: 0.4, windows: 12 };
const ctx: EngineContext = { language: 'fr', textDifficulty: 'moyen', maxDurationMs: 15 * 60_000, storedBaseline: baseline };
const input = (over: Partial<Parameters<DifficultyEngine['assess']>[1]> = {}) => ({
  t: 60_000,
  elapsedMs: 60_000,
  calibrationGrade: 'good' as const,
  blinkRate: 15,
  ...over,
});
const ok = (a: Assessment) => {
  if (a.status !== 'ok') throw new Error(`expected ok, got ${a.status}`);
  return a;
};

describe('indicators', () => {
  const score = (w: WindowFeatures, key: string, b = baseline) => computeIndicators(w, b, 'moyen', 0).find((i) => i.key === key)!.score;

  it('are all zero for reading that matches the personal baseline', () => {
    for (const i of computeIndicators(calm, baseline, 'moyen', 0)) expect(i.score, i.key).toBe(0);
  });

  it('compare fixation duration and speed with the reader, not with a norm', () => {
    // The same measurements are unremarkable for a reader whose own baseline is slow.
    const slowReader: Baseline = { fixationMs: 800, wordsPerMinute: 38, fixationCv: 0.7, windows: 12 };
    expect(score(effortful, 'prolongedFixations')).toBeGreaterThan(0.9);
    expect(score(effortful, 'prolongedFixations', slowReader)).toBe(0);
    expect(score(effortful, 'slowProgress')).toBeGreaterThan(0.9);
    expect(score(effortful, 'slowProgress', slowReader)).toBe(0);
  });

  it('expect slower reading on a text marked difficult', () => {
    const w = { ...calm, medianFixationMs: 420 * 1.3, wordsPerMinute: 110 * 0.7 };
    const on = (d: 'facile' | 'moyen' | 'difficile', key: string) => computeIndicators(w, baseline, d, 0).find((i) => i.key === key)!.score;
    expect(on('difficile', 'prolongedFixations')).toBeLessThan(on('moyen', 'prolongedFixations'));
    expect(on('moyen', 'prolongedFixations')).toBeLessThan(on('facile', 'prolongedFixations'));
    expect(on('difficile', 'slowProgress')).toBeLessThan(on('facile', 'slowProgress'));
  });

  it('use absolute limits for regressions, stagnation, off-text time and pauses', () => {
    expect(score({ ...calm, regressionRate: 0.4 }, 'frequentRegressions')).toBe(1);
    expect(score({ ...calm, stagnationMs: 20_000 }, 'stagnation')).toBe(1);
    expect(score({ ...calm, stagnationMs: 13_500 }, 'stagnation')).toBeCloseTo(0.5);
    expect(score({ ...calm, offTextRatio: 0.6 }, 'offText')).toBe(1);
    expect(score({ ...calm, longPauses: 4 }, 'longPauses')).toBe(1); // 8 per minute
  });

  it('do not read line instability into one or two line changes', () => {
    expect(score({ ...calm, lineTransitions: 2, lineInstability: 1 }, 'lineInstability')).toBe(0);
    expect(score({ ...calm, lineTransitions: 6, lineInstability: 0.7 }, 'lineInstability')).toBe(1);
  });

  it('expose the measured value and what it was compared with', () => {
    const i = computeIndicators(effortful, baseline, 'moyen', 0).find((x) => x.key === 'prolongedFixations')!;
    expect(i.value).toBe(820);
    expect(i.reference).toBe(420);
  });

  it('combine into support dimensions with weights that sum to one', () => {
    for (const [dim, weights] of Object.entries(DIMENSION_WEIGHTS)) {
      expect(Object.values(weights).reduce((s, w) => s + w, 0), dim).toBeCloseTo(1);
    }
    const dims = combineDimensions(computeIndicators(effortful, baseline, 'moyen', 0));
    expect(dims.decoding).toBeGreaterThan(0.8);
    expect(dims.lineTracking).toBeGreaterThan(0.5);
    expect(dims.fatigue).toBe(0);
  });
});

describe('DifficultyEngine', () => {
  it('says "insufficient data" instead of guessing', () => {
    const e = new DifficultyEngine(ctx);
    expect(e.assess({ ...effortful, windowMs: 5000 }, input())).toMatchObject({ status: 'insufficient-data', reason: 'warming-up' });
    expect(e.assess({ ...effortful, validRatio: 0.3 }, input())).toMatchObject({ status: 'insufficient-data', reason: 'low-tracking' });
    expect(e.assess({ ...effortful, fixationCount: 4 }, input())).toMatchObject({ status: 'insufficient-data', reason: 'few-fixations' });
  });

  it('needs a warm-up before it can assess a reader it has never seen', () => {
    const e = new DifficultyEngine({ ...ctx, storedBaseline: null });
    for (let i = 0; i < ENGINE_CONFIG.warmupWindows - 1; i++) {
      expect(e.assess(calm, input())).toMatchObject({ status: 'insufficient-data', reason: 'warming-up' });
    }
    expect(e.assess(calm, input()).status).toBe('ok');
    expect(e.baseline).toMatchObject({ fixationMs: 420, wordsPerMinute: 110 });
  });

  it('finds little need for support in steady reading and a clear need in effortful reading', () => {
    const e = new DifficultyEngine(ctx);
    const a = ok(e.assess(calm, input()));
    expect(a.supportNeed).toBeLessThan(0.1);
    expect(a.dominant).toBeNull();

    const b = ok(e.assess(effortful, input()));
    expect(b.supportNeed).toBeGreaterThan(0.6);
    expect(b.dominant).toBe('decoding');
    expect(b.indicators.filter((i) => i.score > 0.5).map((i) => i.key)).toEqual(
      expect.arrayContaining(['prolongedFixations', 'frequentRegressions', 'slowProgress']),
    );
  });

  it('names line tracking or attention when those are what stands out', () => {
    const e = new DifficultyEngine(ctx);
    expect(ok(e.assess({ ...calm, lineInstability: 0.8, regressionRate: 0.3 }, input())).dominant).toBe('lineTracking');
    expect(ok(e.assess({ ...calm, offTextRatio: 0.7, stagnationMs: 18_000 }, input())).dominant).toBe('attention');
  });

  it('is less confident with poor calibration, patchy tracking or an unfamiliar reader', () => {
    const e = new DifficultyEngine(ctx);
    const good = ok(e.assess(effortful, input())).confidence;
    expect(ok(e.assess(effortful, input({ calibrationGrade: 'poor' }))).confidence).toBeLessThan(good * 0.6);
    expect(ok(e.assess({ ...effortful, validRatio: 0.6 }, input())).confidence).toBeLessThan(good * 0.5);
    const fresh = new DifficultyEngine({ ...ctx, storedBaseline: { ...baseline, windows: 1 } });
    expect(ok(fresh.assess(effortful, input())).confidence).toBeLessThan(good);
    expect(good).toBeGreaterThan(0.9);
  });

  it('only suspects fatigue late in a session', () => {
    const e = new DifficultyEngine(ctx);
    e.assess(calm, input({ elapsedMs: 70_000, blinkRate: 14 })); // sets the blink reference
    const early = ok(e.assess(calm, input({ elapsedMs: 100_000, blinkRate: 40 })));
    expect(early.dimensions.fatigue).toBe(0);
    const late = ok(e.assess({ ...calm, wordsPerMinute: 50 }, input({ elapsedMs: 14 * 60_000, blinkRate: 34 })));
    expect(late.dimensions.fatigue).toBeGreaterThan(0.6);
    expect(late.dominant).toBe('fatigue');
  });

  it('blends the stored baseline with how the child reads today', () => {
    const e = new DifficultyEngine(ctx);
    const today = { ...calm, medianFixationMs: 520, wordsPerMinute: 90 };
    for (let i = 0; i < ENGINE_CONFIG.warmupWindows; i++) e.assess(today, input());
    expect(e.baseline!.fixationMs).toBeCloseTo(0.6 * 420 + 0.4 * 520);
  });

  it('updates the stored baseline from unremarkable windows only', () => {
    const e = new DifficultyEngine(ctx);
    for (let i = 0; i < 5; i++) e.assess({ ...calm, medianFixationMs: 460 }, input());
    for (let i = 0; i < 5; i++) e.assess(effortful, input());
    const next = e.updatedBaseline()!;
    // Moves 30 % of the way towards today's calm reading; effortful windows are ignored.
    expect(next.fixationMs).toBeCloseTo(420 + 0.3 * 40);
    expect(next.windows).toBeGreaterThan(baseline.windows);
  });

  it('keeps the stored baseline when a session produced nothing usable', () => {
    const e = new DifficultyEngine(ctx);
    e.assess({ ...calm, validRatio: 0.1 }, input());
    expect(e.updatedBaseline()).toEqual(baseline);
    expect(new DifficultyEngine({ ...ctx, storedBaseline: null }).updatedBaseline()).toBeNull();
  });

  it('summarises windows into a baseline with medians', () => {
    expect(toBaseline([calm, { ...calm, medianFixationMs: 500 }, { ...calm, medianFixationMs: 1000 }])).toMatchObject({
      fixationMs: 500,
      windows: 3,
    });
  });
});
