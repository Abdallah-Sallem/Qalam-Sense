import { isMixedLanguageWord, isNumericToken } from './textUtils';

describe('textUtils', () => {
  test('detects mixed language words', () => {
    expect(isMixedLanguageWord('Bonjourمرحبا')).toBe(true);
    expect(isMixedLanguageWord('Bonjour')).toBe(false);
    expect(isMixedLanguageWord('مرحبا')).toBe(false);
  });

  test('detects numeric tokens including arabic numerals', () => {
    expect(isNumericToken('2026')).toBe(true);
    expect(isNumericToken('١٢٣')).toBe(true);
    expect(isNumericToken('hello')).toBe(false);
  });
});
