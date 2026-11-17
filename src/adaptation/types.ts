import type { IndicatorKey, SupportDimension } from '@/difficulty/types';

/** Intensity of reading support: 0 = plain presentation, 3 = strongest. */
export type Level = 0 | 1 | 2 | 3;
export const MAX_LEVEL: Level = 3;

export type ThemeName = 'paper' | 'cream' | 'sky' | 'dusk';
export type FontChoice = 'auto' | 'atkinson' | 'lexend' | 'opendyslexic';
export type FocusMode = 'none' | 'paragraph' | 'line-guide';

/** Per-student settings chosen by the teacher (the student can adjust some live). */
export interface StudentSettings {
  /** Let the system raise/lower support on its own when the camera is in use. */
  autoAdapt: boolean;
  /** Support level the student always starts from and never goes below. */
  baseLevel: Level;
  /** Ceiling for automatic adaptation. */
  maxLevel: Level;
  font: FontChoice;
  theme: 'auto' | ThemeName;
  /** Alternate colours for French syllables. */
  syllableColoring: boolean;
}

export const DEFAULT_SETTINGS: StudentSettings = {
  autoAdapt: true,
  baseLevel: 0,
  maxLevel: 3,
  font: 'auto',
  theme: 'auto',
  syllableColoring: false,
};

/** Live adjustments made by the student during a session. They always win over automation. */
export interface ManualAdjust {
  /** Steps of text size on top of the level (-1..+3). */
  sizeSteps: number;
  /** Steps of extra spacing on top of the level (0..+2). */
  spacingSteps: number;
  theme: ThemeName | null;
  focus: FocusMode | null;
}

export const NO_MANUAL: ManualAdjust = { sizeSteps: 0, spacingSteps: 0, theme: null, focus: null };

/** Fully resolved presentation of the reading area. */
export interface ReadingStyle {
  fontFamily: string;
  /** Multiplier of the base reading size. */
  fontScale: number;
  letterSpacingEm: number;
  wordSpacingEm: number;
  lineHeight: number;
  paragraphSpacingEm: number;
  /** Maximum line length in characters. */
  maxWidthCh: number;
  theme: ThemeName;
  highContrast: boolean;
  background: string;
  color: string;
  focus: FocusMode;
}

export type AdaptationTrigger = 'auto' | 'student' | 'teacher-base';

/** One entry of the adaptation log shown to teachers and parents. */
export interface AdaptationEvent {
  /** Milliseconds since the session started. */
  atMs: number;
  trigger: AdaptationTrigger;
  fromLevel: Level;
  toLevel: Level;
  dominant: SupportDimension | null;
  /** Indicators that led to the decision (automatic changes only). */
  reasons: IndicatorKey[];
  confidence: number | null;
}

export type AdaptationMode = 'auto' | 'held' | 'manual-only';
