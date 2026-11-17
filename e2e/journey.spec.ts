/**
 * The whole product, end to end, in a real browser:
 * teacher → parent → student (calibration, reading, adaptation) → teacher → parent.
 *
 * Gaze comes from the explicit synthetic observation source (see
 * src/testing/syntheticSource.ts); everything after it is production code.
 */
import { expect, test } from '@playwright/test';
import { PARENT, TEACHER, loginAdult, loginStudent, logout, parentLinksAndConsents, readerVar, seedClass, setReaderProfile, useSyntheticGaze } from './helpers';

test('teacher, parent and student complete a camera-assisted reading session', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1–2. Teacher creates a student, uploads a text and assigns it.
  const creds = await seedClass(page);
  expect(creds.login).toMatch(/^amine\d{3}$/);
  expect(creds.pin).toMatch(/^\d{4}$/);

  // 3. Parent links the child with the one-time code and grants camera consent.
  await parentLinksAndConsents(page, creds);

  // 4. Student signs in.
  await useSyntheticGaze(page);
  await loginStudent(page, creds);
  await expect(page.getByText('TEST MODE')).toBeVisible();
  await page.getByRole('link', { name: /Le renard/ }).click();

  // 5. Onboarding: the child chooses to use the camera helper.
  await page.getByRole('button', { name: 'Oui, avec la caméra' }).click();

  // 6. Camera initialises; the child is told when they are well placed.
  await expect(page.getByText('Parfait, je te vois bien !')).toBeVisible();
  await page.getByRole('button', { name: 'Je suis prêt' }).click();

  // 7. Calibration: 13 targets, no clicks.
  await page.getByRole('button', { name: 'C’est parti' }).click();
  await expect(page.locator('[data-gaze-target]')).toBeVisible();
  await expect(page.locator('[data-reader]')).toBeVisible({ timeout: 60_000 });

  // 8–9. Reading: gaze observations are processed and the helper reports tracking.
  await expect(page.locator('.pill-tracking')).toBeVisible({ timeout: 15_000 });
  const before = { size: await readerVar(page, '--rd-size'), line: await readerVar(page, '--rd-line') };
  expect(before.size).toBe('1.000');

  // A steady reader is left alone while the engine learns their rhythm.
  await page.waitForTimeout(45_000);
  await expect(page.getByText('J’ai rendu le texte un peu plus facile à lire.')).toHaveCount(0);
  expect(await readerVar(page, '--rd-size')).toBe(before.size);

  // 10. Reading becomes effortful: an adaptation is triggered, announced, and applied.
  await setReaderProfile(page, 'effortful');
  await expect(page.getByText('J’ai rendu le texte un peu plus facile à lire.')).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => readerVar(page, '--rd-size').then(Number)).toBeGreaterThan(1);
  expect(Number(await readerVar(page, '--rd-line'))).toBeGreaterThan(Number(before.line));
  await expect(page.locator('[data-reader]')).toHaveAttribute('data-focus', /paragraph|line-guide/);
  await page.getByRole('button', { name: 'D’accord' }).click();

  // 11. The session ends.
  await page.getByRole('button', { name: 'Arrêter' }).click();
  await expect(page.getByText('Mots lus')).toBeVisible();
  await page.getByRole('button', { name: 'Retour à mes textes' }).click();
  await logout(page);

  // 12. The teacher reviews the session: camera used, adaptation logged with its reasons.
  await loginAdult(page, 'Enseignant', TEACHER);
  await page.getByRole('link', { name: 'Amine' }).click();
  const row = page.locator('.table tbody tr').filter({ hasText: 'Le renard' }).first();
  await expect(row).toContainText('Utilisée');
  await row.getByRole('button', { name: 'Détails' }).click();
  await expect(page.locator('.timeline')).toContainText('Automatique — niveau 0 → 1');
  await expect(page.getByText('Qualité de la mesure')).toBeVisible();
  await expect(page.getByText(/ne constituent pas un diagnostic/)).toBeVisible();
  await logout(page);

  // The parent sees the same session, then deletes the child's records for real.
  await loginAdult(page, 'Parent', PARENT);
  await expect(page.getByText('1 séance(s) enregistrée(s)')).toBeVisible();
  await page.getByRole('button', { name: 'Qui a consulté ces données' }).click();
  await expect(page.getByText('Séances consultées').first()).toBeVisible();
  await page.getByRole('button', { name: 'Effacer les séances de lecture' }).click();
  await page.getByRole('button', { name: 'Oui, effacer définitivement' }).click();
  await expect(page.getByText('1 séance(s) effacée(s) de cet appareil.')).toBeVisible();
  await expect(page.getByText('0 séance(s) enregistrée(s)')).toBeVisible();

  expect(errors).toEqual([]);
});
