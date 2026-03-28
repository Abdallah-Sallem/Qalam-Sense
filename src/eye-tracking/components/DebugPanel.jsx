import React, { useState, useEffect } from 'react';
import gazeService from '../services/gazeService';
import { getMemoryUsage } from '../utils/performanceUtils';
import '../styles/gaze.css';

export default function DebugPanel({ isVisible = true }) {
  const [stats, setStats] = useState(null);
  const [memory, setMemory] = useState(null);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const interval = setInterval(() => {
      setStats(gazeService.getPerformanceStats());
      setMemory(getMemoryUsage());
    }, 500);

    return () => clearInterval(interval);
  }, [isVisible]);

  if (!isVisible || !stats) {
    return null;
  }

  return (
    <div className="debug-panel">
      <div className="debug-panel-header">Eye Tracking Debug</div>

      <div className="debug-panel-content">
        <div className="debug-stat">
          <span className="debug-label">Status:</span>
          <span className={`debug-value status-${stats.isTracking ? 'active' : 'inactive'}`}>
            {stats.isTracking ? 'Tracking' : 'Paused'}
          </span>
        </div>

        <div className="debug-stat">
          <span className="debug-label">FPS:</span>
          <span className="debug-value">{stats.fps}</span>
        </div>

        <div className="debug-stat">
          <span className="debug-label">Latency:</span>
          <span className="debug-value">{stats.latency}ms</span>
        </div>

        <div className="debug-stat">
          <span className="debug-label">Gaze Buffer:</span>
          <span className="debug-value">{stats.gazeBufferSize}</span>
        </div>

        <div className="debug-stat">
          <span className="debug-label">Fixations:</span>
          <span className="debug-value">{stats.fixationCount}</span>
        </div>

        <div className="debug-stat">
          <span className="debug-label">Regressions:</span>
          <span className="debug-value">{stats.regressionCount}</span>
        </div>

        <div className="debug-stat">
          <span className="debug-label">Tracking Loss:</span>
          <span className="debug-value">{stats.trackingLossFrames}</span>
        </div>

        {memory && (
          <>
            <div className="debug-stat">
              <span className="debug-label">Memory (Used / Total):</span>
              <span className="debug-value">
                {memory.usedJSHeapSize} / {memory.totalJSHeapSize} MB
              </span>
            </div>

            <div className="debug-stat">
              <span className="debug-label">Heap Limit:</span>
              <span className="debug-value">{memory.jsHeapSizeLimit} MB</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
