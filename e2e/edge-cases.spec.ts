import { expect, test, type Page } from '@playwright/test';
import { ARABIC_TEXT, TEACHER, loginAdult, loginStudent, logout, parentLinksAndConsents, readerVar, registerAdult, seedClass } from './helpers';

const openText = async (page: Page, title: RegExp) => page.getByRole('link', { name: title }).click();

test.describe('authentication', () => {
  test('rejects wrong credentials, then locks the account after repeated failures', async ({ page }) => {
    await registerAdult(page, 'Enseignant', TEACHER);
    await logout(page);
    await page.getByRole('tab', { name: 'Enseignant' }).click();
    await page.getByLabel('Adresse e-mail').fill(TEACHER.email);
    await page.getByLabel('Mot de passe').fill('mauvais-mot-de-passe');
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: 'Se connecter' }).click();
      await expect(page.getByRole('alert')).toContainText('Identifiant ou mot de passe incorrect');
    }
    await page.getByLabel('Mot de passe').fill(TEACHER.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('alert')).toContainText(/Trop d’essais/);
  });

  test('keeps the session across a browser refresh and shows an empty class', async ({ page }) => {
    await registerAdult(page, 'Enseignant', TEACHER);
    await expect(page.getByText('Aucun élève pour l’instant')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
    await expect(page.getByText('Aucun élève pour l’instant')).toBeVisible();
    await page.getByRole('tab', { name: 'Textes' }).click();
    await expect(page.getByText('Aucun texte pour l’instant')).toBeVisible();
  });

  test('validates sign-up input', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Parent' }).click();
    await page.getByRole('button', { name: /Pas encore de compte/ }).click();
    await page.getByLabel('Votre nom').fill('X');
    await page.getByLabel('Adresse e-mail').fill('pas-une-adresse');
    await page.getByLabel('Mot de passe').fill('court');
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page.getByRole('alert')).toContainText('Adresse e-mail invalide');
  });
});

test.describe('reading without the camera', () => {
  test('a student without parental consent reads, adjusts the display and finishes', async ({ page }) => {
    const creds = await seedClass(page);
    await loginStudent(page, creds);
    await openText(page, /Le renard/);
    await expect(page.getByText('L’aide de la caméra n’est pas activée pour toi.')).toBeVisible();
    await page.getByRole('button', { name: 'Commencer la lecture' }).click();

    const article = page.locator('[data-reader]');
    await expect(article).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('.pill')).toHaveCount(0); // no camera indicator at all

    // Manual controls work and change the real typography.
    const size0 = await article.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await page.getByRole('button', { name: 'Affichage' }).click();
    await expect(page.getByText('L’affichage ne change que si tu le demandes.')).toBeVisible();
    await page.getByRole('button', { name: 'Plus grand' }).click();
    await page.getByRole('button', { name: 'Plus', exact: true }).click();
    await expect.poll(() => article.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(size0 * 1.1);
    await page.getByRole('button', { name: 'Sombre' }).click();
    await expect(article).toHaveAttribute('data-theme', 'dusk');
    await page.getByRole('button', { name: 'Affichage' }).click();

    // Pause and resume.
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('dialog', { name: 'Pause' })).toBeVisible();
    await page.getByRole('button', { name: 'Reprendre la lecture' }).click();

    // Paragraph navigation to the end.
    await expect(page.locator('.reader-nav')).toContainText('Paragraphe 1 sur 6');
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(3200);
      await page.getByRole('button', { name: 'Suivant' }).click();
    }
    await page.waitForTimeout(3200);
    await page.getByRole('button', { name: 'J’ai fini' }).click();
    await expect(page.getByRole('heading', { name: 'Bravo Amine !' })).toBeVisible();
    await page.getByRole('button', { name: 'Retour à mes textes' }).click();
    await logout(page);

    // The teacher sees the session, marked as read without consent, with a pace but no gaze data.
    await loginAdult(page, 'Enseignant', TEACHER);
    await page.getByRole('link', { name: 'Amine' }).click();
    const row = page.locator('.table tbody tr').filter({ hasText: 'Le renard' }).first();
    await expect(row).toContainText('Sans consentement');
    await expect(row).toContainText('mots/min');
    await row.getByRole('button', { name: 'Détails' }).click();
    await expect(page.getByText(/Séance sans mesure du regard/)).toBeVisible();
    await expect(page.locator('.timeline')).toContainText('Par l’élève');
  });

  test('Arabic text is laid out right to left and never letter-spaced', async ({ page }) => {
    const creds = await seedClass(page, { title: 'الأسد والفأر', content: ARABIC_TEXT, language: 'ar' });
    await loginStudent(page, creds);
    await openText(page, /الأسد والفأر/);
    await page.getByRole('button', { name: 'Commencer la lecture' }).click();
    const article = page.locator('[data-reader]');
    await expect(article).toHaveAttribute('dir', 'rtl');
    await expect(article).toHaveAttribute('lang', 'ar');

    // The first word of a line is to the right of the second.
    const [x0, x1] = await article.evaluate((el) => [0, 1].map((i) => el.querySelector(`[data-w="${i}"]`)!.getBoundingClientRect().left));
    expect(x0).toBeGreaterThan(x1!);

    // Strongest support level: more line height and word spacing, still no letter spacing.
    await page.getByRole('button', { name: 'Affichage' }).click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Plus', exact: true }).click();
    await expect.poll(() => readerVar(page, '--rd-line').then(Number)).toBeGreaterThan(2.5);
    expect(await readerVar(page, '--rd-letter')).toBe('0em');
    expect(await article.evaluate((el) => getComputedStyle(el).letterSpacing)).toMatch(/^(normal|0px)$/);
    expect(await article.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Noto Naskh Arabic');
  });

  test('the interface switches to Arabic and mirrors', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Changer de langue' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('tab', { name: 'معلّم' })).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar'); // the choice is remembered
  });

  test('long passages and small screens stay usable', async ({ page }) => {
    const long = Array.from({ length: 40 }, (_, p) => Array.from({ length: 60 }, (_, i) => `mot${p}x${i}`).join(' ')).join('\n\n');
    const creds = await seedClass(page, { title: 'Long texte', content: long });
    await page.setViewportSize({ width: 360, height: 640 });
    await loginStudent(page, creds);
    await openText(page, /Long texte/);
    await page.getByRole('button', { name: 'Commencer la lecture' }).click();
    await expect(page.locator('[data-reader] [data-w]')).toHaveCount(2400);
    await expect(page.locator('.reader-nav')).toContainText('Paragraphe 1 sur 40');
    // No horizontal scrolling on a phone-sized screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Suivant' }).click();
    await expect(page.locator('.reader-nav')).toContainText('Paragraphe 2 sur 40');
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

test.describe('camera edge cases (real pipeline, fake camera device)', () => {
  async function toCameraCheck(page: Page) {
    const creds = await seedClass(page);
    await parentLinksAndConsents(page, creds);
    await loginStudent(page, creds);
    await openText(page, /Le renard/);
    await page.getByRole('button', { name: 'Oui, avec la caméra' }).click();
  }

  test('face not detected: the landmark model runs, the child is coached, and can read without the camera', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await toCameraCheck(page);
    // The fake device shows a test pattern: MediaPipe loads, runs, and finds no face.
    await expect(page.getByText('Je ne vois pas ton visage. Mets-toi en face de l’écran.')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('button', { name: 'Je suis prêt' })).toBeDisabled();
    await page.getByRole('button', { name: 'Lire sans la caméra' }).click();
    await expect(page.locator('[data-reader]')).toBeVisible();
    // The camera is released when the helper is not used.
    expect(await page.evaluate(() => document.querySelectorAll('video').length)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('camera permission denied: clear message, reading continues', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    await toCameraCheck(page);
    await expect(page.getByText('L’accès à la caméra a été refusé.')).toBeVisible();
    await page.getByRole('button', { name: 'Lire sans la caméra' }).click();
    await expect(page.locator('[data-reader]')).toBeVisible();
  });

  test('no camera on the device: clear message, retry offered', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('none', 'NotFoundError'));
    });
    await toCameraCheck(page);
    await expect(page.getByText('Aucune caméra n’a été trouvée sur cet appareil.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  });

  test('calibration without a face fails gracefully and explains why', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const hooks = (window as unknown as { __qalamTest: { useSyntheticSource(on: boolean): void } }).__qalamTest;
      hooks.useSyntheticSource(true);
    });
    await toCameraCheck(page);
    await page.getByRole('button', { name: 'Je suis prêt' }).click();
    // The child walks away right after starting the star game.
    await page.evaluate(() => {
      (window as unknown as { __qalamTest: { controls: { faceVisible: boolean } } }).__qalamTest.controls.faceVisible = false;
    });
    await page.getByRole('button', { name: 'C’est parti' }).click();
    await expect(page.getByRole('heading', { name: 'Le jeu de l’étoile n’a pas marché' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('La caméra ne voyait pas ton visage.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recommencer le jeu' })).toBeVisible();
    await page.getByRole('button', { name: 'Lire sans la caméra' }).click();
    await expect(page.locator('[data-reader]')).toBeVisible();
  });

  test('tracking interrupted mid-reading: calm notice, no adaptation, reading continues', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as unknown as { __qalamTest: { useSyntheticSource(on: boolean): void } }).__qalamTest.useSyntheticSource(true));
    await toCameraCheck(page);
    await page.getByRole('button', { name: 'Je suis prêt' }).click();
    await page.getByRole('button', { name: 'C’est parti' }).click();
    await expect(page.locator('.pill-tracking')).toBeVisible({ timeout: 75_000 });
    await page.evaluate(() => {
      (window as unknown as { __qalamTest: { controls: { faceVisible: boolean } } }).__qalamTest.controls.faceVisible = false;
    });
    await expect(page.locator('.pill-lost')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Je ne vois plus tes yeux. Ce n’est pas grave, continue à lire.')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(12_000);
    await expect(page.getByText('J’ai rendu le texte un peu plus facile à lire.')).toHaveCount(0);
    // Tracking recovers by itself when the child comes back.
    await page.evaluate(() => {
      (window as unknown as { __qalamTest: { controls: { faceVisible: boolean } } }).__qalamTest.controls.faceVisible = true;
    });
    await expect(page.locator('.pill-tracking')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Suivant' }).click();
    await expect(page.locator('.reader-nav')).toContainText(/Paragraphe [2-6] sur 6/);
  });
});

test.describe('diagnostics', () => {
  test('shows live pipeline measurements, calibrates, and measures accuracy against known targets', async ({ page }) => {
    await registerAdult(page, 'Enseignant', TEACHER);
    await page.evaluate(() => (window as unknown as { __qalamTest: { useSyntheticSource(on: boolean): void } }).__qalamTest.useSyntheticSource(true));
    await page.getByRole('link', { name: 'Diagnostic du suivi' }).click();
    await page.getByRole('button', { name: 'Démarrer la caméra' }).click();
    await expect(page.getByText('Images analysées par seconde')).toBeVisible();
    await page.getByRole('button', { name: /Régler/ }).click();
    await page.getByRole('button', { name: 'C’est parti' }).click();
    await expect(page.getByText('Erreur maximale')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Test de précision' }).click();
    await expect(page.getByText(/Erreur moyenne \d+ px \(médiane \d+ px\)/)).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText(/sur 9 cibles mesurées sur 9/)).toBeVisible();
  });
});
