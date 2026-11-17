/**
 * Stage 4 of the vision pipeline: turns per-frame observations into gaze
 * samples that carry an explicit validity flag and confidence, and watches
 * for tracking loss and for the need to recalibrate.
 *
 * No DOM, no camera: fed with FaceObservations, fully unit-testable.
 */
import { Emitter } from '@/lib/emitter';
import { clamp01, ramp } from '@/lib/math';
import type { CalibrationQuality, Viewport } from './calibration';
import { OneEuroFilter } from './filters';
import { assessFrame } from './frameQuality';
import { headDeviation, predictGaze, rawFeatures, type GazeModel } from './gazeModel';
import type { FaceObservation, GazeSample, TrackingState } from './types';

export const TRACKER_CONFIG = {
  /** No valid sample for this long ⇒ tracking is declared lost. */
  lostAfterMs: 1500,
  /** Consecutive valid frames required to declare recovery. */
  recoverFrames: 5,
  /** Samples below this confidence are not observations. */
  minConfidence: 0.3,
  /** How far outside the viewport (fraction of its size) an estimate may land and still count. */
  screenMargin: 0.12,
  /** Frames dropped after a blink: the lids are still moving and drag the iris estimate. */
  postBlinkFrames: 2,
  /** Head outside the calibration envelope for this long ⇒ suggest recalibration. */
  poseDriftMs: 8000,
  /** This many losses within lossWindowMs ⇒ suggest recalibration. */
  lossBurst: 3,
  lossWindowMs: 60_000,
  minBlinkMs: 50,
  maxBlinkMs: 600,
};

const GRADE_CONFIDENCE = { good: 0.9, fair: 0.7, poor: 0.45 } as const;

export type RecalibrationReason = 'head-moved' | 'repeated-loss' | 'drift';

export interface TrackerEvents extends Record<string, unknown> {
  sample: GazeSample;
  state: TrackingState;
  lost: { t: number };
  recovered: { t: number; lostMs: number };
  'recalibration-suggested': { t: number; reason: RecalibrationReason };
}

export interface TrackerStats {
  frames: number;
  validFrames: number;
  validRatio: number;
  lossEvents: number;
  blinks: number;
  /** Blinks per minute over the tracked duration. */
  blinkRate: number;
  durationMs: number;
}

export class GazeTracker {
  readonly events = new Emitter<TrackerEvents>();
  private readonly fx = new OneEuroFilter();
  private readonly fy = new OneEuroFilter();
  private state: TrackingState = 'degraded';
  private lastValidAt: number | null = null;
  private lostAt: number | null = null;
  private validStreak = 0;
  private skipFrames = 0;
  private blinkStart: number | null = null;
  private outOfEnvelopeSince: number | null = null;
  private lossTimes: number[] = [];
  private suggested = false;
  private startedAt: number | null = null;
  private lastT = 0;
  private counters = { frames: 0, valid: 0, losses: 0, blinks: 0 };

  constructor(
    private readonly model: GazeModel,
    private readonly quality: CalibrationQuality,
    private viewport: Viewport,
    private readonly config = TRACKER_CONFIG,
  ) {}

  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  get trackingState(): TrackingState {
    return this.state;
  }

  /** Lets the reading layer report that gaze no longer lines up with the text. */
  reportDrift(t: number): void {
    this.suggest(t, 'drift');
  }

  /** Call after the child recalibrated or dismissed the suggestion. */
  resetSuggestion(): void {
    this.suggested = false;
    this.outOfEnvelopeSince = null;
    this.lossTimes = [];
  }

  process(t: number, observation: FaceObservation | null): GazeSample {
    this.startedAt ??= t;
    this.lastT = t;
    this.counters.frames++;

    const { usable, issues } = assessFrame(observation);
    this.trackBlink(t, observation);

    let sample: GazeSample = { t, x: 0, y: 0, valid: false, confidence: 0, offScreen: false, issues };

    if (observation && observation.eyesClosed) this.skipFrames = this.config.postBlinkFrames;
    else if (usable && observation && this.skipFrames > 0) this.skipFrames--;
    else if (usable && observation) sample = this.estimate(t, observation, issues);

    this.updateEnvelope(t, observation);
    this.updateState(t, sample.valid);
    if (sample.valid) this.counters.valid++;
    this.events.emit('sample', sample);
    return sample;
  }

  private estimate(t: number, o: FaceObservation, issues: GazeSample['issues']): GazeSample {
    const raw = predictGaze(this.model, rawFeatures(o));
    const deviation = headDeviation(this.model, o);
    const poseFactor = 1 - ramp(deviation, 0.6, 1.5);
    const eyeFactor = 1 - ramp(o.blinkScore, 0.25, 0.55);
    const confidence = clamp01(GRADE_CONFIDENCE[this.quality.grade] * poseFactor * eyeFactor);

    const { width, height } = this.viewport;
    const mx = width * this.config.screenMargin;
    const my = height * this.config.screenMargin;
    const offScreen = raw.x < -mx || raw.x > width + mx || raw.y < -my || raw.y > height + my;
    const valid = confidence >= this.config.minConfidence && !offScreen;

    if (!valid) {
      // Do not let rejected estimates leak into the smoothing history.
      this.fx.reset();
      this.fy.reset();
      return { t, x: raw.x, y: raw.y, valid: false, confidence, offScreen, issues };
    }
    return { t, x: this.fx.filter(raw.x, t), y: this.fy.filter(raw.y, t), valid: true, confidence, offScreen: false, issues };
  }

  private trackBlink(t: number, o: FaceObservation | null): void {
    if (o?.eyesClosed) {
      this.blinkStart ??= t;
    } else if (this.blinkStart !== null) {
      const d = t - this.blinkStart;
      if (o && d >= this.config.minBlinkMs && d <= this.config.maxBlinkMs) this.counters.blinks++;
      this.blinkStart = null;
    }
  }

  private updateEnvelope(t: number, o: FaceObservation | null): void {
    if (!o || headDeviation(this.model, o) <= 1) {
      this.outOfEnvelopeSince = null;
      return;
    }
    this.outOfEnvelopeSince ??= t;
    if (t - this.outOfEnvelopeSince >= this.config.poseDriftMs) this.suggest(t, 'head-moved');
  }

  private updateState(t: number, valid: boolean): void {
    if (valid) {
      this.validStreak++;
      this.lastValidAt = t;
      if (this.state !== 'tracking' && this.validStreak >= this.config.recoverFrames) {
        if (this.state === 'lost' && this.lostAt !== null) {
          this.events.emit('recovered', { t, lostMs: t - this.lostAt });
          this.lostAt = null;
        }
        this.setState('tracking');
      }
      return;
    }
    this.validStreak = 0;
    const since = this.lastValidAt ?? this.startedAt ?? t;
    if (this.state !== 'lost' && t - since >= this.config.lostAfterMs) {
      this.lostAt = since;
      this.counters.losses++;
      this.setState('lost');
      this.events.emit('lost', { t });
      this.lossTimes = [...this.lossTimes.filter((x) => t - x <= this.config.lossWindowMs), t];
      if (this.lossTimes.length >= this.config.lossBurst) this.suggest(t, 'repeated-loss');
    } else if (this.state === 'tracking') {
      this.setState('degraded');
    }
  }

  private setState(state: TrackingState): void {
    if (state === this.state) return;
    this.state = state;
    this.events.emit('state', state);
  }

  private suggest(t: number, reason: RecalibrationReason): void {
    if (this.suggested) return;
    this.suggested = true;
    this.events.emit('recalibration-suggested', { t, reason });
  }

  stats(): TrackerStats {
    const durationMs = this.startedAt === null ? 0 : this.lastT - this.startedAt;
    const { frames, valid, losses, blinks } = this.counters;
    return {
      frames,
      validFrames: valid,
      validRatio: frames ? valid / frames : 0,
      lossEvents: losses,
      blinks,
      blinkRate: durationMs > 0 ? (blinks * 60_000) / durationMs : 0,
      durationMs,
    };
  }

  dispose(): void {
    this.events.clear();
  }
}
