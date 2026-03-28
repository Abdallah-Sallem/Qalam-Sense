import { getDirection, isRTL } from './directionUtils';

describe('directionUtils', () => {
  test('detects arabic as RTL', () => {
    expect(isRTL('ar')).toBe(true);
    expect(getDirection('ar')).toBe('rtl');
  });

  test('detects french as LTR', () => {
    expect(isRTL('fr')).toBe(false);
    expect(getDirection('fr')).toBe('ltr');
  });
});
