export function normalizeGazeCoordinates(x, y, windowWidth = window.innerWidth, windowHeight = window.innerHeight) {
  return {
    x: Math.max(0, Math.min(1, x / windowWidth)),
    y: Math.max(0, Math.min(1, y / windowHeight)),
  };
}

export function denormalizeGazeCoordinates(normalizedX, normalizedY, windowWidth = window.innerWidth, windowHeight = window.innerHeight) {
  return {
    x: normalizedX * windowWidth,
    y: normalizedY * windowHeight,
  };
}

export function calculateDistance(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

export function isValidGazePoint(point, minConfidence = 0.6, maxDistance = 150) {
  if (!point || typeof point !== 'object') {
    return false;
  }

  const x = point.x ?? -1;
  const y = point.y ?? -1;
  const confidence = point.confidence ?? 0;

  if (x < 0 || y < 0 || x > 1 || y > 1) {
    return false;
  }

  if (confidence < minConfidence) {
    return false;
  }

  return true;
}

export function createGazeEvent(x, y, confidence, timestamp = Date.now()) {
  return {
    x: Math.round(x * 10000) / 10000,
    y: Math.round(y * 10000) / 10000,
    timestamp,
    confidence: Math.round(confidence * 100) / 100,
    stable: confidence > 0.75,
    fixationId: null,
    isRegression: false,
  };
}
