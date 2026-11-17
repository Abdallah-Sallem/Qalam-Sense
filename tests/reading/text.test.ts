import { describe, expect, it } from 'vitest';
import { buildLayout, lineProgress, nearestWord, type WordRect } from '@/reading/layout';
import { detectLanguage, directionOf, parseText, syllabifyFrench } from '@/reading/text';
import { gridLayout } from '@/testing/harness';

describe('language and direction', () => {
  it('detects the dominant script', () => {
    expect(detectLanguage('Le petit chat dort.')).toBe('fr');
    expect(detectLanguage('القط الصغير ينام.')).toBe('ar');
    expect(detectLanguage('ذهب أحمد إلى مدرسة Pasteur صباحا')).toBe('ar');
    expect(detectLanguage('Il a dit « مرحبا » en entrant dans la classe')).toBe('fr');
    expect(detectLanguage('123 !!!')).toBe('fr');
  });
  it('maps language to reading direction', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('fr')).toBe('ltr');
  });
});

describe('parseText', () => {
  it('splits paragraphs, words and sentences, numbering words in reading order', () => {
    const p = parseText('Le chat dort. Il rêve.\n\nLa nuit tombe');
    expect(p.paragraphs).toHaveLength(2);
    expect(p.wordCount).toBe(8);
    expect(p.words).toEqual(['Le', 'chat', 'dort.', 'Il', 'rêve.', 'La', 'nuit', 'tombe']);
    expect(p.paragraphOf).toEqual([0, 0, 0, 0, 0, 1, 1, 1]);
    expect(p.sentenceOf).toEqual([0, 0, 0, 1, 1, 2, 2, 2]);
    expect(p.sentences.map((s) => [s.firstWord, s.lastWord])).toEqual([
      [0, 2],
      [3, 4],
      [5, 7],
    ]);
    // Whitespace tokens carry no word index.
    expect(p.paragraphs[0]!.filter((t) => t.word === -1).every((t) => t.text === ' ')).toBe(true);
  });

  it('handles Arabic punctuation and Windows line endings', () => {
    const p = parseText('هل تحب القراءة؟ نعم أحبها.\r\nالكتاب صديق');
    expect(p.paragraphs).toHaveLength(2);
    expect(p.sentences).toHaveLength(3);
    expect(p.sentenceOf[0]).toBe(0);
    expect(p.sentenceOf[3]).toBe(1);
  });

  it('returns an empty model for empty content', () => {
    const p = parseText('  \n \n');
    expect(p.wordCount).toBe(0);
    expect(p.paragraphs).toEqual([]);
    expect(p.sentences).toEqual([]);
  });

  it('keeps every word of a long passage', () => {
    const text = Array.from({ length: 2500 }, (_, i) => `mot${i}`).join(' ');
    expect(parseText(text).wordCount).toBe(2500);
  });
});

describe('syllabifyFrench', () => {
  const cases: [string, string[]][] = [
    ['chocolat', ['cho', 'co', 'lat']],
    ['table', ['ta', 'ble']],
    ['partir', ['par', 'tir']],
    ['école', ['é', 'co', 'le']],
    ['oiseau', ['oi', 'seau']],
    ['le', ['le']],
    ['ils', ['ils']],
    ['montagne', ['mon', 'ta', 'gne']],
    ['Maison,', ['Mai', 'son,']],
  ];
  it.each(cases)('%s', (word, expected) => {
    expect(syllabifyFrench(word)).toEqual(expected);
  });
  it('never loses or reorders characters', () => {
    for (const w of ['anticonstitutionnellement', "l'arbre", 'aujourd’hui', 'œuf', 'x', '']) {
      expect(syllabifyFrench(w).join('')).toBe(w);
    }
  });
});

describe('layout', () => {
  const parsed = parseText(Array.from({ length: 20 }, (_, i) => `w${i}`).join(' '));

  it('groups LTR words into lines from left to right', () => {
    const l = gridLayout(parsed, { direction: 'ltr', wordsPerLine: 8 });
    expect(l.lines.map((x) => [x.firstWord, x.lastWord])).toEqual([[0, 7], [8, 15], [16, 19]]);
    expect(l.words[0]!.left).toBeLessThan(l.words[1]!.left);
    expect(l.linePitch).toBe(64);
    expect(lineProgress(l.lines[0]!, l.lines[0]!.left, 'ltr')).toBe(0);
    expect(lineProgress(l.lines[0]!, l.lines[0]!.right, 'ltr')).toBe(1);
  });

  it('places the first word of an RTL line on the right and measures progress leftwards', () => {
    const l = gridLayout(parsed, { direction: 'rtl', wordsPerLine: 8 });
    expect(l.lines.map((x) => [x.firstWord, x.lastWord])).toEqual([[0, 7], [8, 15], [16, 19]]);
    expect(l.words[0]!.left).toBeGreaterThan(l.words[1]!.left);
    expect(lineProgress(l.lines[0]!, l.lines[0]!.right, 'rtl')).toBe(0);
    expect(lineProgress(l.lines[0]!, l.lines[0]!.left, 'rtl')).toBe(1);
    expect(lineProgress(l.lines[0]!, l.lines[0]!.left - 500, 'rtl')).toBe(1); // clamped
  });

  it('keeps a bidirectional line together even though x is not monotonic in reading order', () => {
    // RTL line: words 0,1 on the right, an embedded LTR run (2,3) displayed left-to-right, then 4.
    const y = { top: 100, bottom: 130 };
    const rects: WordRect[] = [
      { index: 0, paragraph: 0, left: 800, right: 880, ...y },
      { index: 1, paragraph: 0, left: 700, right: 780, ...y },
      { index: 2, paragraph: 0, left: 500, right: 580, ...y }, // LTR run: 2 is left of 3
      { index: 3, paragraph: 0, left: 600, right: 680, ...y },
      { index: 4, paragraph: 0, left: 400, right: 480, ...y },
      { index: 5, paragraph: 0, left: 800, right: 880, top: 164, bottom: 194 },
    ];
    const l = buildLayout(rects, 'rtl');
    expect(l.lines).toHaveLength(2);
    expect(l.lines[0]).toMatchObject({ firstWord: 0, lastWord: 4, left: 400, right: 880 });
    expect(nearestWord(l, l.lines[0]!, 640).index).toBe(3);
    expect(nearestWord(l, l.lines[0]!, 530).index).toBe(2);
  });

  it('starts a new line for a new paragraph and finds the nearest word', () => {
    const two = parseText('a b c\n\nd e f');
    const l = gridLayout(two, { direction: 'ltr', wordsPerLine: 8 });
    expect(l.lines).toHaveLength(2);
    expect(l.lines[1]!.paragraph).toBe(1);
    expect(nearestWord(l, l.lines[0]!, -1000).index).toBe(0);
    expect(nearestWord(l, l.lines[0]!, 99999).index).toBe(2);
  });

  it('copes with an empty layout', () => {
    const l = buildLayout([], 'ltr');
    expect(l.lines).toEqual([]);
    expect(l.linePitch).toBe(0);
  });
});
