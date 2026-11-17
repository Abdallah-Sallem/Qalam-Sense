/** Small numeric helpers shared by the vision, reading and difficulty layers. */

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const clamp01 = (v: number): number => clamp(v, 0, 1);

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function std(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/** Median absolute deviation, scaled to be comparable to a standard deviation. */
export function mad(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

/**
 * Linear ramp: 0 at or below `from`, 1 at or above `to`.
 * `from` may be greater than `to` to express "lower is worse".
 */
export function ramp(value: number, from: number, to: number): number {
  if (from === to) return value >= to ? 1 : 0;
  return clamp01((value - from) / (to - from));
}

export function weightedMean(pairs: readonly (readonly [value: number, weight: number])[]): number {
  let s = 0;
  let w = 0;
  for (const [v, wt] of pairs) {
    s += v * wt;
    w += wt;
  }
  return w > 0 ? s / w : 0;
}

export const hypot2 = (dx: number, dy: number): number => Math.sqrt(dx * dx + dy * dy);

/**
 * Solves A·x = b in place with Gaussian elimination and partial pivoting.
 * Returns null when the system is numerically singular.
 */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(M[pivot]![col]!) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    const prow = M[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = M[r]!;
      const f = row[col]! / prow[col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) row[c]! -= f * prow[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = M[r]!;
    let s = row[n]!;
    for (let c = r + 1; c < n; c++) s -= row[c]! * x[c]!;
    x[r] = s / row[r]!;
  }
  return x;
}

/**
 * Ridge regression: minimises ‖X·w − y‖² + λ‖w‖² (the first column is treated
 * as the intercept and is not penalised). Returns null if it cannot be solved.
 */
export function ridgeFit(X: readonly (readonly number[])[], y: readonly number[], lambda: number): number[] | null {
  const n = X.length;
  if (n === 0) return null;
  const p = X[0]!.length;
  const XtX: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    const row = X[i]!;
    const yi = y[i]!;
    for (let a = 0; a < p; a++) {
      const ra = row[a]!;
      Xty[a]! += ra * yi;
      const dst = XtX[a]!;
      for (let c = a; c < p; c++) dst[c]! += ra * row[c]!;
    }
  }
  for (let a = 0; a < p; a++) {
    for (let c = 0; c < a; c++) XtX[a]![c] = XtX[c]![a]!;
    if (a > 0) XtX[a]![a]! += lambda;
  }
  return solveLinearSystem(XtX, Xty);
}

export const dot = (a: readonly number[], b: readonly number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};
