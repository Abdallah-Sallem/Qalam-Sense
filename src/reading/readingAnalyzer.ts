/**
 * Accumulates mapped fixations into (a) a sliding window of reading-behaviour
 * measurements for the difficulty engine and (b) per-sentence totals that tell
 * a teacher which passages took the most effort.
 *
 * Nothing here interprets the numbers: this is measurement only.
 */
import { mean, median, std } from '@/lib/math';
import type { ReadingFixation } from './readingMapper';

export interface WindowFeatures {
  windowMs: number;
  /** Share of gaze samples in the window that were valid observations. */
  validRatio: number;
  /** Fixations on the text. */
  fixationCount: number;
  medianFixationMs: number;
  meanFixationMs: number;
  /** Coefficient of variation of fixation durations. */
  fixationCv: number;
  /** Backward moves (within a line or to an earlier line) per on-text fixation. */
  regressionRate: number;
  /** New words reached in the window. */
  wordsAdvanced: number;
  wordsPerMinute: number;
  /** Time since the reading frontier last moved forward, ms. */
  stagnationMs: number;
  lineTransitions: number;
  /** Share of line changes that went backwards or skipped a line. */
  lineInstability: number;
  /** Fixations much longer than the reader's own typical fixation. */
  longPauses: number;
  /** Share of fixation time spent off the text. */
  offTextRatio: number;
  meanConfidence: number;
}

export interface SentenceStats {
  sentence: number;
  dwellMs: number;
  fixations: number;
  /** Times the reader came back into this sentence from further ahead. */
  regressionsIn: number;
}

interface Entry {
  t: number;
  duration: number;
  kind: ReadingFixation['kind'];
  confidence: number;
  advanced: number;
}

export const ANALYZER_CONFIG = {
  windowMs: 30_000,
  /** A fixation is a "long pause" when it exceeds both of these. */
  longPauseMinMs: 900,
  longPauseFactor: 3,
};

export class ReadingAnalyzer {
  private entries: Entry[] = [];
  private samples: { t: number; valid: boolean }[] = [];
  private frontier = -1;
  private frontierAt: number | null = null;
  private sentenceStats = new Map<number, SentenceStats>();
  private totals = { fixations: 0, regressions: 0, onTextMs: 0 };

  constructor(
    /** Sentence index of every word, from parseText(). */
    private readonly sentenceOf: readonly number[],
    private readonly config = ANALYZER_CONFIG,
  ) {}

  /** Highest word index reached so far, -1 before any reading. */
  get frontierWord(): number {
    return this.frontier;
  }

  noteSample(t: number, valid: boolean): void {
    this.samples.push({ t, valid });
    if (this.samples.length > 4000) this.trim(t);
  }

  /** Restarts the "no progress" clock, e.g. after a pause. */
  touch(t: number): void {
    if (this.frontierAt !== null) this.frontierAt = t;
  }

  /** The reader moved to another paragraph by hand: progress restarts from there. */
  notePosition(t: number, firstWordOfParagraph: number): void {
    this.frontier = Math.max(this.frontier, firstWordOfParagraph - 1);
    this.frontierAt = t;
  }

  addFixation(f: ReadingFixation): void {
    let advanced = 0;
    if (f.kind !== 'off-text') {
      this.frontierAt ??= f.start;
      if (f.word > this.frontier) {
        // Count at most a line's worth: a jump further than that is a skip, not reading.
        advanced = this.frontier < 0 ? 1 : Math.min(f.word - this.frontier, 12);
        this.frontier = f.word;
        this.frontierAt = f.end;
      }
      const s = this.sentenceOf[f.word];
      if (s !== undefined) {
        const st = this.sentenceStats.get(s) ?? { sentence: s, dwellMs: 0, fixations: 0, regressionsIn: 0 };
        st.dwellMs += f.duration;
        st.fixations++;
        if (f.kind === 'regression' || f.kind === 'line-back') st.regressionsIn++;
        this.sentenceStats.set(s, st);
      }
      this.totals.fixations++;
      this.totals.onTextMs += f.duration;
      if (f.kind === 'regression' || f.kind === 'line-back') this.totals.regressions++;
    }
    this.entries.push({ t: f.end, duration: f.duration, kind: f.kind, confidence: f.confidence, advanced });
  }

  private trim(now: number): void {
    const from = now - this.config.windowMs;
    while (this.entries.length && this.entries[0]!.t < from) this.entries.shift();
    while (this.samples.length && this.samples[0]!.t < from) this.samples.shift();
  }

  window(now: number): WindowFeatures {
    this.trim(now);
    const on = this.entries.filter((e) => e.kind !== 'off-text');
    const durations = on.map((e) => e.duration);
    const med = median(durations);
    const m = mean(durations);
    const regressions = on.filter((e) => e.kind === 'regression' || e.kind === 'line-back').length;
    const transitions = on.filter((e) => e.kind === 'line-advance' || e.kind === 'line-back' || e.kind === 'line-skip').length;
    const unstable = on.filter((e) => e.kind === 'line-back' || e.kind === 'line-skip').length;
    const offMs = this.entries.filter((e) => e.kind === 'off-text').reduce((s, e) => s + e.duration, 0);
    const onMs = durations.reduce((s, d) => s + d, 0);
    const wordsAdvanced = on.reduce((s, e) => s + e.advanced, 0);
    const span = this.samples.length ? Math.min(this.config.windowMs, now - this.samples[0]!.t) : 0;
    const longLimit = Math.max(this.config.longPauseMinMs, this.config.longPauseFactor * med);

    return {
      windowMs: span,
      validRatio: this.samples.length ? this.samples.filter((s) => s.valid).length / this.samples.length : 0,
      fixationCount: on.length,
      medianFixationMs: med,
      meanFixationMs: m,
      fixationCv: m > 0 ? std(durations) / m : 0,
      regressionRate: on.length ? regressions / on.length : 0,
      wordsAdvanced,
      wordsPerMinute: span > 0 ? (wordsAdvanced * 60_000) / span : 0,
      stagnationMs: this.frontierAt === null ? 0 : Math.max(0, now - this.frontierAt),
      lineTransitions: transitions,
      lineInstability: transitions ? unstable / transitions : 0,
      longPauses: on.filter((e) => e.duration >= longLimit).length,
      offTextRatio: onMs + offMs > 0 ? offMs / (onMs + offMs) : 0,
      meanConfidence: mean(this.entries.map((e) => e.confidence)),
    };
  }

  /** Per-sentence totals for the whole session, in text order. */
  sentences(): SentenceStats[] {
    return [...this.sentenceStats.values()].sort((a, b) => a.sentence - b.sentence);
  }

  sessionTotals(): { fixations: number; regressions: number; onTextMs: number } {
    return { ...this.totals };
  }
}
