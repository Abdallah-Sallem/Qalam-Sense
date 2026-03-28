const RTL_LANGUAGES = new Set(['ar']);

export function isRTL(language) {
  return RTL_LANGUAGES.has(language);
}

export function getDirection(language) {
  return isRTL(language) ? 'rtl' : 'ltr';
}
