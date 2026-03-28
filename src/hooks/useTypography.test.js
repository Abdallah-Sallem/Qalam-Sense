import { renderHook } from '@testing-library/react';
import useTypography from './useTypography';

describe('useTypography', () => {
  test('returns arabic typography config', () => {
    const { result } = renderHook(() => useTypography('ar'));

    expect(result.current.fontClass).toContain('typography-ar');
    expect(Number(result.current.lineHeight)).toBeGreaterThanOrEqual(1.9);
    expect(result.current.wordSpacing).toBe('0.18em');
  });

  test('returns french typography config', () => {
    const { result } = renderHook(() => useTypography('fr'));

    expect(result.current.fontClass).toContain('typography-fr');
    expect(result.current.lineHeight).toBe('1.6');
  });
});
