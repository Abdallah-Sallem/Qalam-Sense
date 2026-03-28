import React, { useEffect, useRef, useMemo } from 'react';
import '../styles/gaze.css';

export default function GazeOverlay({ gaze, showTrail = false, trailLength = 10 }) {
  const canvasRef = useRef(null);
  const trailRef = useRef([]);

  const gazeX = useMemo(() => {
    if (!gaze) return -100;
    return gaze.x * window.innerWidth;
  }, [gaze]);

  const gazeY = useMemo(() => {
    if (!gaze) return -100;
    return gaze.y * window.innerHeight;
  }, [gaze]);

  useEffect(() => {
    if (!canvasRef.current || !gaze) {
      return;
    }

    const canvas = canvasRef.current;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return;
    }

    trailRef.current.push({ x: gazeX, y: gazeY });

    if (trailRef.current.length > trailLength) {
      trailRef.current.shift();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (showTrail && trailRef.current.length > 1) {
      ctx.strokeStyle = 'rgba(244, 114, 182, 0.4)';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      ctx.beginPath();

      for (let i = 0; i < trailRef.current.length; i += 1) {
        const point = trailRef.current[i];
        if (i === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }

      ctx.stroke();
    }

    const opacity = Math.max(0.5, gaze.confidence);

    ctx.fillStyle = `rgba(244, 114, 182, ${opacity})`;
    ctx.beginPath();
    ctx.arc(gazeX, gazeY, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(244, 114, 182, ${opacity * 0.8})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(gazeX, gazeY, 14, 0, Math.PI * 2);
    ctx.stroke();
  }, [gaze, gazeX, gazeY, showTrail, trailLength]);

  return (
    <canvas
      ref={canvasRef}
      className="gaze-overlay-canvas"
      style={{
        pointerEvents: 'none',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 9999,
      }}
    />
  );
}
