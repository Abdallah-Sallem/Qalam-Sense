/**
 * Measures the real MediaPipe pipeline in the browser, using Chromium's fake
 * camera (a test pattern, so no face is found, but inference runs in full).
 * Numbers are printed for docs/TESTING.md; budgets are loose sanity checks.
 */
import { expect, test } from '@playwright/test';
import { TEACHER, registerAdult } from './helpers';

test('MediaPipe inference rate and cost on this machine', async ({ page }) => {
  await registerAdult(page, 'Enseignant', TEACHER);
  await page.getByRole('link', { name: 'Diagnostic du suivi' }).click();
  await page.getByRole('button', { name: 'Démarrer la caméra' }).click();
  const value = (label: string) => page.locator('.kv dt', { hasText: label }).locator('xpath=following-sibling::dd[1]').innerText();
  await expect.poll(async () => parseFloat(await value('Images analysées par seconde')), { timeout: 60_000 }).toBeGreaterThan(5);
  await page.waitForTimeout(8000); // let the averages settle
  const fps = parseFloat(await value('Images analysées par seconde'));
  const inference = await value('Temps de détection');
  const latency = await value('Latence image → regard');
  const resolution = await value('Résolution');
  console.log(`[perf] browser: ${fps.toFixed(1)} fps, inference ${inference}, latency ${latency}, ${resolution}`);

  // Main-thread responsiveness while inference runs: longest task over 5 s.
  const longest = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let max = 0;
        new PerformanceObserver((list) => list.getEntries().forEach((e) => (max = Math.max(max, e.duration)))).observe({ type: 'longtask', buffered: false });
        setTimeout(() => resolve(max), 5000);
      }),
  );
  console.log(`[perf] longest main-thread task during inference: ${longest.toFixed(0)} ms`);
  expect(fps).toBeGreaterThan(10);
});
