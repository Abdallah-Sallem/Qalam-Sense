import React, { memo, useMemo } from 'react';
import clsx from 'clsx';
import { isMixedLanguageWord, isNumericToken } from '../../utils/textUtils';

function Word({ word }) {
  const isMixed = useMemo(() => isMixedLanguageWord(word), [word]);
  const isNumber = useMemo(() => isNumericToken(word), [word]);

  const className = useMemo(
    () =>
      clsx('reader-word', {
        'reader-word-mixed': isMixed,
        'reader-word-number': isNumber,
      }),
    [isMixed, isNumber]
  );

  return (
    <span className={className} dir={isMixed ? 'auto' : undefined}>
      {word}
    </span>
  );
}

export default memo(Word);
