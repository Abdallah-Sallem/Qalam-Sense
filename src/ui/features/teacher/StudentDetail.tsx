import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FontChoice, Level, StudentSettings, ThemeName } from '@/adaptation/types';
import { useApp } from '@/app/AppContext';
import { href, navigate } from '@/app/router';
import { sessionsToCsv } from '@/services/reports';
import { Button, ConfirmButton, Modal, Notice, Spinner, useAction, useLoad } from '@/ui/components/ui';
import { OverviewStats, SessionTable, TrendChart, downloadFile } from '@/ui/features/shared/SessionViews';
import { CredentialsCard } from './TeacherDashboard';

const LEVELS: Level[] = [0, 1, 2, 3];
const FONTS: FontChoice[] = ['auto', 'atkinson', 'lexend', 'opendyslexic'];
const THEMES: ('auto' | ThemeName)[] = ['auto', 'paper', 'cream', 'sky', 'dusk'];

export function StudentDetail({ studentId }: { studentId: string }) {
  const { t } = useTranslation();
  const { services } = useApp();
  const rows = useLoad(() => services.classroom.listStudents(), [studentId]);
  const sessions = useLoad(() => services.classroom.sessions(studentId), [studentId]);
  const texts = useLoad(() => services.classroom.listTexts(), []);
  const action = useAction();
  const [secret, setSecret] = useState<{ pin?: string; linkCode?: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const row = rows.data?.find((r) => r.student.id === studentId);
  const textMap = useMemo(() => new Map((texts.data ?? []).map((x) => [x.id, x])), [texts.data]);
  const summaries = useMemo(() => (sessions.data?.sessions ?? []).map((s) => s.summary), [sessions.data]);

  if (rows.loading) return <Spinner label={t('common.loading')} />;
  if (rows.error) return <Notice kind="error">{rows.error}</Notice>;
  if (!row) {
    return (
      <>
        <Notice kind="error">{t('errors.not-found')}</Notice>
        <a href={href('')}>{t('common.back')}</a>
      </>
    );
  }
  const { student } = row;

  const saveSettings = (patch: Partial<StudentSettings>) =>
    void action.run(async () => {
      setSaved(false);
      await services.classroom.updateStudent(studentId, { settings: patch });
      setSaved(true);
      rows.reload();
    });

  return (
    <div className="stack">
      <p>
        <a href={href('')}>← {t('teacher.students')}</a>
      </p>
      <header className="detail-head">
        <h1>{student.displayName}</h1>
        <p className="muted">
          {t('teacher.years', { count: student.age })} · {t(`lang.${student.language}`)} ·{' '}
          <span className="mono" dir="ltr">
            {row.loginId}
          </span>
        </p>
      </header>
      {action.error && <Notice kind="error">{action.error}</Notice>}

      <section className="card">
        <h2>{t('settings.supportTitle')}</h2>
        <p className="muted">{t('settings.supportHint')}</p>
        <div className="form-grid">
          <label className="check">
            <input type="checkbox" checked={student.settings.autoAdapt} onChange={(e) => saveSettings({ autoAdapt: e.target.checked })} />
            {t('settings.autoAdapt')}
          </label>
          <label className="check">
            <input type="checkbox" checked={student.settings.syllableColoring} onChange={(e) => saveSettings({ syllableColoring: e.target.checked })} />
            {t('settings.syllables')}
          </label>
          <div className="field">
            <label htmlFor="base-level">{t('settings.baseLevel')}</label>
            <select id="base-level" value={student.settings.baseLevel} onChange={(e) => saveSettings({ baseLevel: Number(e.target.value) as Level })}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`settings.level.${l}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="max-level">{t('settings.maxLevel')}</label>
            <select id="max-level" value={student.settings.maxLevel} onChange={(e) => saveSettings({ maxLevel: Number(e.target.value) as Level })}>
              {LEVELS.filter((l) => l >= student.settings.baseLevel).map((l) => (
                <option key={l} value={l}>
                  {t(`settings.level.${l}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="font">{t('settings.font')}</label>
            <select id="font" value={student.settings.font} onChange={(e) => saveSettings({ font: e.target.value as FontChoice })}>
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {t(`settings.fontChoice.${f}`)}
                </option>
              ))}
            </select>
            <p className="field-hint">{t('settings.fontHint')}</p>
          </div>
          <div className="field">
            <label htmlFor="theme">{t('settings.theme')}</label>
            <select id="theme" value={student.settings.theme} onChange={(e) => saveSettings({ theme: e.target.value as 'auto' | ThemeName })}>
              {THEMES.map((th) => (
                <option key={th} value={th}>
                  {th === 'auto' ? t('settings.auto') : t(`reader.theme.${th}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {saved && <Notice kind="success">{t('common.saved')}</Notice>}
      </section>

      <section className="card">
        <h2>{t('teacher.accessTitle')}</h2>
        <p>
          {row.parentLinked ? t(row.cameraConsent ? 'teacher.accessConsent' : 'teacher.accessLinkedNoConsent') : t('teacher.accessNoParent')}
        </p>
        <div className="row">
          <Button onClick={() => void action.run(async () => setSecret({ pin: await services.classroom.resetPin(studentId) }))} busy={action.busy}>
            {t('teacher.resetPin')}
          </Button>
          <Button onClick={() => void action.run(async () => setSecret({ linkCode: await services.classroom.issueLinkCode(studentId) }))} busy={action.busy}>
            {t('teacher.newParentCode')}
          </Button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t('sessions.title')}</h2>
          <div className="row no-print">
            <Button
              disabled={summaries.length === 0}
              onClick={() =>
                void action.run(async () => {
                  await services.classroom.noteExport(studentId);
                  downloadFile(`qalam-sense-${row.loginId}.csv`, sessionsToCsv(summaries), 'text/csv;charset=utf-8');
                })
              }
            >
              {t('sessions.exportCsv')}
            </Button>
            <Button disabled={summaries.length === 0} onClick={() => window.print()}>
              {t('sessions.printReport')}
            </Button>
          </div>
        </div>
        {sessions.loading && <Spinner label={t('common.loading')} />}
        {sessions.error && <Notice kind="error">{sessions.error}</Notice>}
        {sessions.data && (
          <>
            {sessions.data.unreadable > 0 && <Notice kind="warn">{t('sessions.unreadable', { count: sessions.data.unreadable })}</Notice>}
            {summaries.length > 0 && (
              <>
                <OverviewStats sessions={summaries} />
                <h3>{t('sessions.overTime')}</h3>
                <TrendChart sessions={summaries} />
              </>
            )}
            <SessionTable
              sessions={sessions.data.sessions}
              texts={textMap}
              onDelete={async (id) => {
                await action.run(() => services.classroom.deleteSession(studentId, id));
                sessions.reload();
              }}
            />
          </>
        )}
      </section>

      <section className="card card-danger no-print">
        <h2>{t('teacher.deleteStudentTitle')}</h2>
        <p>{t('teacher.deleteStudentBody', { name: student.displayName })}</p>
        <ConfirmButton
          label={t('teacher.deleteStudent')}
          confirmLabel={t('teacher.deleteStudentConfirm')}
          onConfirm={async () => {
            if (await action.run(() => services.classroom.deleteStudent(studentId))) navigate('');
          }}
        />
      </section>

      {secret && (
        <Modal title={t('teacher.newCredentials')} onClose={() => setSecret(null)}>
          <CredentialsCard name={student.displayName} loginId={row.loginId} pin={secret.pin} linkCode={secret.linkCode} />
        </Modal>
      )}
    </div>
  );
}
