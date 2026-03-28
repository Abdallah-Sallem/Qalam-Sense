import interactionService from './interactionService';

jest.useFakeTimers();

describe('interactionService', () => {
  beforeEach(() => {
    interactionService.clearSession();
    jest.clearAllTimers();
  });

  test('captures events when tracking enabled', () => {
    interactionService.setTrackingEnabled(true);
    const event = { type: 'SCROLL', t: 1000, y: 500 };

    interactionService.captureEvent(event);

    const stats = interactionService.getStats();
    expect(stats.queuedEvents).toBe(1);
  });

  test('ignores events when tracking disabled', () => {
    interactionService.setTrackingEnabled(false);
    const event = { type: 'SCROLL', t: 1000, y: 500 };

    interactionService.captureEvent(event);

    const stats = interactionService.getStats();
    expect(stats.queuedEvents).toBe(0);
  });

  test('auto-flushes at 50 events', () => {
    interactionService.setTrackingEnabled(true);

    for (let i = 0; i < 50; i += 1) {
      interactionService.captureEvent({ type: 'SCROLL', t: 1000 + i, y: 100 + i });
    }

    const stats = interactionService.getStats();
    expect(stats.queuedEvents).toBe(0);
  });

  test('manually flushes events', () => {
    interactionService.setTrackingEnabled(true);
    const event = { type: 'SCROLL', t: 1000, y: 500, d: 0, dir: 0, v: 0 };

    interactionService.captureEvent(event);
    interactionService.flushEvents();

    const stats = interactionService.getStats();
    expect(stats.queuedEvents).toBe(0);
  });

  test('provides session statistics', () => {
    interactionService.setTrackingEnabled(true);

    const stats = interactionService.getStats();

    expect(stats).toMatchObject({
      queuedEvents: 0,
      trackingEnabled: true,
    });
    expect(stats.sessionId).toBeDefined();
  });

  test('clears session', () => {
    interactionService.setTrackingEnabled(true);
    interactionService.captureEvent({ type: 'SCROLL', t: 1000, y: 500 });

    interactionService.clearSession();

    const stats = interactionService.getStats();
    expect(stats.queuedEvents).toBe(0);
  });
});
