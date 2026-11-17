/** Session data views shared by the teacher and parent dashboards. */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionSummary, TextDoc } from '@/domain/types';
import { parseText } from '@/reading/text';
import type { DecryptedSession } from '@/services/keyring';
import { effortfulPassages, mainIndicators, overview, pace, trend, type TrendPoint } from '@/services/reports';
import { Button, ConfirmButton, Empty, formatDuration } from '@/ui/components/ui';

export function useDate(): (ms: number) => string {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-TN' : 'fr-TN', { dateStyle: 'medium', timeStyle: 'short' });
    return (ms: number) => f.format(ms);
  }, [i18n.language]);
}

export function OverviewStats({ sessions }: { sessions: SessionSummary[] }) {
  const { t } = useTranslation();
  const date = useDate();
  const o = overview(sessions);
  const items: [string, string][] = [
    [t('sessions.count'), String(o.sessions)],
    [t('sessions.totalTime'), formatDuration(o.totalMs)],
    [t('sessions.completed'), `${o.completed} / ${o.sessions}`],
    [t('sessions.medianPace'), o.medianPace === null ? '—' : t('sessions.wpm', { value: Math.round(o.medianPace) })],
    [t('sessions.withCamera'), `${o.withCamera} / ${o.sessions}`],
    [t('sessions.last'), o.lastAt === null ? '—' : date(o.lastAt)],
  ];
  return (
    <dl className="stats">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Reading pace per session (and support need when the camera was used), oldest to newest. */
export function TrendChart({ sessions }: { sessions: SessionSummary[] }) {
  const { t } = useTranslation();
  const date = useDate();
  const points = trend(sessions);
  const paced = points.filter((p): p is TrendPoint & { pace: number } => p.pace !== null);
  if (paced.length < 2) return <p className="muted">{t('sessions.trendNeedsTwo')}</p>;

  const W = 640;
  const H = 200;
  const pad = { l: 44, r: 16, t: 16, b: 28 };
  const maxPace = Math.max(...paced.map((p) => p.pace)) * 1.15;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1);
  const yPace = (v: number) => H - pad.b - (v / maxPace) * (H - pad.t - pad.b);
  const yNeed = (v: number) => H - pad.b - v * (H - pad.t - pad.b);
  const line = (pts: [number, number][]) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const paceLine = line(points.flatMap((p, i) => (p.pace === null ? [] : [[x(i), yPace(p.pace)] as [number, number]])));
  const needPts = points.flatMap((p, i) => (p.need === null ? [] : [[x(i), yNeed(p.need)] as [number, number]]));

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('sessions.trendAlt')}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={yPace(maxPace * f)} y2={yPace(maxPace * f)} className="chart-grid" />
            <text x={pad.l - 6} y={yPace(maxPace * f) + 4} textAnchor="end" className="chart-label">
              {Math.round(maxPace * f)}
            </text>
          </g>
        ))}
        <path d={paceLine} className="chart-pace" fill="none" />
        {points.map((p, i) =>
          p.pace === null ? null : (
            <circle key={i} cx={x(i)} cy={yPace(p.pace)} r={4} className="chart-pace-dot">
              <title>{`${date(p.startedAt)} — ${t('sessions.wpm', { value: Math.round(p.pace) })}`}</title>
            </circle>
          ),
        )}
        {needPts.length >= 2 && <path d={line(needPts)} className="chart-need" fill="none" />}
        {needPts.map(([cx, cy], i) => (
          <rect key={i} x={cx - 3} y={cy - 3} width={6} height={6} className="chart-need-dot" />
        ))}
      </svg>
      <figcaption>
        <span className="legend legend-pace">{t('sessions.legendPace')}</span>
        {needPts.length > 0 && <span className="legend legend-need">{t('sessions.legendNeed')}</span>}
      </figcaption>
    </figure>
  );
}

interface TableProps {
  sessions: DecryptedSession[];
  /** Texts by id, to show effortful passages. Omit to hide that section. */
  texts?: Map<string, TextDoc>;
  onDelete?: (sessionId: string) => Promise<void>;
}

export function SessionTable({ sessions, texts, onDelete }: TableProps) {
  const { t } = useTranslation();
  const date = useDate();
  const [open, setOpen] = useState<string | null>(null);
  if (sessions.length === 0) return <Empty title={t('sessions.none')}>{t('sessions.noneHint')}</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t('sessions.date')}</th>
            <th scope="col">{t('sessions.text')}</th>
            <th scope="col">{t('sessions.duration')}</th>
            <th scope="col">{t('sessions.pace')}</th>
            <th scope="col">{t('sessions.camera')}</th>
            <th scope="col">{t('sessions.level')}</th>
            <th scope="col">
              <span className="sr-only">{t('sessions.details')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map(({ id, summary: s }) => {
            const p = pace(s);
            return [
              <tr key={id}>
                <td>{date(s.startedAt)}</td>
                <td lang={s.language} dir="auto">
                  {s.textTitle}
                </td>
                <td>
                  {formatDuration(s.durationMs)} <span className="muted">({t(`sessions.end.${s.endReason}`)})</span>
                </td>
                <td>{p === null ? '—' : t('sessions.wpm', { value: Math.round(p) })}</td>
                <td>{t(`sessions.cameraOutcome.${s.camera}`)}</td>
                <td>{s.finalLevel}</td>
                <td>
                  <Button variant="ghost" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
                    {t(open === id ? 'sessions.hide' : 'sessions.details')}
                  </Button>
                </td>
              </tr>,
              open === id && (
                <tr key={`${id}-d`} className="detail-row">
                  <td colSpan={7}>
                    <SessionDetail summary={s} text={texts?.get(s.textId)} showPassages={texts !== undefined} />
                    {onDelete && <ConfirmButton label={t('sessions.delete')} confirmLabel={t('sessions.deleteConfirm')} onConfirm={() => onDelete(id)} />}
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SessionDetail({ summary: s, text, showPassages }: { summary: SessionSummary; text?: TextDoc; showPassages: boolean }) {
  const { t } = useTranslation();
  const indicators = mainIndicators(s);
  const passages = useMemo(() => (showPassages && text ? effortfulPassages(s, parseText(text.content)) : []), [s, text, showPassages]);
  const g = s.gaze;

  return (
    <div className="session-detail">
      <section>
        <h4>{t('detail.adaptations')}</h4>
        {s.adaptations.length === 0 ? (
          <p className="muted">{t('detail.noAdaptations')}</p>
        ) : (
          <ol className="timeline">
            {s.adaptations.map((e, i) => (
              <li key={i}>
                <span className="timeline-time">{formatDuration(e.atMs)}</span>
                <span>
                  {t(`detail.trigger.${e.trigger}`)} — {t('detail.levelChange', { from: e.fromLevel, to: e.toLevel })}
                  {e.dominant && ` · ${t(`dimension.${e.dominant}`)}`}
                  {e.reasons.length > 0 && <span className="muted"> ({e.reasons.map((r) => t(`indicator.${r}.name`)).join(', ')})</span>}
                  {e.confidence !== null && <span className="muted"> · {t('detail.confidence', { value: Math.round(e.confidence * 100) })}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {g ? (
        <>
          <section>
            <h4>{t('detail.observed')}</h4>
            {g.assessments.ok < 3 ? (
              <p className="muted">{t('detail.tooLittle')}</p>
            ) : indicators.length === 0 ? (
              <p>{t('detail.nothingUnusual')}</p>
            ) : (
              <ul className="indicators">
                {indicators.map((i) => (
                  <li key={i.key}>
                    <span className="meter" aria-hidden="true">
                      <span style={{ width: `${Math.round(i.score * 100)}%` }} />
                    </span>
                    <strong>{t(`indicator.${i.key}.name`)}</strong>
                    <span className="muted"> — {t(`indicator.${i.key}.meaning`)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {showPassages && (
            <section>
              <h4>{t('detail.passages')}</h4>
              {passages.length === 0 ? (
                <p className="muted">{t(text ? 'detail.noPassages' : 'detail.textDeleted')}</p>
              ) : (
                <ul className="passages">
                  {passages.slice(0, 5).map((p) => (
                    <li key={p.sentence}>
                      <q lang={s.language} dir="auto">
                        {p.text}
                      </q>
                      <span className="muted">
                        {' '}
                        {t('detail.passageRatio', { ratio: p.ratio.toFixed(1) })}
                        {p.regressionsIn > 0 && ` · ${t('detail.passageReturns', { count: p.regressionsIn })}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <section>
            <h4>{t('detail.quality')}</h4>
            <p className="muted">
              {t('detail.qualityLine', {
                grade: t(`grade.${g.calibration.grade}`),
                error: g.calibration.meanErrorPx,
                valid: Math.round(g.tracking.validRatio * 100),
                losses: g.tracking.lossEvents,
                usable: g.assessments.ok,
                total: g.assessments.ok + g.assessments.insufficient,
              })}
            </p>
          </section>
        </>
      ) : (
        <p className="muted">{t('detail.noCamera', { reason: t(`sessions.cameraOutcome.${s.camera}`) })}</p>
      )}
      <p className="disclaimer">{t('detail.disclaimer')}</p>
    </div>
  );
}

/** Triggers a client-side file download. */
export function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
