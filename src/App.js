import './App.css';
import ReaderContainer from './components/Reader/ReaderContainer';
import LanguageSwitcher from './components/Controls/LanguageSwitcher';

const ENABLE_EYE_TRACKING = process.env.REACT_APP_ENABLE_EYE_TRACKING === 'true';
const ENABLE_EYE_TRACKING_DEBUG = process.env.REACT_APP_ENABLE_EYE_TRACKING_DEBUG === 'true';

const LOCALIZED_CONTENT = {
  fr: {
    paragraphs: [
      {
        sentences: [
          ['Bonjour', 'et', 'bienvenue', 'dans', 'Qalam-Sense.'],
          ['Cette', 'experience', 'adapte', 'la', 'lecture', 'en', 'temps', 'reel.'],
        ],
      },
      {
        sentences: [
          ['Le', 'systeme', 'respecte', 'la', 'direction', 'du', 'texte', 'et', 'la', 'typographie.'],
          ['Exemple', 'mixte', ':', 'Bonjour', 'مرحبا', '2026.'],
        ],
      },
    ],
  },
  ar: {
    paragraphs: [
      {
        sentences: [
          ['مرحبا', 'بك', 'في', 'Qalam-Sense.'],
          ['هذه', 'التجربة', 'تضبط', 'القراءة', 'بشكل', 'ديناميكي', 'وفوري.'],
        ],
      },
      {
        sentences: [
          ['النظام', 'يدعم', 'الاتجاه', 'والطباعة', 'والاداء', 'لفترات', 'قراءة', 'طويلة.'],
          ['مثال', 'مختلط', ':', 'Bonjour', 'مرحبا', '2026.'],
        ],
      },
    ],
  },
};

function App() {
  return (
    <main className="app-shell">
      <section className="reader-panel" aria-label="Qalam-Sense multilingual reader">
        <header className="reader-header">
          <h1 className="reader-title">Qalam-Sense Reader</h1>
          <p className="reader-subtitle">Production-grade multilingual reading for Arabic and French.</p>
          <LanguageSwitcher />
        </header>

        <ReaderContainer
          localizedContent={LOCALIZED_CONTENT}
          enableEyeTracking={ENABLE_EYE_TRACKING}
          enableEyeTrackingDebug={ENABLE_EYE_TRACKING_DEBUG}
        />
      </section>
    </main>
  );
}

export default App;
