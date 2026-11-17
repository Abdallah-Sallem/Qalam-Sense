import { expect, type Page } from '@playwright/test';

export const TEACHER = { email: 'prof@ecole.tn', password: 'lecture-2026', name: 'Mme Trabelsi' };
export const PARENT = { email: 'parent@mail.tn', password: 'maison-2026', name: 'M. Ben Salah' };

const sentence = (i: number) => `Le petit renard numéro ${i} traverse la forêt calme et regarde les grands arbres verts.`;
/** Six paragraphs of about 45 words: each fits on screen, together several minutes of reading. */
export const FRENCH_TEXT = Array.from({ length: 6 }, (_, p) => [0, 1, 2].map((s) => sentence(p * 3 + s + 1)).join(' ')).join('\n\n');
export const ARABIC_TEXT = [
  'كان الأسد نائما في ظل شجرة كبيرة. مر فأر صغير فوق أنفه فاستيقظ الأسد غاضبا.',
  'قال الفأر: سامحني أيها الملك، وربما أساعدك يوما. ضحك الأسد وتركه يذهب.',
  'بعد أيام وقع الأسد في شبكة الصياد. سمع الفأر صوته فجاء وقرض الحبال حتى تحرر.',
].join('\n\n');

export interface Credentials {
  login: string;
  pin: string;
  linkCode: string;
}

export async function registerAdult(page: Page, role: 'Enseignant' | 'Parent', who: { email: string; password: string; name: string }) {
  await page.goto('/');
  await page.getByRole('tab', { name: role }).click();
  await page.getByRole('button', { name: /Pas encore de compte/ }).click();
  await page.getByLabel('Votre nom').fill(who.name);
  await page.getByLabel('Adresse e-mail').fill(who.email);
  await page.getByLabel('Mot de passe').fill(who.password);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
}

export async function loginAdult(page: Page, role: 'Enseignant' | 'Parent', who: { email: string; password: string }) {
  await page.goto('/');
  await page.getByRole('tab', { name: role }).click();
  await page.getByLabel('Adresse e-mail').fill(who.email);
  await page.getByLabel('Mot de passe').fill(who.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('tab', { name: 'Élève' })).toBeVisible();
}

export async function createStudent(page: Page, name: string, language: 'fr' | 'ar' = 'fr'): Promise<Credentials> {
  await page.getByLabel('Prénom').fill(name);
  await page.getByLabel('Âge').fill('9');
  await page.getByLabel('Langue', { exact: true }).selectOption(language);
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  const values = page.locator('.credentials dd.mono');
  await expect(values).toHaveCount(3);
  const [login, pin, code] = await values.allInnerTexts();
  await page.getByRole('button', { name: 'Fermer' }).click();
  return { login: login!.trim(), pin: pin!.trim(), linkCode: code!.trim() };
}

export async function createAndAssignText(page: Page, title: string, content: string, student: string) {
  await page.getByRole('tab', { name: 'Textes' }).click();
  await page.getByRole('button', { name: 'Nouveau texte' }).click();
  await page.getByLabel('Titre').fill(title);
  await page.getByLabel('Texte', { exact: true }).fill(content);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: 'Attribuer' }).click();
  await page.getByLabel(student).check();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('attribué à 1 élève(s)')).toBeVisible();
}

/** Teacher account with one student and one assigned text; ends signed out. */
export async function seedClass(page: Page, opts: { title?: string; content?: string; language?: 'fr' | 'ar' } = {}): Promise<Credentials> {
  await registerAdult(page, 'Enseignant', TEACHER);
  const creds = await createStudent(page, 'Amine', opts.language ?? 'fr');
  await createAndAssignText(page, opts.title ?? 'Le renard', opts.content ?? FRENCH_TEXT, 'Amine');
  await logout(page);
  return creds;
}

export async function parentLinksAndConsents(page: Page, creds: Credentials) {
  await registerAdult(page, 'Parent', PARENT);
  await page.getByLabel('Identifiant').fill(creds.login);
  await page.getByLabel('Code parent').fill(creds.linkCode);
  await page.getByRole('button', { name: 'Lier', exact: true }).click();
  await expect(page.getByText('est maintenant lié')).toBeVisible();
  await page.getByRole('button', { name: 'J’autorise l’aide de la caméra' }).click();
  await expect(page.getByText(/Autorisée depuis/)).toBeVisible();
  await logout(page);
}

export async function loginStudent(page: Page, creds: Credentials) {
  await page.goto('/');
  await page.getByLabel('Identifiant').fill(creds.login);
  await page.getByLabel('Code secret').fill(creds.pin);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: /Bonjour Amine/ })).toBeVisible();
}

export const useSyntheticGaze = (page: Page) =>
  page.evaluate(() => (window as unknown as { __qalamTest: { useSyntheticSource(on: boolean): void } }).__qalamTest.useSyntheticSource(true));

export const setReaderProfile = (page: Page, profile: 'steady' | 'effortful') =>
  page.evaluate((p) => {
    (window as unknown as { __qalamTest: { controls: { profile: string } } }).__qalamTest.controls.profile = p;
  }, profile);

export const readerVar = (page: Page, name: string) =>
  page.locator('[data-reader]').evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);
