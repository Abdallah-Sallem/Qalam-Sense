import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/app/AppContext';
import { href, navigate } from '@/app/router';
import { Button, ConfirmButton, Field, Notice, useAction } from '@/ui/components/ui';

export function AccountSettings() {
  const { t } = useTranslation();
  const { services, session, refreshSession } = useApp();
  const pw = useAction();
  const del = useAction();
  const wipe = useAction();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [changed, setChanged] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');

  const changePassword = (e: FormEvent) => {
    e.preventDefault();
    setChanged(false);
    void pw.run(async () => {
      await services.auth.changePassword(oldPassword, newPassword);
      setOld('');
      setNew('');
      setChanged(true);
    });
  };

  return (
    <div className="stack page-narrow">
      <p>
        <a href={href('')}>← {t('common.back')}</a>
      </p>
      <h1>{t('account.title')}</h1>

      <section className="card">
        <h2>{t('account.passwordTitle')}</h2>
        <form onSubmit={changePassword} className="stack" noValidate>
          <Field label={t('account.currentPassword')} type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" dir="ltr" required />
          <Field label={t('account.newPassword')} hint={t('auth.passwordHint')} type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} autoComplete="new-password" dir="ltr" required />
          {pw.error && <Notice kind="error">{pw.error}</Notice>}
          {changed && <Notice kind="success">{t('account.passwordChanged')}</Notice>}
          <Button type="submit" variant="primary" busy={pw.busy} disabled={!oldPassword || !newPassword}>
            {t('account.changePassword')}
          </Button>
        </form>
      </section>

      <section className="card">
        <h2>{t('account.storageTitle')}</h2>
        <p>{t('account.storageBody')}</p>
        <ul>
          <li>{t('account.storagePoint1')}</li>
          <li>{t('account.storagePoint2')}</li>
          <li>{t('account.storagePoint3')}</li>
        </ul>
      </section>

      <section className="card card-danger">
        <h2>{t('account.deleteTitle')}</h2>
        <p>{t(session?.role === 'teacher' ? 'account.deleteTeacherBody' : 'account.deleteParentBody')}</p>
        <Field label={t('account.currentPassword')} type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} autoComplete="current-password" dir="ltr" />
        {del.error && <Notice kind="error">{del.error}</Notice>}
        <ConfirmButton
          label={t('account.delete')}
          confirmLabel={t('account.deleteConfirm')}
          onConfirm={async () => {
            if (
              await del.run(async () => {
                await services.account.deleteOwnAccount(deletePassword);
              })
            ) {
              navigate('');
              refreshSession();
            }
          }}
        />
      </section>

      <section className="card card-danger">
        <h2>{t('account.wipeTitle')}</h2>
        <p>{t('account.wipeBody')}</p>
        {wipe.error && <Notice kind="error">{wipe.error}</Notice>}
        <ConfirmButton
          label={t('account.wipe')}
          confirmLabel={t('account.wipeConfirm')}
          onConfirm={async () => {
            if (await wipe.run(() => services.account.wipeDevice())) window.location.replace(window.location.pathname);
          }}
        />
      </section>
    </div>
  );
}
