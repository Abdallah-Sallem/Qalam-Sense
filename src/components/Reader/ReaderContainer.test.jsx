import { act, render, screen } from '@testing-library/react';
import Word from './Word';
import ReaderContainer from './ReaderContainer';
import { __languageStore } from '../../hooks/useLanguage';

const CONTENT = {
  fr: {
    paragraphs: [{ sentences: [['Bonjour', 'le', 'monde']] }],
  },
  ar: {
    paragraphs: [{ sentences: [['مرحبا', 'بالعالم']] }],
  },
};

beforeEach(() => {
  window.localStorage.clear();
  __languageStore.setLanguageStore('fr');
});

test('updates dir attribute based on language state', () => {
  render(<ReaderContainer localizedContent={CONTENT} />);

  const reader = screen.getByLabelText('Reader content');
  expect(reader).toHaveAttribute('dir', 'ltr');

  act(() => {
    __languageStore.setLanguageStore('ar');
  });
  expect(reader).toHaveAttribute('dir', 'rtl');
});

test('applies dir auto for mixed language words', () => {
  const { container } = render(<Word word="Bonjourمرحبا" />);
  const wordNode = container.querySelector('.reader-word');

  expect(wordNode).toHaveAttribute('dir', 'auto');
});
