import { en, type Catalogue } from './locales/en';
import ar from './locales/ar.json';
import de from './locales/de.json';
import el from './locales/el.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import hi from './locales/hi.json';
import id from './locales/id.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import tr from './locales/tr.json';
import vi from './locales/vi.json';
import zh_Hans from './locales/zh-Hans.json';

/**
 * The translations MyVault ships with. English is the source of truth; each
 * other language is one JSON file, so a native speaker can correct a language
 * without touching any code.
 *
 * A language listed in `languages.ts` but missing here — or a key its file has
 * not covered yet — falls back to the English text, so the app is always
 * readable and never shows a raw key.
 */
export const catalogues: Record<string, Partial<Catalogue>> = {
  en,
  'ar': ar as Partial<Catalogue>,
  'de': de as Partial<Catalogue>,
  'el': el as Partial<Catalogue>,
  'es': es as Partial<Catalogue>,
  'fr': fr as Partial<Catalogue>,
  'hi': hi as Partial<Catalogue>,
  'id': id as Partial<Catalogue>,
  'pt': pt as Partial<Catalogue>,
  'ru': ru as Partial<Catalogue>,
  'tr': tr as Partial<Catalogue>,
  'vi': vi as Partial<Catalogue>,
  'zh-Hans': zh_Hans as Partial<Catalogue>,
};

/** Languages that have their own catalogue rather than falling back to English. */
export const TRANSLATED_LANGUAGES = new Set(Object.keys(catalogues));
