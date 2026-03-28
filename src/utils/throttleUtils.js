export function createThrottledFunction(fn, delay) {
  let lastCall = 0;
  let timerId = null;

  function throttled(...args) {
    const now = Date.now();
    const remaining = delay - (now - lastCall);

    if (remaining <= 0) {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }

      lastCall = now;
      fn(...args);
    } else if (!timerId) {
      timerId = setTimeout(() => {
        lastCall = Date.now();
        timerId = null;
        fn(...args);
      }, remaining);
    }
  }

  throttled.cancel = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  return throttled;
}
