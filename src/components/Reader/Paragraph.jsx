import React, { memo, useMemo } from 'react';
import Sentence from './Sentence';

function Paragraph({ paragraph, paragraphIndex }) {
  const renderedSentences = useMemo(() => {
    const items = [];
    const sentenceList = Array.isArray(paragraph.sentences) ? paragraph.sentences : [];

    for (let sentenceIndex = 0; sentenceIndex < sentenceList.length; sentenceIndex += 1) {
      items.push(
        <Sentence
          key={`s-${paragraphIndex}-${sentenceIndex}`}
          words={sentenceList[sentenceIndex]}
          paragraphIndex={paragraphIndex}
          sentenceIndex={sentenceIndex}
        />
      );
    }

    return items;
  }, [paragraph, paragraphIndex]);

  return <p className="reader-paragraph">{renderedSentences}</p>;
}

export default memo(Paragraph);
