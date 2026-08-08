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

/** Replaces {placeholders} with their values. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function I18nProvider({ language, children }: { language: string; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => {
    const catalogue = catalogues[language] ?? en;

    const t: Translate = (key, vars) => {
      // Fall back to English for anything a translation has not covered yet,
      // so a gap shows readable text instead of a raw key.
      const template = catalogue[key] ?? en[key] ?? String(key);
      return interpolate(template, vars);
    };

    return {
      language,
      rtl: RTL_LANGUAGES.has(language),
      t,
      locale: findLanguage(language)?.code ?? 'en',
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
