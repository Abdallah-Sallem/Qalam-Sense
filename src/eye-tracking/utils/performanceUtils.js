export class PerformanceMonitor {
  constructor() {
    this.frameTimestamps = [];
    this.maxFrames = 60;
  }

  recordFrame() {
    this.frameTimestamps.push(Date.now());

    if (this.frameTimestamps.length > this.maxFrames) {
      this.frameTimestamps.shift();
    }
  }

  getFPS() {
    if (this.frameTimestamps.length < 2) {
      return 0;
    }

    const timeSpan = this.frameTimestamps[this.frameTimestamps.length - 1] - this.frameTimestamps[0];
    const fps = (this.frameTimestamps.length - 1) / (timeSpan / 1000);

    return Math.round(fps);
  }

  getAverageLatency() {
    if (this.frameTimestamps.length < 2) {
      return 0;
    }

    const gaps = [];
    for (let i = 1; i < this.frameTimestamps.length; i += 1) {
      gaps.push(this.frameTimestamps[i] - this.frameTimestamps[i - 1]);
    }

    return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  }

  reset() {
    this.frameTimestamps = [];
  }
}

export function getMemoryUsage() {
  if (typeof performance === 'undefined' || !performance.memory) {
    return null;
  }

  return {
    usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1048576),
    totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1048576),
    jsHeapSizeLimit: Math.round(performance.memory.jsHeapSizeLimit / 1048576),
  };
}
