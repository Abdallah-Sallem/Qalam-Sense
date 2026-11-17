import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '@/app/App';
import { useApp } from '@/app/AppContext';
import { navigate } from '@/app/router';
import { Button, Field, Notice, Tabs, useAction } from '@/ui/components/ui';

type Who = 'student' | 'parent' | 'teacher';

export function AuthPage() {
  const { t } = useTranslation();
  const [who, setWho] = useState<Who>('student');
  return (
    <main className="page page-narrow auth">
      <div className="auth-lang">
        <LanguageSwitch />
      </div>
      <header className="auth-head">
        <span className="brand-mark brand-mark-lg" aria-hidden="true">
          ق
        </span>
        <h1>Qalam-Sense</h1>
        <p className="muted">{t('auth.tagline')}</p>
      </header>
      <Tabs
        label={t('auth.whoAreYou')}
        value={who}
        onChange={setWho}
        tabs={[
          { id: 'student', label: t('roles.student') },
          { id: 'parent', label: t('roles.parent') },
          { id: 'teacher', label: t('roles.teacher') },
        ]}
      />
      <section className="card" key={who}>
        {who === 'student' ? <StudentLogin /> : <AdultAuth role={who} />}
      </section>
      <p className="muted auth-foot">{t('auth.localOnly')}</p>
    </main>
  );
}

function useSignIn() {
  const { services, refreshSession } = useApp();
  return async (login: string, secret: string) => {
    await services.auth.login(login, secret);
    navigate('');
    refreshSession();
  };
}

function StudentLogin() {
  const { t } = useTranslation();
  const signIn = useSignIn();
  const action = useAction();
  const [login, setLogin] = useState('');
  const [pin, setPin] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(() => signIn(login, pin));
  };
  return (
    <form onSubmit={submit} className="stack" noValidate>
      <h2>{t('auth.studentTitle')}</h2>
      <Field label={t('auth.studentLogin')} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" required />
      <Field
        label={t('auth.pin')}
        hint={t('auth.pinHint')}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
        inputMode="numeric"
        autoComplete="current-password"
        type="password"
        className="pin-input"
        dir="ltr"
        required
      />
      {action.error && <Notice kind="error">{action.error}</Notice>}
      <Button type="submit" variant="primary" busy={action.busy} disabled={!login || pin.length !== 4}>
        {t('auth.signIn')}
      </Button>
    </form>
  );
}

function AdultAuth({ role }: { role: 'parent' | 'teacher' }) {
  const { t } = useTranslation();
  const { services } = useApp();
  const signIn = useSignIn();
  const action = useAction();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      if (mode === 'register') await services.auth.registerAdult(role, { email, password, displayName: name });
      await signIn(email, password);
    });
  };

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <h2>{t(mode === 'login' ? `auth.${role}LoginTitle` : `auth.${role}RegisterTitle`)}</h2>
      {mode === 'register' && <Field label={t('auth.name')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} required />}
      <Field label={t('auth.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" dir="ltr" required />
      <Field
        label={t('auth.password')}
        hint={mode === 'register' ? t('auth.passwordHint') : undefined}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        dir="ltr"
        required
      />
      {mode === 'register' && <Notice kind="info">{t('auth.noRecovery')}</Notice>}
      {action.error && <Notice kind="error">{action.error}</Notice>}
      <Button type="submit" variant="primary" busy={action.busy} disabled={!email || !password || (mode === 'register' && !name)}>
        {t(mode === 'login' ? 'auth.signIn' : 'auth.createAccount')}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          action.clear();
          setMode(mode === 'login' ? 'register' : 'login');
        }}
      >
        {t(mode === 'login' ? 'auth.needAccount' : 'auth.haveAccount')}
      </Button>
    </form>
  );
}
