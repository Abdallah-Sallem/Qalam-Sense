/**
 * Geometric model of the rendered text: where every word and line is.
 *
 * Coordinates are document coordinates (viewport + scroll offset), so the
 * model survives scrolling. It must be rebuilt whenever the text reflows
 * (font, spacing or width change, window resize).
 */
import { median } from '@/lib/math';
import type { Direction } from './text';

export interface WordRect {
  /** Word index in reading order. */
  index: number;
  paragraph: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface WordBox extends WordRect {
  line: number;
}

export interface LineBox {
  index: number;
  paragraph: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerY: number;
  firstWord: number;
  lastWord: number;
}

export interface TextLayout {
  direction: Direction;
  words: WordBox[];
  lines: LineBox[];
  /** Typical distance between consecutive line centres, px. */
  linePitch: number;
  meanWordWidth: number;
  bounds: { left: number; top: number; right: number; bottom: number };
}

/**
 * Groups word rectangles (given in reading order) into visual lines.
 * `words` is indexed by word index, so words[i] is always word i.
 * A word starts a new line when it belongs to another paragraph or when its
 * vertical centre leaves the current line's band. Grouping follows the
 * logical order, so bidirectional lines (French inside Arabic) stay intact.
 */
export function buildLayout(rects: readonly WordRect[], direction: Direction): TextLayout {
  const sorted = [...rects].sort((a, b) => a.index - b.index);
  const words: WordBox[] = [];
  const lines: LineBox[] = [];
  let line: LineBox | null = null;

  for (const r of sorted) {
    const cy = (r.top + r.bottom) / 2;
    const h = r.bottom - r.top;
    const sameLine = line !== null && line.paragraph === r.paragraph && Math.abs(cy - line.centerY) < Math.max(h, line.bottom - line.top) * 0.5;
    if (!sameLine || line === null) {
      line = {
        index: lines.length,
        paragraph: r.paragraph,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        centerY: cy,
        firstWord: r.index,
        lastWord: r.index,
      };
      lines.push(line);
    } else {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
      line.centerY = (line.top + line.bottom) / 2;
      line.lastWord = r.index;
    }
    words[r.index] = { ...r, line: line.index };
  }

  const pitches: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.paragraph === lines[i - 1]!.paragraph) pitches.push(lines[i]!.centerY - lines[i - 1]!.centerY);
  }
  const heights = lines.map((l) => l.bottom - l.top);
  const linePitch = pitches.length ? median(pitches) : heights.length ? median(heights) * 1.5 : 0;

  return {
    direction,
    words,
    lines,
    linePitch,
    meanWordWidth: sorted.length ? sorted.reduce((s, w) => s + (w.right - w.left), 0) / sorted.length : 0,
    bounds: {
      left: Math.min(...lines.map((l) => l.left), Infinity),
      right: Math.max(...lines.map((l) => l.right), -Infinity),
      top: Math.min(...lines.map((l) => l.top), Infinity),
      bottom: Math.max(...lines.map((l) => l.bottom), -Infinity),
    },
  };
}

/**
 * Position along a line in reading direction: 0 at the start of the line,
 * 1 at its end. For RTL lines the start is the right edge.
 */
export function lineProgress(line: LineBox, x: number, direction: Direction): number {
  const width = Math.max(line.right - line.left, 1);
  const p = direction === 'rtl' ? (line.right - x) / width : (x - line.left) / width;
  return Math.min(1, Math.max(0, p));
}

/** Word of the line that is horizontally closest to x. */
export function nearestWord(layout: TextLayout, line: LineBox, x: number): WordBox {
  let best = layout.words[line.firstWord]!;
  let bestDist = Infinity;
  for (let i = line.firstWord; i <= line.lastWord; i++) {
    const w = layout.words[i];
    if (!w) continue;
    const d = x < w.left ? w.left - x : x > w.right ? x - w.right : 0;
    const tie = Math.abs(x - (w.left + w.right) / 2) * 1e-6; // prefer the nearer centre on ties
    if (d + tie < bestDist) {
      bestDist = d + tie;
      best = w;
    }
  }
  return best;
}

/**
 * Measures the rendered words of a reading container.
 * Every word must be an element carrying data-w (word index) and data-p (paragraph).
 */
export function measureLayout(container: HTMLElement, direction: Direction): TextLayout {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const rects: WordRect[] = [];
  for (const el of container.querySelectorAll<HTMLElement>('[data-w]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    rects.push({
      index: Number(el.dataset.w),
      paragraph: Number(el.dataset.p),
      left: r.left + sx,
      right: r.right + sx,
      top: r.top + sy,
      bottom: r.bottom + sy,
    });
  }
  return buildLayout(rects, direction);
}
