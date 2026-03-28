import { useEffect, useRef } from 'react';
import { createThrottledFunction } from '../utils/throttleUtils';
import { createScrollEvent } from '../utils/eventUtils';
import interactionService from '../services/interactionService';

const SCROLL_THROTTLE_MS = 100;
const DELTA_THRESHOLD = 2;

export default function useScrollTracker(enableTracking = true) {
  const lastScrollYRef = useRef(0);
  const lastEventRef = useRef(null);
  const throttledHandlerRef = useRef(null);

  useEffect(() => {
    if (!enableTracking) {
      return;
    }

    function handleScroll() {
      const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
      const delta = Math.abs(scrollY - lastScrollYRef.current);

      if (delta < DELTA_THRESHOLD) {
        return;
      }

      const event = createScrollEvent(scrollY, lastScrollYRef.current);

      if (lastEventRef.current && lastEventRef.current.y === event.y) {
        return;
      }

      lastEventRef.current = event;
      lastScrollYRef.current = scrollY;

      interactionService.captureEvent(event);
    }

    throttledHandlerRef.current = createThrottledFunction(
      handleScroll,
      SCROLL_THROTTLE_MS
    );

    window.addEventListener('scroll', throttledHandlerRef.current, {
      passive: true,
    });

    return () => {
      if (throttledHandlerRef.current) {
        throttledHandlerRef.current.cancel();
        window.removeEventListener('scroll', throttledHandlerRef.current);
      }
    };
  }, [enableTracking]);
}
