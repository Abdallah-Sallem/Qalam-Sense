import type { Lang } from '@/reading/text';
import type { CalibrationGrade } from '@/vision/calibration';

export type TextDifficulty = 'facile' | 'moyen' | 'difficile';

/**
 * What "usual" looks like for one reader in one language, as measured by this
 * instrument. Webcam fixations are coarser than laboratory ones, so published
 * norms do not apply: a reader is only ever compared with themselves.
 */
export interface Baseline {
  fixationMs: number;
  wordsPerMinute: number;
  fixationCv: number;
  /** Number of measurement windows the baseline is built from. */
  windows: number;
}

export type IndicatorKey =
  | 'prolongedFixations'
  | 'frequentRegressions'
  | 'slowProgress'
  | 'stagnation'
  | 'lineInstability'
  | 'fixationVolatility'
  | 'longPauses'
  | 'offText'
  | 'fatigueSigns';

/** A single transparent, explainable behavioural indicator. */
export interface Indicator {
  key: IndicatorKey;
  /** 0 = nothing unusual, 1 = strongly present. */
  score: number;
  /** The measured quantity behind the score. */
  value: number;
  /** What it was compared with (personal baseline or fixed limit), when applicable. */
  reference: number | null;
}

/**
 * Kinds of support the interface can offer. These describe what would help
 * right now, not what the child "has": no label here is a diagnosis.
 */
export type SupportDimension = 'decoding' | 'lineTracking' | 'attention' | 'fatigue';

export type InsufficientReason = 'low-tracking' | 'few-fixations' | 'warming-up';

export type Assessment =
  | { status: 'insufficient-data'; t: number; reason: InsufficientReason }
  | {
      status: 'ok';
      t: number;
      indicators: Indicator[];
      dimensions: Record<SupportDimension, number>;
      /** 0..1 overall estimate of how much reading support would help now. */
      supportNeed: number;
      dominant: SupportDimension | null;
      /** 0..1: how much this assessment should be trusted. */
      confidence: number;
    };

export interface EngineContext {
  language: Lang;
  textDifficulty: TextDifficulty;
  /** Session time limit, used only for the fatigue estimate. */
  maxDurationMs: number;
  /** Baseline carried over from earlier sessions in the same language, if any. */
  storedBaseline: Baseline | null;
}

export interface AssessInput {
  t: number;
  elapsedMs: number;
  calibrationGrade: CalibrationGrade;
  /** Blinks per minute so far, from the tracker. */
  blinkRate: number;
}
