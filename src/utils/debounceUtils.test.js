import { createDebouncedFunction } from './debounceUtils';

jest.useFakeTimers();

describe('debounceUtils', () => {
  test('debounces function calls by delay', () => {
    const fn = jest.fn();
    const debounced = createDebouncedFunction(fn, 100);

    debounced(1);
    debounced(2);
    debounced(3);

    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('cancels pending debounced call', () => {
    const fn = jest.fn();
    const debounced = createDebouncedFunction(fn, 100);

    debounced(1);
    debounced.cancel();
    jest.advanceTimersByTime(100);

    expect(fn).not.toHaveBeenCalled();
  });

  test('handles rapid calls and calls only latest', () => {
    const fn = jest.fn();
    const debounced = createDebouncedFunction(fn, 50);

    debounced(1);
    jest.advanceTimersByTime(25);
    debounced(2);
    jest.advanceTimersByTime(25);
    debounced(3);
    jest.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
