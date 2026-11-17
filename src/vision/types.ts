/** Shared types for the vision pipeline. Coordinates are documented per field. */

export interface Point {
  x: number;
  y: number;
}

/** A face-mesh landmark in normalised image coordinates (0..1 on both axes). */
export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

export interface EyeObservation {
  /** Iris offset along the eye axis, in eye widths. 0 = centred, sign follows image +x. */
  h: number;
  /** Iris offset perpendicular to the eye axis, in eye widths. Positive = towards the chin. */
  v: number;
  /** Lid aperture divided by eye width (about 0.3 open, below 0.12 closed). */
  openness: number;
}

/**
 * Stage-2 output: head and eye geometry for one video frame.
 * This is the boundary between landmark extraction and gaze estimation:
 * nothing downstream ever sees pixels or raw landmarks.
 */
export interface FaceObservation {
  /** Capture time in ms on the performance.now() timeline. */
  t: number;
  right: EyeObservation;
  left: EyeObservation;
  /** Head rotation in radians. Only used as regression features and envelope checks. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Mid-point between the eyes, normalised image coordinates. */
  faceX: number;
  faceY: number;
  /** Inter-ocular distance divided by image width: a proxy for viewing distance. */
  faceScale: number;
  /** 0 = eyes wide open, 1 = fully closed. */
  blinkScore: number;
  eyesClosed: boolean;
}

export interface LumaStats {
  mean: number;
  std: number;
}

/** What an observation source delivers for every processed video frame. */
export interface VisionFrame {
  t: number;
  observation: FaceObservation | null;
  /** Time spent in landmark inference for this frame, ms. */
  inferenceMs: number;
  /** Raw landmarks, only provided when diagnostics asked for them. */
  landmarks?: Landmark[];
  luma?: LumaStats;
}

export type FrameListener = (frame: VisionFrame) => void;

/**
 * A producer of face observations. The production implementation wraps the
 * webcam and MediaPipe; the test implementation is an explicit synthetic eye.
 */
export interface ObservationSource {
  readonly kind: 'camera' | 'synthetic';
  start(listener: FrameListener): Promise<void>;
  stop(): void;
  /** Camera stream to show in a preview, when the source has one. */
  readonly stream: MediaStream | null;
}

export type FrameIssue =
  | 'no-face'
  | 'face-too-far'
  | 'face-too-close'
  | 'face-off-center'
  | 'head-turned'
  | 'eyes-closed';

export type LightingIssue = 'too-dark' | 'too-bright' | 'low-contrast';

export interface GazeSample {
  t: number;
  /** Estimated gaze point in CSS pixels, viewport coordinates. */
  x: number;
  y: number;
  /** False when the estimate must not be used as an observation. */
  valid: boolean;
  /** 0..1. Combines calibration quality, head-pose envelope and eye state. */
  confidence: number;
  /** True when a usable estimate lands clearly outside the viewport. */
  offScreen: boolean;
  issues: FrameIssue[];
}

export type TrackingState = 'tracking' | 'degraded' | 'lost';
