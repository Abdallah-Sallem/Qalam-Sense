/**
 * Input validation. Every value typed by a user passes through here before
 * it is stored. Failures are reported with a stable code the UI translates.
 */
import type { Lang } from '@/reading/text';

export type ValidationCode =
  | 'name-required'
  | 'name-too-long'
  | 'email-invalid'
  | 'password-too-short'
  | 'password-too-weak'
  | 'pin-invalid'
  | 'age-invalid'
  | 'title-required'
  | 'title-too-long'
  | 'text-empty'
  | 'text-too-long'
  | 'language-invalid';

export class ValidationError extends Error {
  constructor(readonly code: ValidationCode) {
    super(code);
    this.name = 'ValidationError';
  }
}

export const LIMITS = {
  nameMax: 40,
  passwordMin: 8,
  titleMax: 120,
  textMaxWords: 5000,
  textMaxChars: 60_000,
  ageMin: 5,
  ageMax: 18,
};

/** Removes control and invisible formatting characters, collapses whitespace. */
const clean = (s: string): string =>
  s
    .normalize('NFC')
    .replace(/[\t\n\r]/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function validateName(input: string): string {
  const name = clean(input);
  if (!name) throw new ValidationError('name-required');
  if ([...name].length > LIMITS.nameMax) throw new ValidationError('name-too-long');
  return name;
}

export function validateEmail(input: string): string {
  const email = clean(input).toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ValidationError('email-invalid');
  return email;
}

const COMMON = new Set(['password', 'motdepasse', '12345678', '123456789', 'azertyui', 'qwertyui', 'azerty123', '00000000', '11111111']);

export function validatePassword(password: string): string {
  if ([...password].length < LIMITS.passwordMin) throw new ValidationError('password-too-short');
  if (COMMON.has(password.toLowerCase()) || new Set(password).size < 4) throw new ValidationError('password-too-weak');
  return password;
}

export function validatePin(pin: string): string {
  if (!/^\d{4}$/.test(pin)) throw new ValidationError('pin-invalid');
  return pin;
}

export function validateAge(age: number): number {
  if (!Number.isInteger(age) || age < LIMITS.ageMin || age > LIMITS.ageMax) throw new ValidationError('age-invalid');
  return age;
}

export function validateLanguage(lang: string): Lang {
  if (lang !== 'ar' && lang !== 'fr') throw new ValidationError('language-invalid');
  return lang;
}

export function validateTitle(input: string): string {
  const title = clean(input);
  if (!title) throw new ValidationError('title-required');
  if ([...title].length > LIMITS.titleMax) throw new ValidationError('title-too-long');
  return title;
}

/** Normalises reading material: keeps paragraph breaks, strips control characters. */
export function validateTextContent(input: string): string {
  const content = input
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!content) throw new ValidationError('text-empty');
  if (content.length > LIMITS.textMaxChars || content.split(/\s+/).length > LIMITS.textMaxWords) {
    throw new ValidationError('text-too-long');
  }
  return content;
}
