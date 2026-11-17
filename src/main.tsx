import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled with the app: nothing is fetched from a font CDN.
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/lexend/400.css';
import '@fontsource/lexend/600.css';
import '@fontsource/noto-naskh-arabic/400.css';
import '@fontsource/noto-naskh-arabic/700.css';
import '@fontsource/opendyslexic/400.css';
import './ui/styles/app.css';
import './ui/styles/reader.css';
import { App } from './app/App';
import { initI18n } from './ui/i18n';
import { installTestHooks } from './vision/sourceFactory';

initI18n();
void installTestHooks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
