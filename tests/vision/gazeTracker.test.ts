import { beforeAll, describe, expect, it } from 'vitest';
import { createRng } from '@/lib/random';
import { FRAME_MS, runSyntheticCalibration } from '@/testing/harness';
import { observeGaze, type SyntheticEyeOptions } from '@/testing/syntheticEye';
import type { CalibrationResult } from '@/vision/calibration';
import { GazeTracker } from '@/vision/gazeTracker';
import type { GazeSample } from '@/vision/types';

const VIEWPORT = { width: 1366, height: 768 };
type Ok = Extract<CalibrationResult, { ok: true }>;
let calibration: Ok;

beforeAll(() => {
  const { result } = runSyntheticCalibration(VIEWPORT, createRng(31));
  if (!result.ok) throw new Error('calibration failed');
  calibration = result;
});

function setup() {
  const tracker = new GazeTracker(calibration.model, calibration.quality, VIEWPORT);
  const rng = createRng(7);
  let t = 0;
  const feed = (frames: number, gaze: { x: number; y: number } | null, eye: SyntheticEyeOptions = { noise: 0.004 }): GazeSample[] => {
    const out: GazeSample[] = [];
    for (let i = 0; i < frames; i++) {
      out.push(tracker.process(t, gaze ? observeGaze(gaze, VIEWPORT, t, rng, eye) : null));
      t += FRAME_MS;
    }
    return out;
  };
  return { tracker, feed, now: () => t };
}

describe('GazeTracker', () => {
  it('estimates where the eye looks, with a confidence, once calibrated', () => {
    const { tracker, feed } = setup();
    const samples = feed(60, { x: 900, y: 250 });
    const last = samples.slice(-20);
    expect(last.every((s) => s.valid)).toBe(true);
    for (const s of last) {
      expect(Math.hypot(s.x - 900, s.y - 250)).toBeLessThan(70);
      expect(s.confidence).toBeGreaterThan(0.7);
    }
    expect(tracker.trackingState).toBe('tracking');
  });

  it('never reports a blink as an observation, and counts it', () => {
    const { tracker, feed } = setup();
    feed(30, { x: 600, y: 400 });
    const closed = feed(8, { x: 600, y: 400 }, { noise: 0.004, eyesClosed: true });
    expect(closed.every((s) => !s.valid && s.issues.includes('eyes-closed'))).toBe(true);
    const after = feed(6, { x: 600, y: 400 });
    // The first frames after re-opening are discarded too.
    expect(after[0]!.valid).toBe(false);
    expect(after[5]!.valid).toBe(true);
    expect(tracker.stats().blinks).toBe(1);
  });

  it('declares tracking lost after sustained absence and recovers afterwards', () => {
    const { tracker, feed } = setup();
    const events: string[] = [];
    let lostMs = 0;
    tracker.events.on('lost', () => events.push('lost'));
    tracker.events.on('recovered', (e) => {
      events.push('recovered');
      lostMs = e.lostMs;
    });
    feed(30, { x: 600, y: 400 });
    feed(20, null); // 0.66 s: degraded, not lost
    expect(tracker.trackingState).toBe('degraded');
    expect(events).toEqual([]);
    feed(40, null);
    expect(tracker.trackingState).toBe('lost');
    feed(10, { x: 600, y: 400 });
    expect(tracker.trackingState).toBe('tracking');
    expect(events).toEqual(['lost', 'recovered']);
    expect(lostMs).toBeGreaterThan(1500);
    expect(tracker.stats().lossEvents).toBe(1);
  });

  it('lowers confidence when the head leaves the calibration pose and asks to recalibrate if it stays there', () => {
    const { tracker, feed } = setup();
    const reasons: string[] = [];
    tracker.events.on('recalibration-suggested', (e) => reasons.push(e.reason));
    const before = feed(30, { x: 600, y: 400 }).at(-1)!;
    const moved = feed(60, { x: 600, y: 400 }, { noise: 0.004, head: { yaw: 0.2 } });
    expect(moved.at(-1)!.confidence).toBeLessThan(before.confidence * 0.7);
    expect(reasons).toEqual([]); // 2 s is not enough
    feed(260, { x: 600, y: 400 }, { noise: 0.004, head: { yaw: 0.2 } });
    expect(reasons).toEqual(['head-moved']);
    // Only suggested once until it is acknowledged.
    feed(300, { x: 600, y: 400 }, { noise: 0.004, head: { yaw: 0.2 } });
    expect(reasons).toHaveLength(1);
  });

  it('treats estimates far outside the screen as invalid, flagged off-screen', () => {
    const { feed } = setup();
    const s = feed(20, { x: 2600, y: 400 }).at(-1)!;
    expect(s.valid).toBe(false);
    expect(s.offScreen).toBe(true);
  });

  it('asks to recalibrate after repeated losses', () => {
    const { tracker, feed } = setup();
    const reasons: string[] = [];
    tracker.events.on('recalibration-suggested', (e) => reasons.push(e.reason));
    for (let i = 0; i < 3; i++) {
      feed(20, { x: 600, y: 400 });
      feed(60, null);
    }
    expect(reasons).toEqual(['repeated-loss']);
  });

  it('reports the share of valid frames', () => {
    const { tracker, feed } = setup();
    feed(50, { x: 600, y: 400 });
    feed(50, null);
    expect(tracker.stats().validRatio).toBeGreaterThan(0.4);
    expect(tracker.stats().validRatio).toBeLessThan(0.55);
  });

  it('stops notifying listeners after dispose', () => {
    const { tracker, feed } = setup();
    let n = 0;
    tracker.events.on('sample', () => n++);
    feed(3, { x: 600, y: 400 });
    tracker.dispose();
    feed(3, { x: 600, y: 400 });
    expect(n).toBe(3);
    expect(tracker.events.listenerCount('sample')).toBe(0);
  });
});
