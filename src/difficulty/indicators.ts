/**
 * Feature → indicator rules. Every rule is a plain ramp between two documented
 * limits, so a teacher (or a reviewer) can see exactly why a score is what it is.
 *
 * Two families:
 *  - relative indicators compare the reader with their own baseline;
 *  - absolute indicators describe behaviour that is unusual for any reader
 *    (e.g. no forward progress for 15 seconds) and need no baseline.
 */
import { ramp, weightedMean } from '@/lib/math';
import type { WindowFeatures } from '@/reading/readingAnalyzer';
import type { Baseline, Indicator, IndicatorKey, SupportDimension, TextDifficulty } from './types';

/** Limits of each ramp: [score 0 at, score 1 at]. */
export const LIMITS = {
  /** Median fixation duration relative to baseline. */
  prolongedFixations: [1.2, 1.8],
  /** Backward moves per fixation. Fluent reading typically stays under about 0.15. */
  frequentRegressions: [0.18, 0.4],
  /** Reading speed relative to baseline (lower is worse). */
  slowProgress: [0.75, 0.35],
  /** Seconds without reaching a new word. */
  stagnationS: [7, 20],
  /** Share of line changes that go back or skip. */
  lineInstability: [0.25, 0.7],
  /** Fixation-duration variability relative to baseline. */
  fixationVolatility: [1.3, 2.2],
  /** Long pauses per minute. */
  longPausesPerMin: [2, 8],
  /** Share of fixation time off the text. */
  offText: [0.25, 0.6],
} as const;

/** A harder text is expected to be read more slowly, with longer fixations. */
const TEXT_FACTOR: Record<TextDifficulty, { fixation: number; speed: number }> = {
  facile: { fixation: 0.94, speed: 1.1 },
  moyen: { fixation: 1, speed: 1 },
  difficile: { fixation: 1.12, speed: 0.85 },
};

const ind = (key: IndicatorKey, score: number, value: number, reference: number | null = null): Indicator => ({
  key,
  score,
  value,
  reference,
});

export function computeIndicators(
  w: WindowFeatures,
  baseline: Baseline,
  textDifficulty: TextDifficulty,
  fatigue: number,
): Indicator[] {
  const f = TEXT_FACTOR[textDifficulty];
  const refFix = baseline.fixationMs * f.fixation;
  const refSpeed = baseline.wordsPerMinute * f.speed;
  const minutes = Math.max(w.windowMs / 60_000, 1e-6);
  // Line instability needs a few line changes before it means anything.
  const lineScore = w.lineTransitions >= 3 ? ramp(w.lineInstability, ...LIMITS.lineInstability) : 0;

  return [
    ind('prolongedFixations', refFix > 0 ? ramp(w.medianFixationMs / refFix, ...LIMITS.prolongedFixations) : 0, w.medianFixationMs, refFix),
    ind('frequentRegressions', ramp(w.regressionRate, ...LIMITS.frequentRegressions), w.regressionRate, LIMITS.frequentRegressions[0]),
    ind('slowProgress', refSpeed > 0 ? ramp(w.wordsPerMinute / refSpeed, ...LIMITS.slowProgress) : 0, w.wordsPerMinute, refSpeed),
    ind('stagnation', ramp(w.stagnationMs / 1000, ...LIMITS.stagnationS), w.stagnationMs / 1000, LIMITS.stagnationS[0]),
    ind('lineInstability', lineScore, w.lineInstability, LIMITS.lineInstability[0]),
    ind(
      'fixationVolatility',
      baseline.fixationCv > 0 ? ramp(w.fixationCv / baseline.fixationCv, ...LIMITS.fixationVolatility) : 0,
      w.fixationCv,
      baseline.fixationCv,
    ),
    ind('longPauses', ramp(w.longPauses / minutes, ...LIMITS.longPausesPerMin), w.longPauses / minutes, LIMITS.longPausesPerMin[0]),
    ind('offText', ramp(w.offTextRatio, ...LIMITS.offText), w.offTextRatio, LIMITS.offText[0]),
    ind('fatigueSigns', fatigue, fatigue),
  ];
}

/** How indicators combine into each kind of support. Weights sum to 1 per dimension. */
export const DIMENSION_WEIGHTS: Record<SupportDimension, Partial<Record<IndicatorKey, number>>> = {
  decoding: { prolongedFixations: 0.4, frequentRegressions: 0.3, slowProgress: 0.2, longPauses: 0.1 },
  lineTracking: { lineInstability: 0.7, frequentRegressions: 0.3 },
  attention: { offText: 0.45, stagnation: 0.3, fixationVolatility: 0.25 },
  fatigue: { fatigueSigns: 1 },
};

export function combineDimensions(indicators: readonly Indicator[]): Record<SupportDimension, number> {
  const score = new Map(indicators.map((i) => [i.key, i.score]));
  const out = {} as Record<SupportDimension, number>;
  for (const dim of Object.keys(DIMENSION_WEIGHTS) as SupportDimension[]) {
    out[dim] = weightedMean(
      Object.entries(DIMENSION_WEIGHTS[dim]).map(([key, weight]) => [score.get(key as IndicatorKey) ?? 0, weight] as const),
    );
  }
  return out;
}
