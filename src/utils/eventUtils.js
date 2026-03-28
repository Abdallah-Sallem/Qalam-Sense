export const EVENT_TYPES = {
  SCROLL: 'SCROLL',
  CLICK: 'CLICK',
  PROGRESS: 'PROGRESS',
};

export function createScrollEvent(scrollY, previousScrollY = 0) {
  const delta = scrollY - previousScrollY;
  const direction = delta > 0 ? 1 : delta < 0 ? -1 : 0;

  return {
    type: EVENT_TYPES.SCROLL,
    t: Date.now(),
    y: Math.round(scrollY),
    d: Math.round(delta),
    dir: direction,
    v: Math.abs(delta),
  };
}

export function createClickEvent(x, y, target = 'unknown') {
  return {
    type: EVENT_TYPES.CLICK,
    t: Date.now(),
    x: Math.round(x),
    y: Math.round(y),
    target,
  };
}

export function createProgressEvent(progress) {
  return {
    type: EVENT_TYPES.PROGRESS,
    t: Date.now(),
    p: Math.round(progress * 100) / 100,
  };
}

export function isSameEvent(e1, e2, tolerance = 0) {
  if (!e1 || !e2 || e1.type !== e2.type) {
    return false;
  }

  if (e1.type === EVENT_TYPES.SCROLL) {
    return Math.abs((e1.y || 0) - (e2.y || 0)) <= tolerance;
  }

  if (e1.type === EVENT_TYPES.CLICK) {
    const xDiff = Math.abs((e1.x || 0) - (e2.x || 0));
    const yDiff = Math.abs((e1.y || 0) - (e2.y || 0));
    return xDiff <= tolerance && yDiff <= tolerance;
  }

  return false;
}
