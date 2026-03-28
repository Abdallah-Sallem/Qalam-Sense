export function compressEvent(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  switch (event.type) {
    case 'SCROLL':
      return ['S', event.t, event.y, event.d, event.dir, event.v];

    case 'CLICK':
      return ['C', event.t, event.x, event.y, event.target];

    case 'PROGRESS':
      return ['P', event.t, event.p];

    default:
      return null;
  }
}

export function decompressEvent(compressed) {
  if (!Array.isArray(compressed) || compressed.length < 2) {
    return null;
  }

  const [type, t] = compressed;

  switch (type) {
    case 'S': {
      const [, timestamp, y, d, dir, v] = compressed;
      return {
        type: 'SCROLL',
        t: timestamp,
        y,
        d,
        dir,
        v,
      };
    }

    case 'C': {
      const [, timestamp, x, y, target] = compressed;
      return {
        type: 'CLICK',
        t: timestamp,
        x,
        y,
        target,
      };
    }

    case 'P': {
      const [, timestamp, p] = compressed;
      return {
        type: 'PROGRESS',
        t: timestamp,
        p,
      };
    }

    default:
      return null;
  }
}

export function compressEventBatch(events) {
  return events
    .map((event) => compressEvent(event))
    .filter((compressed) => compressed !== null);
}

export function decompressEventBatch(batch) {
  return batch
    .map((compressed) => decompressEvent(compressed))
    .filter((event) => event !== null);
}
