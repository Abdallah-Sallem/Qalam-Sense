import { useMemo } from 'react';
import { useLanguage } from './useLanguage';

const TYPOGRAPHY_CONFIG = {
  ar: {
    fontClass: 'typography-base typography-ar',
    lineHeight: '1.95',
    letterSpacing: '0.01em',
    wordSpacing: '0.18em',
  },
  fr: {
    fontClass: 'typography-base typography-fr',
    lineHeight: '1.6',
    letterSpacing: '0.005em',
    wordSpacing: '0.08em',
  },
};

export default function useTypography(languageOverride) {
  const { language } = useLanguage();
  const activeLanguage = languageOverride || language;

  return useMemo(() => {
    return TYPOGRAPHY_CONFIG[activeLanguage] || TYPOGRAPHY_CONFIG.fr;
  }, [activeLanguage]);
}
