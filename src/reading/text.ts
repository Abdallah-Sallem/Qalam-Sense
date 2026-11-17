/**
 * Text model: language detection, tokenisation into paragraphs / sentences /
 * words, and French syllable splitting.
 *
 * Word indices are the backbone of the reading analysis: "progress" and
 * "regression" are defined on the logical word order, never on x coordinates,
 * so the same logic is correct for LTR French, RTL Arabic and mixed lines.
 */

export type Lang = 'ar' | 'fr';
export type Direction = 'ltr' | 'rtl';

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LETTER = /\p{L}/u;

/** Majority script of the letters in the text. */
export function detectLanguage(text: string): Lang {
  let arabic = 0;
  let letters = 0;
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    letters++;
    if (ARABIC.test(ch)) arabic++;
  }
  return letters > 0 && arabic / letters > 0.5 ? 'ar' : 'fr';
}

export const directionOf = (lang: Lang): Direction => (lang === 'ar' ? 'rtl' : 'ltr');

export interface Token {
  text: string;
  /** Index in reading order across the whole text, or -1 for whitespace. */
  word: number;
}

export interface Sentence {
  index: number;
  paragraph: number;
  firstWord: number;
  lastWord: number;
}

export interface ParsedText {
  paragraphs: Token[][];
  wordCount: number;
  /** Paragraph index of each word. */
  paragraphOf: number[];
  /** Sentence index of each word. */
  sentenceOf: number[];
  sentences: Sentence[];
  words: string[];
}

const SENTENCE_END = /[.!?؟…。]["'»”)\]]*$/;

export function parseText(content: string): ParsedText {
  const paragraphs: Token[][] = [];
  const paragraphOf: number[] = [];
  const sentenceOf: number[] = [];
  const sentences: Sentence[] = [];
  const words: string[] = [];
  let word = 0;
  let sentenceStart = 0;

  const closeSentence = (paragraph: number) => {
    if (word > sentenceStart) {
      sentences.push({ index: sentences.length, paragraph, firstWord: sentenceStart, lastWord: word - 1 });
      sentenceStart = word;
    }
  };

  for (const block of content.replace(/\r\n?/g, '\n').split(/\n+/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const p = paragraphs.length;
    const tokens: Token[] = [];
    for (const part of trimmed.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        tokens.push({ text: ' ', word: -1 });
        continue;
      }
      tokens.push({ text: part, word });
      words.push(part);
      paragraphOf.push(p);
      sentenceOf.push(sentences.length);
      word++;
      if (SENTENCE_END.test(part)) closeSentence(p);
    }
    closeSentence(p); // a paragraph always ends its sentence
    paragraphs.push(tokens);
  }
  return { paragraphs, wordCount: word, paragraphOf, sentenceOf, sentences, words };
}

const VOWELS = 'aeiouyàâäéèêëîïôöùûüœæ';
const isVowel = (ch: string | undefined): boolean => !!ch && VOWELS.includes(ch.toLowerCase());
const isLetter = (ch: string | undefined): boolean => !!ch && LETTER.test(ch);
/** Consonant pairs that start a French syllable together and are never split. */
const CLUSTERS = new Set([
  'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gn', 'gr', 'ph', 'pl', 'pr', 'th', 'tr', 'vr', 'qu', 'gu',
]);

/**
 * Splits a French word into written syllables for alternate colouring.
 * Rules: V|CV, VC|CV, and inseparable clusters stay with the following vowel.
 * It is a reading aid, not a phonetic transcription.
 */
export function syllabifyFrench(word: string): string[] {
  const chars = [...word];
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < chars.length; i++) {
    current += chars[i];
    const c = chars[i];
    const n1 = chars[i + 1];
    const n2 = chars[i + 2];
    const n3 = chars[i + 3];
    if (!isVowel(c) || !isLetter(n1) || isVowel(n1)) continue;
    // c is a vowel followed by a consonant.
    if (isVowel(n2)) {
      // V | C V
      out.push(current);
      current = '';
    } else if (isLetter(n2) && isVowel(n3)) {
      if (CLUSTERS.has((n1! + n2!).toLowerCase())) {
        // V | CC V  (cluster belongs to the next syllable)
        out.push(current);
        current = '';
      } else {
        // V C | C V
        current += n1;
        i++;
        out.push(current);
        current = '';
      }
    }
  }
  if (current) {
    // A trailing fragment without a vowel (e.g. a silent ending) joins the previous syllable.
    if (out.length > 0 && ![...current].some(isVowel)) out[out.length - 1] += current;
    else out.push(current);
  }
  return out.length > 0 ? out : [word];
}
