import { useEffect, useRef, useState } from 'react';
import gazeService from '../services/gazeService';

const GAZE_THROTTLE_MS = 35;

export default function useGazeTracker({ debug = false, enabled = true } = {}) {
  const [gaze, setGaze] = useState(null);
  const [fixations, setFixations] = useState([]);
  const [regressions, setRegressions] = useState([]);
  const [status, setStatus] = useState('initializing');
  const [error, setError] = useState(null);

  const webgazerRef = useRef(null);
  const throttleTimerRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const permissionRef = useRef(false);
  const trackingLoopRef = useRef(null);

  const startTracking = async () => {
    if (!webgazerRef.current) {
      setError('WebGazer not initialized');
      return;
    }

    try {
      if (typeof webgazerRef.current.showVideo === 'function') {
        await webgazerRef.current.showVideo(true);
      }
      if (typeof webgazerRef.current.showPredictionPoints === 'function') {
        await webgazerRef.current.showPredictionPoints(debug);
      }
      if (typeof webgazerRef.current.begin === 'function') {
        await webgazerRef.current.begin();
      }
      gazeService.start();
      setStatus('tracking');
    } catch (err) {
      setError(`Failed to start tracking: ${err.message}`);
      setStatus('error');
    }
  };

  const stopTracking = () => {
    if (trackingLoopRef.current) {
      clearInterval(trackingLoopRef.current);
      trackingLoopRef.current = null;
    }

    if (webgazerRef.current && typeof webgazerRef.current.pause === 'function') {
      webgazerRef.current.pause();
    }
    gazeService.stop();
    setStatus('paused');
  };

  const startCalibration = () => {
    setStatus('calibrating');
    gazeService.startCalibration();
  };

  const recalibrate = async () => {
    if (!webgazerRef.current) {
      return;
    }

    try {
      if (
        webgazerRef.current.calibration &&
        typeof webgazerRef.current.calibration.clear === 'function'
      ) {
        await webgazerRef.current.calibration.clear();
      }
      gazeService.clearCalibrationPoints();
      startCalibration();
    } catch (err) {
      setError(`Recalibration failed: ${err.message}`);
    }
  };

  useEffect(() => {
    if (!enabled) {
      setStatus('disabled');
      return undefined;
    }

    let webgazer;

    const loadWebgazer = async () => {
      try {
        const { default: Webgazer } = await import('webgazer');
        webgazer = Webgazer;
        webgazerRef.current = webgazer;

        if (typeof webgazer.setTracker === 'function') {
          webgazer.setTracker('clmtrackr');
        }
        gazeService.setWebgazer(webgazer);

        permissionRef.current = true;
        setStatus('ready');
      } catch (err) {
        setError(`WebGazer initialization failed: ${err.message}`);
        setStatus('error');
      }
    };

    loadWebgazer();

    return () => {
      if (trackingLoopRef.current) {
        clearInterval(trackingLoopRef.current);
      }
      if (webgazerRef.current) {
        if (typeof webgazerRef.current.end === 'function') {
          webgazerRef.current.end();
        }
      }
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !webgazerRef.current || !permissionRef.current) {
      return;
    }

    const processPrediction = () => {
      if (typeof webgazerRef.current.getCurrentPrediction !== 'function') {
        return;
      }

      const prediction = webgazerRef.current.getCurrentPrediction();
      if (!prediction) {
        return;
      }

      gazeService.processGaze(prediction.x, prediction.y, prediction.confidence || 0.8);
    };

    unsubscribeRef.current = gazeService.subscribe((event) => {
      if (event.type === 'gaze_update') {
        setGaze(event.gaze);
        setFixations(gazeService.getFixations());
        setRegressions(gazeService.getRegressions());
      } else if (event.type === 'tracking_lost') {
        setStatus('tracking_lost');
      } else if (event.type === 'calibration_completed') {
        setStatus('tracking');
      }
    });

    trackingLoopRef.current = setInterval(() => {
      if (status !== 'tracking') {
        return;
      }

      if (throttleTimerRef.current) {
        return;
      }

      processPrediction();

      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
      }, GAZE_THROTTLE_MS);
    }, GAZE_THROTTLE_MS);

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      if (trackingLoopRef.current) {
        clearInterval(trackingLoopRef.current);
        trackingLoopRef.current = null;
      }
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
    };
  }, [enabled, status]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopTracking();
      } else if (status === 'tracking') {
        startTracking();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [status]);

  return {
    gaze,
    fixations,
    regressions,
    status,
    startTracking,
    stopTracking,
    startCalibration,
    recalibrate,
    error,
  };
}
