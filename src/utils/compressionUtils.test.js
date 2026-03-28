import {
  compressEvent,
  decompressEvent,
  compressEventBatch,
  decompressEventBatch,
} from './compressionUtils';

describe('compressionUtils', () => {
  test('compresses scroll event', () => {
    const event = {
      type: 'SCROLL',
      t: 1000,
      y: 500,
      d: 100,
      dir: 1,
      v: 100,
    };

    const compressed = compressEvent(event);
    expect(compressed).toEqual(['S', 1000, 500, 100, 1, 100]);
  });

  test('compresses click event', () => {
    const event = {
      type: 'CLICK',
      t: 1000,
      x: 100,
      y: 200,
      target: 'word',
    };

    const compressed = compressEvent(event);
    expect(compressed).toEqual(['C', 1000, 100, 200, 'word']);
  });

  test('compresses progress event', () => {
    const event = {
      type: 'PROGRESS',
      t: 1000,
      p: 0.5,
    };

    const compressed = compressEvent(event);
    expect(compressed).toEqual(['P', 1000, 0.5]);
  });

  test('decompresses scroll event', () => {
    const compressed = ['S', 1000, 500, 100, 1, 100];
    const decompressed = decompressEvent(compressed);

    expect(decompressed).toMatchObject({
      type: 'SCROLL',
      t: 1000,
      y: 500,
      d: 100,
      dir: 1,
      v: 100,
    });
  });

  test('decompresses click event', () => {
    const compressed = ['C', 1000, 100, 200, 'word'];
    const decompressed = decompressEvent(compressed);

    expect(decompressed).toMatchObject({
      type: 'CLICK',
      t: 1000,
      x: 100,
      y: 200,
      target: 'word',
    });
  });

  test('compresses and decompresses batch', () => {
    const events = [
      {
        type: 'SCROLL',
        t: 1000,
        y: 500,
        d: 100,
        dir: 1,
        v: 100,
      },
      {
        type: 'CLICK',
        t: 1005,
        x: 100,
        y: 200,
        target: 'word',
      },
    ];

    const compressed = compressEventBatch(events);
    const decompressed = decompressEventBatch(compressed);

    expect(decompressed).toHaveLength(2);
    expect(decompressed[0].type).toBe('SCROLL');
    expect(decompressed[1].type).toBe('CLICK');
  });
});
