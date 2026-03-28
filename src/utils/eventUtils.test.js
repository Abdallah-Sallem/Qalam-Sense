import {
  createScrollEvent,
  createClickEvent,
  createProgressEvent,
  isSameEvent,
} from './eventUtils';

describe('eventUtils', () => {
  test('creates scroll event with correct structure', () => {
    const event = createScrollEvent(500, 400);

    expect(event).toMatchObject({
      type: 'SCROLL',
      y: 500,
      d: 100,
      dir: 1,
      v: 100,
    });
    expect(event.t).toBeDefined();
  });

  test('detects direction correctly', () => {
    const upEvent = createScrollEvent(300, 400);
    expect(upEvent.dir).toBe(-1);

    const downEvent = createScrollEvent(500, 400);
    expect(downEvent.dir).toBe(1);

    const noMovement = createScrollEvent(400, 400);
    expect(noMovement.dir).toBe(0);
  });

  test('creates click event with correct structure', () => {
    const event = createClickEvent(100, 200, 'word');

    expect(event).toMatchObject({
      type: 'CLICK',
      x: 100,
      y: 200,
      target: 'word',
    });
    expect(event.t).toBeDefined();
  });

  test('creates progress event', () => {
    const event = createProgressEvent(0.5);

    expect(event).toMatchObject({
      type: 'PROGRESS',
      p: 0.5,
    });
    expect(event.t).toBeDefined();
  });

  test('detects identical scroll events', () => {
    const event1 = createScrollEvent(500, 400);
    const event2 = createScrollEvent(500, 400);

    expect(isSameEvent(event1, event2)).toBe(true);
  });

  test('detects different scroll events', () => {
    const event1 = createScrollEvent(500, 400);
    const event2 = createScrollEvent(510, 400);

    expect(isSameEvent(event1, event2)).toBe(false);
  });
});
