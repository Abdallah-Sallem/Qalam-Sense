import { useMemo } from 'react';
import { useLanguage } from './useLanguage';
import { getDirection, isRTL } from '../utils/directionUtils';

export default function useDirection(languageOverride) {
  const { language } = useLanguage();
  const activeLanguage = languageOverride || language;

  return useMemo(() => {
    const rtl = isRTL(activeLanguage);
    return {
      dir: getDirection(activeLanguage),
      isRTL: rtl,
    };
  }, [activeLanguage]);
}
