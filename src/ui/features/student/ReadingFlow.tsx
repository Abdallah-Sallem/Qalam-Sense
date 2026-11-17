/**
 * One reading session from the child's point of view:
 * welcome → (camera helper: check → calibration) → reading → summary.
 *
 * The camera is optional at every step. Whatever goes wrong with it, the
 * child can always read; the reason is recorded in the session summary.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/app/AppContext';
import { navigate } from '@/app/router';
import type { Baseline } from '@/difficulty/types';
import type { CameraOutcome, SessionSummary, Student, TextDoc } from '@/domain/types';
import { Emitter } from '@/lib/emitter';
import type { GazeSetup } from '@/session/pipeline';
import { Button, Notice, Spinner, formatDuration, useErrorText } from '@/ui/components/ui';
import type { CalibrationResult } from '@/vision/calibration';
import { VisionError } from '@/vision/camera';
import { assessFrame, assessLighting } from '@/vision/frameQuality';
import { createObservationSource } from '@/vision/sourceFactory';
import type { FrameIssue, LightingIssue, ObservationSource, VisionFrame } from '@/vision/types';
import { CalibrationView, type FrameHub } from './CalibrationView';
import { Reader, maxDurationFor } from './Reader';

type Stage = 'welcome' | 'camera' | 'calibration' | 'calibration-result' | 'reading' | 'done';
const MAX_CALIBRATION_ATTEMPTS = 3;

interface Loaded {
  text: TextDoc;
  student: Student;
  cameraAllowed: boolean;
  baseline: Baseline | null;
}

export function ReadingFlow({ textId }: { textId: string }) {
  const { t } = useTranslation();
  const { services } = useApp();
  const errorText = useErrorText();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('welcome');
  const [camera, setCamera] = useState<CameraOutcome>('no-consent');
  const [gaze, setGaze] = useState<GazeSetup | null>(null);
  const [calibration, setCalibration] = useState<CalibrationResult | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [cameraLost, setCameraLost] = useState(false);
  const [result, setResult] = useState<{ summary: SessionSummary; saved: boolean; saveError: string | null } | null>(null);

  const sourceRef = useRef<ObservationSource | null>(null);
  const hubRef = useRef<FrameHub>(new Emitter<{ frame: VisionFrame }>());

  useEffect(() => {
    let alive = true;
    (async () => {
      const [text, student, cameraAllowed] = await Promise.all([services.student.text(textId), services.student.profile(), services.student.cameraAllowed()]);
      const baseline = await services.student.baseline(text.language);
      if (alive) setLoaded({ text, student, cameraAllowed, baseline });
    })().catch((err) => alive && setLoadError(errorText(err)));
    return () => {
      alive = false;
    };
  }, [services, textId, errorText]);

  const stopCamera = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current = null;
  }, []);
  // The camera must never outlive this screen.
  useEffect(() => stopCamera, [stopCamera]);

  const readWithoutCamera = useCallback(
    (outcome: CameraOutcome) => {
      stopCamera();
      setGaze(null);
      setCamera(outcome);
      setStage('reading');
    },
    [stopCamera],
  );

  const onFinish = useCallback(
    (summary: SessionSummary, baseline: Baseline | null) => {
      stopCamera();
      setResult({ summary, saved: false, saveError: null });
      setStage('done');
      // Very short visits are not reading sessions: nothing is stored for them.
      if (summary.durationMs < 15_000) return;
      (async () => {
        await services.student.saveSession(summary);
        if (baseline && summary.gaze) await services.student.saveBaseline(summary.language, baseline);
      })().then(
        () => setResult((r) => r && { ...r, saved: true }),
        (err) => setResult((r) => r && { ...r, saveError: errorText(err) }),
      );
    },
    [services, stopCamera, errorText],
  );

  if (loadError) {
    return (
      <main className="page page-narrow">
        <Notice kind="error">{loadError}</Notice>
        <Button onClick={() => navigate('')}>{t('common.back')}</Button>
      </main>
    );
  }
  if (!loaded) {
    return (
      <main className="page page-narrow">
        <Spinner label={t('common.loading')} />
      </main>
    );
  }
  const { text, student } = loaded;

  if (stage === 'welcome') {
    return (
      <main className="page page-narrow flow">
        <h1 lang={text.language} dir={text.language === 'ar' ? 'rtl' : 'ltr'}>
          {text.title}
        </h1>
        <p className="lead">{t('flow.welcome', { name: student.displayName })}</p>
        <ul className="tips">
          <li>{t('flow.tipSit')}</li>
          <li>{t('flow.tipTime', { minutes: Math.round(maxDurationFor(student.age) / 60_000) })}</li>
          <li>{t('flow.tipControls')}</li>
        </ul>
        {loaded.cameraAllowed ? (
          <section className="card">
            <h2>{t('flow.helperTitle')}</h2>
            <p>{t('flow.helperBody')}</p>
            <p className="muted">{t('flow.helperPrivacy')}</p>
            <div className="row">
              <Button variant="primary" onClick={() => setStage('camera')}>
                {t('flow.helperYes')}
              </Button>
              <Button onClick={() => readWithoutCamera('declined')}>{t('flow.helperNo')}</Button>
            </div>
          </section>
        ) : (
          <section className="card">
            <p>{t('flow.noConsent')}</p>
            <Button variant="primary" onClick={() => readWithoutCamera('no-consent')}>
              {t('flow.start')}
            </Button>
          </section>
        )}
        <Button variant="ghost" onClick={() => navigate('')}>
          {t('common.back')}
        </Button>
      </main>
    );
  }

  if (stage === 'camera') {
    return (
      <CameraCheck
        hub={hubRef.current}
        sourceRef={sourceRef}
        onReady={() => setStage('calibration')}
        onSkip={readWithoutCamera}
        onLost={() => setCameraLost(true)}
      />
    );
  }

  if (stage === 'calibration') {
    return (
      <CalibrationView
        hub={hubRef.current}
        onCancel={() => readWithoutCamera('declined')}
        onDone={(res) => {
          setAttempts((n) => n + 1);
          setCalibration(res);
          if (res.ok && res.quality.grade !== 'poor') {
            setGaze({ model: res.model, quality: res.quality, viewport: res.viewport });
            setCamera('used');
            setStage('reading');
          } else {
            setStage('calibration-result');
          }
        }}
      />
    );
  }

  if (stage === 'calibration-result' && calibration) {
    const canRetry = attempts < MAX_CALIBRATION_ATTEMPTS;
    return (
      <main className="page page-narrow flow">
        <h1>{t(calibration.ok ? 'calibration.poorTitle' : 'calibration.failedTitle')}</h1>
        <p className="lead">{t(calibration.ok ? 'calibration.poorBody' : `calibration.failed.${calibration.reason}`)}</p>
        <ul className="tips">
          <li>{t('calibration.tipLight')}</li>
          <li>{t('calibration.tipHead')}</li>
          <li>{t('calibration.tipGlasses')}</li>
        </ul>
        <div className="row">
          {canRetry && (
            <Button variant="primary" onClick={() => setStage('calibration')}>
              {t('calibration.retry')}
            </Button>
          )}
          {calibration.ok && (
            <Button
              onClick={() => {
                setGaze({ model: calibration.model, quality: calibration.quality, viewport: calibration.viewport });
                setCamera('used');
                setStage('reading');
              }}
            >
              {t('calibration.continueAnyway')}
            </Button>
          )}
          <Button variant={canRetry ? 'secondary' : 'primary'} onClick={() => readWithoutCamera('calibration-failed')}>
            {t('flow.helperNo')}
          </Button>
        </div>
      </main>
    );
  }

  if (stage === 'reading') {
    return (
      <Reader
        text={text}
        student={student}
        hub={gaze ? hubRef.current : null}
        gaze={gaze}
        camera={camera}
        baseline={loaded.baseline}
        cameraLost={cameraLost}
        onFinish={onFinish}
      />
    );
  }

  // done
  const s = result?.summary;
  return (
    <main className="page page-narrow flow done">
      <div className="done-mark" aria-hidden="true">
        ★
      </div>
      <h1>{t(s?.endReason === 'completed' ? 'done.completed' : s?.endReason === 'time-limit' ? 'done.timeUp' : 'done.stopped', { name: student.displayName })}</h1>
      <p className="lead">{t(s?.endReason === 'time-limit' ? 'done.timeUpBody' : 'done.body')}</p>
      {s && (
        <dl className="stats">
          <div>
            <dt>{t('done.words')}</dt>
            <dd>{s.wordsRead}</dd>
          </div>
          <div>
            <dt>{t('done.time')}</dt>
            <dd>{formatDuration(s.durationMs)}</dd>
          </div>
        </dl>
      )}
      {result?.saveError && <Notice kind="warn">{t('done.notSaved', { reason: result.saveError })}</Notice>}
      <Button variant="primary" onClick={() => navigate('')}>
        {t('done.back')}
      </Button>
    </main>
  );
}

const READY_AFTER_MS = 1200;

/** Starts the camera, shows the child their face, and coaches position and light. */
function CameraCheck({
  hub,
  sourceRef,
  onReady,
  onSkip,
  onLost,
}: {
  hub: FrameHub;
  sourceRef: React.RefObject<ObservationSource | null>;
  onReady: () => void;
  onSkip: (outcome: CameraOutcome) => void;
  onLost: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'starting' | 'running' | 'error'>('starting');
  const [error, setError] = useState<VisionError | null>(null);
  const [issue, setIssue] = useState<FrameIssue | null>('no-face');
  const [light, setLight] = useState<LightingIssue | null>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    let source: ObservationSource | null = null;
    setStatus('starting');
    setError(null);
    (async () => {
      source = await createObservationSource({ onError: onLost });
      await source.start((frame) => hub.emit('frame', frame));
      if (cancelled) {
        source.stop();
        return;
      }
      sourceRef.current = source;
      if (videoRef.current && source.stream) {
        videoRef.current.srcObject = source.stream;
        void videoRef.current.play().catch(() => {});
      }
      setStatus('running');
    })().catch((err: unknown) => {
      source?.stop();
      if (cancelled) return;
      setError(err instanceof VisionError ? err : new VisionError('unsupported', err));
      setStatus('error');
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, hub, sourceRef, onLost]);

  useEffect(() => {
    let goodSince = 0;
    let shown: string | null = 'no-face';
    return hub.on('frame', (frame) => {
      const { usable, issues } = assessFrame(frame.observation);
      const first = issues.find((i) => i !== 'eyes-closed') ?? null;
      if (first !== shown) {
        shown = first;
        setIssue(first);
      }
      setLight((prev) => {
        const l = assessLighting(frame.luma);
        return l === prev ? prev : l;
      });
      if (usable || issues.every((i) => i === 'eyes-closed')) {
        goodSince ||= frame.t;
        if (frame.t - goodSince >= READY_AFTER_MS) setReady(true);
      } else {
        goodSince = 0;
        setReady(false);
      }
    });
  }, [hub]);

  if (status === 'error' && error) {
    const outcome: CameraOutcome =
      error.code === 'permission-denied' ? 'permission-denied' : error.code === 'model-missing' || error.code === 'model-failed' ? 'model-missing' : 'unavailable';
    return (
      <main className="page page-narrow flow">
        <h1>{t('camera.problemTitle')}</h1>
        <Notice kind="warn">{t(`camera.error.${error.code}`)}</Notice>
        <p>{t('camera.problemBody')}</p>
        <div className="row">
          <Button onClick={() => setAttempt((n) => n + 1)}>{t('camera.retry')}</Button>
          <Button variant="primary" onClick={() => onSkip(outcome)}>
            {t('flow.helperNo')}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="page page-narrow flow">
      <h1>{t('camera.checkTitle')}</h1>
      <p className="lead">{t('camera.checkBody')}</p>
      <div className={`camera-frame ${ready ? 'is-ready' : ''}`}>
        <video ref={videoRef} className="camera-video" muted playsInline aria-hidden="true" />
        <div className="camera-oval" aria-hidden="true" />
        {status === 'starting' && <Spinner label={t('camera.starting')} />}
      </div>
      <p className="camera-status" role="status">
        {status === 'starting' ? t('camera.starting') : issue ? t(`camera.issue.${issue}`) : light ? t(`camera.light.${light}`) : t('camera.good')}
      </p>
      <div className="row">
        <Button variant="primary" onClick={onReady} disabled={!ready}>
          {t('camera.ready')}
        </Button>
        <Button onClick={() => onSkip('declined')}>{t('flow.helperNo')}</Button>
      </div>
    </main>
  );
}
