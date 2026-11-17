/**
 * Stage 0 of the vision pipeline: camera access.
 * Turns the browser's assorted failure modes into a small set of causes the
 * UI can explain to a child, and guarantees the camera light goes off on stop.
 */

export type VisionErrorCode =
  | 'unsupported'
  | 'insecure-context'
  | 'permission-denied'
  | 'no-camera'
  | 'camera-in-use'
  | 'camera-stopped'
  | 'model-missing'
  | 'model-failed';

export class VisionError extends Error {
  constructor(
    readonly code: VisionErrorCode,
    cause?: unknown,
  ) {
    super(code, { cause });
    this.name = 'VisionError';
  }
}

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: 'user',
    // 640×480 is plenty for face landmarks and keeps inference cheap on school laptops.
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30, max: 30 },
  },
};

export function classifyCameraError(err: unknown): VisionErrorCode {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-camera';
  if (name === 'NotReadableError' || name === 'AbortError') return 'camera-in-use';
  return 'unsupported';
}

export async function openCamera(): Promise<MediaStream> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) throw new VisionError('insecure-context');
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw new VisionError('unsupported');
  try {
    return await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  } catch (err) {
    throw new VisionError(classifyCameraError(err), err);
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}
