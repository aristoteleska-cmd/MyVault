import { en, type Catalogue } from './locales/en';
import de from './locales/de.json';
import el from './locales/el.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';

/**
 * Every language MyVault ships with. English is the source of truth; the JSON
 * files hold the translations, one file per language so a native speaker can
 * correct a single file without touching any code.
 *
 * A language with no file here — or with a key its file has not covered yet —
 * falls back to the English text, so the app is always readable.
 */
export const catalogues: Record<string, Partial<Catalogue>> = {
  en,
  'de': de as Partial<Catalogue>,
  'el': el as Partial<Catalogue>,
  'es': es as Partial<Catalogue>,
  'fr': fr as Partial<Catalogue>,
  'pt': pt as Partial<Catalogue>,
  'ru': ru as Partial<Catalogue>,
};

export const TRANSLATED_LANGUAGES = new Set(Object.keys(catalogues));
