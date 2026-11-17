/**
 * Full-screen calibration for children: "follow the star with your eyes".
 * No clicks are needed once it starts. The state machine lives in
 * vision/calibration.ts; this component only draws what it describes.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Emitter } from '@/lib/emitter';
import { Button } from '@/ui/components/ui';
import { CALIBRATION_TIMING, CalibrationSession, type CalibrationProgress, type CalibrationResult } from '@/vision/calibration';
import type { FrameIssue, VisionFrame } from '@/vision/types';

export type FrameHub = Emitter<{ frame: VisionFrame }>;

interface Props {
  hub: FrameHub;
  onDone: (result: CalibrationResult) => void;
  onCancel: () => void;
}

export function CalibrationView({ hub, onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<Pick<CalibrationProgress, 'target' | 'phase' | 'completed' | 'total'> | null>(null);
  const [issue, setIssue] = useState<FrameIssue | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!running) return;
    const session = new CalibrationSession({ width: window.innerWidth, height: window.innerHeight });
    let started = false;
    let issueSince = 0;
    let lastKey = '';
    const off = hub.on('frame', (frame) => {
      if (!started) {
        session.start(frame.t);
        started = true;
      }
      const p = session.update(frame.t, frame.observation);
      if (p.done) {
        off();
        done.current(session.finish());
        return;
      }
      // Re-render only when something visible changes, not on every frame.
      const key = `${p.target?.id}|${p.phase}|${p.completed}`;
      if (key !== lastKey) {
        lastKey = key;
        setView({ target: p.target, phase: p.phase, completed: p.completed, total: p.total });
      }
      // Coach only about problems that last: a blink is not a problem.
      if (!p.issue || p.issue === 'eyes-closed') {
        issueSince = 0;
        setIssue(null);
      } else {
        issueSince ||= frame.t;
        if (frame.t - issueSince > 1200) setIssue(p.issue);
      }
    });
    return off;
  }, [running, hub]);

  if (!running) {
    return (
      <div className="calib calib-intro" role="dialog" aria-modal="true" aria-label={t('calibration.title')}>
        <div className="calib-card">
          <div className="calib-star calib-star-demo" aria-hidden="true" />
          <h2>{t('calibration.title')}</h2>
          <ol className="calib-steps">
            <li>{t('calibration.step1')}</li>
            <li>{t('calibration.step2')}</li>
            <li>{t('calibration.step3')}</li>
          </ol>
          <div className="row">
            <Button variant="primary" onClick={() => setRunning(true)} autoFocus>
              {t('calibration.start')}
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              {t('calibration.skip')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const target = view?.target;
  return (
    <div className="calib" role="dialog" aria-modal="true" aria-label={t('calibration.title')}>
      <p className="calib-hint" role="status">
        {issue ? t(`camera.issue.${issue}`) : t('calibration.follow')}
      </p>
      {target && (
        <div
          className={`calib-star calib-${view.phase}`}
          data-gaze-target
          style={{
            left: `${target.nx * 100}%`,
            top: `${target.ny * 100}%`,
            transitionDuration: `${CALIBRATION_TIMING.travelMs}ms`,
          }}
          aria-hidden="true"
        />
      )}
      <div className="calib-progress" aria-hidden="true">
        {Array.from({ length: view?.total ?? 13 }, (_, i) => (
          <span key={i} className={i < (view?.completed ?? 0) ? 'on' : ''} />
        ))}
      </div>
      <Button variant="ghost" className="calib-cancel" onClick={onCancel}>
        {t('calibration.skip')}
      </Button>
    </div>
  );
}
