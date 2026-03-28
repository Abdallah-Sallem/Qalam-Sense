import { useEffect, useRef } from 'react';
import { createThrottledFunction } from '../utils/throttleUtils';
import { createProgressEvent } from '../utils/eventUtils';
import interactionService from '../services/interactionService';

const PROGRESS_THROTTLE_MS = 150;

export default function useReadingProgress(enableTracking = true) {
  const throttledHandlerRef = useRef(null);
  const lastProgressRef = useRef(0);

  useEffect(() => {
    if (!enableTracking) {
      return;
    }

    function computeProgress() {
      const docHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;
      const scrollY = window.scrollY || document.documentElement.scrollTop || 0;

      const maxScroll = docHeight - viewportHeight;
      const progress = maxScroll > 0 ? Math.min(scrollY / maxScroll, 1) : 1;

      if (Math.abs(progress - lastProgressRef.current) < 0.01) {
        return;
      }

      lastProgressRef.current = progress;
      const event = createProgressEvent(progress);
      interactionService.captureEvent(event);
    }

    throttledHandlerRef.current = createThrottledFunction(
      computeProgress,
      PROGRESS_THROTTLE_MS
    );

    window.addEventListener('scroll', throttledHandlerRef.current, {
      passive: true,
    });

    window.addEventListener('resize', throttledHandlerRef.current);

    return () => {
      if (throttledHandlerRef.current) {
        throttledHandlerRef.current.cancel();
        window.removeEventListener('scroll', throttledHandlerRef.current);
        window.removeEventListener('resize', throttledHandlerRef.current);
      }
    };
  }, [enableTracking]);
}
