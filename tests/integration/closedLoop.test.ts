/**
 * Integration: the whole observation → adaptation loop, driven by the
 * synthetic eye and scripted readers. No camera, no DOM.
 *
 * These tests prove that the modules are wired correctly and that the loop
 * reacts (or deliberately does not react) as designed. They do not measure
 * real-world accuracy: that needs a webcam and a person (see docs/TESTING.md).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Decision } from '@/adaptation/controller';
import { DEFAULT_SETTINGS, type StudentSettings } from '@/adaptation/types';
import type { Assessment, Baseline } from '@/difficulty/types';
import { createRng, type Rng } from '@/lib/random';
import type { TextLayout } from '@/reading/layout';
import { parseText, type Direction, type ParsedText } from '@/reading/text';
import { ReadingPipeline } from '@/session/pipeline';
import { FRAME_MS, gridLayout, runSyntheticCalibration } from '@/testing/harness';
import { EFFORTFUL_READER, STEADY_READER, planReading, targetAt, type ReaderProfile } from '@/testing/readingSimulator';
import { observeGaze, type SyntheticEyeOptions } from '@/testing/syntheticEye';
import type { CalibrationResult } from '@/vision/calibration';

const VIEWPORT = { width: 1366, height: 768 };
type Ok = Extract<CalibrationResult, { ok: true }>;
let calibration: Ok;

beforeAll(() => {
  const { result } = runSyntheticCalibration(VIEWPORT, createRng(101));
  if (!result.ok) throw new Error('calibration failed');
  calibration = result;
});

/** 12 paragraphs of 48 words: several minutes of reading. */
function makeText(): ParsedText {
  const paragraph = (p: number) => Array.from({ length: 48 }, (_, i) => (i % 12 === 11 ? `m${p}_${i}.` : `m${p}_${i}`)).join(' ');
  return parseText(Array.from({ length: 12 }, (_, p) => paragraph(p)).join('\n\n'));
}

interface Phase {
  profile: ReaderProfile;
  seconds: number;
  eye?: SyntheticEyeOptions;
  /** Returns true for frames in which no face is visible. */
  dropout?: (t: number) => boolean;
}

interface RunResult {
  pipeline: ReadingPipeline;
  assessments: Assessment[];
  decisions: Decision[];
  fixations: number;
  endT: number;
}

function runSession(opts: {
  direction: Direction;
  phases: Phase[];
  seed: number;
  settings?: StudentSettings;
  storedBaseline?: Baseline | null;
  gaze?: boolean;
}): RunResult {
  const parsed = makeText();
  const layout: TextLayout = gridLayout(parsed, { direction: opts.direction, wordsPerLine: 8 });
  const pipeline = new ReadingPipeline({
    parsed,
    lang: opts.direction === 'rtl' ? 'ar' : 'fr',
    textDifficulty: 'moyen',
    settings: opts.settings ?? DEFAULT_SETTINGS,
    maxDurationMs: 15 * 60_000,
    storedBaseline: opts.storedBaseline ?? null,
    layout,
    gaze: opts.gaze === false ? null : { model: calibration.model, quality: calibration.quality, viewport: VIEWPORT },
  });
  const assessments: Assessment[] = [];
  const decisions: Decision[] = [];
  let fixations = 0;
  pipeline.events.on('assessment', (a) => assessments.push(a));
  pipeline.events.on('adaptation', (d) => decisions.push(d));
  pipeline.events.on('fixation', () => fixations++);

  const rng: Rng = createRng(opts.seed);
  let t = 0;
  let word = 0;
  let paragraph = -1;
  pipeline.start(t);
  for (const phase of opts.phases) {
    const until = t + phase.seconds * 1000;
    const plan = planReading(layout, phase.profile, rng, { from: word, to: parsed.wordCount - 1 }, t, until);
    for (; t < until; t += FRAME_MS) {
      const g = targetAt(plan, t);
      if (!g) continue;
      word = g.word;
      // The reader presses "next" when entering a new paragraph, as in the UI.
      const p = parsed.paragraphOf[g.word]!;
      if (p !== paragraph) {
        paragraph = p;
        pipeline.setActiveParagraph(p, parsed.paragraphOf.indexOf(p), t);
      }
      // The page scrolls so the current line sits mid-screen.
      const scrollY = Math.max(0, layout.lines[layout.words[g.word]!.line]!.centerY - VIEWPORT.height / 2);
      const onScreen = { x: g.point.x, y: g.point.y - scrollY };
      const observation = phase.dropout?.(t) ? null : observeGaze(onScreen, VIEWPORT, t, rng, phase.eye ?? { noise: 0.004 });
      pipeline.onObservation(t, observation, { x: 0, y: scrollY });
    }
  }
  return { pipeline, assessments, decisions, fixations, endT: t };
}

const usable = (as: Assessment[]) => as.filter((a): a is Extract<Assessment, { status: 'ok' }> => a.status === 'ok');

describe.each<[string, Direction]>([
  ['French (LTR)', 'ltr'],
  ['Arabic (RTL)', 'rtl'],
])('closed loop — %s', (_name, direction) => {
  it('leaves a steady reader alone', () => {
    const r = runSession({ direction, seed: 1, phases: [{ profile: STEADY_READER, seconds: 150 }] });
    const ok = usable(r.assessments);
    expect(ok.length).toBeGreaterThan(15);
    expect(Math.max(...ok.map((a) => a.supportNeed))).toBeLessThan(0.35);
    expect(r.decisions).toEqual([]);
    expect(r.pipeline.controller.stateAt(r.endT).level).toBe(0);
    expect(r.fixations).toBeGreaterThan(200);
  });

  it('raises support when reading becomes effortful, and explains why', () => {
    const r = runSession({
      direction,
      seed: 2,
      phases: [
        { profile: STEADY_READER, seconds: 60 },
        { profile: EFFORTFUL_READER, seconds: 120 },
      ],
    });
    expect(r.decisions.length).toBeGreaterThanOrEqual(1);
    const first = r.decisions[0]!.event;
    expect(first).toMatchObject({ trigger: 'auto', fromLevel: 0, toLevel: 1 });
    expect(first.atMs).toBeGreaterThan(60_000); // not before the change in behaviour
    expect(first.reasons.length).toBeGreaterThan(0);
    expect(first.confidence).toBeGreaterThan(0.5);
    expect(r.pipeline.controller.stateAt(r.endT).level).toBeGreaterThanOrEqual(1);
    // Never more than one level per change.
    for (const d of r.decisions) expect(Math.abs(d.event.toLevel - d.event.fromLevel)).toBeLessThanOrEqual(1);
  });
});

describe('closed loop — safeguards', () => {
  it('does not adapt on patchy tracking: it reports insufficient data instead', () => {
    const r = runSession({
      direction: 'ltr',
      seed: 3,
      storedBaseline: { fixationMs: 330, wordsPerMinute: 150, fixationCv: 0.3, windows: 12 },
      // Face visible only 0.4 s out of every 1.5 s.
      phases: [{ profile: EFFORTFUL_READER, seconds: 150, dropout: (t) => t % 1500 > 400 }],
    });
    expect(usable(r.assessments)).toEqual([]);
    expect(r.assessments.length).toBeGreaterThan(10);
    expect(r.decisions).toEqual([]);
  });

  it('does not adapt when the head has moved far from the calibration pose', () => {
    const r = runSession({
      direction: 'ltr',
      seed: 4,
      storedBaseline: { fixationMs: 330, wordsPerMinute: 150, fixationCv: 0.3, windows: 12 },
      phases: [{ profile: EFFORTFUL_READER, seconds: 120, eye: { noise: 0.004, head: { yaw: 0.3 } } }],
    });
    expect(r.decisions).toEqual([]);
    expect(r.pipeline.tracker!.stats().validRatio).toBeLessThan(0.1);
  });

  it('asks for recalibration when the head stays away from the calibration pose', () => {
    const parsed = makeText();
    const layout = gridLayout(parsed, { direction: 'ltr', wordsPerLine: 8 });
    const pipeline = new ReadingPipeline({
      parsed,
      lang: 'fr',
      textDifficulty: 'moyen',
      settings: DEFAULT_SETTINGS,
      maxDurationMs: 900_000,
      storedBaseline: null,
      layout,
      gaze: { model: calibration.model, quality: calibration.quality, viewport: VIEWPORT },
    });
    const reasons: string[] = [];
    pipeline.events.on('recalibrate', (e) => reasons.push(e.reason));
    const rng = createRng(9);
    pipeline.start(0);
    for (let t = 0; t < 12_000; t += FRAME_MS) {
      pipeline.onObservation(t, observeGaze({ x: 600, y: 300 }, VIEWPORT, t, rng, { noise: 0.004, head: { dx: 0.15 } }), { x: 0, y: 0 });
    }
    expect(reasons).toEqual(['head-moved']);
    pipeline.noteRecalibrated();
    expect(pipeline.summary()!.tracking.recalibrations).toBe(1);
  });

  it('respects a teacher who switched automatic adaptation off', () => {
    const r = runSession({
      direction: 'ltr',
      seed: 5,
      settings: { ...DEFAULT_SETTINGS, autoAdapt: false },
      phases: [
        { profile: STEADY_READER, seconds: 60 },
        { profile: EFFORTFUL_READER, seconds: 120 },
      ],
    });
    expect(r.decisions).toEqual([]);
    expect(usable(r.assessments).some((a) => a.supportNeed > 0.5)).toBe(true); // still observed, just not acted on
  });

  it('runs without a camera: no gaze samples, no assessments, manual changes only', () => {
    const r = runSession({ direction: 'ltr', seed: 6, gaze: false, phases: [{ profile: EFFORTFUL_READER, seconds: 60 }] });
    expect(r.pipeline.hasGaze).toBe(false);
    expect(r.assessments).toEqual([]);
    expect(r.pipeline.summary()).toBeNull();
    expect(r.pipeline.controller.currentMode(r.endT)).toBe('manual-only');
    expect(r.pipeline.controller.setLevelManually(r.endT, 2)!.event.trigger).toBe('student');
  });

  it('does not count paused time as stagnation or reading time', () => {
    const r = runSession({ direction: 'ltr', seed: 7, phases: [{ profile: STEADY_READER, seconds: 40 }] });
    const before = r.pipeline.elapsed(r.endT);
    r.pipeline.pause(r.endT);
    expect(r.pipeline.onObservation(r.endT + 10_000, null, { x: 0, y: 0 })).toBeNull();
    r.pipeline.resume(r.endT + 60_000);
    expect(r.pipeline.elapsed(r.endT + 60_000)).toBe(before);
  });
});

describe('session summary', () => {
  it('stores aggregates only, and enough for a teacher to locate effortful passages', () => {
    const r = runSession({
      direction: 'ltr',
      seed: 8,
      phases: [
        { profile: STEADY_READER, seconds: 70 },
        { profile: EFFORTFUL_READER, seconds: 80 },
      ],
    });
    const s = r.pipeline.summary()!;
    expect(s.calibration.grade).toBe('good');
    expect(s.tracking.validRatio).toBeGreaterThan(0.9);
    expect(s.assessments.ok).toBeGreaterThan(10);
    expect(s.assessments.peakNeed).toBeGreaterThan(s.assessments.meanNeed);
    expect(s.timeline.length).toBeLessThanOrEqual(120);
    expect(s.indicatorMeans.prolongedFixations).toBeGreaterThan(0);

    // Dwell time per word is clearly higher in the effortful part of the text.
    const perWord = (stats: typeof s.sentences) => stats.reduce((a, x) => a + x.dwellMs, 0) / (stats.length * 12);
    const half = Math.floor(s.sentences.length / 2);
    expect(perWord(s.sentences.slice(-4))).toBeGreaterThan(perWord(s.sentences.slice(0, Math.min(half, 6))) * 1.5);

    // Privacy: nothing in the stored summary is a gaze coordinate or a raw sample.
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/"x":|"y":|landmark|features/);
    expect(json.length).toBeLessThan(20_000);
  });

  it('produces a baseline to carry to the next session', () => {
    const r = runSession({ direction: 'ltr', seed: 9, phases: [{ profile: STEADY_READER, seconds: 90 }] });
    const b = r.pipeline.updatedBaseline()!;
    expect(b.fixationMs).toBeGreaterThan(200);
    expect(b.wordsPerMinute).toBeGreaterThan(60);
    expect(b.windows).toBeGreaterThanOrEqual(3);
  });

  it('releases its listeners on dispose', () => {
    const r = runSession({ direction: 'ltr', seed: 10, phases: [{ profile: STEADY_READER, seconds: 5 }] });
    r.pipeline.dispose();
    expect(r.pipeline.events.listenerCount('assessment')).toBe(0);
    expect(r.pipeline.tracker!.events.listenerCount('state')).toBe(0);
  });
});
