/**
 * TEST INSTRUMENT — an observation source that needs no webcam.
 *
 * Only reachable when the app is built with VITE_ENABLE_TEST_HOOKS=true AND a
 * test explicitly selects it; the app then shows a permanent "test mode"
 * banner. It is never a fallback: if the real camera fails, the app says so.
 *
 * The simulated eye looks at the calibration target when one is on screen,
 * and otherwise reads the active paragraph of the reader word by word, in
 * real time. Everything downstream (calibration, gaze model, fixations,
 * reading analysis, difficulty, adaptation) is the production code.
 */
import { createRng } from '@/lib/random';
import { measureLayout } from '@/reading/layout';
import type { FrameListener, ObservationSource, Point } from '@/vision/types';
import { EFFORTFUL_READER, STEADY_READER, planReading, targetAt, type GazeTarget, type ReaderProfile } from './readingSimulator';
import { observeGaze } from './syntheticEye';

export interface SyntheticControls {
  profile: 'steady' | 'effortful';
  /** False simulates nobody in front of the camera. */
  faceVisible: boolean;
  /** Iris noise in eye widths. */
  noise: number;
  /** Press "next" after finishing a paragraph, as a reader would (never "finish"). */
  autoAdvance: boolean;
}

export const syntheticControls: SyntheticControls = { profile: 'steady', faceVisible: true, noise: 0.004, autoAdvance: true };

const PROFILES: Record<SyntheticControls['profile'], ReaderProfile> = { steady: STEADY_READER, effortful: EFFORTFUL_READER };

export class SyntheticObservationSource implements ObservationSource {
  readonly kind = 'synthetic' as const;
  readonly stream = null;
  private timer = 0;
  private rng = createRng(2026);
  private plan: GazeTarget[] = [];
  private planKey = '';
  private lastPoint: Point = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  async start(listener: FrameListener): Promise<void> {
    this.timer = window.setInterval(() => {
      const t = performance.now();
      const gaze = this.gazePoint(t);
      const observation = syntheticControls.faceVisible
        ? observeGaze(gaze, { width: window.innerWidth, height: window.innerHeight }, t, this.rng, { noise: syntheticControls.noise })
        : null;
      listener({ t, observation, inferenceMs: 0 });
    }, 33);
  }

  /** Where the simulated reader looks, in viewport coordinates. */
  private gazePoint(t: number): Point {
    const target = document.querySelector<HTMLElement>('[data-gaze-target]');
    if (target) {
      const r = target.getBoundingClientRect();
      return (this.lastPoint = { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
    const article = document.querySelector<HTMLElement>('[data-reader]');
    const active = article?.dataset.activeParagraph;
    if (!article || active === undefined) return this.lastPoint;

    const layout = measureLayout(article, article.dir === 'rtl' ? 'rtl' : 'ltr');
    const words = layout.words.filter((w) => w && w.paragraph === Number(active));
    if (words.length === 0) return this.lastPoint;
    const key = `${active}|${syntheticControls.profile}|${Math.round(layout.linePitch)}|${layout.lines.length}`;
    if (key !== this.planKey) {
      // New paragraph, new profile or reflow: plan the rest of this paragraph afresh.
      const sameParagraph = this.planKey.startsWith(`${active}|`);
      const from = sameParagraph ? (targetAt(this.plan, t)?.word ?? words[0]!.index) : words[0]!.index;
      this.plan = planReading(layout, PROFILES[syntheticControls.profile], this.rng, { from, to: words[words.length - 1]!.index }, t, t + 600_000);
      this.planKey = key;
    }
    const g = targetAt(this.plan, t);
    if (!g) return this.lastPoint;
    const last = this.plan[this.plan.length - 1]!;
    if (syntheticControls.autoAdvance && g === last && t > last.t + last.duration && last.word === words[words.length - 1]!.index) {
      document.querySelector<HTMLButtonElement>('[data-next="next"]')?.click();
    }
    return (this.lastPoint = { x: g.point.x - window.scrollX, y: g.point.y - window.scrollY });
  }

  stop(): void {
    window.clearInterval(this.timer);
  }
}
