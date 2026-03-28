import { createGazeEvent, isValidGazePoint, normalizeGazeCoordinates } from '../utils/gazeUtils';
import { MovingAverageFilter } from '../utils/filterUtils';
import { FixationDetector } from '../utils/fixationUtils';
import { RegressionDetector } from '../utils/regressionUtils';
import { PerformanceMonitor } from '../utils/performanceUtils';

class GazeService {
  constructor() {
    this.isTracking = false;
    this.isCalibrating = false;
    this.gazeBuffer = [];
    this.calibrationPoints = [];
    this.fixationDetector = new FixationDetector();
    this.regressionDetector = new RegressionDetector();
    this.movingAverageFilter = new MovingAverageFilter(7);
    this.performanceMonitor = new PerformanceMonitor();
    this.listeners = new Set();
    this.webgazer = null;
    this.trackingStartTime = null;
    this.lastValidGaze = null;
    this.trackingLossFrames = 0;
    this.maxTrackingLossFrames = 30;
  }

  setWebgazer(webgazer) {
    this.webgazer = webgazer;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.warn('Gaze listener error:', error);
      }
    });
  }

  processGaze(rawX, rawY, confidence) {
    this.performanceMonitor.recordFrame();

    const normalized = normalizeGazeCoordinates(rawX, rawY);

    if (!isValidGazePoint({ ...normalized, confidence })) {
      this.trackingLossFrames += 1;

      if (this.trackingLossFrames > this.maxTrackingLossFrames) {
        this.emit({ type: 'tracking_lost', trackingLossFrames: this.trackingLossFrames });
      }

      return null;
    }

    this.trackingLossFrames = 0;
    const timestamp = Date.now();
    this.lastValidGaze = { ...normalized, confidence };

    this.movingAverageFilter.addPoint(normalized.x, normalized.y);
    const smoothed = this.movingAverageFilter.getSmoothed();

    const gazeEvent = createGazeEvent(smoothed.x, smoothed.y, confidence, timestamp);

    const fixation = this.fixationDetector.addPoint(smoothed.x, smoothed.y, timestamp);
    if (fixation) {
      gazeEvent.fixationId = fixation.id;
      this.emit({ type: 'fixation_detected', fixation });
    }

    const regression = this.regressionDetector.addPoint(smoothed.x, timestamp);
    if (regression) {
      gazeEvent.isRegression = true;
      this.emit({ type: 'regression_detected', regression });
    }

    this.gazeBuffer.push(gazeEvent);

    if (this.gazeBuffer.length > 200) {
      this.gazeBuffer.shift();
    }

    this.emit({ type: 'gaze_update', gaze: gazeEvent });

    return gazeEvent;
  }

  addCalibrationPoint(x, y) {
    if (!this.isCalibrating) {
      return false;
    }

    this.calibrationPoints.push({ x, y, count: 1 });
    this.emit({ type: 'calibration_point_added', pointCount: this.calibrationPoints.length });

    return true;
  }

  getCalibrationPoints() {
    return [...this.calibrationPoints];
  }

  clearCalibrationPoints() {
    this.calibrationPoints = [];
  }

  startCalibration() {
    this.isCalibrating = true;
    this.calibrationPoints = [];
    this.emit({ type: 'calibration_started' });
  }

  endCalibration() {
    this.isCalibrating = false;
    this.emit({ type: 'calibration_completed', pointCount: this.calibrationPoints.length });
  }

  start() {
    if (this.isTracking) {
      return;
    }

    this.isTracking = true;
    this.trackingStartTime = Date.now();
    this.gazeBuffer = [];
    this.fixationDetector.reset();
    this.regressionDetector.reset();
    this.movingAverageFilter.reset();
    this.performanceMonitor.reset();

    this.emit({ type: 'tracking_started' });
  }

  stop() {
    if (!this.isTracking) {
      return;
    }

    this.isTracking = false;
    this.emit({ type: 'tracking_stopped' });
  }

  getGazeBuffer() {
    return [...this.gazeBuffer];
  }

  getFixations() {
    return this.fixationDetector.getFixations();
  }

  getRegressions() {
    return this.regressionDetector.getRegressions();
  }

  getPerformanceStats() {
    return {
      fps: this.performanceMonitor.getFPS(),
      latency: this.performanceMonitor.getAverageLatency(),
      gazeBufferSize: this.gazeBuffer.length,
      fixationCount: this.fixationDetector.getFixations().length,
      regressionCount: this.regressionDetector.getRegressions().length,
      trackingLossFrames: this.trackingLossFrames,
      isTracking: this.isTracking,
    };
  }

  reset() {
    this.isTracking = false;
    this.isCalibrating = false;
    this.gazeBuffer = [];
    this.calibrationPoints = [];
    this.fixationDetector.reset();
    this.regressionDetector.reset();
    this.movingAverageFilter.reset();
    this.performanceMonitor.reset();
    this.lastValidGaze = null;
    this.trackingLossFrames = 0;
  }
}

export default new GazeService();
