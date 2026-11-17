/**
 * Applies a reading style to the DOM without making the reader lose their place.
 *
 * Changing font size or spacing reflows the text. While the CSS transition
 * runs, the element the child is reading (the anchor) is held at the same
 * place in the viewport by compensating the scroll position every frame.
 */
import { styleToCssVars } from './presets';
import type { ReadingStyle } from './types';

export const TRANSITION_MS = 700;

export function applyStyle(target: HTMLElement, style: ReadingStyle): void {
  for (const [name, value] of Object.entries(styleToCssVars(style))) target.style.setProperty(name, value);
  target.dataset.theme = style.theme;
  target.dataset.focus = style.focus;
  target.dataset.contrast = style.highContrast ? 'high' : 'normal';
}

/**
 * Applies the style and keeps `anchor` visually still for the duration of the transition.
 * Returns a function that cancels the compensation (e.g. on unmount).
 */
export function applyStyleAnchored(
  target: HTMLElement,
  style: ReadingStyle,
  anchor: Element | null,
  durationMs = TRANSITION_MS,
): () => void {
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const before = anchor?.getBoundingClientRect().top ?? null;
  applyStyle(target, style);
  if (!anchor || before === null) return () => {};

  let frame = 0;
  let cancelled = false;
  const end = performance.now() + (reduceMotion ? 0 : durationMs) + 50;
  const hold = () => {
    if (cancelled) return;
    const delta = anchor.getBoundingClientRect().top - before;
    if (Math.abs(delta) >= 0.5) window.scrollBy(0, delta);
    if (performance.now() < end) frame = requestAnimationFrame(hold);
  };
  hold();
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}
