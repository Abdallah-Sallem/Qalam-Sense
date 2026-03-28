const ARABIC_CHAR_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const LATIN_CHAR_REGEX = /[A-Za-z\u00C0-\u024F]/;
const NUMERIC_REGEX = /[0-9\u0660-\u0669\u06F0-\u06F9]/;

export function hasArabicChars(value) {
  return ARABIC_CHAR_REGEX.test(value);
}

export function hasLatinChars(value) {
  return LATIN_CHAR_REGEX.test(value);
}

export function isMixedLanguageWord(word) {
  if (typeof word !== 'string' || word.length === 0) {
    return false;
  }

  return hasArabicChars(word) && hasLatinChars(word);
}

export function isNumericToken(word) {
  if (typeof word !== 'string' || word.length === 0) {
    return false;
  }

  return NUMERIC_REGEX.test(word);
}

export function normalizeReaderContent(content) {
  if (!content || !Array.isArray(content.paragraphs)) {
    return [];
  }

  return content.paragraphs;
}
