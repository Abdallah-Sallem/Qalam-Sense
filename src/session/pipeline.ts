/**
 * The closed loop, without any DOM or camera:
 *
 *   observation → gaze sample → fixation → line/word → window features
 *        → assessment → adaptation decision → (UI applies it) → observation…
 *
 * The UI feeds it observations and layout changes and listens to its events.
 * One instance per reading session; dispose() releases every subscription.
 */
import { AdaptationController, type Decision } from '@/adaptation/controller';
import type { StudentSettings } from '@/adaptation/types';
import { DifficultyEngine } from '@/difficulty/engine';
import type { Assessment, Baseline, IndicatorKey, TextDifficulty } from '@/difficulty/types';
import { Emitter } from '@/lib/emitter';
import { clamp, mean } from '@/lib/math';
import { FixationDetector } from '@/reading/fixations';
import type { TextLayout } from '@/reading/layout';
import { ReadingAnalyzer, type SentenceStats } from '@/reading/readingAnalyzer';
import { ReadingMapper, type ReadingFixation } from '@/reading/readingMapper';
import type { Lang, ParsedText } from '@/reading/text';
import type { CalibrationGrade, CalibrationQuality, Viewport } from '@/vision/calibration';
import type { GazeModel } from '@/vision/gazeModel';
import { GazeTracker, type RecalibrationReason } from '@/vision/gazeTracker';
import type { FaceObservation, GazeSample, TrackingState } from '@/vision/types';

export interface GazeSetup {
  model: GazeModel;
  quality: CalibrationQuality;
  viewport: Viewport;
}

export interface PipelineOptions {
  parsed: ParsedText;
  lang: Lang;
  textDifficulty: TextDifficulty;
  settings: StudentSettings;
  maxDurationMs: number;
  storedBaseline: Baseline | null;
  layout: TextLayout;
  /** Null when the session runs without the camera: only manual adaptation is possible. */
  gaze: GazeSetup | null;
  assessEveryMs?: number;
}

export interface PipelineEvents extends Record<string, unknown> {
  fixation: ReadingFixation;
  assessment: Assessment;
  adaptation: Decision;
  tracking: TrackingState;
  recalibrate: { reason: RecalibrationReason };
}

/** Gaze-derived part of a session record. Aggregates only — no gaze coordinates are kept. */
export interface GazeSummary {
  calibration: { grade: CalibrationGrade; meanErrorPx: number; relativeError: number };
  tracking: { validRatio: number; lossEvents: number; blinkRate: number; recalibrations: number };
  totals: { fixations: number; regressions: number; onTextMs: number };
  assessments: { ok: number; insufficient: number; meanNeed: number; peakNeed: number };
  /** Mean score of each indicator over the usable assessments. */
  indicatorMeans: Partial<Record<IndicatorKey, number>>;
  /** Support need over time, at most ~120 points. */
  timeline: { atMs: number; need: number; confidence: number }[];
  sentences: SentenceStats[];
}

const DRIFT_ASSESSMENTS = 3;

export class ReadingPipeline {
  readonly events = new Emitter<PipelineEvents>();
  readonly controller: AdaptationController;
  tracker: GazeTracker | null;
  private readonly detector: FixationDetector;
  private readonly mapper: ReadingMapper;
  private readonly analyzer: ReadingAnalyzer;
  private readonly engine: DifficultyEngine;
  private readonly assessEveryMs: number;
  private gaze: GazeSetup | null;
  private startedAt: number | null = null;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private lastAssessAt = 0;
  private driftCount = 0;
  private recalibrations = 0;
  private history: Extract<Assessment, { status: 'ok' }>[] = [];
  private insufficient = 0;
  private unsubscribe: (() => void)[] = [];

  constructor(options: PipelineOptions) {
    this.gaze = options.gaze;
    this.assessEveryMs = options.assessEveryMs ?? 5000;
    this.controller = new AdaptationController(options.settings, options.gaze !== null);
    this.analyzer = new ReadingAnalyzer(options.parsed.sentenceOf);
    this.engine = new DifficultyEngine({
      language: options.lang,
      textDifficulty: options.textDifficulty,
      maxDurationMs: options.maxDurationMs,
      storedBaseline: options.storedBaseline,
    });
    const q = options.gaze?.quality;
    this.detector = new FixationDetector({ dispersionPx: q ? clamp(3 * q.jitterPx + 40, 60, 160) : 80 });
    this.mapper = new ReadingMapper(options.layout, { errorXPx: q?.errorXPx ?? 100, errorYPx: q?.errorYPx ?? 100 });
    this.tracker = null;
    if (options.gaze) this.attachTracker(options.gaze);
  }

  private attachTracker(gaze: GazeSetup): void {
    for (const u of this.unsubscribe) u();
    this.tracker?.dispose();
    const tracker = new GazeTracker(gaze.model, gaze.quality, gaze.viewport);
    this.tracker = tracker;
    this.gaze = gaze;
    this.unsubscribe = [
      tracker.events.on('state', (s) => this.events.emit('tracking', s)),
      tracker.events.on('recalibration-suggested', ({ reason }) => this.events.emit('recalibrate', { reason })),
    ];
  }

  /** Swaps in a new calibration mid-session. Reading position and statistics are kept. */
  recalibrate(gaze: GazeSetup): void {
    this.attachTracker(gaze);
    this.detector.setDispersion(clamp(3 * gaze.quality.jitterPx + 40, 60, 160));
    this.mapper.setPrecision({ errorXPx: gaze.quality.errorXPx, errorYPx: gaze.quality.errorYPx });
    this.controller.setAutomationAvailable(true);
    this.noteRecalibrated();
  }

  /** Stops using gaze for the rest of the session (camera lost or switched off). */
  dropGaze(): void {
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    this.controller.setAutomationAvailable(false);
  }

  get hasGaze(): boolean {
    return this.tracker !== null;
  }

  start(t: number): void {
    this.startedAt = t;
    this.lastAssessAt = t;
  }

  /** Active reading time so far (pauses excluded), ms. */
  elapsed(t: number): number {
    if (this.startedAt === null) return 0;
    return (this.pausedAt ?? t) - this.startedAt - this.pausedTotal;
  }

  pause(t: number): void {
    this.pausedAt ??= t;
  }

  resume(t: number): void {
    if (this.pausedAt === null) return;
    this.pausedTotal += t - this.pausedAt;
    this.pausedAt = null;
    this.lastAssessAt = t;
    this.analyzer.touch(t); // time spent paused is not "stagnation"
  }

  setLayout(layout: TextLayout): void {
    this.mapper.setLayout(layout);
  }

  setViewport(viewport: Viewport): void {
    this.tracker?.setViewport(viewport);
  }

  setActiveParagraph(paragraph: number, firstWord: number, t: number): void {
    this.mapper.setActiveParagraph(paragraph);
    this.analyzer.notePosition(t, firstWord);
  }

  /** The reader chose not to recalibrate now: allow the suggestion to come back later. */
  dismissRecalibration(): void {
    this.driftCount = 0;
    this.tracker?.resetSuggestion();
  }

  noteRecalibrated(): void {
    this.recalibrations++;
    this.driftCount = 0;
    this.mapper.resetOffset();
  }

  /**
   * Feed one camera frame's observation. `scroll` converts viewport gaze
   * coordinates to the document coordinates the layout is expressed in.
   */
  onObservation(t: number, observation: FaceObservation | null, scroll: { x: number; y: number }): GazeSample | null {
    if (!this.tracker || this.startedAt === null || this.pausedAt !== null) return null;
    const sample = this.tracker.process(t, observation);
    this.analyzer.noteSample(t, sample.valid);
    const fixation = this.detector.push({ ...sample, x: sample.x + scroll.x, y: sample.y + scroll.y });
    if (fixation) {
      const mapped = this.mapper.map(fixation);
      this.analyzer.addFixation(mapped);
      this.events.emit('fixation', mapped);
    }
    if (t - this.lastAssessAt >= this.assessEveryMs) this.assess(t);
    return sample;
  }

  private assess(t: number): void {
    this.lastAssessAt = t;
    const elapsedMs = this.elapsed(t);
    const assessment = this.engine.assess(this.analyzer.window(t), {
      t: elapsedMs,
      elapsedMs,
      calibrationGrade: this.gaze!.quality.grade,
      blinkRate: this.tracker!.stats().blinkRate,
    });
    if (assessment.status === 'ok') this.history.push(assessment);
    else this.insufficient++;
    this.events.emit('assessment', assessment);

    this.driftCount = this.mapper.isDrifting ? this.driftCount + 1 : 0;
    if (this.driftCount >= DRIFT_ASSESSMENTS) this.tracker!.reportDrift(t);

    const decision = this.controller.step(elapsedMs, assessment);
    if (decision) this.events.emit('adaptation', decision);
  }

  /** Baseline to persist for this student and language after the session. */
  updatedBaseline(): Baseline | null {
    return this.engine.updatedBaseline();
  }

  /** Aggregated, storable description of what the camera observed. Null without gaze. */
  summary(): GazeSummary | null {
    if (!this.tracker || !this.gaze) return null;
    const stats = this.tracker.stats();
    const needs = this.history.map((a) => a.supportNeed);
    const indicatorMeans: Partial<Record<IndicatorKey, number>> = {};
    if (this.history.length) {
      for (const { key } of this.history[0]!.indicators) {
        indicatorMeans[key] = mean(this.history.map((a) => a.indicators.find((i) => i.key === key)?.score ?? 0));
      }
    }
    const stride = Math.max(1, Math.ceil(this.history.length / 120));
    const q = this.gaze.quality;
    return {
      calibration: { grade: q.grade, meanErrorPx: Math.round(q.meanErrorPx), relativeError: q.relativeError },
      tracking: {
        validRatio: stats.validRatio,
        lossEvents: stats.lossEvents,
        blinkRate: stats.blinkRate,
        recalibrations: this.recalibrations,
      },
      totals: this.analyzer.sessionTotals(),
      assessments: {
        ok: this.history.length,
        insufficient: this.insufficient,
        meanNeed: mean(needs),
        peakNeed: needs.length ? Math.max(...needs) : 0,
      },
      indicatorMeans,
      timeline: this.history
        .filter((_, i) => i % stride === 0)
        .map((a) => ({ atMs: Math.round(a.t), need: round2(a.supportNeed), confidence: round2(a.confidence) })),
      sentences: this.analyzer.sentences(),
    };
  }

  dispose(): void {
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    this.tracker?.dispose();
    this.events.clear();
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
