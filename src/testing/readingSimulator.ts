/**
 * TEST INSTRUMENT — scripted "reader" that looks at the words of a layout.
 *
 * Produces a sequence of gaze targets (where the simulated eye is aimed at
 * each instant). Two profiles are provided: a steady reader, and a reader
 * showing the behaviours the difficulty engine looks for (long fixations,
 * re-reading, losing the line). The profiles are test fixtures, not models
 * of any real child.
 */
import type { Rng } from '@/lib/random';
import type { TextLayout } from '@/reading/layout';
import type { Point } from '@/vision/types';

export interface ReaderProfile {
  /** Mean and spread of fixation duration, ms. */
  fixationMs: number;
  fixationJitter: number;
  /** Words advanced per fixation (1 = every word). */
  stride: number;
  /** Probability of jumping back a few words after a fixation. */
  regressionProb: number;
  /** Probability of landing on the wrong line after a line change. */
  lineSlipProb: number;
  /** Probability of a long pause on a word. */
  pauseProb: number;
  pauseMs: number;
}

export const STEADY_READER: ReaderProfile = {
  fixationMs: 330,
  fixationJitter: 50,
  stride: 1,
  regressionProb: 0.06,
  lineSlipProb: 0,
  pauseProb: 0,
  pauseMs: 0,
};

export const EFFORTFUL_READER: ReaderProfile = {
  fixationMs: 760,
  fixationJitter: 220,
  stride: 1,
  regressionProb: 0.42,
  lineSlipProb: 0.35,
  pauseProb: 0.12,
  pauseMs: 1900,
};

export interface GazeTarget {
  /** Start time and duration of the fixation, ms. */
  t: number;
  duration: number;
  word: number;
  point: Point;
}

/**
 * Plans fixations over words [from, to] of the layout, starting at time t0,
 * and stops when `untilMs` is reached or the last word has been read.
 */
export function planReading(
  layout: TextLayout,
  profile: ReaderProfile,
  rng: Rng,
  range: { from: number; to: number },
  t0: number,
  untilMs: number,
): GazeTarget[] {
  const out: GazeTarget[] = [];
  let t = t0;
  let word = range.from;
  let frontier = range.from;
  const saccadeMs = 40;

  const aim = (w: number, lineOverride?: number): Point => {
    const box = layout.words[w]!;
    const line = layout.lines[lineOverride ?? box.line]!;
    return { x: (box.left + box.right) / 2, y: line.centerY };
  };

  while (t < untilMs && frontier <= range.to) {
    let duration = Math.max(120, profile.fixationMs + rng.gauss() * profile.fixationJitter);
    if (rng.next() < profile.pauseProb) duration += profile.pauseMs;

    const box = layout.words[word]!;
    const prev = out[out.length - 1];
    const changedLine = prev !== undefined && layout.words[prev.word]!.line !== box.line;
    let lineOverride: number | undefined;
    if (changedLine && rng.next() < profile.lineSlipProb) {
      // Lands one line too low or too high, then has to find the line again.
      const slip = box.line + (rng.next() < 0.5 ? 1 : -1);
      if (layout.lines[slip] && layout.lines[slip]!.paragraph === box.paragraph) lineOverride = slip;
    }
    out.push({ t, duration, word, point: aim(word, lineOverride) });
    t += duration + saccadeMs;

    if (rng.next() < profile.regressionProb && word - range.from >= 3) {
      word -= 2 + Math.floor(rng.next() * 3);
      word = Math.max(range.from, word);
    } else {
      word = Math.max(word, frontier) + profile.stride;
      frontier = word;
    }
    if (word > range.to) break;
  }
  return out;
}

/** Where the simulated reader is looking at time t (null between plans). */
export function targetAt(plan: readonly GazeTarget[], t: number): GazeTarget | null {
  // Plans are short; a linear scan from the end is plenty.
  for (let i = plan.length - 1; i >= 0; i--) {
    const g = plan[i]!;
    if (t >= g.t) return g;
  }
  return null;
}
