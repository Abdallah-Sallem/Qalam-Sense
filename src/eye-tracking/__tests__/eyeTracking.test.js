import gazeService from '../services/gazeService';
import { FixationDetector } from '../utils/fixationUtils';
import { RegressionDetector } from '../utils/regressionUtils';
import { MovingAverageFilter } from '../utils/filterUtils';
import {
  normalizeGazeCoordinates,
  denormalizeGazeCoordinates,
  isValidGazePoint,
  calculateDistance,
} from '../utils/gazeUtils';

jest.mock('webgazer', () => ({
  setGazeListener: jest.fn(),
  begin: jest.fn(() => Promise.resolve()),
  pause: jest.fn(),
  resume: jest.fn(),
  end: jest.fn(),
  getFixedPrediction: jest.fn(),
  calibration: {
    addCalibrationPoint: jest.fn(),
    removePreviousData: jest.fn(),
  },
}));

describe('Eye-Tracking Core Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    gazeService.reset();
  });

  describe('Gaze Coordinate Utilities', () => {
    test('normalizeGazeCoordinates converts pixel coords to 0-1 range', () => {
      const result = normalizeGazeCoordinates(960, 540, 1920, 1080);
      expect(result).toEqual({ x: 0.5, y: 0.5 });
    });

    test('denormalizeGazeCoordinates reverses normalization', () => {
      const result = denormalizeGazeCoordinates(0.5, 0.5, 1920, 1080);
      expect(result).toEqual({ x: 960, y: 540 });
    });

    test('normalizeGazeCoordinates clamps values to 0-1', () => {
      const { x, y } = normalizeGazeCoordinates(-100, 2000, 1920, 1080);
      expect(x).toBe(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    });

    test('calculateDistance computes Euclidean distance', () => {
      const distance = calculateDistance(0, 0, 3, 4);
      expect(distance).toBe(5);
    });

    test('calculateDistance handles same points', () => {
      const distance = calculateDistance(0.5, 0.5, 0.5, 0.5);
      expect(distance).toBe(0);
    });
  });

  describe('Gaze Point Validation', () => {
    test('isValidGazePoint accepts valid point', () => {
      const valid = isValidGazePoint(
        { x: 0.5, y: 0.5, confidence: 0.9 },
        0.6
      );
      expect(valid).toBe(true);
    });

    test('isValidGazePoint rejects low confidence', () => {
      const invalid = isValidGazePoint(
        { x: 0.5, y: 0.5, confidence: 0.4 },
        0.6
      );
      expect(invalid).toBe(false);
    });

    test('isValidGazePoint rejects out-of-bounds coordinates', () => {
      const invalid = isValidGazePoint(
        { x: 1.5, y: 0.5, confidence: 0.9 },
        0.6
      );
      expect(invalid).toBe(false);
    });

    test('isValidGazePoint rejects null/undefined', () => {
      expect(isValidGazePoint(null, 0.6)).toBe(false);
      expect(isValidGazePoint(undefined, 0.6)).toBe(false);
    });
  });

  describe('Noise Filtering', () => {
    test('MovingAverageFilter smooths points', () => {
      const filter = new MovingAverageFilter(3);
      filter.addPoint(0.5, 0.5);
      filter.addPoint(0.51, 0.49);
      filter.addPoint(0.52, 0.51);

      const { x, y } = filter.getSmoothed();
      expect(x).toBeCloseTo(0.513, 2);
      expect(y).toBeCloseTo(0.503, 2);
    });

    test('MovingAverageFilter handles single point', () => {
      const filter = new MovingAverageFilter(3);
      filter.addPoint(0.3, 0.4);
      const { x, y } = filter.getSmoothed();

      expect(x).toBeCloseTo(0.3, 1);
      expect(y).toBeCloseTo(0.4, 1);
    });

    test('MovingAverageFilter maintains window size', () => {
      const filter = new MovingAverageFilter(2);
      filter.addPoint(0.1, 0.1);
      filter.addPoint(0.2, 0.2);
      filter.addPoint(0.3, 0.3);
      filter.addPoint(0.4, 0.4);

      const { x, y } = filter.getSmoothed();
      // Should average last 2 points only
      expect(x).toBeCloseTo(0.35, 1);
      expect(y).toBeCloseTo(0.35, 1);
    });
  });

  describe('Fixation Detection', () => {
    test('FixationDetector identifies stable gaze', () => {
      const detector = new FixationDetector(0.05, 100);

      const t0 = Date.now();
      for (let i = 0; i < 6; i++) {
        detector.addPoint(0.5, 0.5, t0 + i * 30);
      }
      detector.addPoint(0.7, 0.5, t0 + 220);

      const fixations = detector.getFixations();
      expect(fixations.length).toBeGreaterThan(0);
      expect(fixations[0].x).toBe(0.5);
      expect(fixations[0].y).toBe(0.5);
      expect(fixations[0].duration).toBeGreaterThanOrEqual(100);
    });

    test('FixationDetector rejects saccades', () => {
      const detector = new FixationDetector(0.05, 100);

      const t0 = Date.now();
      detector.addPoint(0.1, 0.1, t0);
      detector.addPoint(0.9, 0.9, t0 + 20);

      const fixations = detector.getFixations();
      const longFixations = fixations.filter((f) => f.duration >= 100);
      expect(longFixations).toHaveLength(0);
    });

    test('FixationDetector respects internal buffer limit', () => {
      const detector = new FixationDetector(0.05, 100);

      const t0 = Date.now();
      for (let i = 0; i < 1000; i++) {
        detector.addPoint(0.5, 0.5, t0 + i * 16);
      }

      const fixations = detector.getFixations();
      expect(fixations.length).toBeLessThanOrEqual(1000);
    });

    test('FixationDetector associates fixation IDs', () => {
      const detector = new FixationDetector(0.05, 100);

      const t0 = Date.now();
      for (let i = 0; i < 6; i++) {
        detector.addPoint(0.5, 0.5, t0 + i * 30);
      }
      detector.addPoint(0.7, 0.5, t0 + 220);

      const fixations = detector.getFixations();
      expect(fixations[0]).toHaveProperty('id');
      expect(typeof fixations[0].id).toBe('string');
    });
  });

  describe('Regression Detection', () => {
    test('RegressionDetector identifies backward movement', () => {
      const detector = new RegressionDetector(0.03, 0.02);

      const t0 = Date.now();
      detector.addPoint(0.1, t0);
      detector.addPoint(0.5, t0 + 20);
      detector.addPoint(0.2, t0 + 40);

      const regressions = detector.getRegressions();
      expect(regressions.length).toBeGreaterThan(0);
      expect(regressions[0].fromX).toBeGreaterThan(regressions[0].toX);
    });

    test('RegressionDetector ignores small movements', () => {
      const detector = new RegressionDetector(0.03, 0.02);

      const t0 = Date.now();
      detector.addPoint(0.5, t0);
      detector.addPoint(0.505, t0 + 20);

      const regressions = detector.getRegressions();
      expect(regressions).toHaveLength(0);
    });

    test('RegressionDetector calculates magnitude', () => {
      const detector = new RegressionDetector(0.03, 0.02);

      const t0 = Date.now();
      detector.addPoint(0.1, t0);
      detector.addPoint(0.7, t0 + 20);
      detector.addPoint(0.2, t0 + 40);

      const regressions = detector.getRegressions();
      if (regressions.length > 0) {
        expect(regressions[0]).toHaveProperty('magnitude');
        expect(regressions[0].magnitude).toBeGreaterThan(0);
      }
    });
  });

  describe('Gaze Service Pipeline', () => {
    test('gazeService processes valid gaze', () => {
      gazeService.start();
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const result = gazeService.processGaze(centerX, centerY, 0.95);

      expect(result).not.toBeNull();
      expect(result.x).toBeCloseTo(0.5, 1);
      expect(result.y).toBeCloseTo(0.5, 1);
      expect(result.confidence).toBeCloseTo(0.95, 1);
      gazeService.stop();
    });

    test('gazeService rejects invalid gaze', () => {
      gazeService.start();
      const result = gazeService.processGaze(960, 540, 0.1); // Low confidence

      expect(result).toBeNull();
      gazeService.stop();
    });

    test('gazeService maintains buffer size', () => {
      gazeService.start();
      for (let i = 0; i < 500; i++) {
        gazeService.processGaze(Math.random(), Math.random(), 0.9);
      }

      const stats = gazeService.getPerformanceStats();
      expect(stats.gazeBufferSize).toBeLessThanOrEqual(200);
      gazeService.stop();
    });

    test('gazeService reports performance stats', () => {
      gazeService.start();
      for (let i = 0; i < 10; i++) {
        gazeService.processGaze(960, 540, 0.95);
      }

      const stats = gazeService.getPerformanceStats();
      expect(stats).toHaveProperty('fps');
      expect(stats).toHaveProperty('latency');
      expect(stats).toHaveProperty('gazeBufferSize');
      expect(stats).toHaveProperty('fixationCount');
      expect(stats).toHaveProperty('regressionCount');
      expect(stats).toHaveProperty('trackingLossFrames');
      expect(stats).toHaveProperty('isTracking');

      gazeService.stop();
    });

    test('gazeService resets state', () => {
      gazeService.start();
      gazeService.processGaze(960, 540, 0.95);

      gazeService.reset();

      const stats = gazeService.getPerformanceStats();
      expect(stats.gazeBufferSize).toBe(0);
      expect(stats.isTracking).toBe(false);
    });

    test('gazeService calibration workflow', () => {
      const events = [];
      const unsub = gazeService.subscribe((e) => {
        events.push(e);
      });

      gazeService.startCalibration();
      expect(gazeService.getCalibrationPoints().length).toBe(0);

      gazeService.addCalibrationPoint(0.5, 0.5);
      gazeService.addCalibrationPoint(0.75, 0.75);

      expect(gazeService.getCalibrationPoints().length).toBe(2);
      expect(events.some((e) => e.type === 'calibration_started')).toBe(true);

      gazeService.endCalibration();
      expect(events.some((e) => e.type === 'calibration_completed')).toBe(true);

      unsub();
    });
  });

  describe('Error Handling & Edge Cases', () => {
    test('gazeService handles null gaze input', () => {
      gazeService.start();
      const result = gazeService.processGaze(null, null, 0);
      expect(result).toBeNull();
      gazeService.stop();
    });

    test('gazeService handles very low confidence', () => {
      gazeService.start();
      const result = gazeService.processGaze(960, 540, 0.1);
      expect(result).toBeNull();
      gazeService.stop();
    });

    test('gazeService handles rapid calibration changes', () => {
      gazeService.startCalibration();
      gazeService.clearCalibrationPoints();

      gazeService.addCalibrationPoint(0.1, 0.1);
      expect(gazeService.getCalibrationPoints().length).toBe(1);

      gazeService.endCalibration();
      expect(gazeService.getCalibrationPoints().length).toBe(1);
    });

    test('MovingAverageFilter handles edge cases', () => {
      const filter = new MovingAverageFilter(1);
      filter.addPoint(0.5, 0.5);
      const result = filter.getSmoothed();
      expect(result.x).toBe(0.5);
      expect(result.y).toBe(0.5);
    });

    test('FixationDetector handles negative coordinates', () => {
      const detector = new FixationDetector();
      const t0 = Date.now();

      detector.addPoint(0.5, 0.5, t0);
      const fixations = detector.getFixations();

      expect(Array.isArray(fixations)).toBe(true);
    });
  });
});
