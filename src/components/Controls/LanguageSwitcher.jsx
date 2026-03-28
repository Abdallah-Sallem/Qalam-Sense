import React, { memo, useCallback, useMemo } from 'react';
import { useLanguage } from '../../hooks/useLanguage';

function LanguageSwitcher() {
  const { language, toggleLanguage } = useLanguage();

  const nextLanguageLabel = useMemo(() => {
    return language === 'ar' ? 'Passer au francais' : 'التحويل إلى العربية';
  }, [language]);

  const liveMessage = useMemo(() => {
    return language === 'ar' ? 'Language switched to Arabic' : 'Language switched to French';
  }, [language]);

  const onKeyDown = useCallback(
    (event) => {
      if (event.key === ' ') {
        event.preventDefault();
        toggleLanguage();
      }
    },
    [toggleLanguage]
  );

  return (
    <div className="language-switcher">
      <button
        type="button"
        className="language-switcher-button"
        tabIndex={0}
        aria-label="Switch language"
        aria-controls="reader-container"
        onClick={toggleLanguage}
        onKeyDown={onKeyDown}
      >
        {nextLanguageLabel}
      </button>
      <span className="sr-only" aria-live="polite">
        {liveMessage}
      </span>
    </div>
  );
}

export default memo(LanguageSwitcher);
