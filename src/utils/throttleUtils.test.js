import { createThrottledFunction } from './throttleUtils';

jest.useFakeTimers();

describe('throttleUtils', () => {
  test('throttles function calls by delay', () => {
    const fn = jest.fn();
    const throttled = createThrottledFunction(fn, 100);

    throttled(1);
    expect(fn).toHaveBeenCalledTimes(1);

    throttled(2);
    throttled(3);
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('cancels pending throttled call', () => {
    const fn = jest.fn();
    const throttled = createThrottledFunction(fn, 100);

    throttled(1);
    throttled(2);

    throttled.cancel();
    jest.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
