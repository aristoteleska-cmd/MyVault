import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { en, type TranslationKey } from './locales/en';
import { catalogues } from './catalogues';
import { LANGUAGES, RTL_LANGUAGES, findLanguage, resolveLanguage } from './languages';

export { LANGUAGES, findLanguage, resolveLanguage } from './languages';
export type { LanguageMeta } from './languages';
export type { TranslationKey } from './locales/en';

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface I18nValue {
  language: string;
  rtl: boolean;
  t: Translate;
  /** BCP-47 tag for Intl number and date formatting. */
  locale: string;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Replaces {placeholders} with their values.
 *
 * A number is written the way the language writes numbers — 1.234 in Greek and
 * German, 1,234 in English — so a caller can hand over the plain count and get
 * both the right digits and, through the plural rules below, the right words
 * around them. Callers that have already formatted their own string are handed
 * straight through.
 */
function interpolate(
  template: string,
  vars: Record<string, string | number> | undefined,
  locale: string,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return match;
    const value = vars[name];
    if (typeof value === 'number' && Number.isFinite(value)) {
      try {
        return new Intl.NumberFormat(locale).format(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  });
}

/**
 * The form of a word that goes with a number, in this language.
 *
 * "This will add 1 pieces to your stock" is the sort of thing a shopkeeper
 * reads once and thereafter trusts a little less, and English is the easy case:
 * Russian needs a different word for 1, for 2–4 and for 5 and up, and Arabic
 * has six forms including one for exactly two. Rather than encode any of that
 * here, the browser's own rules are asked which form a number takes, and the
 * catalogue supplies whichever forms its language actually uses — `key.one`,
 * `key.few`, `key.many` and so on beside the plain `key`.
 *
 * A catalogue that offers no form for this number falls back to the plain key,
 * so a language nobody has done this work for yet reads exactly as it did
 * before rather than breaking.
 */
const pluralRules = new Map<string, Intl.PluralRules>();

function pluralKey(
  catalogue: Record<string, string>,
  key: string,
  locale: string,
  count: unknown,
): string {
  if (typeof count !== 'number' || !Number.isFinite(count)) return key;
  let rules = pluralRules.get(locale);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      // An unknown tag is not worth failing a translation over.
      rules = new Intl.PluralRules('en');
    }
    pluralRules.set(locale, rules);
  }
  const candidate = `${key}.${rules.select(count)}`;
  return catalogue[candidate] ? candidate : key;
}

export function I18nProvider({ language, children }: { language: string; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => {
    const catalogue = catalogues[language] ?? en;

    const locale = findLanguage(language)?.code ?? 'en';

    const t: Translate = (key, vars) => {
      // Fall back to English for anything a translation has not covered yet,
      // so a gap shows readable text instead of a raw key.
      const source = (catalogue[key] !== undefined ? catalogue : en) as Record<string, string>;
      const wanted = pluralKey(source, key, source === en ? 'en' : locale, vars?.count);
      const template = source[wanted] ?? en[key] ?? String(key);
      return interpolate(template, vars, locale);
    };

    return {
      language,
      rtl: RTL_LANGUAGES.has(language),
      t,
      locale,
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>');
  return context;
}

/** Shorthand for components that only need the translate function. */
export function useT(): Translate {
  return useI18n().t;
}

/**
 * Picks the language to start in: the shop's saved choice, or failing that the
 * one chosen during installation / the Windows display language.
 */
export function useAutoLanguage() {
  return useCallback((saved: string, systemLocale: string | undefined) => {
    if (saved && catalogues[saved]) return saved;
    return resolveLanguage(systemLocale);
  }, []);
}

export const LANGUAGE_COUNT = LANGUAGES.length;
