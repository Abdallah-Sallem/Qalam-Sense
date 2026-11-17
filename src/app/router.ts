/**
 * Minimal hash router. Hash routing keeps the app deployable as static files
 * on any host or sub-path, and a browser refresh lands on the same screen.
 */
import { useSyncExternalStore } from 'react';

const read = (): string => window.location.hash.replace(/^#\/?/, '');

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** Current route as path segments, e.g. "#/student/abc" → ["student", "abc"]. */
export function useRoute(): string[] {
  const path = useSyncExternalStore(subscribe, read);
  return path.split('/').filter(Boolean).map(decodeURIComponent);
}

export function navigate(path: string): void {
  const target = `#/${path.replace(/^\/+/, '')}`;
  if (window.location.hash !== target) window.location.hash = target;
}

export const href = (path: string): string => `#/${path.replace(/^\/+/, '')}`;
