import { calculateDistance } from './gazeUtils';

const FIXATION_RADIUS_THRESHOLD = 50;
const FIXATION_DURATION_MIN = 100;

export class FixationDetector {
  constructor(radiusThreshold = FIXATION_RADIUS_THRESHOLD, durationMin = FIXATION_DURATION_MIN) {
    this.radiusThreshold = radiusThreshold;
    this.durationMin = durationMin;
    this.currentFixation = null;
    this.fixationBuffer = [];
    this.fixationIdCounter = 0;
  }

  addPoint(x, y, timestamp) {
    if (!this.currentFixation) {
      this.currentFixation = {
        id: `f${this.fixationIdCounter++}`,
        x,
        y,
        startTime: timestamp,
        points: [{ x, y, timestamp }],
      };
      return null;
    }

    const distance = calculateDistance(this.currentFixation.x, this.currentFixation.y, x, y);

    if (distance > this.radiusThreshold) {
      const fixation = this.endFixation(timestamp);
      this.currentFixation = {
        id: `f${this.fixationIdCounter++}`,
        x,
        y,
        startTime: timestamp,
        points: [{ x, y, timestamp }],
      };
      return fixation;
    }

    this.currentFixation.points.push({ x, y, timestamp });
    const centerX = this.currentFixation.points.reduce((sum, p) => sum + p.x, 0) / this.currentFixation.points.length;
    const centerY = this.currentFixation.points.reduce((sum, p) => sum + p.y, 0) / this.currentFixation.points.length;

    this.currentFixation.x = centerX;
    this.currentFixation.y = centerY;

    return null;
  }

  endFixation(timestamp) {
    if (!this.currentFixation) {
      return null;
    }

    const duration = timestamp - this.currentFixation.startTime;

    if (duration < this.durationMin) {
      return null;
    }

    const fixation = {
      id: this.currentFixation.id,
      x: this.currentFixation.x,
      y: this.currentFixation.y,
      duration,
      start: this.currentFixation.startTime,
      end: timestamp,
      sampleCount: this.currentFixation.points.length,
    };

    this.fixationBuffer.push(fixation);

    if (this.fixationBuffer.length > 1000) {
      this.fixationBuffer.shift();
    }

    this.currentFixation = null;

    return fixation;
  }

  getFixations() {
    return [...this.fixationBuffer];
  }

  reset() {
    this.currentFixation = null;
    this.fixationBuffer = [];
  }
}

export function isFixationComplete(fixation) {
  return fixation && fixation.duration && fixation.duration >= FIXATION_DURATION_MIN;
}
