/**
 * Reading-aware mapping: fixation → line and word of the text.
 *
 * Webcam gaze is typically wrong by more than one line of text vertically,
 * so "nearest line to the gaze point" would jump around at random. The mapper
 * is instead an online Viterbi filter over "which line is being read":
 *
 *   - emission: how well the vertical gaze estimate fits each line, scaled by
 *     the vertical precision measured during calibration;
 *   - transition: reading order. Staying on a line is free; reaching the next
 *     line requires a jump back along the line (a return sweep); changing
 *     line while moving smoothly forward is implausible; skipping is rare.
 *
 * Every line keeps a running cost, so a wrong choice is not final: if the
 * following fixations keep fitting another line better, that hypothesis
 * overtakes and the position is revised.
 *
 * Direction is handled by lineProgress(): the start of a line is its left
 * edge in French and its right edge in Arabic, so a return sweep is a jump
 * to the left in French and to the right in Arabic.
 *
 * Known limitation: a constant vertical offset of one line pitch cannot be
 * told apart from being one line off. The anchor is the start of a reading
 * run (a paragraph), which is assumed to begin on its first line; the offset
 * is learned quickly there and only slowly afterwards.
 */
import { clamp } from '@/lib/math';
import type { Fixation } from './fixations';
import { lineProgress, nearestWord, type LineBox, type TextLayout } from './layout';

export type MoveKind =
  | 'first'
  | 'forward'
  | 'refixation'
  | 'regression'
  | 'line-advance'
  | 'line-back'
  | 'line-skip'
  | 'off-text';

export interface ReadingFixation extends Fixation {
  /** -1 when the fixation is off the text. */
  line: number;
  word: number;
  paragraph: number;
  kind: MoveKind;
  /** For off-text fixations: where the gaze was relative to the active text block. */
  side?: 'above' | 'below' | 'beside';
}

export interface GazePrecision {
  /** Mean absolute calibration error per axis, px. */
  errorXPx: number;
  errorYPx: number;
}

export const MAPPER_CONFIG = {
  /** A jump against the reading direction of at least this share of the line is a "big jump back". */
  bigJumpBack: 0.5,
  /** A big jump back is a return sweep when it starts beyond this share of the line... */
  sweepFromProgress: 0.75,
  /** ...and lands within this share from the line start. */
  sweepToProgress: 0.3,
  /** Long-run learning rate of the vertical offset (the first fixations of a session learn faster). */
  biasRate: 0.05,
  /** Largest vertical offset (in line pitches) the mapper is willing to absorb. */
  maxBiasPitches: 1.5,
  /** Offset beyond this many line pitches is reported as drift. */
  driftPitches: 1.2,
  /** Vertical standard deviation is never assumed better than this share of the line pitch. */
  minSigmaPitches: 0.35,
  /** Costs are capped so that an old mistake can always be overturned by new evidence. */
  maxCost: 10,
};

/**
 * Transition costs (negative log-likelihoods, in nats). For scale: with a
 * vertical error of one line pitch, a fixation lying one line away from a
 * hypothesis adds 0.5 to that hypothesis' cost.
 */
const COST = {
  stay: 0,
  stayAfterSweep: 1.5,
  nextAfterSweep: 0,
  stayAfterJumpBack: 0.3,
  nextAfterJumpBack: 1.0,
  nextWithoutJump: 3.0,
  backAfterJumpBack: 2.0,
  backWithoutJump: 2.5,
  far: 4.0,
  farStep: 1.0,
  /** Per line below the first one when a reading run starts: reading starts at the top. */
  startBelowTop: 2.0,
};

export class ReadingMapper {
  private word: number | null = null;
  private prevX = 0;
  private costs: number[] | null = null;
  private bias = 0;
  private fixations = 0;
  private activeParagraph: number | null = null;
  private lines: LineBox[];

  constructor(
    private layout: TextLayout,
    private precision: GazePrecision,
    private readonly config = MAPPER_CONFIG,
  ) {
    this.lines = this.candidates();
  }

  /** Call after every reflow. The reading position (a word) carries over. */
  setLayout(layout: TextLayout): void {
    // The vertical offset was learned in the old geometry: rescale it to the new line pitch.
    if (this.layout.linePitch > 0 && layout.linePitch > 0) this.bias *= layout.linePitch / this.layout.linePitch;
    this.layout = layout;
    this.lines = this.candidates();
    const box = this.word === null ? undefined : layout.words[this.word];
    if (!box) {
      this.word = null;
      this.costs = null;
      return;
    }
    // Re-anchor every hypothesis on the line that now holds the current word.
    const at = this.lines.findIndex((l) => l.index === box.line);
    this.costs = at < 0 ? null : this.lines.map((_, i) => Math.min(this.config.maxCost, 3 * Math.abs(i - at)));
    this.prevX = (box.left + box.right) / 2;
  }

  setPrecision(precision: GazePrecision): void {
    this.precision = precision;
  }

  /** Restricts mapping to one paragraph (the one the reader is on). Null = whole text. */
  setActiveParagraph(paragraph: number | null): void {
    if (paragraph === this.activeParagraph) return;
    this.activeParagraph = paragraph;
    this.lines = this.candidates();
    this.word = null; // a new paragraph starts a new reading run, anchored on its first line
    this.costs = null;
  }

  /** Vertical gaze offset currently being compensated, in line pitches. */
  get verticalOffsetPitches(): number {
    return this.layout.linePitch > 0 ? this.bias / this.layout.linePitch : 0;
  }

  get isDrifting(): boolean {
    return Math.abs(this.verticalOffsetPitches) >= this.config.driftPitches;
  }

  get currentWord(): number | null {
    return this.word;
  }

  private candidates(): LineBox[] {
    const { lines } = this.layout;
    return this.activeParagraph === null ? lines : lines.filter((l) => l.paragraph === this.activeParagraph);
  }

  map(fix: Fixation): ReadingFixation {
    const lines = this.lines;
    const off = (side: ReadingFixation['side']): ReadingFixation => ({ ...fix, line: -1, word: -1, paragraph: -1, kind: 'off-text', side });
    if (lines.length === 0) return off('beside');

    const pitch = this.layout.linePitch || lines[0]!.bottom - lines[0]!.top;
    const left = Math.min(...lines.map((l) => l.left));
    const right = Math.max(...lines.map((l) => l.right));
    const mx = Math.max(1.5 * this.precision.errorXPx, 60);
    const my = Math.max(1.5 * this.precision.errorYPx, pitch);
    const y = fix.y - this.bias;
    if (y < lines[0]!.top - my) return off('above');
    if (y > lines[lines.length - 1]!.bottom + my) return off('below');
    if (fix.x < left - mx || fix.x > right + mx) return off('beside');

    const sigma = clamp(this.precision.errorYPx, this.config.minSigmaPitches * pitch, 2 * pitch);
    const emission = (line: LineBox): number => 0.5 * ((y - line.centerY) / sigma) ** 2;

    const prev = this.costs;
    const next = new Array<number>(lines.length);
    const from = new Array<number>(lines.length).fill(-1);
    for (let j = 0; j < lines.length; j++) {
      let best = Infinity;
      if (!prev) {
        best = COST.startBelowTop * j;
      } else {
        for (let i = 0; i < lines.length; i++) {
          const c = prev[i]! + this.transition(lines[i]!, j - i, fix.x);
          if (c < best) {
            best = c;
            from[j] = i;
          }
        }
      }
      next[j] = best + emission(lines[j]!);
    }
    let at = 0;
    for (let j = 1; j < lines.length; j++) if (next[j]! < next[at]!) at = j;
    const floor = next[at]!;
    this.costs = next.map((c) => Math.min(c - floor, this.config.maxCost));

    const line = lines[at]!;
    const w = nearestWord(this.layout, line, fix.x);
    // Classify against the line this hypothesis came from. When the filter has
    // just revised its opinion, that is not the line reported last time.
    const origin = from[at]! >= 0 ? lines[from[at]!]! : null;
    const kind = this.classify(line, w.index, origin);

    this.fixations++;
    const rate = Math.max(this.config.biasRate, 1 / (this.fixations + 1));
    this.bias = clamp(
      this.bias + rate * (fix.y - line.centerY - this.bias),
      -this.config.maxBiasPitches * pitch,
      this.config.maxBiasPitches * pitch,
    );
    this.word = w.index;
    this.prevX = fix.x;
    return { ...fix, line: line.index, word: w.index, paragraph: line.paragraph, kind };
  }

  /** Cost of having been on `origin` at the previous fixation and being `d` lines further now. */
  private transition(origin: LineBox, d: number, x: number): number {
    const dir = this.layout.direction;
    const before = lineProgress(origin, this.prevX, dir);
    const landing = lineProgress(origin, x, dir);
    const jumpBack = before - landing >= this.config.bigJumpBack;
    const sweep = jumpBack && before >= this.config.sweepFromProgress && landing <= this.config.sweepToProgress;
    if (d === 0) return sweep ? COST.stayAfterSweep : jumpBack ? COST.stayAfterJumpBack : COST.stay;
    if (d === 1) return sweep ? COST.nextAfterSweep : jumpBack ? COST.nextAfterJumpBack : COST.nextWithoutJump;
    if (d === -1) return jumpBack ? COST.backAfterJumpBack : COST.backWithoutJump;
    return COST.far + COST.farStep * (Math.abs(d) - 2);
  }

  private classify(line: LineBox, word: number, origin: LineBox | null): MoveKind {
    if (!origin) return 'first';
    const d = line.index - origin.index;
    if (d === 1) return 'line-advance';
    if (d > 1) return 'line-skip';
    if (d < 0) return 'line-back';
    const previousWord = nearestWord(this.layout, origin, this.prevX).index;
    const delta = word - previousWord;
    if (delta > 0) return 'forward';
    // Backward moves smaller than the horizontal precision are indistinguishable from noise.
    const tolerance = Math.max(1, Math.round(this.precision.errorXPx / Math.max(this.layout.meanWordWidth, 1)));
    return delta < -tolerance ? 'regression' : 'refixation';
  }

  /** Forget the learned vertical offset (after recalibration) but keep the reading position. */
  resetOffset(): void {
    this.bias = 0;
    this.fixations = 0;
  }

  reset(): void {
    this.word = null;
    this.costs = null;
    this.bias = 0;
    this.fixations = 0;
  }
}
