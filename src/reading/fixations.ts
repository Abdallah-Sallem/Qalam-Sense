/**
 * Streaming dispersion-threshold fixation detection (I-DT, Salvucci & Goldberg 2000).
 *
 * A fixation is a run of valid gaze samples that stays inside a small
 * bounding box for long enough. Invalid samples never join a fixation, and a
 * long enough gap of them ends it: we do not interpolate over missing data.
 */
import type { GazeSample } from '@/vision/types';

export interface Fixation {
  start: number;
  end: number;
  duration: number;
  /** Centroid, same coordinate space as the samples that were pushed. */
  x: number;
  y: number;
  /** Mean confidence of the contributing samples. */
  confidence: number;
  samples: number;
}

export interface FixationOptions {
  /** Max (width + height) of the bounding box of a fixation, px. */
  dispersionPx: number;
  minDurationMs: number;
  /** A gap of invalid samples longer than this ends the fixation. */
  maxGapMs: number;
}

export const DEFAULT_FIXATION_OPTIONS: FixationOptions = { dispersionPx: 80, minDurationMs: 100, maxGapMs: 120 };

type Pt = Pick<GazeSample, 't' | 'x' | 'y' | 'confidence'>;

export class FixationDetector {
  private window: Pt[] = [];
  private minX = 0;
  private maxX = 0;
  private minY = 0;
  private maxY = 0;
  private options: FixationOptions;

  constructor(options: Partial<FixationOptions> = {}) {
    this.options = { ...DEFAULT_FIXATION_OPTIONS, ...options };
  }

  setDispersion(px: number): void {
    this.options = { ...this.options, dispersionPx: px };
  }

  /** Feed one sample; returns a fixation when one has just ended. */
  push(s: Pick<GazeSample, 't' | 'x' | 'y' | 'confidence' | 'valid'>): Fixation | null {
    if (!s.valid) {
      const last = this.window[this.window.length - 1];
      if (last && s.t - last.t > this.options.maxGapMs) return this.close();
      return null;
    }
    if (this.window.length === 0) {
      this.begin(s);
      return null;
    }
    const last = this.window[this.window.length - 1]!;
    const minX = Math.min(this.minX, s.x);
    const maxX = Math.max(this.maxX, s.x);
    const minY = Math.min(this.minY, s.y);
    const maxY = Math.max(this.maxY, s.y);
    if (s.t - last.t <= this.options.maxGapMs && maxX - minX + (maxY - minY) <= this.options.dispersionPx) {
      this.window.push(s);
      this.minX = minX;
      this.maxX = maxX;
      this.minY = minY;
      this.maxY = maxY;
      return null;
    }
    const done = this.close();
    this.begin(s);
    return done;
  }

  /** Ends the current fixation, e.g. when the session stops. */
  flush(): Fixation | null {
    return this.close();
  }

  private begin(s: Pt): void {
    this.window = [s];
    this.minX = this.maxX = s.x;
    this.minY = this.maxY = s.y;
  }

  private close(): Fixation | null {
    const w = this.window;
    this.window = [];
    if (w.length < 2) return null;
    const start = w[0]!.t;
    const end = w[w.length - 1]!.t;
    if (end - start < this.options.minDurationMs) return null;
    let x = 0;
    let y = 0;
    let c = 0;
    for (const p of w) {
      x += p.x;
      y += p.y;
      c += p.confidence;
    }
    return { start, end, duration: end - start, x: x / w.length, y: y / w.length, confidence: c / w.length, samples: w.length };
  }
}
