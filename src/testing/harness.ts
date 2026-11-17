/**
 * TEST INSTRUMENT — helpers shared by unit, integration and end-to-end tests.
 */
import type { Rng } from '@/lib/random';
import { buildLayout, type TextLayout, type WordRect } from '@/reading/layout';
import type { Direction, ParsedText } from '@/reading/text';
import { CalibrationSession, buildTargets, type CalibrationResult, type CalibrationTarget, type Viewport } from '@/vision/calibration';
import { DEFAULT_EYE, observeGaze, type SyntheticEyeOptions } from './syntheticEye';

export const FRAME_MS = 33;

/** Runs a full calibration with the synthetic eye looking at each target. */
export function runSyntheticCalibration(
  viewport: Viewport,
  rng: Rng,
  eye: SyntheticEyeOptions = DEFAULT_EYE,
  targets: CalibrationTarget[] = buildTargets(9),
  /** Lets a test corrupt individual frames (return null for "no face"). */
  tamper?: (t: number, target: CalibrationTarget) => SyntheticEyeOptions | null,
): { result: CalibrationResult; durationMs: number } {
  const session = new CalibrationSession(viewport, targets);
  let t = 0;
  let target = targets[0]!;
  session.start(t);
  while (!session.finished && t < 180_000) {
    const options = tamper ? tamper(t, target) : eye;
    const observation = options
      ? observeGaze({ x: target.nx * viewport.width, y: target.ny * viewport.height }, viewport, t, rng, options)
      : null;
    const progress = session.update(t, observation);
    target = progress.target ?? target;
    t += FRAME_MS;
  }
  return { result: session.finish(), durationMs: t };
}

export interface GridOptions {
  direction: Direction;
  wordsPerLine: number;
  wordWidth?: number;
  gap?: number;
  wordHeight?: number;
  linePitch?: number;
  left?: number;
  top?: number;
  /** Extra vertical gap between paragraphs. */
  paragraphGap?: number;
}

/**
 * Lays the words of a parsed text out on a regular grid, the way a browser
 * would: left-to-right for French, right-to-left for Arabic.
 */
export function gridLayout(parsed: Pick<ParsedText, 'wordCount' | 'paragraphOf'>, o: GridOptions): TextLayout {
  const wordWidth = o.wordWidth ?? 90;
  const gap = o.gap ?? 16;
  const height = o.wordHeight ?? 30;
  const pitch = o.linePitch ?? 64;
  const left = o.left ?? 220;
  const top = o.top ?? 160;
  const blockWidth = o.wordsPerLine * wordWidth + (o.wordsPerLine - 1) * gap;
  const rects: WordRect[] = [];
  let line = 0;
  let col = 0;
  let extra = 0;
  for (let i = 0; i < parsed.wordCount; i++) {
    const paragraph = parsed.paragraphOf[i]!;
    if (i > 0 && (col === o.wordsPerLine || paragraph !== parsed.paragraphOf[i - 1])) {
      if (paragraph !== parsed.paragraphOf[i - 1]) extra += o.paragraphGap ?? 30;
      line++;
      col = 0;
    }
    const offset = col * (wordWidth + gap);
    const x = o.direction === 'rtl' ? left + blockWidth - offset - wordWidth : left + offset;
    const y = top + line * pitch + extra;
    rects.push({ index: i, paragraph, left: x, right: x + wordWidth, top: y, bottom: y + height });
    col++;
  }
  return buildLayout(rects, o.direction);
}
