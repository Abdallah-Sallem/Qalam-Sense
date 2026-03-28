const REGRESSION_THRESHOLD_X = 0.03;
const REGRESSION_MIN_MAGNITUDE = 0.02;

export class RegressionDetector {
  constructor(thresholdX = REGRESSION_THRESHOLD_X, minMagnitude = REGRESSION_MIN_MAGNITUDE) {
    this.thresholdX = thresholdX;
    this.minMagnitude = minMagnitude;
    this.lastX = null;
    this.regressionBuffer = [];
  }

  addPoint(x, timestamp) {
    if (this.lastX === null) {
      this.lastX = x;
      return null;
    }

    const regression = this.detectRegression(x, timestamp);
    this.lastX = x;

    return regression;
  }

  detectRegression(currentX, timestamp) {
    const delta = this.lastX - currentX;

    if (delta > this.thresholdX && delta > this.minMagnitude) {
      const regression = {
        timestamp,
        fromX: this.lastX,
        toX: currentX,
        magnitude: delta,
      };

      this.regressionBuffer.push(regression);

      if (this.regressionBuffer.length > 1000) {
        this.regressionBuffer.shift();
      }

      return regression;
    }

    return null;
  }

  getRegressions() {
    return [...this.regressionBuffer];
  }

  reset() {
    this.lastX = null;
    this.regressionBuffer = [];
  }
}

export function isRegression(previousX, currentX, threshold = REGRESSION_THRESHOLD_X) {
  return previousX - currentX > threshold;
}

export function getRegressionMagnitude(fromX, toX) {
  return Math.abs(fromX - toX);
}
