/**
 * Read-only views over decrypted session summaries, for the teacher and
 * parent dashboards and for export. Pure functions.
 *
 * Only quantities that were actually measured are reported, each with what
 * it means. There is no composite "score" and nothing here is a diagnosis.
 */
import type { IndicatorKey } from '@/difficulty/types';
import type { SessionSummary } from '@/domain/types';
import { median } from '@/lib/math';
import type { ParsedText } from '@/reading/text';

/** Words per minute from paragraph timings (available with or without the camera). */
export function pace(s: Pick<SessionSummary, 'paragraphs'>): number | null {
  const words = s.paragraphs.reduce((a, p) => a + p.words, 0);
  const ms = s.paragraphs.reduce((a, p) => a + p.timeMs, 0);
  // Under ten seconds of reading is not a pace measurement.
  return ms >= 10_000 && words > 0 ? (words * 60_000) / ms : null;
}

export interface Overview {
  sessions: number;
  totalMs: number;
  lastAt: number | null;
  completed: number;
  withCamera: number;
  /** Median pace over sessions where it could be measured. */
  medianPace: number | null;
  automaticAdaptations: number;
}

export function overview(sessions: readonly SessionSummary[]): Overview {
  const paces = sessions.map(pace).filter((p): p is number => p !== null);
  return {
    sessions: sessions.length,
    totalMs: sessions.reduce((a, s) => a + s.durationMs, 0),
    lastAt: sessions.length ? Math.max(...sessions.map((s) => s.startedAt)) : null,
    completed: sessions.filter((s) => s.endReason === 'completed').length,
    withCamera: sessions.filter((s) => s.gaze !== null).length,
    medianPace: paces.length ? median(paces) : null,
    automaticAdaptations: sessions.reduce((a, s) => a + s.adaptations.filter((e) => e.trigger === 'auto').length, 0),
  };
}

export interface TrendPoint {
  startedAt: number;
  pace: number | null;
  /** Mean support need (0..1) from gaze, when the camera was used and data was sufficient. */
  need: number | null;
  finalLevel: number;
}

/** One point per session, oldest first, for the "over time" chart. */
export function trend(sessions: readonly SessionSummary[]): TrendPoint[] {
  return [...sessions]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => ({
      startedAt: s.startedAt,
      pace: pace(s),
      need: s.gaze && s.gaze.assessments.ok >= 3 ? s.gaze.assessments.meanNeed : null,
      finalLevel: s.finalLevel,
    }));
}

export interface PassageEffort {
  sentence: number;
  text: string;
  dwellPerWordMs: number;
  /** Dwell per word relative to the median sentence of the same session. */
  ratio: number;
  regressionsIn: number;
}

/**
 * Sentences that took clearly more gaze time per word than the rest of the
 * same session, or that the reader came back into. A hint about the TEXT
 * (where to look when preparing the next lesson), not a judgement of the reader.
 */
export function effortfulPassages(summary: SessionSummary, parsed: ParsedText, minRatio = 1.5): PassageEffort[] {
  const stats = summary.gaze?.sentences ?? [];
  const rows = stats
    .map((st) => {
      const s = parsed.sentences[st.sentence];
      if (!s || st.fixations < 2) return null;
      const words = s.lastWord - s.firstWord + 1;
      return { st, s, dwellPerWordMs: st.dwellMs / words };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length < 3) return [];
  const typical = median(rows.map((r) => r.dwellPerWordMs));
  if (typical <= 0) return [];
  return rows
    .map(({ st, s, dwellPerWordMs }) => ({
      sentence: st.sentence,
      text: parsed.words.slice(s.firstWord, s.lastWord + 1).join(' '),
      dwellPerWordMs,
      ratio: dwellPerWordMs / typical,
      regressionsIn: st.regressionsIn,
    }))
    .filter((r) => r.ratio >= minRatio || r.regressionsIn >= 2)
    .sort((a, b) => b.ratio - a.ratio);
}

/** Indicators that were present on average in a session, strongest first. */
export function mainIndicators(summary: SessionSummary, min = 0.25): { key: IndicatorKey; score: number }[] {
  return Object.entries(summary.gaze?.indicatorMeans ?? {})
    .map(([key, score]) => ({ key: key as IndicatorKey, score: score ?? 0 }))
    .filter((i) => i.score >= min)
    .sort((a, b) => b.score - a.score);
}

const csvCell = (value: string | number | null): string => {
  if (value === null) return '';
  let s = String(value);
  // Spreadsheet formula injection: never let a cell start with = + - @.
  if (/^[=+\-@\t\r]/.test(s) && typeof value === 'string') s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_COLUMNS = [
  'date',
  'text',
  'language',
  'duration_s',
  'end',
  'words_read',
  'words_total',
  'pace_wpm',
  'camera',
  'tracking_valid_ratio',
  'calibration',
  'mean_support_need',
  'final_level',
  'auto_adaptations',
  'manual_adaptations',
] as const;

export function sessionsToCsv(sessions: readonly SessionSummary[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    const p = pace(s);
    lines.push(
      [
        new Date(s.startedAt).toISOString(),
        s.textTitle,
        s.language,
        Math.round(s.durationMs / 1000),
        s.endReason,
        s.wordsRead,
        s.wordsTotal,
        p === null ? null : Math.round(p),
        s.camera,
        s.gaze ? s.gaze.tracking.validRatio.toFixed(2) : null,
        s.gaze ? s.gaze.calibration.grade : null,
        s.gaze && s.gaze.assessments.ok ? s.gaze.assessments.meanNeed.toFixed(2) : null,
        s.finalLevel,
        s.adaptations.filter((e) => e.trigger === 'auto').length,
        s.adaptations.filter((e) => e.trigger === 'student').length,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // BOM so spreadsheet software opens Arabic titles as UTF-8.
  return `﻿${lines.join('\r\n')}\r\n`;
}
