import { describe, expect, it } from 'vitest';
import { createRng } from '@/lib/random';
import { FixationDetector, type Fixation } from '@/reading/fixations';
import type { TextLayout } from '@/reading/layout';
import { ReadingAnalyzer } from '@/reading/readingAnalyzer';
import { ReadingMapper, type ReadingFixation } from '@/reading/readingMapper';
import { parseText, type Direction } from '@/reading/text';
import { gridLayout } from '@/testing/harness';
import { EFFORTFUL_READER, STEADY_READER, planReading, type ReaderProfile } from '@/testing/readingSimulator';

const sample = (t: number, x: number, y: number, valid = true) => ({ t, x, y, valid, confidence: 0.8 });

describe('FixationDetector', () => {
  it('merges a steady run of samples into one fixation', () => {
    const d = new FixationDetector();
    const rng = createRng(1);
    for (let i = 0; i < 12; i++) expect(d.push(sample(i * 33, 500 + rng.gauss() * 6, 300 + rng.gauss() * 6))).toBeNull();
    const f = d.push(sample(12 * 33, 900, 300))!; // saccade away ends it
    expect(f.duration).toBe(11 * 33);
    expect(f.x).toBeCloseTo(500, -1);
    expect(f.samples).toBe(12);
    expect(f.confidence).toBeCloseTo(0.8);
  });

  it('ignores glances shorter than the minimum duration', () => {
    const d = new FixationDetector();
    d.push(sample(0, 100, 100));
    d.push(sample(33, 102, 100));
    expect(d.push(sample(66, 700, 100))).toBeNull();
  });

  it('ends a fixation on a long gap of invalid samples, without bridging it', () => {
    const d = new FixationDetector();
    for (let i = 0; i < 8; i++) d.push(sample(i * 33, 400, 400));
    expect(d.push(sample(8 * 33, 0, 0, false))).toBeNull(); // short gap: keep waiting
    const f = d.push(sample(8 * 33 + 200, 0, 0, false))!;
    expect(f.end).toBe(7 * 33);
    // Samples after the gap start a new fixation.
    for (let i = 0; i < 6; i++) d.push(sample(1000 + i * 33, 400, 400));
    expect(d.flush()!.start).toBe(1000);
  });

  it('tolerates a single dropped frame inside a fixation', () => {
    const d = new FixationDetector();
    for (let i = 0; i < 5; i++) d.push(sample(i * 33, 400, 400));
    d.push(sample(5 * 33, 0, 0, false));
    for (let i = 6; i < 11; i++) d.push(sample(i * 33, 402, 401));
    expect(d.flush()!.samples).toBe(10);
  });

  it('flushes nothing when empty', () => {
    expect(new FixationDetector().flush()).toBeNull();
  });
});

/** Turns a reading plan into fixations with measurement error, as the gaze layer would deliver them. */
function fixationsFor(layout: TextLayout, profile: ReaderProfile, seed: number, noise: { x: number; y: number }, offsetY = 0) {
  const rng = createRng(seed);
  const plan = planReading(layout, profile, rng, { from: 0, to: layout.words.length - 1 }, 0, 600_000);
  return plan.map((g) => ({
    truth: g,
    fix: {
      start: g.t,
      end: g.t + g.duration,
      duration: g.duration,
      x: g.point.x + rng.gauss() * noise.x,
      y: g.point.y + rng.gauss() * noise.y + offsetY,
      confidence: 0.8,
      samples: 10,
    } satisfies Fixation,
  }));
}

const TEXT = parseText(Array.from({ length: 64 }, (_, i) => `w${i}`).join(' '));
const PRECISION = { errorXPx: 45, errorYPx: 80 };

describe.each<[string, Direction]>([
  ['French, left to right', 'ltr'],
  ['Arabic, right to left', 'rtl'],
])('ReadingMapper — %s', (_name, direction) => {
  const layout = gridLayout(TEXT, { direction, wordsPerLine: 8 });

  it('keeps track of the line although vertical gaze error exceeds the line spacing', () => {
    // Vertical noise of 45 px against a 64 px line pitch: nearest-line would fail constantly.
    const mapper = new ReadingMapper(layout, PRECISION);
    const run = fixationsFor(layout, STEADY_READER, 5, { x: 25, y: 45 });
    let correct = 0;
    for (const { truth, fix } of run) {
      if (mapper.map(fix).line === layout.words[truth.word]!.line) correct++;
    }
    expect(correct / run.length).toBeGreaterThan(0.9);

    // Baseline for comparison: assigning each fixation to the nearest line by y alone.
    const nearest = run.filter(({ truth, fix }) => {
      const best = layout.lines.reduce((a, b) => (Math.abs(b.centerY - fix.y) < Math.abs(a.centerY - fix.y) ? b : a));
      return best.index === layout.words[truth.word]!.line;
    }).length;
    expect(correct).toBeGreaterThan(nearest);
  });

  it('recognises the return sweep as a line change', () => {
    const mapper = new ReadingMapper(layout, PRECISION);
    const at = (word: number): Fixation => {
      const w = layout.words[word]!;
      return { start: 0, end: 300, duration: 300, x: (w.left + w.right) / 2, y: (w.top + w.bottom) / 2, confidence: 0.8, samples: 9 };
    };
    for (let w = 0; w <= 7; w++) mapper.map(at(w));
    // Jump to the start of the next line, but with a vertical reading that still points at line 0.
    const sweep = mapper.map({ ...at(8), y: layout.lines[0]!.centerY + 10 });
    expect(sweep.kind).toBe('line-advance');
    expect(sweep.line).toBe(1);
    expect(sweep.word).toBe(8);
  });

  it('distinguishes forward reading, re-fixation and regression by word order', () => {
    const mapper = new ReadingMapper(layout, PRECISION);
    const at = (word: number): Fixation => {
      const w = layout.words[word]!;
      return { start: 0, end: 300, duration: 300, x: (w.left + w.right) / 2, y: (w.top + w.bottom) / 2, confidence: 0.8, samples: 9 };
    };
    expect(mapper.map(at(0)).kind).toBe('first');
    expect(mapper.map(at(1)).kind).toBe('forward');
    expect(mapper.map(at(3)).kind).toBe('forward');
    expect(mapper.map(at(3)).kind).toBe('refixation');
    expect(mapper.map(at(5)).kind).toBe('forward');
    // Three words back: beyond the precision tolerance, so it is a regression in both scripts.
    expect(mapper.map(at(2)).kind).toBe('regression');
    expect(mapper.currentWord).toBe(2);
  });

  it('absorbs a constant vertical offset of about one line', () => {
    const mapper = new ReadingMapper(layout, PRECISION);
    const run = fixationsFor(layout, STEADY_READER, 6, { x: 20, y: 15 }, 60);
    let correct = 0;
    for (const { truth, fix } of run) if (mapper.map(fix).line === layout.words[truth.word]!.line) correct++;
    expect(correct / run.length).toBeGreaterThan(0.8);
    expect(mapper.verticalOffsetPitches).toBeCloseTo(60 / 64, 0);
    expect(mapper.isDrifting).toBe(false);
  });

  it('reports drift when the offset grows beyond what it can absorb', () => {
    const mapper = new ReadingMapper(layout, PRECISION);
    for (const { fix } of fixationsFor(layout, STEADY_READER, 6, { x: 20, y: 15 }, 110)) mapper.map(fix);
    expect(mapper.isDrifting).toBe(true);
    mapper.resetOffset();
    expect(mapper.isDrifting).toBe(false);
  });
});

describe('ReadingMapper — scope and reflow', () => {
  const two = parseText(`${Array.from({ length: 16 }, (_, i) => `a${i}`).join(' ')}\n\n${Array.from({ length: 16 }, (_, i) => `b${i}`).join(' ')}`);
  const layout = gridLayout(two, { direction: 'ltr', wordsPerLine: 8 });
  const fixAt = (x: number, y: number): Fixation => ({ start: 0, end: 300, duration: 300, x, y, confidence: 0.8, samples: 9 });
  const centre = (l: TextLayout, word: number) => {
    const w = l.words[word]!;
    return fixAt((w.left + w.right) / 2, (w.top + w.bottom) / 2);
  };

  it('classifies gaze away from the active paragraph as off-text, with the side', () => {
    const mapper = new ReadingMapper(layout, { errorXPx: 40, errorYPx: 40 });
    mapper.setActiveParagraph(0);
    expect(mapper.map(fixAt(600, layout.bounds.top - 400))).toMatchObject({ kind: 'off-text', side: 'above', line: -1 });
    expect(mapper.map(fixAt(600, layout.bounds.bottom + 400))).toMatchObject({ kind: 'off-text', side: 'below' });
    expect(mapper.map(fixAt(layout.bounds.right + 500, layout.lines[0]!.centerY))).toMatchObject({ kind: 'off-text', side: 'beside' });
  });

  it('only maps onto the active paragraph', () => {
    const mapper = new ReadingMapper(layout, { errorXPx: 40, errorYPx: 40 });
    mapper.setActiveParagraph(1);
    const f = mapper.map(centre(layout, 20));
    expect(f.paragraph).toBe(1);
    expect(f.word).toBe(20);
    // A fixation just above the paragraph is snapped to its first line, never to paragraph 0.
    const near = mapper.map(fixAt(layout.words[16]!.left + 10, layout.lines[2]!.top - 20));
    expect(near.paragraph).toBe(1);
  });

  it('keeps the reading position when the text reflows', () => {
    const mapper = new ReadingMapper(layout, { errorXPx: 40, errorYPx: 40 });
    for (const w of [0, 1, 2, 3, 4, 5]) mapper.map(centre(layout, w));
    // Larger text: 5 words per line instead of 8, bigger line pitch.
    const reflowed = gridLayout(two, { direction: 'ltr', wordsPerLine: 5, wordWidth: 130, linePitch: 90 });
    mapper.setLayout(reflowed);
    expect(mapper.currentWord).toBe(5);
    const next = mapper.map(centre(reflowed, 6));
    expect(next.kind).toBe('forward'); // word 5 and 6 are both on the new line 1
    expect(next.line).toBe(reflowed.words[6]!.line);
  });

  it('handles an empty layout without throwing', () => {
    const mapper = new ReadingMapper(gridLayout(parseText(''), { direction: 'ltr', wordsPerLine: 8 }), { errorXPx: 40, errorYPx: 40 });
    expect(mapper.map(fixAt(10, 10)).kind).toBe('off-text');
  });
});

describe('ReadingAnalyzer', () => {
  const layout = gridLayout(TEXT, { direction: 'ltr', wordsPerLine: 8 });

  function analyse(profile: ReaderProfile, seed: number) {
    const mapper = new ReadingMapper(layout, PRECISION);
    const analyzer = new ReadingAnalyzer(TEXT.sentenceOf);
    const mapped: ReadingFixation[] = [];
    let end = 0;
    for (const { fix } of fixationsFor(layout, profile, seed, { x: 15, y: 15 })) {
      if (fix.end > 30_000) break;
      for (let t = fix.start; t < fix.end; t += 33) analyzer.noteSample(t, true);
      const m = mapper.map(fix);
      analyzer.addFixation(m);
      mapped.push(m);
      end = fix.end;
    }
    return { analyzer, window: analyzer.window(end), mapped };
  }

  it('measures steady reading', () => {
    const { window, analyzer } = analyse(STEADY_READER, 21);
    expect(window.validRatio).toBe(1);
    expect(window.fixationCount).toBeGreaterThan(40);
    expect(window.medianFixationMs).toBeGreaterThan(250);
    expect(window.medianFixationMs).toBeLessThan(420);
    expect(window.regressionRate).toBeLessThan(0.15);
    expect(window.wordsPerMinute).toBeGreaterThan(100);
    expect(window.lineInstability).toBeLessThan(0.2);
    expect(window.offTextRatio).toBe(0);
    expect(analyzer.frontierWord).toBeGreaterThan(40);
  });

  it('measures effortful reading as slower, with more regressions and pauses', () => {
    const steady = analyse(STEADY_READER, 22).window;
    const effort = analyse(EFFORTFUL_READER, 22).window;
    expect(effort.medianFixationMs).toBeGreaterThan(steady.medianFixationMs * 1.6);
    expect(effort.regressionRate).toBeGreaterThan(0.25);
    expect(effort.wordsPerMinute).toBeLessThan(steady.wordsPerMinute * 0.5);
    expect(effort.longPauses).toBeGreaterThan(0);
  });

  it('accumulates per-sentence effort for the teacher view', () => {
    const text = parseText('un deux trois quatre. cinq six sept huit. neuf dix onze douze.');
    const l = gridLayout(text, { direction: 'ltr', wordsPerLine: 12 });
    const mapper = new ReadingMapper(l, { errorXPx: 20, errorYPx: 20 });
    const analyzer = new ReadingAnalyzer(text.sentenceOf);
    const look = (word: number, t: number, duration: number) => {
      const w = l.words[word]!;
      analyzer.addFixation(mapper.map({ start: t, end: t + duration, duration, x: (w.left + w.right) / 2, y: (w.top + w.bottom) / 2, confidence: 0.8, samples: 9 }));
    };
    let t = 0;
    for (const w of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) look(w, (t += 400), 300);
    look(4, (t += 400), 900); // comes back into sentence 1 and lingers
    look(5, (t += 1000), 600);
    const s = analyzer.sentences();
    expect(s.map((x) => x.sentence)).toEqual([0, 1, 2]);
    expect(s[1]!.regressionsIn).toBe(1);
    expect(s[1]!.dwellMs).toBe(4 * 300 + 900 + 600);
    expect(s[1]!.dwellMs).toBeGreaterThan(s[0]!.dwellMs);
    expect(analyzer.sessionTotals()).toMatchObject({ fixations: 12, regressions: 1 });
  });

  it('tracks stagnation, off-text time and the share of valid samples', () => {
    const analyzer = new ReadingAnalyzer(TEXT.sentenceOf);
    const mapper = new ReadingMapper(layout, PRECISION);
    const w0 = layout.words[0]!;
    analyzer.addFixation(mapper.map({ start: 0, end: 300, duration: 300, x: w0.left + 20, y: w0.top + 10, confidence: 0.8, samples: 9 }));
    analyzer.addFixation(mapper.map({ start: 400, end: 1000, duration: 600, x: 5000, y: 5000, confidence: 0.8, samples: 9 }));
    for (let t = 0; t < 10_000; t += 100) analyzer.noteSample(t, t < 4000);
    const w = analyzer.window(10_000);
    expect(w.stagnationMs).toBe(10_000 - 300);
    expect(w.offTextRatio).toBeCloseTo(600 / 900);
    expect(w.validRatio).toBeCloseTo(0.4);
    analyzer.touch(10_000);
    expect(analyzer.window(10_500).stagnationMs).toBe(500);
  });

  it('forgets what is older than the window', () => {
    const { analyzer } = analyse(STEADY_READER, 23);
    const later = analyzer.window(200_000);
    expect(later.fixationCount).toBe(0);
    expect(later.validRatio).toBe(0);
    expect(analyzer.sessionTotals().fixations).toBeGreaterThan(0); // session totals are kept
  });
});
