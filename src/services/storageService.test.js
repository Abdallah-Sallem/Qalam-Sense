import storageService from './storageService';

describe('storageService', () => {
  beforeEach(() => {
    storageService.clearSession();
    window.localStorage.clear();
  });

  test('generates unique session ID', () => {
    const id1 = storageService.getSessionId();
    expect(id1).toMatch(/^session_/);
  });

  test('adds events to memory buffer', () => {
    const event = { type: 'SCROLL', t: 1000, y: 500 };
    storageService.addEvent(event);

    expect(storageService.getBufferSize()).toBe(1);
  });

  test('respects max buffer size', () => {
    for (let i = 0; i < 5100; i += 1) {
      storageService.addEvent({ type: 'SCROLL', t: 1000 + i, y: i });
    }

    expect(storageService.getBufferSize()).toBeLessThanOrEqual(5000);
  });

  test('flushes events to localStorage', () => {
    const event = { type: 'SCROLL', t: 1000, y: 500, d: 0, dir: 0, v: 0 };
    storageService.addEvent(event);
    storageService.flushToStorage();

    const sessionId = storageService.getSessionId();
    const key = `qalam.tracking.session.${sessionId}`;
    const stored = window.localStorage.getItem(key);

    expect(stored).toBeTruthy();
  });

  test('clears session data', () => {
    const event = { type: 'SCROLL', t: 1000, y: 500 };
    storageService.addEvent(event);
    storageService.clearSession();

    expect(storageService.getBufferSize()).toBe(0);
  });
});
