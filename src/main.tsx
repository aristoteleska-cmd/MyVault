import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { VaultProvider, useVault } from './state/vault';
import { I18nProvider, resolveLanguage } from './i18n';
import { TRANSLATED_LANGUAGES } from './i18n/catalogues';
import './styles.css';

/**
 * Sits between the store and the app so the interface language can come from
 * the shop's saved settings. Until they pick one, it follows the language
 * chosen during installation, or failing that the Windows display language.
 */
function Localized() {
  const { db, info } = useVault();
  const saved = db.settings.language;
  const language = saved && TRANSLATED_LANGUAGES.has(saved)
    ? saved
    : resolveLanguage(saved || info?.systemLocale);

  return (
    <I18nProvider language={language}>
      <App />
    </I18nProvider>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing from index.html');

createRoot(container).render(
  <StrictMode>
    <VaultProvider>
      <Localized />
    </VaultProvider>
  </StrictMode>,
);
