/** Seeded pseudo-random numbers, so simulations and tests are reproducible. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Standard normal. */
  gauss(): number;
}

export function createRng(seed = 1): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = (): number => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return { next, gauss };
}
