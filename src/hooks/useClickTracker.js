import { useEffect, useRef } from 'react';
import { createDebouncedFunction } from '../utils/debounceUtils';
import { createClickEvent } from '../utils/eventUtils';
import interactionService from '../services/interactionService';

const CLICK_DEBOUNCE_MS = 75;

export default function useClickTracker(containerRef, enableTracking = true) {
  const debouncedHandlerRef = useRef(null);
  const lastClickRef = useRef(null);

  useEffect(() => {
    if (!enableTracking || !containerRef || !containerRef.current) {
      return;
    }

    function handleClick(event) {
      const target = event.target;
      let targetType = 'unknown';

      if (target.classList.contains('reader-word')) {
        targetType = 'word';
      } else if (target.classList.contains('reader-sentence')) {
        targetType = 'sentence';
      } else if (target.classList.contains('reader-paragraph')) {
        targetType = 'paragraph';
      }

      const clickEvent = createClickEvent(event.clientX, event.clientY, targetType);

      if (
        lastClickRef.current &&
        lastClickRef.current.x === clickEvent.x &&
        lastClickRef.current.y === clickEvent.y &&
        lastClickRef.current.target === clickEvent.target
      ) {
        return;
      }

      lastClickRef.current = clickEvent;
      interactionService.captureEvent(clickEvent);
    }

    debouncedHandlerRef.current = createDebouncedFunction(
      handleClick,
      CLICK_DEBOUNCE_MS
    );

    const container = containerRef.current;
    container.addEventListener('click', debouncedHandlerRef.current);

    return () => {
      if (debouncedHandlerRef.current) {
        debouncedHandlerRef.current.cancel();
        container.removeEventListener('click', debouncedHandlerRef.current);
      }
    };
  }, [containerRef, enableTracking]);
}
