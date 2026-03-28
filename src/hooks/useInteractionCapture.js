import { useEffect, useRef } from 'react';
import useScrollTracker from './useScrollTracker';
import useClickTracker from './useClickTracker';
import useReadingProgress from './useReadingProgress';
import interactionService from '../services/interactionService';

export default function useInteractionCapture({
  containerRef,
  enableTracking = true,
  flushInterval = 2000,
} = {}) {
  const flushScheduledRef = useRef(false);

  useScrollTracker(enableTracking);
  useClickTracker(containerRef, enableTracking);
  useReadingProgress(enableTracking);

  useEffect(() => {
    if (!enableTracking) {
      interactionService.setTrackingEnabled(false);
      return;
    }

    interactionService.setTrackingEnabled(true);

    if (!flushScheduledRef.current) {
      interactionService.scheduleFlush(flushInterval);
      flushScheduledRef.current = true;
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        interactionService.flushEvents();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      interactionService.cancelFlush();
      flushScheduledRef.current = false;
    };
  }, [enableTracking, flushInterval]);

  return {
    getSessionEvents: () => interactionService.getSessionEvents(),
    getSessionId: () => interactionService.getSessionId(),
    getStats: () => interactionService.getStats(),
    flushEvents: () => interactionService.flushEvents(),
    clearSession: () => interactionService.clearSession(),
  };
}
