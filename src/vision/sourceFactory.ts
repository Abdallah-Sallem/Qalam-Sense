/**
 * Chooses the observation source. In every normal build this is the webcam.
 * The synthetic source exists only in builds made with
 * VITE_ENABLE_TEST_HOOKS=true and only when a test has asked for it.
 */
import { CameraObservationSource, type CameraSourceOptions } from './cameraSource';
import type { ObservationSource } from './types';

export const TEST_HOOKS_ENABLED = import.meta.env.VITE_ENABLE_TEST_HOOKS === 'true';
const TEST_SOURCE_KEY = 'qalam:test-source';

export function syntheticSourceSelected(): boolean {
  if (!TEST_HOOKS_ENABLED) return false;
  try {
    return sessionStorage.getItem(TEST_SOURCE_KEY) === 'synthetic';
  } catch {
    return false;
  }
}

export async function createObservationSource(options: CameraSourceOptions = {}): Promise<ObservationSource> {
  // The constant is checked first so production bundles drop the synthetic source entirely.
  if (TEST_HOOKS_ENABLED && syntheticSourceSelected()) {
    const { SyntheticObservationSource } = await import('@/testing/syntheticSource');
    return new SyntheticObservationSource();
  }
  return new CameraObservationSource(options);
}

/** Installs window.__qalamTest for the end-to-end suite. No-op in normal builds. */
export async function installTestHooks(): Promise<void> {
  if (!TEST_HOOKS_ENABLED) return;
  const { syntheticControls } = await import('@/testing/syntheticSource');
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) {
    const { runDemoSeed } = await import('@/testing/demoSeed');
    await runDemoSeed(params);
  }
  (window as unknown as { __qalamTest: unknown }).__qalamTest = {
    useSyntheticSource: (on: boolean) => sessionStorage.setItem(TEST_SOURCE_KEY, on ? 'synthetic' : 'camera'),
    controls: syntheticControls,
  };
}
