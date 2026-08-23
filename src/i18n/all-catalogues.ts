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
 * Every translation at once — for the test that checks them, and nothing else.
 *
 * DO NOT IMPORT THIS FROM THE APP. Together these files are three quarters of a
 * megabyte, and importing them here means every one of them is read and parsed
 * before a shop can see its stock — twelve languages loaded so that one can be
 * displayed. The app loads the one language it needs through
 * `loadCatalogue` in ./catalogues.ts.
 *
 * tests/i18n.test.ts is the reason this file exists: checking that every
 * catalogue carries every key means having every catalogue, and the test is
 * bundled separately from the app, so the weight costs the shop nothing.
 */
export const catalogues: Record<string, Partial<Catalogue>> = {
  en,
  ar: ar as Partial<Catalogue>,
  de: de as Partial<Catalogue>,
  el: el as Partial<Catalogue>,
  es: es as Partial<Catalogue>,
  fr: fr as Partial<Catalogue>,
  hi: hi as Partial<Catalogue>,
  id: id as Partial<Catalogue>,
  pt: pt as Partial<Catalogue>,
  ru: ru as Partial<Catalogue>,
  tr: tr as Partial<Catalogue>,
  vi: vi as Partial<Catalogue>,
  'zh-Hans': zh_Hans as Partial<Catalogue>,
};
