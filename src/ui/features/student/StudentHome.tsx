import { useTranslation } from 'react-i18next';
import { useApp } from '@/app/AppContext';
import { href } from '@/app/router';
import { parseText } from '@/reading/text';
import { Empty, Notice, Spinner, useLoad } from '@/ui/components/ui';

export function StudentHome() {
  const { t } = useTranslation();
  const { services, session } = useApp();
  const { data, error, loading } = useLoad(() => services.student.assignedTexts(), []);

  return (
    <div className="page-narrow student-home">
      <h1>{t('student.hello', { name: session?.displayName })}</h1>
      <p className="lead">{t('student.pick')}</p>
      {loading && <Spinner label={t('common.loading')} />}
      {error && <Notice kind="error">{error}</Notice>}
      {data && data.length === 0 && <Empty title={t('student.noTexts')}>{t('student.noTextsHint')}</Empty>}
      <ul className="text-list">
        {data?.map((text) => (
          <li key={text.id}>
            <a className="text-card" href={href(`read/${text.id}`)}>
              <span className="text-card-title" lang={text.language} dir={text.language === 'ar' ? 'rtl' : 'ltr'}>
                {text.title}
              </span>
              <span className="muted">
                {t(`lang.${text.language}`)} · {t('student.words', { count: parseText(text.content).wordCount })}
              </span>
              <span className="text-card-go" aria-hidden="true">
                {t('student.read')}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
