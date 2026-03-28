import React, { useState, useCallback } from 'react';
import gazeService from '../services/gazeService';
import '../styles/gaze.css';

const CALIBRATION_POINTS = [
  { x: 0.1, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.5 },
  { x: 0.9, y: 0.9 },
  { x: 0.5, y: 0.9 },
  { x: 0.1, y: 0.9 },
  { x: 0.1, y: 0.5 },
  { x: 0.5, y: 0.5 },
];

export default function CalibrationOverlay({ onComplete, pointCount = 5 }) {
  const [currentPointIndex, setCurrentPointIndex] = useState(0);
  const [clickCount, setClickCount] = useState(0);
  const [isActive, setIsActive] = useState(false);

  const availablePoints = CALIBRATION_POINTS.slice(0, pointCount);
  const currentPoint = availablePoints[currentPointIndex];
  const progress = currentPointIndex / availablePoints.length;

  const handleCalibrationPointClick = useCallback(() => {
    if (!currentPoint) {
      return;
    }

    gazeService.addCalibrationPoint(
      currentPoint.x * window.innerWidth,
      currentPoint.y * window.innerHeight
    );

    setClickCount((prev) => prev + 1);

    if (clickCount + 1 >= 5) {
      if (currentPointIndex + 1 >= availablePoints.length) {
        gazeService.endCalibration();
        onComplete?.(gazeService.getCalibrationPoints());
        return;
      }

      setCurrentPointIndex((prev) => prev + 1);
      setClickCount(0);
    }
  }, [currentPointIndex, clickCount, availablePoints.length, onComplete]);

  if (!currentPoint) {
    return null;
  }

  const posX = currentPoint.x * 100;
  const posY = currentPoint.y * 100;

  return (
    <div className="calibration-overlay">
      <div className="calibration-background" />

      <div
        className="calibration-point"
        style={{ left: `${posX}%`, top: `${posY}%` }}
        onClick={handleCalibrationPointClick}
      >
        <div className="calibration-point-inner">
          <div className="calibration-point-dot" />
          <span className="calibration-point-click-count">{clickCount + 1} / 5</span>
        </div>
      </div>

      <div className="calibration-progress">
        <div className="calibration-progress-bar" style={{ width: `${progress * 100}%` }} />
        <span className="calibration-progress-text">
          Point {currentPointIndex + 1} of {availablePoints.length}
        </span>
      </div>

      <div className="calibration-instructions">
        <h2>Eye Tracking Calibration</h2>
        <p>Look at the point and click {5 - clickCount} more time(s)</p>
        <button className="calibration-button" onClick={handleCalibrationPointClick}>
          Click Point ({clickCount} / 5)
        </button>
      </div>
    </div>
  );
}
