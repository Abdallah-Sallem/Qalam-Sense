import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'qalam-sense.reader.language';
const SUPPORTED_LANGUAGES = ['ar', 'fr'];

function normalizeLanguage(language) {
  if (typeof language !== 'string') {
    return 'fr';
  }

  const baseLanguage = language.trim().toLowerCase().split('-')[0];
  return SUPPORTED_LANGUAGES.includes(baseLanguage) ? baseLanguage : 'fr';
}

function getInitialLanguage() {
  if (typeof window === 'undefined') {
    return 'fr';
  }

  const storedLanguage = window.localStorage.getItem(STORAGE_KEY);
  if (storedLanguage) {
    return normalizeLanguage(storedLanguage);
  }

  return normalizeLanguage(window.navigator.language);
}

let languageState = getInitialLanguage();
const listeners = new Set();

function emitChange() {
  listeners.forEach((listener) => {
    listener();
  });
}

function setLanguageStore(nextLanguage) {
  const normalizedLanguage = normalizeLanguage(nextLanguage);
  if (normalizedLanguage === languageState) {
    return;
  }

  languageState = normalizedLanguage;

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, normalizedLanguage);
  }

  emitChange();
}

function toggleLanguageStore() {
  const nextLanguage = languageState === 'ar' ? 'fr' : 'ar';
  setLanguageStore(nextLanguage);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return languageState;
}

export function useLanguage() {
  const language = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setLanguage = useCallback((nextLanguage) => {
    setLanguageStore(nextLanguage);
  }, []);

  const toggleLanguage = useCallback(() => {
    toggleLanguageStore();
  }, []);

  return {
    language,
    setLanguage,
    toggleLanguage,
  };
}

export const __languageStore = {
  normalizeLanguage,
  getInitialLanguage,
  setLanguageStore,
  toggleLanguageStore,
  getSnapshot,
};
