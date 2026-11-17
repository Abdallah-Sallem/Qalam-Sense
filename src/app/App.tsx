import { Component, useCallback, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthSession } from '@/domain/types';
import { openServices, type Services } from '@/services';
import { Button, Notice, Spinner } from '@/ui/components/ui';
import { AuthPage } from '@/ui/features/auth/AuthPage';
import { DiagnosticsPage } from '@/ui/features/diagnostics/DiagnosticsPage';
import { ParentDashboard } from '@/ui/features/parent/ParentDashboard';
import { AccountSettings } from '@/ui/features/settings/AccountSettings';
import { ReadingFlow } from '@/ui/features/student/ReadingFlow';
import { StudentHome } from '@/ui/features/student/StudentHome';
import { StudentDetail } from '@/ui/features/teacher/StudentDetail';
import { TeacherDashboard } from '@/ui/features/teacher/TeacherDashboard';
import { setLocale, type Locale } from '@/ui/i18n';
import { syntheticSourceSelected } from '@/vision/sourceFactory';
import { AppContext, useApp } from './AppContext';
import { href, navigate, useRoute } from './router';

class ErrorBoundary extends Component<{ children: ReactNode; fallback: (error: Error) => ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }
  override render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

export function App() {
  const { t } = useTranslation();
  const [services, setServices] = useState<Services | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    openServices()
      .then(async (s) => {
        const restored = await s.auth.restore();
        if (!alive) return;
        setServices(s);
        setSession(restored);
      })
      .catch((err: unknown) => alive && setBootError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, []);

  const refreshSession = useCallback(() => setSession(services?.auth.current() ?? null), [services]);

  // Sessions expire while the tab stays open: notice it without waiting for a click.
  useEffect(() => {
    if (!services) return;
    const timer = window.setInterval(() => {
      if (session && !services.auth.current()) setSession(null);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [services, session]);

  const state = useMemo(() => (services ? { services, session, refreshSession } : null), [services, session, refreshSession]);

  if (bootError) {
    return (
      <main className="page page-narrow">
        <Notice kind="error">
          <strong>{t('boot.storageTitle')}</strong>
          <p>{t('boot.storageBody')}</p>
          <p className="muted">{bootError}</p>
        </Notice>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="page page-narrow">
        <Spinner label={t('common.loading')} />
      </main>
    );
  }
  return (
    <AppContext.Provider value={state}>
      <ErrorBoundary
        fallback={(error) => (
          <main className="page page-narrow">
            <Notice kind="error">
              <strong>{t('errors.unexpected')}</strong>
              <p className="muted">{error.message}</p>
              <Button onClick={() => window.location.reload()}>{t('common.reload')}</Button>
            </Notice>
          </main>
        )}
      >
        {syntheticSourceSelected() && sessionStorage.getItem('qalam:hide-test-banner') !== '1' && <div className="test-banner">TEST MODE — synthetic gaze source, not a real camera</div>}
        <Routes session={session} />
      </ErrorBoundary>
    </AppContext.Provider>
  );
}

function Routes({ session }: { session: AuthSession | null }) {
  const route = useRoute();
  if (!session) return <AuthPage />;
  const [head, arg] = route;

  if (session.role === 'student') {
    // The reading flow owns the whole screen: no header, nothing to distract.
    if (head === 'read' && arg) return <ReadingFlow key={arg} textId={arg} />;
    return (
      <Shell session={session}>
        <StudentHome />
      </Shell>
    );
  }
  let page: ReactNode;
  if (head === 'settings') page = <AccountSettings />;
  else if (session.role === 'teacher' && head === 'student' && arg) page = <StudentDetail key={arg} studentId={arg} />;
  else if (session.role === 'teacher' && head === 'diagnostics') page = <DiagnosticsPage />;
  else page = session.role === 'teacher' ? <TeacherDashboard /> : <ParentDashboard />;
  return <Shell session={session}>{page}</Shell>;
}

function Shell({ session, children }: { session: AuthSession; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <a className="skip-link" href="#main">
        {t('common.skipToContent')}
      </a>
      <header className="topbar">
        <a className="brand" href={href('')}>
          <span className="brand-mark" aria-hidden="true">
            ق
          </span>
          Qalam-Sense
        </a>
        <nav className="topbar-nav" aria-label={t('nav.main')}>
          {session.role === 'teacher' && <a href={href('diagnostics')}>{t('nav.diagnostics')}</a>}
          {session.role !== 'student' && <a href={href('settings')}>{t('nav.settings')}</a>}
          <LanguageSwitch />
          <span className="topbar-user">
            <strong>{session.displayName}</strong>
            <span className="muted">{t(`roles.${session.role}`)}</span>
          </span>
          <LogoutButton busy={busy} setBusy={setBusy} />
        </nav>
      </header>
      <main id="main" className="page" lang={i18n.language}>
        {children}
      </main>
    </>
  );
}

function LogoutButton({ busy, setBusy }: { busy: boolean; setBusy: (b: boolean) => void }) {
  const { t } = useTranslation();
  const { services, refreshSession } = useApp();
  return (
    <Button
      variant="ghost"
      busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await services.auth.logout();
          navigate('');
          refreshSession();
        } finally {
          setBusy(false);
        }
      }}
    >
      {t('nav.logout')}
    </Button>
  );
}

export function LanguageSwitch() {
  const { i18n, t } = useTranslation();
  const next: Locale = i18n.language === 'ar' ? 'fr' : 'ar';
  return (
    <button type="button" className="btn btn-ghost" onClick={() => setLocale(next)} aria-label={t('nav.switchLanguage')} lang={next}>
      {next === 'ar' ? 'العربية' : 'Français'}
    </button>
  );
}
