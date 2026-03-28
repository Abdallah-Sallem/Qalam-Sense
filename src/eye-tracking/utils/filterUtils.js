export class MovingAverageFilter {
  constructor(windowSize = 7) {
    this.windowSize = windowSize;
    this.xBuffer = [];
    this.yBuffer = [];
  }

  addPoint(x, y) {
    this.xBuffer.push(x);
    this.yBuffer.push(y);

    if (this.xBuffer.length > this.windowSize) {
      this.xBuffer.shift();
      this.yBuffer.shift();
    }
  }

  getSmoothed() {
    if (this.xBuffer.length === 0) {
      return null;
    }

    const avgX = this.xBuffer.reduce((a, b) => a + b, 0) / this.xBuffer.length;
    const avgY = this.yBuffer.reduce((a, b) => a + b, 0) / this.yBuffer.length;

    return { x: avgX, y: avgY };
  }

  reset() {
    this.xBuffer = [];
    this.yBuffer = [];
  }
}

export class KalmanFilter {
  constructor(q = 0.01, r = 5) {
    this.q = q;
    this.r = r;
    this.p = 1;
    this.x = 0;
    this.k = 0;
  }

  update(z) {
    this.p += this.q;
    this.k = this.p / (this.p + this.r);
    this.x += this.k * (z - this.x);
    this.p *= 1 - this.k;
    return this.x;
  }

  reset() {
    this.p = 1;
    this.x = 0;
    this.k = 0;
  }
}

export function applyFilter(point, method = 'movingAverage', filter) {
  if (!point) {
    return null;
  }

  if (method === 'kalman' && filter) {
    return {
      x: filter.xFilter.update(point.x),
      y: filter.yFilter.update(point.y),
    };
  }

  if (method === 'movingAverage' && filter) {
    filter.addPoint(point.x, point.y);
    return filter.getSmoothed();
  }

  return point;
}
