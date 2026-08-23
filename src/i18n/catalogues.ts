import { en, type Catalogue } from './locales/en';

/**
 * One language, read when the shop asks for it.
 *
 * The twelve translated catalogues come to about three quarters of a megabyte
 * between them, and a shop reads one. Loading all of them to display one is
 * most of what the interface used to spend before it could draw anything, on
 * exactly the kind of machine that sits behind a counter and is not replaced
 * often. So they are separate files in the bundle now, and the one that gets
 * read is the one somebody is actually reading.
 *
 * Nothing here touches the network. `import()` in a packaged Electron app reads
 * a file that shipped beside the program; the app has no internet access at all
 * and this does not give it any.
 */
const loaders = import.meta.glob<{ default: Partial<Catalogue> }>('./locales/*.json');

/**
 * Which languages have a catalogue of their own rather than falling back to
 * English. Written out rather than derived from the loaders above, because the
 * Settings screen counts them before any of them has been read, and a promise
 * is a poor thing to put in a sentence.
 */
export const TRANSLATED_LANGUAGES = new Set([
  'en', 'ar', 'de', 'el', 'es', 'fr', 'hi', 'id', 'pt', 'ru', 'tr', 'vi', 'zh-Hans',
]);

/**
 * The catalogue for one language.
 *
 * English is the source of truth and is compiled in, so it is returned without
 * waiting. Anything MyVault does not have a file for falls back to English,
 * which is also what happens if the file cannot be read — a shop with an
 * unreadable translation should get a readable app in the wrong language, not
 * an unreadable one in the right language.
 */
export async function loadCatalogue(code: string): Promise<Partial<Catalogue>> {
  if (!code || code === 'en') return en;
  const load = loaders[`./locales/${code}.json`];
  if (!load) return en;
  try {
    return (await load()).default;
  } catch {
    return en;
  }
}
