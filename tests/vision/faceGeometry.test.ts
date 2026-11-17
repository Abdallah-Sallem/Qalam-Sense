import { describe, expect, it } from 'vitest';
import { LANDMARK_COUNT_WITH_IRIS, LM, binocular, extractObservation, measureEye } from '@/vision/faceGeometry';
import { assessFrame, assessLighting, computeLuma } from '@/vision/frameQuality';
import type { Landmark } from '@/vision/types';

/**
 * Builds a minimal face mesh: only the landmarks the pipeline reads are
 * meaningful. Coordinates are in a 4:3 image, face centred.
 */
function face(opts: { irisDx?: number; irisDy?: number; lidGap?: number; rollDeg?: number; scale?: number } = {}): Landmark[] {
  const { irisDx = 0, irisDy = 0, lidGap = 0.012, rollDeg = 0, scale = 1 } = opts;
  const lm: Landmark[] = Array.from({ length: LANDMARK_COUNT_WITH_IRIS }, () => ({ x: 0.5, y: 0.5 }));
  const eyeHalf = 0.02 * scale; // half eye width, in image-width units
  const eyeY = 0.45;
  const put = (i: number, x: number, y: number) => {
    // Rotate around the face centre in square-pixel space (aspect 4:3).
    const a = (rollDeg * Math.PI) / 180;
    const px = (x - 0.5) * (4 / 3);
    const py = y - 0.5;
    lm[i] = { x: 0.5 + (px * Math.cos(a) - py * Math.sin(a)) / (4 / 3), y: 0.5 + px * Math.sin(a) + py * Math.cos(a) };
  };
  const eye = (cx: number, a: number, b: number, up: number, low: number, iris: number) => {
    put(a, cx - eyeHalf, eyeY);
    put(b, cx + eyeHalf, eyeY);
    put(up, cx, eyeY - (lidGap * scale) / 2);
    put(low, cx, eyeY + (lidGap * scale) / 2);
    put(iris, cx + irisDx * scale, eyeY + irisDy * scale);
  };
  eye(0.5 - 0.045 * scale, LM.rightOuter, LM.rightInner, LM.rightUpper, LM.rightLower, LM.rightIris);
  eye(0.5 + 0.045 * scale, LM.leftInner, LM.leftOuter, LM.leftUpper, LM.leftLower, LM.leftIris);
  put(LM.noseTip, 0.5, eyeY + 0.054 * scale * (4 / 3));
  return lm;
}

const ASPECT = 4 / 3;

describe('measureEye', () => {
  it('reports a centred iris as zero offset', () => {
    const e = measureEye({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -1.5 }, { x: 5, y: 1.5 }, { x: 5, y: 0 });
    expect(e.h).toBeCloseTo(0);
    expect(e.v).toBeCloseTo(0);
    expect(e.openness).toBeCloseTo(0.3);
  });

  it('expresses offsets in eye widths, positive right and down', () => {
    const e = measureEye({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -1 }, { x: 5, y: 1 }, { x: 6, y: 0.5 });
    expect(e.h).toBeCloseTo(0.1);
    expect(e.v).toBeCloseTo(0.05);
  });

  it('does not divide by zero on a degenerate eye', () => {
    const p = { x: 1, y: 1 };
    expect(measureEye(p, p, p, p, p)).toEqual({ h: 0, v: 0, openness: 0 });
  });
});

describe('extractObservation', () => {
  it('returns null when the mesh has no iris landmarks', () => {
    expect(extractObservation(face().slice(0, 468), ASPECT, 0)).toBeNull();
  });

  it('measures iris displacement identically for both eyes', () => {
    const o = extractObservation(face({ irisDx: 0.004, irisDy: 0.002 }), ASPECT, 12)!;
    expect(o.t).toBe(12);
    expect(o.right.h).toBeCloseTo(o.left.h, 5);
    expect(o.right.h).toBeGreaterThan(0);
    expect(o.right.v).toBeGreaterThan(0);
    expect(binocular(o).h).toBeCloseTo(0.1, 2); // 0.004 / 0.04 eye width
  });

  it('is invariant to in-plane head roll', () => {
    const straight = extractObservation(face({ irisDx: 0.004, irisDy: 0.002 }), ASPECT, 0)!;
    const tilted = extractObservation(face({ irisDx: 0.004, irisDy: 0.002, rollDeg: 14 }), ASPECT, 0)!;
    expect(binocular(tilted).h).toBeCloseTo(binocular(straight).h, 3);
    expect(binocular(tilted).v).toBeCloseTo(binocular(straight).v, 3);
    expect(tilted.roll).toBeCloseTo((14 * Math.PI) / 180, 2);
  });

  it('is invariant to distance from the camera', () => {
    const near = extractObservation(face({ irisDx: 0.004, scale: 1.6 }), ASPECT, 0)!;
    const far = extractObservation(face({ irisDx: 0.004, scale: 0.7 }), ASPECT, 0)!;
    expect(binocular(near).h).toBeCloseTo(binocular(far).h, 3);
    expect(near.faceScale).toBeGreaterThan(far.faceScale);
  });

  it('detects closed eyes from lid aperture and from blendshapes', () => {
    expect(extractObservation(face({ lidGap: 0.002 }), ASPECT, 0)!.eyesClosed).toBe(true);
    expect(extractObservation(face(), ASPECT, 0)!.eyesClosed).toBe(false);
    expect(extractObservation(face(), ASPECT, 0, { blink: { left: 0.9, right: 0.1 } })!.eyesClosed).toBe(true);
  });

  it('reads head rotation from the transformation matrix when provided', () => {
    const yaw = 0.3;
    // Column-major rotation about the vertical axis.
    const m = [Math.cos(yaw), 0, -Math.sin(yaw), 0, 0, 1, 0, 0, Math.sin(yaw), 0, Math.cos(yaw), 0, 0, 0, 0, 1];
    const o = extractObservation(face(), ASPECT, 0, { matrix: m })!;
    expect(o.yaw).toBeCloseTo(yaw, 5);
    expect(o.pitch).toBeCloseTo(0, 5);
  });

  it('estimates a frontal pose from landmarks alone', () => {
    const o = extractObservation(face(), ASPECT, 0)!;
    expect(Math.abs(o.yaw)).toBeLessThan(0.05);
    expect(Math.abs(o.pitch)).toBeLessThan(0.05);
  });
});

describe('assessFrame', () => {
  const ok = extractObservation(face(), ASPECT, 0)!;
  it('accepts a centred, frontal, open-eyed face', () => {
    expect(assessFrame(ok)).toEqual({ usable: true, issues: [] });
  });
  it('explains each rejection', () => {
    expect(assessFrame(null).issues).toEqual(['no-face']);
    expect(assessFrame({ ...ok, faceScale: 0.04 }).issues).toContain('face-too-far');
    expect(assessFrame({ ...ok, faceScale: 0.3 }).issues).toContain('face-too-close');
    expect(assessFrame({ ...ok, faceX: 0.05 }).issues).toContain('face-off-center');
    expect(assessFrame({ ...ok, yaw: 0.7 }).issues).toContain('head-turned');
    expect(assessFrame({ ...ok, eyesClosed: true }).usable).toBe(false);
  });
});

describe('lighting', () => {
  const frame = (value: number, alt = value) => {
    const px = new Uint8ClampedArray(4 * 100);
    for (let i = 0; i < 100; i++) px.set([i % 2 ? value : alt, i % 2 ? value : alt, i % 2 ? value : alt, 255], i * 4);
    return computeLuma(px);
  };
  it('computes mean and spread of luma', () => {
    const l = frame(100, 200);
    expect(l.mean).toBeCloseTo(150, 0);
    expect(l.std).toBeCloseTo(50, 0);
  });
  it('flags dark, bright and flat images', () => {
    expect(assessLighting(frame(10, 40))).toBe('too-dark');
    expect(assessLighting(frame(250, 230))).toBe('too-bright');
    expect(assessLighting(frame(120, 122))).toBe('low-contrast');
    expect(assessLighting(frame(80, 170))).toBeNull();
    expect(assessLighting(undefined)).toBeNull();
  });
});

describe('inference delegate choice', () => {
  it('uses the CPU path on software-rendered WebGL and the GPU path on real hardware', async () => {
    const { preferredDelegate } = await import('@/vision/cameraSource');
    expect(preferredDelegate('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe('CPU');
    expect(preferredDelegate('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('CPU');
    expect(preferredDelegate('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)')).toBe('CPU');
    expect(preferredDelegate('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)')).toBe('GPU');
    expect(preferredDelegate(null)).toBe('CPU');
  });
});
