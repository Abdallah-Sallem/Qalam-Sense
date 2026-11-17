import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/app/AppContext';
import type { ChildRow } from '@/services/family';
import { Button, ConfirmButton, Empty, Field, Notice, Spinner, useAction, useLoad } from '@/ui/components/ui';
import { OverviewStats, SessionTable, TrendChart, useDate } from '@/ui/features/shared/SessionViews';

export function ParentDashboard() {
  const { t } = useTranslation();
  const { services } = useApp();
  const children = useLoad(() => services.family.children(), []);
  const action = useAction();
  const [login, setLogin] = useState('');
  const [code, setCode] = useState('');
  const [linked, setLinked] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      const student = await services.family.linkChild(login, code);
      setLinked(student.displayName);
      setLogin('');
      setCode('');
      children.reload();
    });
  };

  return (
    <div className="stack">
      <h1>{t('parent.title')}</h1>
      {children.loading && <Spinner label={t('common.loading')} />}
      {children.error && <Notice kind="error">{children.error}</Notice>}
      {children.data && children.data.length === 0 && <Empty title={t('parent.noChildren')}>{t('parent.noChildrenHint')}</Empty>}
      {children.data?.map((row) => (
        <ChildCard key={row.student.id} row={row} onChanged={children.reload} />
      ))}

      <section className="card">
        <h2>{t('parent.linkTitle')}</h2>
        <p className="muted">{t('parent.linkHint')}</p>
        <form onSubmit={submit} className="form-row" noValidate>
          <Field label={t('auth.studentLogin')} value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" spellCheck={false} dir="ltr" required />
          <Field label={t('teacher.parentCode')} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" spellCheck={false} className="mono" dir="ltr" maxLength={12} required />
          <Button type="submit" variant="primary" busy={action.busy} disabled={!login.trim() || code.replace(/[\s-]/g, '').length < 8}>
            {t('parent.link')}
          </Button>
        </form>
        {action.error && <Notice kind="error">{action.error}</Notice>}
        {linked && <Notice kind="success">{t('parent.linked', { name: linked })}</Notice>}
      </section>
    </div>
  );
}

function ChildCard({ row, onChanged }: { row: ChildRow; onChanged: () => void }) {
  const { t } = useTranslation();
  const { services } = useApp();
  const date = useDate();
  const { student, consent } = row;
  const action = useAction();
  const [open, setOpen] = useState<'progress' | 'activity' | null>(null);
  const [deleted, setDeleted] = useState<number | null>(null);
  const sessions = useLoad(() => (open === 'progress' ? services.family.sessions(student.id) : Promise.resolve(null)), [open, student.id]);
  const activity = useLoad(() => (open === 'activity' ? services.family.activity(student.id) : Promise.resolve(null)), [open, student.id]);
  const summaries = useMemo(() => (sessions.data?.sessions ?? []).map((s) => s.summary), [sessions.data]);
  const cameraOn = consent?.camera === true;

  return (
    <section className="card">
      <header className="card-head">
        <h2>{student.displayName}</h2>
        <span className="muted">{t('parent.sessionCount', { count: row.sessionCount })}</span>
      </header>
      {action.error && <Notice kind="error">{action.error}</Notice>}

      <div className="consent">
        <h3>{t('consent.title')}</h3>
        <p>{t('consent.what')}</p>
        <ul>
          <li>{t('consent.point1')}</li>
          <li>{t('consent.point2')}</li>
          <li>{t('consent.point3')}</li>
          <li>{t('consent.point4')}</li>
        </ul>
        <p className={cameraOn ? 'consent-state on' : 'consent-state'} role="status">
          {cameraOn ? t('consent.on', { date: date(consent.grantedAt) }) : t('consent.off')}
        </p>
        {cameraOn ? (
          <Button
            busy={action.busy}
            onClick={() =>
              void action.run(async () => {
                await services.family.setCameraConsent(student.id, false);
                onChanged();
              })
            }
          >
            {t('consent.revoke')}
          </Button>
        ) : (
          <Button
            variant="primary"
            busy={action.busy}
            onClick={() =>
              void action.run(async () => {
                await services.family.setCameraConsent(student.id, true);
                onChanged();
              })
            }
          >
            {t('consent.grant')}
          </Button>
        )}
      </div>

      <div className="row">
        <Button aria-expanded={open === 'progress'} onClick={() => setOpen(open === 'progress' ? null : 'progress')}>
          {t('parent.progress')}
        </Button>
        <Button aria-expanded={open === 'activity'} onClick={() => setOpen(open === 'activity' ? null : 'activity')}>
          {t('parent.activity')}
        </Button>
      </div>

      {open === 'progress' && (
        <div className="stack">
          {sessions.loading && <Spinner label={t('common.loading')} />}
          {sessions.error && <Notice kind="error">{sessions.error}</Notice>}
          {sessions.data && (
            <>
              {summaries.length > 0 && <OverviewStats sessions={summaries} />}
              {summaries.length > 1 && <TrendChart sessions={summaries} />}
              <SessionTable sessions={sessions.data.sessions} />
            </>
          )}
        </div>
      )}

      {open === 'activity' && (
        <div>
          <p className="muted">{t('parent.activityHint')}</p>
          {activity.loading && <Spinner label={t('common.loading')} />}
          {activity.data && activity.data.length === 0 && <p className="muted">{t('parent.activityNone')}</p>}
          <ul className="activity">
            {activity.data?.map((a) => (
              <li key={a.id}>
                <span className="muted">{date(a.at)}</span> — {t(`audit.${a.action}`)} <span className="muted">({t(`roles.${a.actorRole === 'anonymous' ? 'student' : a.actorRole}`)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="danger-zone">
        <h3>{t('parent.dataTitle')}</h3>
        <p className="muted">{t('parent.dataHint')}</p>
        {deleted !== null && <Notice kind="success">{t('parent.deleted', { count: deleted })}</Notice>}
        <div className="row">
          <ConfirmButton
            label={t('parent.deleteData')}
            confirmLabel={t('parent.deleteDataConfirm')}
            onConfirm={async () => {
              await action.run(async () => {
                setDeleted(await services.family.deleteChildData(student.id));
                setOpen(null);
                onChanged();
              });
            }}
          />
          <ConfirmButton
            label={t('parent.unlink')}
            confirmLabel={t('parent.unlinkConfirm')}
            onConfirm={async () => {
              await action.run(async () => {
                await services.family.unlinkChild(student.id);
                onChanged();
              });
            }}
          />
        </div>
      </div>
    </section>
  );
}
