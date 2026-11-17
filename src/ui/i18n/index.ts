import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ar } from './ar';
import { fr } from './fr';

export type Locale = 'fr' | 'ar';
const STORAGE_KEY = 'qalam:locale';

function applyToDocument(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
}

function storedLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'ar' || v === 'fr') return v;
  } catch {
    // Storage blocked: fall through to the browser language.
  }
  return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'fr';
}

export function initI18n(): void {
  const lng = storedLocale();
  void i18n.use(initReactI18next).init({
    resources: { fr: { translation: fr }, ar: { translation: ar } },
    lng,
    fallbackLng: 'fr',
    interpolation: { escapeValue: false }, // React already escapes
    returnNull: false,
  });
  applyToDocument(lng);
}

/** Switches the interface language. Reading texts keep their own direction. */
export function setLocale(locale: Locale): void {
  void i18n.changeLanguage(locale);
  applyToDocument(locale);
  try {
    localStorage.setItem(STORAGE_KEY, locale); // a display preference, not personal data
  } catch {
    // Not persisted; the choice still applies to this page.
  }
}
