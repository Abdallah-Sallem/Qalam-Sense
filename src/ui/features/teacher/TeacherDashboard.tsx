import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/app/AppContext';
import { href } from '@/app/router';
import type { TextDifficulty } from '@/difficulty/types';
import type { TextDoc } from '@/domain/types';
import { parseText } from '@/reading/text';
import { LIMITS } from '@/security/validation';
import type { StudentCredentials, StudentRow } from '@/services/classroom';
import { Button, ConfirmButton, Empty, Field, Modal, Notice, Spinner, Tabs, useAction, useLoad } from '@/ui/components/ui';
import { useDate } from '@/ui/features/shared/SessionViews';

export function TeacherDashboard() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'students' | 'texts'>('students');
  return (
    <>
      <h1>{t('teacher.title')}</h1>
      <Tabs
        label={t('teacher.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'students', label: t('teacher.students') },
          { id: 'texts', label: t('teacher.texts') },
        ]}
      />
      {tab === 'students' ? <StudentsTab /> : <TextsTab />}
    </>
  );
}

/** Credentials are displayed once: only verifiers are stored. */
export function CredentialsCard({ name, loginId, pin, linkCode }: { name: string; loginId?: string; pin?: string; linkCode?: string }) {
  const { t } = useTranslation();
  return (
    <div className="credentials">
      <Notice kind="warn">{t('teacher.credentialsOnce')}</Notice>
      <dl>
        <dt>{t('teacher.student')}</dt>
        <dd>{name}</dd>
        {loginId && (
          <>
            <dt>{t('auth.studentLogin')}</dt>
            <dd className="mono" dir="ltr">
              {loginId}
            </dd>
          </>
        )}
        {pin && (
          <>
            <dt>{t('auth.pin')}</dt>
            <dd className="mono" dir="ltr">
              {pin}
            </dd>
          </>
        )}
        {linkCode && (
          <>
            <dt>{t('teacher.parentCode')}</dt>
            <dd className="mono" dir="ltr">
              {linkCode.slice(0, 4)}-{linkCode.slice(4)}
            </dd>
          </>
        )}
      </dl>
      {linkCode && <p className="muted">{t('teacher.parentCodeHint')}</p>}
      <Button onClick={() => window.print()}>{t('common.print')}</Button>
    </div>
  );
}

function StudentsTab() {
  const { t } = useTranslation();
  const { services } = useApp();
  const date = useDate();
  const list = useLoad<StudentRow[]>(() => services.classroom.listStudents(), []);
  const action = useAction();
  const [name, setName] = useState('');
  const [age, setAge] = useState('9');
  const [language, setLanguage] = useState('fr');
  const [created, setCreated] = useState<StudentCredentials | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      setCreated(await services.classroom.createStudent({ displayName: name, age: Number(age), language }));
      setName('');
      list.reload();
    });
  };

  return (
    <div className="stack">
      <section className="card">
        <h2>{t('teacher.addStudent')}</h2>
        <form onSubmit={submit} className="form-row" noValidate>
          <Field label={t('teacher.firstName')} hint={t('teacher.firstNameHint')} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
          <Field label={t('teacher.age')} type="number" min={LIMITS.ageMin} max={LIMITS.ageMax} value={age} onChange={(e) => setAge(e.target.value)} required />
          <div className="field">
            <label htmlFor="new-lang">{t('teacher.language')}</label>
            <select id="new-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="fr">{t('lang.fr')}</option>
              <option value="ar">{t('lang.ar')}</option>
            </select>
          </div>
          <Button type="submit" variant="primary" busy={action.busy} disabled={!name.trim()}>
            {t('teacher.create')}
          </Button>
        </form>
        {action.error && <Notice kind="error">{action.error}</Notice>}
      </section>

      {list.loading && <Spinner label={t('common.loading')} />}
      {list.error && <Notice kind="error">{list.error}</Notice>}
      {list.data && list.data.length === 0 && <Empty title={t('teacher.noStudents')}>{t('teacher.noStudentsHint')}</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('teacher.student')}</th>
                <th scope="col">{t('auth.studentLogin')}</th>
                <th scope="col">{t('teacher.language')}</th>
                <th scope="col">{t('sessions.count')}</th>
                <th scope="col">{t('sessions.last')}</th>
                <th scope="col">{t('teacher.parent')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((row) => (
                <tr key={row.student.id}>
                  <th scope="row">
                    <a href={href(`student/${row.student.id}`)}>{row.student.displayName}</a>
                    <span className="muted"> · {t('teacher.years', { count: row.student.age })}</span>
                  </th>
                  <td className="mono" dir="ltr">
                    {row.loginId}
                  </td>
                  <td>{t(`lang.${row.student.language}`)}</td>
                  <td>{row.sessionCount}</td>
                  <td>{row.lastSessionAt ? date(row.lastSessionAt) : '—'}</td>
                  <td>
                    {row.parentLinked ? (
                      <span className={`badge ${row.cameraConsent ? 'badge-ok' : ''}`}>{t(row.cameraConsent ? 'teacher.cameraConsented' : 'teacher.parentLinked')}</span>
                    ) : (
                      <span className="badge badge-muted">{t('teacher.parentNotLinked')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {created && (
        <Modal title={t('teacher.createdTitle')} onClose={() => setCreated(null)}>
          <CredentialsCard name={created.student.displayName} loginId={created.loginId} pin={created.pin} linkCode={created.linkCode} />
        </Modal>
      )}
    </div>
  );
}

function TextsTab() {
  const { t } = useTranslation();
  const { services } = useApp();
  const texts = useLoad(() => services.classroom.listTexts(), []);
  const students = useLoad(() => services.classroom.listStudents(), []);
  const [editing, setEditing] = useState<TextDoc | 'new' | null>(null);
  const [assigning, setAssigning] = useState<TextDoc | null>(null);
  const action = useAction();

  return (
    <div className="stack">
      <div className="row">
        <Button variant="primary" onClick={() => setEditing('new')}>
          {t('teacher.newText')}
        </Button>
      </div>
      {texts.loading && <Spinner label={t('common.loading')} />}
      {(texts.error || action.error) && <Notice kind="error">{texts.error ?? action.error}</Notice>}
      {texts.data && texts.data.length === 0 && <Empty title={t('teacher.noTexts')}>{t('teacher.noTextsHint')}</Empty>}
      <ul className="card-list">
        {texts.data?.map((text) => (
          <li key={text.id} className="card">
            <h3 lang={text.language} dir={text.language === 'ar' ? 'rtl' : 'ltr'}>
              {text.title}
            </h3>
            <p className="muted">
              {t(`lang.${text.language}`)} · {t(`difficulty.${text.difficulty}`)} · {t('student.words', { count: parseText(text.content).wordCount })} ·{' '}
              {t('teacher.assignedCount', { count: text.assignedTo.length })}
            </p>
            <div className="row">
              <Button onClick={() => setAssigning(text)}>{t('teacher.assign')}</Button>
              <Button onClick={() => setEditing(text)}>{t('common.edit')}</Button>
              <ConfirmButton
                label={t('common.delete')}
                confirmLabel={t('teacher.deleteTextConfirm')}
                onConfirm={async () => {
                  await action.run(() => services.classroom.deleteText(text.id));
                  texts.reload();
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <TextEditor
          text={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            texts.reload();
          }}
        />
      )}
      {assigning && (
        <AssignDialog
          text={assigning}
          students={students.data ?? []}
          onClose={() => setAssigning(null)}
          onSaved={() => {
            setAssigning(null);
            texts.reload();
          }}
        />
      )}
    </div>
  );
}

function TextEditor({ text, onClose, onSaved }: { text: TextDoc | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { services } = useApp();
  const action = useAction();
  const [title, setTitle] = useState(text?.title ?? '');
  const [content, setContent] = useState(text?.content ?? '');
  const [difficulty, setDifficulty] = useState<TextDifficulty>(text?.difficulty ?? 'moyen');
  const [fileError, setFileError] = useState<string | null>(null);
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;

  const loadFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (file.size > 200_000 || !/\.txt$/i.test(file.name)) {
      setFileError(t('teacher.fileInvalid'));
      return;
    }
    setContent(await file.text());
    if (!title) setTitle(file.name.replace(/\.txt$/i, ''));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      await services.classroom.saveText({ id: text?.id, title, content, difficulty });
      onSaved();
    });
  };

  return (
    <Modal title={t(text ? 'teacher.editText' : 'teacher.newText')} onClose={onClose} wide>
      <form onSubmit={submit} className="stack" noValidate>
        <Field label={t('teacher.textTitle')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.titleMax} dir="auto" required />
        <div className="field">
          <label htmlFor="text-content">{t('teacher.textContent')}</label>
          <textarea id="text-content" rows={12} value={content} onChange={(e) => setContent(e.target.value)} dir="auto" required />
          <p className={words > LIMITS.textMaxWords ? 'field-error' : 'field-hint'}>
            {t('teacher.textHint', { count: words, max: LIMITS.textMaxWords })}
          </p>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="text-file">{t('teacher.importFile')}</label>
            <input id="text-file" type="file" accept=".txt,text/plain" onChange={(e) => void loadFile(e.target.files?.[0])} />
            {fileError && <p className="field-error">{fileError}</p>}
          </div>
          <div className="field">
            <label htmlFor="text-difficulty">{t('teacher.difficulty')}</label>
            <select id="text-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as TextDifficulty)}>
              {(['facile', 'moyen', 'difficile'] as const).map((d) => (
                <option key={d} value={d}>
                  {t(`difficulty.${d}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {action.error && <Notice kind="error">{action.error}</Notice>}
        <div className="row">
          <Button type="submit" variant="primary" busy={action.busy} disabled={!title.trim() || !content.trim()}>
            {t('common.save')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AssignDialog({ text, students, onClose, onSaved }: { text: TextDoc; students: StudentRow[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { services } = useApp();
  const action = useAction();
  const [selected, setSelected] = useState(() => new Set(text.assignedTo));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Modal title={t('teacher.assignTitle', { title: text.title })} onClose={onClose}>
      {students.length === 0 ? (
        <Empty title={t('teacher.noStudents')}>{t('teacher.noStudentsHint')}</Empty>
      ) : (
        <fieldset className="checks">
          <legend>{t('teacher.assignLegend')}</legend>
          {students.map(({ student }) => (
            <label key={student.id}>
              <input type="checkbox" checked={selected.has(student.id)} onChange={() => toggle(student.id)} />
              {student.displayName}
            </label>
          ))}
        </fieldset>
      )}
      {action.error && <Notice kind="error">{action.error}</Notice>}
      <div className="row">
        <Button
          variant="primary"
          busy={action.busy}
          onClick={() =>
            void action.run(async () => {
              await services.classroom.assignText(text.id, [...selected]);
              onSaved();
            })
          }
        >
          {t('common.save')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
