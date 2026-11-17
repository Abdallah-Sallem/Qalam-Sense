import { describe, expect, it } from 'vitest';
import { AdaptationController, POLICY } from '@/adaptation/controller';
import { THEMES, contrastRatio, styleFor, styleToCssVars } from '@/adaptation/presets';
import { DEFAULT_SETTINGS, NO_MANUAL, type Level, type StudentSettings } from '@/adaptation/types';
import type { Assessment, SupportDimension } from '@/difficulty/types';

const STEP = 5000;

function assessment(need: number, confidence = 0.9, dominant: SupportDimension | null = 'decoding'): Assessment {
  return {
    status: 'ok',
    t: 0,
    supportNeed: need,
    confidence,
    dominant: need >= 0.3 ? dominant : null,
    dimensions: { decoding: need, lineTracking: 0, attention: 0, fatigue: 0 },
    indicators: [
      { key: 'prolongedFixations', score: need, value: 800, reference: 420 },
      { key: 'frequentRegressions', score: need * 0.8, value: 0.3, reference: 0.18 },
      { key: 'offText', score: 0.05, value: 0.01, reference: 0.25 },
    ],
  };
}

/** Feeds the same assessment every 5 s for a duration; returns the events it caused. */
function run(c: AdaptationController, fromMs: number, seconds: number, a: Assessment) {
  const events = [];
  let t = fromMs;
  for (; t < fromMs + seconds * 1000; t += STEP) {
    const d = c.step(t, a);
    if (d) events.push(d.event);
  }
  return { events, t };
}

const controller = (settings: Partial<StudentSettings> = {}, automation = true) =>
  new AdaptationController({ ...DEFAULT_SETTINGS, ...settings }, automation);

describe('AdaptationController', () => {
  it('does nothing while reading is going well', () => {
    const c = controller();
    expect(run(c, 0, 300, assessment(0.1)).events).toEqual([]);
    expect(c.stateAt(300_000).level).toBe(0);
  });

  it('raises support one level at a time, only after sustained need, and records why', () => {
    const c = controller();
    const { events } = run(c, 30_000, 200, assessment(0.9));
    expect(events.map((e) => [e.fromLevel, e.toLevel])).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(events[0]).toMatchObject({ trigger: 'auto', dominant: 'decoding', confidence: 0.9 });
    expect(events[0]!.reasons).toEqual(['prolongedFixations', 'frequentRegressions']);
    // Never faster than the cooldown.
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.atMs - events[i - 1]!.atMs).toBeGreaterThanOrEqual(POLICY.upCooldownMs);
    }
  });

  it('ignores a single noisy spike', () => {
    const c = controller();
    run(c, 0, 60, assessment(0.1));
    expect(c.step(60_000, assessment(0.95))).toBeNull();
    expect(run(c, 65_000, 120, assessment(0.1)).events).toEqual([]);
  });

  it('ignores assessments it cannot trust', () => {
    const c = controller();
    expect(run(c, 0, 300, assessment(0.95, 0.3)).events).toEqual([]);
    expect(run(c, 300_000, 300, { status: 'insufficient-data', t: 0, reason: 'low-tracking' }).events).toEqual([]);
    expect(c.stateAt(600_000).smoothedNeed).toBe(0);
  });

  it('lowers support only after a much longer calm period (hysteresis)', () => {
    const c = controller();
    const up = run(c, 0, 60, assessment(0.5));
    expect(c.stateAt(up.t).level).toBe(1);
    // Need hovering just under the level-1 threshold: not low enough to step down.
    const hover = run(c, up.t, 240, assessment(0.3));
    expect(hover.events).toEqual([]);
    // Clearly low need: steps down, but only after the long streak and cooldown.
    const down = run(c, hover.t, 120, assessment(0.05));
    expect(down.events.map((e) => [e.fromLevel, e.toLevel])).toEqual([[1, 0]]);
    expect(down.events[0]!.atMs - hover.t).toBeGreaterThanOrEqual((POLICY.downStreak - 1) * STEP);
  });

  it('stops changing when the need keeps flipping (anti-oscillation)', () => {
    const c = controller();
    let t = 0;
    const all = [];
    for (let cycle = 0; cycle < 6; cycle++) {
      const hi = run(c, t, 60, assessment(0.6));
      const lo = run(c, hi.t, 90, assessment(0.0));
      all.push(...hi.events, ...lo.events);
      t = lo.t;
    }
    // Up twice, down, up again: the second reversal freezes it on the more supportive level.
    expect(all.map((e) => e.toLevel)).toEqual([1, 2, 1, 2]);
    expect(c.isFrozen).toBe(true);
    expect(c.currentMode(t)).toBe('held');
  });

  it('caps the number of automatic changes per session', () => {
    const c = new AdaptationController(DEFAULT_SETTINGS, true, { ...POLICY, maxAutoChanges: 2, maxReversals: 99 });
    const { events } = run(c, 0, 600, assessment(0.95));
    expect(events).toHaveLength(2);
  });

  it('respects the floor and ceiling set by the teacher', () => {
    const c = controller({ baseLevel: 1, maxLevel: 2 });
    expect(c.stateAt(0).level).toBe(1);
    const up = run(c, 0, 300, assessment(0.95));
    expect(up.events.map((e) => e.toLevel)).toEqual([2]);
    const down = run(c, up.t, 600, assessment(0));
    expect(down.events.map((e) => e.toLevel)).toEqual([1]);
    expect(c.stateAt(down.t).level).toBe(1);
  });

  it('never adapts automatically without gaze data or when the teacher turned it off', () => {
    const noCamera = controller({}, false);
    expect(run(noCamera, 0, 300, assessment(0.95)).events).toEqual([]);
    expect(noCamera.currentMode(0)).toBe('manual-only');
    const off = controller({ autoAdapt: false });
    expect(run(off, 0, 300, assessment(0.95)).events).toEqual([]);
  });

  it('lets the student change the level, and stays out of the way afterwards', () => {
    const c = controller();
    const d = c.setLevelManually(10_000, 2)!;
    expect(d.event).toMatchObject({ trigger: 'student', fromLevel: 0, toLevel: 2, confidence: null });
    expect(c.setLevelManually(11_000, 2)).toBeNull();
    expect(c.currentMode(60_000)).toBe('held');
    // Automation would lower it (need is zero) but must wait for the manual hold to expire.
    const during = run(c, 15_000, 100, assessment(0));
    expect(during.events).toEqual([]);
    const after = run(c, 10_000 + POLICY.manualHoldMs, 50, assessment(0));
    expect(after.events.map((e) => e.toLevel)).toEqual([1]);
    expect(c.setLevelManually(999_000, 9 as Level)!.event.toLevel).toBe(3);
  });

  it('"keep it like this" stops automation until released', () => {
    const c = controller();
    c.setFrozen(true);
    expect(run(c, 0, 300, assessment(0.95)).events).toEqual([]);
    c.setFrozen(false);
    expect(run(c, 300_000, 20, assessment(0.95)).events.map((e) => e.toLevel)).toEqual([1]);
  });

  it('switches the kind of support when a different need persists at the same level', () => {
    const c = controller({ maxLevel: 1 });
    const first = run(c, 0, 60, assessment(0.5, 0.9, 'decoding'));
    expect(first.events[0]!.dominant).toBe('decoding');
    const second = run(c, first.t, 120, assessment(0.5, 0.9, 'lineTracking'));
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toMatchObject({ fromLevel: 1, toLevel: 1, dominant: 'lineTracking' });
  });

  it('keeps a log of everything it did', () => {
    const c = controller();
    run(c, 0, 50, assessment(0.9));
    c.setLevelManually(130_000, 0);
    expect(c.events.map((e) => e.trigger)).toEqual(['auto', 'auto', 'student']);
  });
});

describe('style presets', () => {
  const style = (level: Level, lang: 'fr' | 'ar', dominant: SupportDimension | null = 'decoding', settings = DEFAULT_SETTINGS, manual = NO_MANUAL) =>
    styleFor({ level, dominant, lang, settings, manual });

  it('never letter-spaces Arabic, whatever the level or manual spacing', () => {
    for (const level of [0, 1, 2, 3] as Level[]) {
      expect(style(level, 'ar').letterSpacingEm).toBe(0);
      expect(style(level, 'ar', 'decoding', DEFAULT_SETTINGS, { ...NO_MANUAL, spacingSteps: 2 }).letterSpacingEm).toBe(0);
    }
    expect(style(3, 'fr').letterSpacingEm).toBeGreaterThan(0);
  });

  it('gives Arabic taller lines and an Arabic typeface, and ignores Latin font choices for it', () => {
    for (const level of [0, 1, 2, 3] as Level[]) {
      expect(style(level, 'ar').lineHeight).toBeGreaterThan(style(level, 'fr').lineHeight);
    }
    expect(style(2, 'ar', 'decoding', { ...DEFAULT_SETTINGS, font: 'opendyslexic' }).fontFamily).toContain('Noto Naskh Arabic');
    expect(style(2, 'fr', 'decoding', { ...DEFAULT_SETTINGS, font: 'opendyslexic' }).fontFamily).toContain('OpenDyslexic');
  });

  it('increases support monotonically with the level in both scripts', () => {
    for (const lang of ['fr', 'ar'] as const) {
      for (let l = 1; l <= 3; l++) {
        const a = style((l - 1) as Level, lang, null);
        const b = style(l as Level, lang, null);
        expect(b.fontScale).toBeGreaterThan(a.fontScale);
        expect(b.wordSpacingEm).toBeGreaterThan(a.wordSpacingEm);
        expect(b.lineHeight).toBeGreaterThan(a.lineHeight);
        expect(b.maxWidthCh).toBeLessThan(a.maxWidthCh);
      }
    }
  });

  it('emphasises what the dominant need calls for', () => {
    expect(style(1, 'fr', 'decoding').wordSpacingEm).toBeGreaterThan(style(1, 'fr', 'attention').wordSpacingEm);
    expect(style(1, 'fr', 'lineTracking').lineHeight).toBeGreaterThan(style(1, 'fr', 'decoding').lineHeight);
    expect(style(2, 'fr', 'lineTracking').focus).toBe('line-guide');
    expect(style(1, 'fr', 'attention').focus).toBe('paragraph');
    expect(style(1, 'fr', 'attention').theme).toBe('sky');
    expect(style(1, 'fr', 'fatigue').fontScale).toBeGreaterThan(style(1, 'fr', 'decoding').fontScale);
    expect(style(0, 'fr', 'decoding')).toMatchObject({ focus: 'none', theme: 'paper' });
  });

  it('lets manual adjustments and teacher settings override the automatic choice', () => {
    const manual = { sizeSteps: 2, spacingSteps: 1, theme: 'dusk' as const, focus: 'line-guide' as const };
    const s = style(0, 'fr', null, { ...DEFAULT_SETTINGS, theme: 'cream' }, manual);
    expect(s.theme).toBe('dusk');
    expect(s.focus).toBe('line-guide');
    expect(s.fontScale).toBeCloseTo(1.14);
    expect(s.wordSpacingEm).toBeGreaterThan(0);
    expect(style(2, 'fr', 'attention', { ...DEFAULT_SETTINGS, theme: 'cream' }).theme).toBe('cream');
  });

  it('keeps text size within sane bounds', () => {
    expect(style(3, 'ar', 'fatigue', DEFAULT_SETTINGS, { ...NO_MANUAL, sizeSteps: 30 }).fontScale).toBe(1.6);
    expect(style(0, 'fr', null, DEFAULT_SETTINGS, { ...NO_MANUAL, sizeSteps: -30 }).fontScale).toBe(0.9);
  });

  it('meets WCAG AAA contrast (7:1) in every theme, normal and high contrast', () => {
    for (const [name, t] of Object.entries(THEMES)) {
      expect(contrastRatio(t.color, t.background), name).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(t.highContrastColor, t.background), `${name} high`).toBeGreaterThan(contrastRatio(t.color, t.background));
    }
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21);
  });

  it('serialises to CSS custom properties', () => {
    const vars = styleToCssVars(style(2, 'fr'));
    expect(vars['--rd-letter']).toMatch(/em$/);
    expect(vars['--rd-width']).toMatch(/ch$/);
    expect(Number(vars['--rd-line'])).toBeGreaterThan(1.5);
    expect(vars['--rd-bg']).toMatch(/^#/);
  });
});
