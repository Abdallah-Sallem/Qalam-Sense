/**
 * Difficulty engine: measurement window → explainable assessment.
 *
 * Pipeline: sufficiency check → personal baseline → indicators → support
 * dimensions → overall need + confidence. It never outputs a diagnosis, and
 * it says "insufficient data" instead of guessing when tracking is poor.
 */
import { clamp01, median, ramp } from '@/lib/math';
import type { WindowFeatures } from '@/reading/readingAnalyzer';
import { combineDimensions, computeIndicators } from './indicators';
import type { AssessInput, Assessment, Baseline, EngineContext, SupportDimension } from './types';

export const ENGINE_CONFIG = {
  /** A window shorter than this is not assessed. */
  minWindowMs: 12_000,
  /** Minimum share of valid gaze samples in the window. */
  minValidRatio: 0.55,
  minFixations: 10,
  /** Sufficient windows used to learn how this child reads today. */
  warmupWindows: 4,
  /** Weight of the stored (cross-session) baseline against today's warm-up. */
  storedWeight: 0.6,
  /** A dimension must reach this to be named as the dominant one. */
  dominantMin: 0.3,
  /** Fatigue is not estimated before this much reading. */
  fatigueAfterMs: 180_000,
  /** How fast the stored baseline follows a new session. */
  baselineLearningRate: 0.3,
};

const GRADE_FACTOR = { good: 1, fair: 0.8, poor: 0.5 } as const;

export class DifficultyEngine {
  private warmup: WindowFeatures[] = [];
  private sessionBaseline: Baseline | null = null;
  private typical: WindowFeatures[] = [];
  private blinkReference: number | null = null;

  constructor(
    private readonly ctx: EngineContext,
    private readonly config = ENGINE_CONFIG,
  ) {}

  /** Baseline in effect, or null while still warming up with nothing stored. */
  get baseline(): Baseline | null {
    const stored = this.ctx.storedBaseline;
    const session = this.sessionBaseline;
    if (stored && session) {
      const w = this.config.storedWeight;
      return {
        fixationMs: w * stored.fixationMs + (1 - w) * session.fixationMs,
        wordsPerMinute: w * stored.wordsPerMinute + (1 - w) * session.wordsPerMinute,
        fixationCv: w * stored.fixationCv + (1 - w) * session.fixationCv,
        windows: stored.windows + session.windows,
      };
    }
    return stored ?? session;
  }

  assess(window: WindowFeatures, input: AssessInput): Assessment {
    const { t } = input;
    if (window.windowMs < this.config.minWindowMs) return { status: 'insufficient-data', t, reason: 'warming-up' };
    if (window.validRatio < this.config.minValidRatio) return { status: 'insufficient-data', t, reason: 'low-tracking' };
    if (window.fixationCount < this.config.minFixations) return { status: 'insufficient-data', t, reason: 'few-fixations' };

    if (!this.sessionBaseline) {
      this.warmup.push(window);
      if (this.warmup.length >= this.config.warmupWindows) this.sessionBaseline = toBaseline(this.warmup);
    }
    this.blinkReference ??= input.elapsedMs >= 60_000 && input.blinkRate > 0 ? input.blinkRate : null;

    const baseline = this.baseline;
    if (!baseline) return { status: 'insufficient-data', t, reason: 'warming-up' };

    const indicators = computeIndicators(window, baseline, this.ctx.textDifficulty, this.fatigue(window, baseline, input));
    const dimensions = combineDimensions(indicators);
    const values = Object.values(dimensions);
    const top = Math.max(...values);
    const supportNeed = clamp01(0.75 * top + 0.25 * (values.reduce((s, v) => s + v, 0) / values.length));
    const dominant =
      top >= this.config.dominantMin
        ? (Object.keys(dimensions) as SupportDimension[]).reduce((a, b) => (dimensions[b] > dimensions[a] ? b : a))
        : null;

    // Trust: how much of the window was really observed, how good calibration
    // was, and how well we know this reader.
    const maturity = clamp01(baseline.windows / (this.config.warmupWindows * 3));
    const confidence = clamp01(
      ramp(window.validRatio, this.config.minValidRatio - 0.15, 0.9) * GRADE_FACTOR[input.calibrationGrade] * (0.7 + 0.3 * maturity),
    );

    if (supportNeed < 0.25) this.typical.push(window);
    return { status: 'ok', t, indicators, dimensions, supportNeed, dominant, confidence };
  }

  /**
   * Fatigue is a weak, slow signal: more blinking than at the start of the
   * session, a long session, and slowing down late in it. It only ever
   * leads to gentler presentation or a suggested break.
   */
  private fatigue(w: WindowFeatures, baseline: Baseline, input: AssessInput): number {
    if (input.elapsedMs < this.config.fatigueAfterMs) return 0;
    const blink = this.blinkReference ? ramp(input.blinkRate / this.blinkReference, 1.4, 2.4) : 0;
    const duration = ramp(input.elapsedMs / this.ctx.maxDurationMs, 0.7, 1);
    const slowing =
      input.elapsedMs > this.ctx.maxDurationMs * 0.5 && baseline.wordsPerMinute > 0
        ? ramp(w.wordsPerMinute / baseline.wordsPerMinute, 0.8, 0.4)
        : 0;
    return clamp01(0.45 * blink + 0.25 * duration + 0.3 * slowing);
  }

  /**
   * Baseline to store for the next session: the previous one nudged towards
   * the windows of this session in which no particular support was needed.
   */
  updatedBaseline(): Baseline | null {
    const source = this.typical.length >= 3 ? this.typical : this.warmup.length >= this.config.warmupWindows ? this.warmup : null;
    if (!source) return this.ctx.storedBaseline;
    const session = toBaseline(source);
    const stored = this.ctx.storedBaseline;
    if (!stored) return session;
    const r = this.config.baselineLearningRate;
    return {
      fixationMs: (1 - r) * stored.fixationMs + r * session.fixationMs,
      wordsPerMinute: (1 - r) * stored.wordsPerMinute + r * session.wordsPerMinute,
      fixationCv: (1 - r) * stored.fixationCv + r * session.fixationCv,
      windows: Math.min(stored.windows + session.windows, 200),
    };
  }
}

export function toBaseline(windows: readonly WindowFeatures[]): Baseline {
  return {
    fixationMs: median(windows.map((w) => w.medianFixationMs)),
    wordsPerMinute: median(windows.map((w) => w.wordsPerMinute)),
    fixationCv: median(windows.map((w) => w.fixationCv)),
    windows: windows.length,
  };
}
