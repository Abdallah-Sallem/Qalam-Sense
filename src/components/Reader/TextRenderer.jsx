import React, { memo, useMemo } from 'react';
import Paragraph from './Paragraph';
import { normalizeReaderContent } from '../../utils/textUtils';

function TextRenderer({ content, paragraphRange }) {
  const paragraphs = useMemo(() => normalizeReaderContent(content), [content]);

  const renderedParagraphs = useMemo(() => {
    const startIndex = paragraphRange?.start ?? 0;
    const endIndex = paragraphRange?.end ?? paragraphs.length;
    const boundedStart = Math.max(0, startIndex);
    const boundedEnd = Math.min(paragraphs.length, endIndex);

    const items = [];
    for (let paragraphIndex = boundedStart; paragraphIndex < boundedEnd; paragraphIndex += 1) {
      items.push(
        <Paragraph
          key={`p-${paragraphIndex}`}
          paragraph={paragraphs[paragraphIndex]}
          paragraphIndex={paragraphIndex}
        />
      );
    }

    return items;
  }, [paragraphRange?.end, paragraphRange?.start, paragraphs]);

  return <div className="text-renderer">{renderedParagraphs}</div>;
}

export default memo(TextRenderer);
