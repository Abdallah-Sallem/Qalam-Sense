/**
 * Level + dominant need + language → concrete typography.
 *
 * Script-specific rules that matter:
 *  - Arabic is cursive: letter-spacing breaks the joins between letters, so it
 *    is ALWAYS 0 for Arabic and extra room comes from word spacing, size and
 *    line height instead.
 *  - Arabic needs taller lines than Latin for its ascenders, descenders and
 *    vowel marks (tashkeel), so its line-height scale starts higher.
 *  - The Latin dyslexia-oriented fonts have no Arabic glyphs; Arabic always
 *    uses a Naskh face designed for continuous reading.
 */
import type { SupportDimension } from '@/difficulty/types';
import { clamp } from '@/lib/math';
import type { Lang } from '@/reading/text';
import type { FocusMode, FontChoice, Level, ManualAdjust, ReadingStyle, StudentSettings, ThemeName } from './types';

const FONT_STACKS: Record<Exclude<FontChoice, 'auto'>, string> = {
  atkinson: '"Atkinson Hyperlegible", Verdana, sans-serif',
  lexend: '"Lexend", Verdana, sans-serif',
  opendyslexic: '"OpenDyslexic", "Atkinson Hyperlegible", Verdana, sans-serif',
};
const ARABIC_STACK = '"Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif';

export const THEMES: Record<ThemeName, { background: string; color: string; highContrastColor: string }> = {
  paper: { background: '#FFFFFF', color: '#1F2328', highContrastColor: '#000000' },
  cream: { background: '#FBF4E2', color: '#2A2418', highContrastColor: '#000000' },
  sky: { background: '#EAF3FA', color: '#16232E', highContrastColor: '#000000' },
  dusk: { background: '#1E2530', color: '#E6E9EE', highContrastColor: '#FFFFFF' },
};

interface Scale {
  fontScale: number[];
  letterSpacingEm: number[];
  wordSpacingEm: number[];
  lineHeight: number[];
  paragraphSpacingEm: number[];
  maxWidthCh: number[];
}

/** Values for levels 0..3 (plus one extra step reachable through manual spacing). */
const LATIN: Scale = {
  fontScale: [1, 1.06, 1.12, 1.2],
  letterSpacingEm: [0, 0.03, 0.06, 0.09, 0.12],
  wordSpacingEm: [0, 0.1, 0.2, 0.3, 0.4],
  lineHeight: [1.7, 1.9, 2.1, 2.35, 2.6],
  paragraphSpacingEm: [1, 1.2, 1.45, 1.7],
  maxWidthCh: [68, 62, 56, 50],
};
const ARABIC: Scale = {
  fontScale: [1.08, 1.14, 1.2, 1.28],
  letterSpacingEm: [0, 0, 0, 0, 0],
  wordSpacingEm: [0, 0.12, 0.24, 0.36, 0.48],
  lineHeight: [1.95, 2.15, 2.35, 2.6, 2.85],
  paragraphSpacingEm: [1, 1.2, 1.45, 1.7],
  maxWidthCh: [64, 58, 52, 46],
};

const SIZE_STEP = 0.07;
const at = (values: number[], i: number): number => values[clamp(Math.round(i), 0, values.length - 1)]!;

export interface StyleInput {
  level: Level;
  dominant: SupportDimension | null;
  lang: Lang;
  settings: StudentSettings;
  manual: ManualAdjust;
}

export function styleFor({ level, dominant, lang, settings, manual }: StyleInput): ReadingStyle {
  const scale = lang === 'ar' ? ARABIC : LATIN;

  // The dominant need shifts emphasis by one step on the properties that address it.
  const bump = (dims: SupportDimension[]) => (level > 0 && dominant && dims.includes(dominant) ? 1 : 0);
  const spacingLevel = level + manual.spacingSteps + bump(['decoding']);
  const lineLevel = level + manual.spacingSteps + bump(['lineTracking']);
  const widthLevel = level + bump(['lineTracking', 'attention']);
  const sizeLevel = level + bump(['fatigue']);

  let fontFamily: string;
  if (lang === 'ar') fontFamily = ARABIC_STACK;
  else if (settings.font !== 'auto') fontFamily = FONT_STACKS[settings.font];
  else fontFamily = level >= 1 ? FONT_STACKS.atkinson : FONT_STACKS.lexend;

  let theme: ThemeName;
  if (manual.theme) theme = manual.theme;
  else if (settings.theme !== 'auto') theme = settings.theme;
  else if (level === 0) theme = 'paper';
  else theme = dominant === 'attention' ? 'sky' : 'cream';

  let focus: FocusMode;
  if (manual.focus) focus = manual.focus;
  else if (level >= 2 && dominant === 'lineTracking') focus = 'line-guide';
  else if (level >= 1) focus = 'paragraph';
  else focus = 'none';

  const highContrast = level >= 3;
  const t = THEMES[theme];
  return {
    fontFamily,
    fontScale: clamp(at(scale.fontScale, sizeLevel) + manual.sizeSteps * SIZE_STEP, 0.9, 1.6),
    letterSpacingEm: at(scale.letterSpacingEm, spacingLevel),
    wordSpacingEm: at(scale.wordSpacingEm, spacingLevel),
    lineHeight: at(scale.lineHeight, lineLevel),
    paragraphSpacingEm: at(scale.paragraphSpacingEm, level),
    maxWidthCh: at(scale.maxWidthCh, widthLevel),
    theme,
    highContrast,
    background: t.background,
    color: highContrast ? t.highContrastColor : t.color,
    focus,
  };
}

/** CSS custom properties consumed by the reader stylesheet. */
export function styleToCssVars(style: ReadingStyle): Record<string, string> {
  return {
    '--rd-font': style.fontFamily,
    '--rd-size': `${style.fontScale.toFixed(3)}`,
    '--rd-letter': `${style.letterSpacingEm}em`,
    '--rd-word': `${style.wordSpacingEm}em`,
    '--rd-line': `${style.lineHeight}`,
    '--rd-para': `${style.paragraphSpacingEm}em`,
    '--rd-width': `${style.maxWidthCh}ch`,
    '--rd-bg': style.background,
    '--rd-fg': style.color,
  };
}

/** WCAG 2 relative luminance contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
