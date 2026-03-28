import React, { memo, useMemo } from 'react';
import Word from './Word';

function Sentence({ words, paragraphIndex, sentenceIndex }) {
  const renderedWords = useMemo(() => {
    const items = [];

    for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
      items.push(
        <Word
          key={`w-${paragraphIndex}-${sentenceIndex}-${wordIndex}`}
          word={words[wordIndex]}
        />
      );
    }

    return items;
  }, [paragraphIndex, sentenceIndex, words]);

  return <span className="reader-sentence">{renderedWords}</span>;
}

export default memo(Sentence);
