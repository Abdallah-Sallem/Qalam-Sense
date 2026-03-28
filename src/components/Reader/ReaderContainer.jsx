import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import TextRenderer from './TextRenderer';
import useDirection from '../../hooks/useDirection';
import useTypography from '../../hooks/useTypography';
import { useLanguage } from '../../hooks/useLanguage';
import useInteractionCapture from '../../hooks/useInteractionCapture';
import useGazeTracker from '../../eye-tracking/hooks/useGazeTracker';
import GazeOverlay from '../../eye-tracking/components/GazeOverlay';
import CalibrationOverlay from '../../eye-tracking/components/CalibrationOverlay';
import DebugPanel from '../../eye-tracking/components/DebugPanel';
import interactionService from '../../services/interactionService';
import '../../styles/typography.css';

function ReaderContainer({
  localizedContent,
  paragraphRange,
  enableTracking = true,
  enableEyeTracking = false,
  enableEyeTrackingDebug = false,
}) {
  const { language } = useLanguage();
  const { dir } = useDirection(language);
  const typography = useTypography(language);
  const containerRef = useRef(null);
  const scrollOffsetRef = useRef(0);
  const trackingInitializedRef = useRef(false);
  const [showCalibration, setShowCalibration] = useState(false);

  const {
    gaze,
    status: gazeStatus,
    startTracking,
    startCalibration,
  } = useGazeTracker({
    debug: enableEyeTrackingDebug,
    enabled: enableEyeTracking,
  });

  useInteractionCapture({
    containerRef,
    enableTracking,
    flushInterval: 2000,
  });

  const activeContent = useMemo(() => {
    return localizedContent?.[language] || localizedContent?.fr || { paragraphs: [] };
  }, [language, localizedContent]);

  const readerClassName = useMemo(
    () => clsx('reader-container', typography.fontClass),
    [typography.fontClass]
  );

  const onScrollCapture = useCallback((event) => {
    scrollOffsetRef.current = event.currentTarget.scrollTop;
  }, []);

  useLayoutEffect(() => {
    const containerNode = containerRef.current;
    if (!containerNode) {
      return;
    }

    containerNode.scrollTop = scrollOffsetRef.current;
  }, [language]);

  useEffect(() => {
    if (!enableEyeTracking || trackingInitializedRef.current) {
      return;
    }

    trackingInitializedRef.current = true;
    startTracking();
  }, [enableEyeTracking, startTracking]);

  useEffect(() => {
    if (!enableEyeTracking || !gaze) {
      return;
    }

    interactionService.captureEvent({
      type: 'gaze',
      timestamp: gaze.timestamp,
      x: gaze.x,
      y: gaze.y,
      confidence: gaze.confidence,
      fixationId: gaze.fixationId,
      isRegression: gaze.isRegression,
    });
  }, [enableEyeTracking, gaze]);

  const onCalibrationComplete = useCallback(() => {
    setShowCalibration(false);
  }, []);

  const handleStartCalibration = useCallback(() => {
    startCalibration();
    setShowCalibration(true);
  }, [startCalibration]);

  return (
    <>
      <section
        id="reader-container"
        ref={containerRef}
        className={readerClassName}
        dir={dir}
        lang={language}
        aria-label="Reader content"
        onScroll={onScrollCapture}
      >
        <TextRenderer content={activeContent} paragraphRange={paragraphRange} />
      </section>

      {enableEyeTracking && gaze && <GazeOverlay gaze={gaze} showTrail={enableEyeTrackingDebug} />}

      {enableEyeTracking && enableEyeTrackingDebug && <DebugPanel isVisible />}

      {enableEyeTracking && showCalibration && (
        <CalibrationOverlay onComplete={onCalibrationComplete} pointCount={9} />
      )}

      {enableEyeTracking && enableEyeTrackingDebug && gazeStatus !== 'calibrating' && (
        <button
          type="button"
          className="calibration-button"
          style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 10003 }}
          onClick={handleStartCalibration}
        >
          Start Calibration
        </button>
      )}
    </>
  );
}

export default memo(ReaderContainer);
