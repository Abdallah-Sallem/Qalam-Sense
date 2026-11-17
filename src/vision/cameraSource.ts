/**
 * Stage 1 of the vision pipeline: webcam frames → face landmarks → FaceObservation.
 *
 * Landmarks come from MediaPipe Face Landmarker (478 points including the
 * irises), running fully in the browser from files served by this app: no
 * frame, landmark or measurement ever leaves the device.
 *
 * Inference runs on the main thread, on the GPU when available. It is fed by
 * requestVideoFrameCallback, so it never processes the same camera frame
 * twice, and it skips frames when inference is slow so the page stays
 * responsive. Nothing here touches React state.
 */
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { VisionError, openCamera, stopStream } from './camera';
import { extractObservation } from './faceGeometry';
import { computeLuma } from './frameQuality';
import type { FrameListener, LumaStats, ObservationSource } from './types';

const ASSET_BASE = `${import.meta.env.BASE_URL}vision`;
export const MODEL_URL = `${ASSET_BASE}/face_landmarker.task`;
const WASM_URL = `${ASSET_BASE}/wasm`;

/**
 * Inference may use at most this share of wall-clock time. Frames arriving
 * sooner are skipped, so the page stays responsive on slow machines.
 */
const MAX_MAIN_THREAD_SHARE = 0.5;
/** Frames measured before checking whether the GPU path is actually fast. */
const DELEGATE_PROBE_FRAMES = 30;
/** A GPU path slower than this is almost certainly software-emulated WebGL. */
const SLOW_GPU_MS = 35;
const LUMA_EVERY_FRAMES = 30;

type Delegate = 'GPU' | 'CPU';

/**
 * Software WebGL (SwiftShader, llvmpipe, Microsoft Basic Render) makes the
 * GPU delegate several times slower than MediaPipe's CPU path (measured:
 * 101 ms vs 27 ms per frame in headless Chromium). Detect it up front.
 */
export function preferredDelegate(renderer: string | null): Delegate {
  if (!renderer) return 'CPU';
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer) ? 'CPU' : 'GPU';
}

function webglRenderer(): string | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    return null;
  }
}

export interface CameraSourceOptions {
  /** Include raw landmarks in each frame (diagnostics only). */
  withLandmarks?: boolean;
  /** Called when the camera stops on its own (unplugged, permission revoked). */
  onError?: (error: VisionError) => void;
}

export interface SourceStats {
  delegate: 'GPU' | 'CPU' | null;
  /** Processed frames per second, recent average. */
  fps: number;
  /** Inference time, recent average, ms. */
  inferenceMs: number;
  skippedFrames: number;
  videoWidth: number;
  videoHeight: number;
}

async function loadLandmarker(order: Delegate[]): Promise<{ landmarker: FaceLandmarker; delegate: Delegate }> {
  // Fail with a clear cause if `npm run setup:vision` was never run.
  const head = await fetch(MODEL_URL, { method: 'HEAD' }).catch(() => null);
  if (!head?.ok) throw new VisionError('model-missing');

  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  let lastError: unknown;
  for (const delegate of order) {
    try {
      const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      return { landmarker, delegate };
    } catch (err) {
      lastError = err;
    }
  }
  throw new VisionError('model-failed', lastError);
}

export class CameraObservationSource implements ObservationSource {
  readonly kind = 'camera' as const;
  stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private landmarker: FaceLandmarker | null = null;
  private delegate: 'GPU' | 'CPU' | null = null;
  private listener: FrameListener | null = null;
  private running = false;
  private frameHandle = 0;
  private lastVideoTime = -1;
  private frameIndex = 0;
  private skipped = 0;
  private avgInference = 0;
  private lastInferenceAt = -Infinity;
  private processed = 0;
  private frameTimes: number[] = [];
  private luma: LumaStats | undefined;
  private lumaCanvas: HTMLCanvasElement | null = null;

  constructor(private readonly options: CameraSourceOptions = {}) {}

  async start(listener: FrameListener): Promise<void> {
    if (this.running) return;
    this.listener = listener;
    try {
      // Ask for the camera first: it is the step the child sees and may refuse.
      this.stream = await openCamera();
      const first = preferredDelegate(webglRenderer());
      const loaded = await loadLandmarker(first === 'GPU' ? ['GPU', 'CPU'] : ['CPU', 'GPU']);
      this.landmarker = loaded.landmarker;
      this.delegate = loaded.delegate;

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = this.stream;
      // Kept in the document (invisible) so the browser keeps decoding frames
      // whichever screen is showing; previews use their own element.
      video.setAttribute('aria-hidden', 'true');
      video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;inset:auto 0 0 auto';
      document.body.appendChild(video);
      await video.play();
      this.video = video;

      for (const track of this.stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (!this.running) return;
          this.stop();
          this.options.onError?.(new VisionError('camera-stopped'));
        });
      }
      this.running = true;
      this.schedule();
    } catch (err) {
      this.stop();
      throw err instanceof VisionError ? err : new VisionError('model-failed', err);
    }
  }

  private schedule(): void {
    const video = this.video;
    if (!this.running || !video) return;
    if ('requestVideoFrameCallback' in video) {
      this.frameHandle = video.requestVideoFrameCallback(() => this.onFrame());
    } else {
      this.frameHandle = requestAnimationFrame(() => this.onFrame());
    }
  }

  private onFrame(): void {
    const video = this.video;
    if (!this.running || !video || !this.landmarker) return;
    this.schedule();
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;
    this.frameIndex++;
    const now = performance.now();
    if (now - this.lastInferenceAt < this.avgInference / MAX_MAIN_THREAD_SHARE) {
      this.skipped++;
      return;
    }

    const t = now;
    this.lastInferenceAt = t;
    const result = this.landmarker.detectForVideo(video, t);
    const inferenceMs = performance.now() - t;
    this.avgInference = this.avgInference === 0 ? inferenceMs : this.avgInference * 0.9 + inferenceMs * 0.1;
    if (++this.processed === DELEGATE_PROBE_FRAMES && this.delegate === 'GPU' && this.avgInference > SLOW_GPU_MS) {
      void this.switchToCpu();
    }
    this.frameTimes.push(t);
    if (this.frameTimes.length > 60) this.frameTimes.shift();

    const landmarks = result.faceLandmarks[0];
    let observation = null;
    if (landmarks) {
      const blend = result.faceBlendshapes?.[0]?.categories;
      const score = (name: string) => blend?.find((c) => c.categoryName === name)?.score;
      const left = score('eyeBlinkLeft');
      const right = score('eyeBlinkRight');
      observation = extractObservation(landmarks, video.videoWidth / video.videoHeight, t, {
        matrix: result.facialTransformationMatrixes?.[0]?.data ?? null,
        blink: left !== undefined && right !== undefined ? { left, right } : null,
      });
    }
    if (this.frameIndex % LUMA_EVERY_FRAMES === 1) this.luma = this.sampleLuma(video);

    this.listener?.({
      t,
      observation,
      inferenceMs,
      luma: this.luma,
      ...(this.options.withLandmarks && landmarks ? { landmarks } : {}),
    });
  }

  /** The GPU path turned out slow (software WebGL the renderer string did not reveal): use the CPU path. */
  private async switchToCpu(): Promise<void> {
    try {
      const { landmarker } = await loadLandmarker(['CPU']);
      if (!this.running) {
        landmarker.close();
        return;
      }
      this.landmarker?.close();
      this.landmarker = landmarker;
      this.delegate = 'CPU';
      this.avgInference = 0;
    } catch {
      // Keep the slower GPU path rather than losing tracking altogether.
    }
  }

  /** Brightness of a heavily downscaled frame. The pixels are discarded immediately. */
  private sampleLuma(video: HTMLVideoElement): LumaStats | undefined {
    try {
      this.lumaCanvas ??= Object.assign(document.createElement('canvas'), { width: 32, height: 24 });
      const ctx = this.lumaCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return undefined;
      ctx.drawImage(video, 0, 0, 32, 24);
      return computeLuma(ctx.getImageData(0, 0, 32, 24).data);
    } catch {
      return undefined;
    }
  }

  stats(): SourceStats {
    const ft = this.frameTimes;
    const span = ft.length > 1 ? ft[ft.length - 1]! - ft[0]! : 0;
    return {
      delegate: this.delegate,
      fps: span > 0 ? ((ft.length - 1) * 1000) / span : 0,
      inferenceMs: this.avgInference,
      skippedFrames: this.skipped,
      videoWidth: this.video?.videoWidth ?? 0,
      videoHeight: this.video?.videoHeight ?? 0,
    };
  }

  /** Stops inference and releases the camera. Safe to call more than once. */
  stop(): void {
    this.running = false;
    const video = this.video;
    if (video) {
      if ('cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(this.frameHandle);
      cancelAnimationFrame(this.frameHandle);
      video.pause();
      video.srcObject = null;
      video.remove();
    }
    stopStream(this.stream);
    this.stream = null;
    this.video = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.listener = null;
    this.lumaCanvas = null;
  }
}
