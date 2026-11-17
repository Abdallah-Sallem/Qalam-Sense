/**
 * Decides whether a frame may be used as an observation, and explains why not.
 * Thresholds are deliberately conservative: a rejected frame costs 33 ms,
 * an accepted bad frame corrupts fixations and everything derived from them.
 */
import type { FaceObservation, FrameIssue, LightingIssue, LumaStats } from './types';

export const FRAME_LIMITS = {
  /** Inter-ocular distance / image width. Below 0.07 the child is too far for iris detail. */
  minFaceScale: 0.07,
  maxFaceScale: 0.26,
  centerX: [0.18, 0.82] as const,
  centerY: [0.15, 0.85] as const,
  maxYaw: 0.5,
  maxPitch: 0.45,
};

export function assessFrame(o: FaceObservation | null): { usable: boolean; issues: FrameIssue[] } {
  if (!o) return { usable: false, issues: ['no-face'] };
  const issues: FrameIssue[] = [];
  if (o.faceScale < FRAME_LIMITS.minFaceScale) issues.push('face-too-far');
  if (o.faceScale > FRAME_LIMITS.maxFaceScale) issues.push('face-too-close');
  if (
    o.faceX < FRAME_LIMITS.centerX[0] ||
    o.faceX > FRAME_LIMITS.centerX[1] ||
    o.faceY < FRAME_LIMITS.centerY[0] ||
    o.faceY > FRAME_LIMITS.centerY[1]
  ) {
    issues.push('face-off-center');
  }
  if (Math.abs(o.yaw) > FRAME_LIMITS.maxYaw || Math.abs(o.pitch) > FRAME_LIMITS.maxPitch) issues.push('head-turned');
  if (o.eyesClosed) issues.push('eyes-closed');
  return { usable: issues.length === 0, issues };
}

/** Mean and standard deviation of luma (0..255) for an RGBA pixel buffer. */
export function computeLuma(rgba: ArrayLike<number>): LumaStats {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return { mean: 0, std: 0 };
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const y = 0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!;
    s += y;
    s2 += y * y;
  }
  const mean = s / n;
  return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

export function assessLighting(luma: LumaStats | undefined): LightingIssue | null {
  if (!luma) return null;
  if (luma.mean < 45) return 'too-dark';
  if (luma.mean > 215) return 'too-bright';
  if (luma.std < 14) return 'low-contrast';
  return null;
}
