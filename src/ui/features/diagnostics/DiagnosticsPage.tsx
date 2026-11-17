/**
 * Tracking diagnostics: makes the vision pipeline measurable.
 *
 * Shows the camera feed with landmarks, live pipeline numbers, calibration
 * quality, the estimated gaze point, and a controlled accuracy test against
 * known screen targets whose results can be exported.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Emitter } from '@/lib/emitter';
import { hypot2, mean, median, std } from '@/lib/math';
import type { GazeSetup } from '@/session/pipeline';
import { Button, Notice, useErrorText } from '@/ui/components/ui';
import { downloadFile } from '@/ui/features/shared/SessionViews';
import { CalibrationView, type FrameHub } from '@/ui/features/student/CalibrationView';
import type { CalibrationResult } from '@/vision/calibration';
import { CameraObservationSource } from '@/vision/cameraSource';
import { LM } from '@/vision/faceGeometry';
import { assessFrame, assessLighting } from '@/vision/frameQuality';
import { headDeviation } from '@/vision/gazeModel';
import { GazeTracker } from '@/vision/gazeTracker';
import { createObservationSource } from '@/vision/sourceFactory';
import type { GazeSample, ObservationSource, VisionFrame } from '@/vision/types';

const EYE_POINTS = [LM.rightOuter, LM.rightInner, LM.rightUpper, LM.rightLower, LM.leftInner, LM.leftOuter, LM.leftUpper, LM.leftLower];
const IRIS_POINTS = [LM.rightIris, LM.leftIris];

/** Accuracy-test targets: a 3×3 grid that does NOT coincide with the calibration points. */
const TEST_TARGETS: [number, number][] = [0.2, 0.5, 0.8].flatMap((y) => [0.2, 0.5, 0.8].map((x) => [x, y] as [number, number]));
const TEST_SETTLE_MS = 900;
const TEST_COLLECT_MS = 1300;

interface TargetResult {
  nx: number;
  ny: number;
  samples: number;
  errorPx: number | null;
  biasX: number | null;
  biasY: number | null;
  precisionPx: number | null;
}

interface Live {
  fps: number;
  inferenceMs: number;
  latencyMs: number;
  delegate: string;
  resolution: string;
  face: boolean;
  issues: string;
  light: string;
  luma: string;
  yaw: number;
  pitch: number;
  blink: number;
  headDeviation: number | null;
  confidence: number | null;
  valid: boolean | null;
  state: string;
  losses: number;
  validRatio: number;
  blinkRate: number;
}

export function DiagnosticsPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [testIndex, setTestIndex] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<TargetResult[] | null>(null);
  const [lossLog, setLossLog] = useState<string[]>([]);

  const hub = useRef<FrameHub>(new Emitter<{ frame: VisionFrame }>()).current;
  const sourceRef = useRef<ObservationSource | null>(null);
  const trackerRef = useRef<GazeTracker | null>(null);
  const gazeRef = useRef<GazeSetup | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const lastFrame = useRef<VisionFrame | null>(null);
  const lastSample = useRef<GazeSample | null>(null);
  const latency = useRef(0);

  const stop = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current = null;
    trackerRef.current?.dispose();
    trackerRef.current = null;
    setRunning(false);
    setLive(null);
  }, []);
  useEffect(() => stop, [stop]);

  const start = async () => {
    setError(null);
    try {
      const source = await createObservationSource({ withLandmarks: true, onError: (e) => setError(errorText(e)) });
      await source.start((frame) => hub.emit('frame', frame));
      sourceRef.current = source;
      if (videoRef.current && source.stream) {
        videoRef.current.srcObject = source.stream;
        void videoRef.current.play().catch(() => {});
      }
      setRunning(true);
    } catch (err) {
      setError(errorText(err));
    }
  };

  // Per-frame work: draw landmarks, run the tracker, move the gaze dot. No React state here.
  useEffect(() => {
    return hub.on('frame', (frame) => {
      lastFrame.current = frame;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (frame.landmarks) {
          ctx.fillStyle = 'rgba(29,158,117,0.55)';
          for (let i = 0; i < frame.landmarks.length; i += 3) {
            const p = frame.landmarks[i]!;
            ctx.fillRect(p.x * canvas.width - 1, p.y * canvas.height - 1, 2, 2);
          }
          const dot = (i: number, color: string, r: number) => {
            const p = frame.landmarks![i];
            if (!p) return;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x * canvas.width, p.y * canvas.height, r, 0, Math.PI * 2);
            ctx.fill();
          };
          EYE_POINTS.forEach((i) => dot(i, '#FFD43B', 3));
          IRIS_POINTS.forEach((i) => dot(i, '#FF4D4F', 4));
        }
      }
      const tracker = trackerRef.current;
      if (tracker) {
        const sample = tracker.process(frame.t, frame.observation);
        lastSample.current = sample;
        latency.current = performance.now() - frame.t;
        const el = dotRef.current;
        if (el) {
          el.style.display = sample.valid ? 'block' : 'none';
          el.style.transform = `translate(${sample.x}px, ${sample.y}px)`;
          el.style.opacity = String(0.35 + 0.65 * sample.confidence);
        }
      }
    });
  }, [hub]);

  // Numbers are refreshed four times a second: readable, and cheap.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const frame = lastFrame.current;
      const source = sourceRef.current;
      const stats = source instanceof CameraObservationSource ? source.stats() : null;
      const o = frame?.observation ?? null;
      const tracker = trackerRef.current;
      const ts = tracker?.stats();
      const sample = lastSample.current;
      setLive({
        fps: stats?.fps ?? 30,
        inferenceMs: stats?.inferenceMs ?? 0,
        latencyMs: latency.current + (frame?.inferenceMs ?? 0),
        delegate: stats?.delegate ?? source?.kind ?? '—',
        resolution: stats ? `${stats.videoWidth}×${stats.videoHeight}` : '—',
        face: o !== null,
        issues: assessFrame(o).issues.join(', ') || '—',
        light: assessLighting(frame?.luma) ?? 'ok',
        luma: frame?.luma ? `${frame.luma.mean.toFixed(0)} ± ${frame.luma.std.toFixed(0)}` : '—',
        yaw: o?.yaw ?? 0,
        pitch: o?.pitch ?? 0,
        blink: o?.blinkScore ?? 0,
        headDeviation: o && gazeRef.current ? headDeviation(gazeRef.current.model, o) : null,
        confidence: sample ? sample.confidence : null,
        valid: sample ? sample.valid : null,
        state: tracker?.trackingState ?? '—',
        losses: ts?.lossEvents ?? 0,
        validRatio: ts?.validRatio ?? 0,
        blinkRate: ts?.blinkRate ?? 0,
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [running]);

  const onCalibrated = (result: CalibrationResult) => {
    setCalibrating(false);
    setCalibration(result);
    setTestResults(null);
    trackerRef.current?.dispose();
    trackerRef.current = null;
    gazeRef.current = null;
    if (!result.ok) return;
    gazeRef.current = { model: result.model, quality: result.quality, viewport: result.viewport };
    const tracker = new GazeTracker(result.model, result.quality, result.viewport);
    tracker.events.on('lost', ({ t: at }) => setLossLog((log) => [...log.slice(-9), `lost @ ${(at / 1000).toFixed(1)} s`]));
    tracker.events.on('recovered', ({ lostMs }) => setLossLog((log) => [...log.slice(-9), `recovered after ${(lostMs / 1000).toFixed(1)} s`]));
    tracker.events.on('recalibration-suggested', ({ reason }) => setLossLog((log) => [...log.slice(-9), `recalibration suggested: ${reason}`]));
    trackerRef.current = tracker;
  };

  // Accuracy test: look at each target in turn; compare the estimate with the known position.
  useEffect(() => {
    if (testIndex === null) return;
    if (testIndex >= TEST_TARGETS.length) {
      setTestIndex(null);
      return;
    }
    const [nx, ny] = TEST_TARGETS[testIndex]!;
    const truth = { x: nx * window.innerWidth, y: ny * window.innerHeight };
    const xs: number[] = [];
    const ys: number[] = [];
    let begin = 0;
    const off = hub.on('frame', (frame) => {
      begin ||= frame.t;
      const sample = lastSample.current;
      if (frame.t - begin >= TEST_SETTLE_MS && sample?.valid && sample.t === frame.t) {
        xs.push(sample.x);
        ys.push(sample.y);
      }
      if (frame.t - begin < TEST_SETTLE_MS + TEST_COLLECT_MS) return;
      off();
      const enough = xs.length >= 8;
      const mx = median(xs);
      const my = median(ys);
      setTestResults((prev) => [
        ...(prev ?? []),
        {
          nx,
          ny,
          samples: xs.length,
          errorPx: enough ? mean(xs.map((x, i) => hypot2(x - truth.x, ys[i]! - truth.y))) : null,
          biasX: enough ? mx - truth.x : null,
          biasY: enough ? my - truth.y : null,
          precisionPx: enough ? hypot2(std(xs), std(ys)) : null,
        },
      ]);
      setTestIndex((i) => (i === null ? null : i + 1));
    });
    return off;
  }, [testIndex, hub]);

  const measured = (testResults ?? []).filter((r) => r.errorPx !== null);
  const diag = hypot2(window.innerWidth, window.innerHeight);
  const exportReport = () =>
    downloadFile(
      `qalam-sense-tracking-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          userAgent: navigator.userAgent,
          viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
          pipeline: live,
          calibration: calibration?.ok ? calibration.quality : calibration ? { failed: calibration.reason } : null,
          calibrationPoints: calibration?.points ?? null,
          accuracyTest: testResults,
          trackerStats: trackerRef.current?.stats() ?? null,
        },
        null,
        2,
      ),
      'application/json',
    );

  const testing = testIndex !== null && testIndex < TEST_TARGETS.length;
  return (
    <div className="stack diag">
      <h1>{t('diag.title')}</h1>
      <p className="muted">{t('diag.intro')}</p>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="row">
        {running ? <Button onClick={stop}>{t('diag.stop')}</Button> : <Button variant="primary" onClick={() => void start()}>{t('diag.start')}</Button>}
        <Button onClick={() => setCalibrating(true)} disabled={!running}>
          {t('diag.calibrate')}
        </Button>
        <Button
          onClick={() => {
            setTestResults([]);
            setTestIndex(0);
          }}
          disabled={!running || !calibration?.ok || testing}
        >
          {t('diag.accuracyTest')}
        </Button>
        <Button onClick={exportReport} disabled={!running}>
          {t('diag.export')}
        </Button>
      </div>

      <div className="diag-grid">
        <section className="card">
          <h2>{t('diag.camera')}</h2>
          <div className="diag-video">
            <video ref={videoRef} muted playsInline />
            <canvas ref={canvasRef} width={640} height={480} />
          </div>
        </section>

        <section className="card">
          <h2>{t('diag.pipeline')}</h2>
          {live ? (
            <dl className="kv">
              <dt>{t('diag.fps')}</dt>
              <dd>{live.fps.toFixed(1)}</dd>
              <dt>{t('diag.inference')}</dt>
              <dd>{live.inferenceMs.toFixed(1)} ms ({live.delegate})</dd>
              <dt>{t('diag.latency')}</dt>
              <dd>{live.latencyMs.toFixed(1)} ms</dd>
              <dt>{t('diag.resolution')}</dt>
              <dd>{live.resolution}</dd>
              <dt>{t('diag.face')}</dt>
              <dd>{live.face ? '✓' : '✗'}</dd>
              <dt>{t('diag.issues')}</dt>
              <dd>{live.issues}</dd>
              <dt>{t('diag.light')}</dt>
              <dd>{live.light} ({live.luma})</dd>
              <dt>{t('diag.pose')}</dt>
              <dd>
                yaw {((live.yaw * 180) / Math.PI).toFixed(0)}°, pitch {((live.pitch * 180) / Math.PI).toFixed(0)}°
              </dd>
              <dt>{t('diag.blink')}</dt>
              <dd>{live.blink.toFixed(2)}</dd>
              <dt>{t('diag.envelope')}</dt>
              <dd>{live.headDeviation === null ? '—' : live.headDeviation.toFixed(2)}</dd>
              <dt>{t('diag.confidence')}</dt>
              <dd>{live.confidence === null ? '—' : `${live.confidence.toFixed(2)} ${live.valid ? '✓' : '✗'}`}</dd>
              <dt>{t('diag.state')}</dt>
              <dd>{live.state}</dd>
              <dt>{t('diag.validRatio')}</dt>
              <dd>{(live.validRatio * 100).toFixed(0)} %</dd>
              <dt>{t('diag.losses')}</dt>
              <dd>{live.losses}</dd>
              <dt>{t('diag.blinkRate')}</dt>
              <dd>{live.blinkRate.toFixed(0)} / min</dd>
            </dl>
          ) : (
            <p className="muted">{t('diag.notRunning')}</p>
          )}
        </section>

        <section className="card">
          <h2>{t('diag.calibration')}</h2>
          {!calibration && <p className="muted">{t('diag.notCalibrated')}</p>}
          {calibration && !calibration.ok && <Notice kind="warn">{t(`calibration.failed.${calibration.reason}`)}</Notice>}
          {calibration?.ok && (
            <dl className="kv">
              <dt>{t('diag.grade')}</dt>
              <dd>{t(`grade.${calibration.quality.grade}`)}</dd>
              <dt>{t('diag.meanError')}</dt>
              <dd>
                {calibration.quality.meanErrorPx.toFixed(0)} px (x {calibration.quality.errorXPx.toFixed(0)}, y {calibration.quality.errorYPx.toFixed(0)})
              </dd>
              <dt>{t('diag.maxError')}</dt>
              <dd>{calibration.quality.maxErrorPx.toFixed(0)} px</dd>
              <dt>{t('diag.jitter')}</dt>
              <dd>{calibration.quality.jitterPx.toFixed(0)} px</dd>
              <dt>{t('diag.relative')}</dt>
              <dd>{(calibration.quality.relativeError * 100).toFixed(1)} %</dd>
              <dt>{t('diag.method')}</dt>
              <dd>
                {calibration.quality.method}, {calibration.quality.model}, {calibration.quality.fitPoints} + {calibration.quality.validationPoints}
              </dd>
            </dl>
          )}
          {lossLog.length > 0 && (
            <ul className="log">
              {lossLog.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>{t('diag.accuracyTest')}</h2>
          <p className="muted">{t('diag.accuracyHint')}</p>
          {measured.length > 0 && (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('diag.target')}</th>
                    <th scope="col">{t('diag.meanError')}</th>
                    <th scope="col">Δx / Δy</th>
                    <th scope="col">{t('diag.jitter')}</th>
                    <th scope="col">n</th>
                  </tr>
                </thead>
                <tbody>
                  {(testResults ?? []).map((r, i) => (
                    <tr key={i}>
                      <td>
                        {r.nx}, {r.ny}
                      </td>
                      <td>{r.errorPx === null ? t('diag.noData') : `${r.errorPx.toFixed(0)} px`}</td>
                      <td>{r.biasX === null ? '—' : `${r.biasX.toFixed(0)} / ${r.biasY!.toFixed(0)}`}</td>
                      <td>{r.precisionPx === null ? '—' : `${r.precisionPx.toFixed(0)} px`}</td>
                      <td>{r.samples}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!testing && (
                <p>
                  <strong>
                    {t('diag.summary', {
                      mean: mean(measured.map((r) => r.errorPx!)).toFixed(0),
                      median: median(measured.map((r) => r.errorPx!)).toFixed(0),
                      percent: ((mean(measured.map((r) => r.errorPx!)) / diag) * 100).toFixed(1),
                      measured: measured.length,
                      total: TEST_TARGETS.length,
                    })}
                  </strong>
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <div ref={dotRef} className="gaze-dot" aria-hidden="true" />
      {testing && (
        <div className="calib calib-test" aria-hidden="true">
          <div className="calib-star calib-collect" data-gaze-target style={{ left: `${TEST_TARGETS[testIndex]![0] * 100}%`, top: `${TEST_TARGETS[testIndex]![1] * 100}%` }} />
        </div>
      )}
      {calibrating && <CalibrationView hub={hub} onDone={onCalibrated} onCancel={() => setCalibrating(false)} />}
    </div>
  );
}
