/**
 * Performance budgets for everything that runs after landmark extraction.
 * MediaPipe inference itself depends on the device GPU and is measured in
 * the browser (diagnostics page, and e2e/performance.spec.ts).
 *
 * Budgets are generous (CI machines vary); the measured numbers are printed
 * and recorded in docs/TESTING.md.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/adaptation/types';
import { median } from '@/lib/math';
import { createRng } from '@/lib/random';
import { parseText } from '@/reading/text';
import { ReadingPipeline } from '@/session/pipeline';
import { gridLayout, runSyntheticCalibration } from '@/testing/harness';
import { observeGaze } from '@/testing/syntheticEye';
import { extractObservation } from '@/vision/faceGeometry';
import type { Landmark } from '@/vision/types';

const VIEWPORT = { width: 1366, height: 768 };

function time(runs: number, fn: (i: number) => void): { medianUs: number; p95Us: number } {
  for (let i = 0; i < Math.min(200, runs); i++) fn(i); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn(i);
    samples.push((performance.now() - t0) * 1000);
  }
  samples.sort((a, b) => a - b);
  return { medianUs: median(samples), p95Us: samples[Math.floor(samples.length * 0.95)]! };
}

describe('per-frame cost (one frame every 33 ms at 30 fps)', () => {
  it('landmarks → face observation', () => {
    const rng = createRng(2);
    const landmarks: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.4 + rng.next() * 0.2, y: 0.4 + rng.next() * 0.2 }));
    const r = time(5000, (i) => extractObservation(landmarks, 4 / 3, i));
    console.log(`[perf] geometry: median ${r.medianUs.toFixed(1)} µs, p95 ${r.p95Us.toFixed(1)} µs`);
    expect(r.p95Us).toBeLessThan(500);
  });

  it('observation → gaze → fixation → line/word → assessment → decision', () => {
    const { result } = runSyntheticCalibration(VIEWPORT, createRng(1));
    if (!result.ok) throw new Error('calibration failed');
    const parsed = parseText(Array.from({ length: 30 }, (_, p) => Array.from({ length: 60 }, (_, i) => `w${p}_${i}`).join(' ')).join('\n\n'));
    const layout = gridLayout(parsed, { direction: 'ltr', wordsPerLine: 10 });
    const pipeline = new ReadingPipeline({
      parsed,
      lang: 'fr',
      textDifficulty: 'moyen',
      settings: DEFAULT_SETTINGS,
      maxDurationMs: 900_000,
      storedBaseline: null,
      layout,
      gaze: { model: result.model, quality: result.quality, viewport: VIEWPORT },
    });
    pipeline.start(0);
    const rng = createRng(3);
    const r = time(9000, (i) => {
      const t = i * 33;
      const w = layout.words[Math.floor(t / 300) % layout.words.length]!;
      pipeline.onObservation(t, observeGaze({ x: (w.left + w.right) / 2, y: (w.top + w.bottom) / 2 - 200 }, VIEWPORT, t, rng), { x: 0, y: 200 });
    });
    console.log(`[perf] full frame (incl. synthetic eye): median ${r.medianUs.toFixed(1)} µs, p95 ${r.p95Us.toFixed(1)} µs`);
    // Must be a tiny fraction of the 33 ms frame budget, leaving it to inference and rendering.
    expect(r.p95Us).toBeLessThan(2000);
  });

  it('calibration fit and hold-out validation', () => {
    const t0 = performance.now();
    const { result } = runSyntheticCalibration(VIEWPORT, createRng(4));
    const ms = performance.now() - t0;
    console.log(`[perf] calibration (≈900 frames + fit): ${ms.toFixed(0)} ms total`);
    expect(result.ok).toBe(true);
    expect(ms).toBeLessThan(3000);
  });

  it('parsing a 5000-word text', () => {
    const text = Array.from({ length: 100 }, (_, p) => Array.from({ length: 50 }, (_, i) => `mot${p}x${i}`).join(' ')).join('\n\n');
    const r = time(50, () => parseText(text));
    console.log(`[perf] parse 5000 words: median ${(r.medianUs / 1000).toFixed(2)} ms`);
    expect(r.medianUs).toBeLessThan(50_000);
  });
});
